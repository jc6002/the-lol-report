import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import * as attributionExportModule from "@/utils/attribution-export";
import {
  buildStudyExportPayload,
  getStudyAttributionPdfFilename,
} from "@/utils/attribution-export";
import {
  computeWilsonConfidenceInterval,
  UNATTRIBUTED_BUCKET_KEY,
  UNATTRIBUTED_BUCKET_LABEL,
  type AttributionLeaderboardRow,
  type SameImageComparisonGroup,
} from "@/utils/attribution-stats";
import * as pdfReportBuilderModule from "@/utils/pdf-report-builder";
import {
  buildStudyPdfReportData,
  renderStudyAttributionPdf,
} from "@/utils/pdf-report-builder";
import {
  encodePdfLiteralString,
  encodePdfMetadataTextString,
  fitFontSizeToWidth,
  getWinAnsiGlyphAdvance,
  layoutRichTextRuns,
  measureTextWidthPt,
  normalizeToWinAnsiText,
  PDF_COLORS,
  PDF_CONTENT_RIGHT_X_PT,
  PDF_CONTENT_WIDTH_PT,
  PDF_MARGIN_X_PT,
  PDF_MAX_BODY_BOTTOM_Y_PT,
  PdfDocumentBuilder,
  toWinAnsiBytes,
  wrapTextLines,
} from "@/utils/pdf-report-engine";
import type { AdaptedStudyExposures } from "@/utils/study-exposure-adapter";
import type { StudyAttributionBundle } from "@/utils/study-lineage-loader";

const pdfInfoCommand = process.env.PDFINFO_BIN ?? "pdfinfo";
const pdfToTextCommand = process.env.PDFTOTEXT_BIN ?? "pdftotext";
const ghostscriptCommand = process.env.GHOSTSCRIPT_BIN ??
  (process.platform === "win32" ? "gswin64c" : "gs");

const expectValidPopplerAndGhostscriptPdf = (
  pdfBytes: Uint8Array,
): {
  pageCount: number;
  title: string;
  extractedText: string;
  bboxXml: string;
} => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lol-pdf-test-"));
  const pdfPath = path.join(tmpDir, "report.pdf");
  const txtPath = path.join(tmpDir, "report.txt");
  const bboxPath = path.join(tmpDir, "report-bbox.html");
  try {
    fs.writeFileSync(pdfPath, pdfBytes);

    const infoOut = execFileSync(pdfInfoCommand, [pdfPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.match(infoOut, /PDF version:\s+1\.4/);
    assert.match(infoOut, /Page size:\s+612 x 792 pts \(letter\)/);
    const titleMatch = /^Title:\s*(.+)$/m.exec(infoOut);
    const title = titleMatch ? titleMatch[1]?.trim() ?? "" : "";
    assert.ok(
      !title.includes("\u0160"),
      `PDF /Info /Title must not contain PDFDocEncoding Scaron mojibake: ${title}`,
    );
    const pagesMatch = /Pages:\s+(\d+)/.exec(infoOut);
    assert.ok(pagesMatch, "pdfinfo should report page count");
    const pageCount = Number(pagesMatch[1]);
    assert.ok(pageCount >= 1);

    execFileSync(pdfToTextCommand, [pdfPath, txtPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const extractedText = fs.readFileSync(txtPath, "utf8");

    execFileSync(pdfToTextCommand, ["-bbox-layout", pdfPath, bboxPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const bboxXml = fs.readFileSync(bboxPath, "utf8");

    execFileSync(
      ghostscriptCommand,
      ["-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=nullpage", pdfPath],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    return { pageCount, title, extractedText, bboxXml };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

const expectExactPdfAsciiStructure = (pdfBytes: Uint8Array): string => {
  for (let i = 0; i < pdfBytes.length; i += 1) {
    const b = pdfBytes[i] ?? 0;
    assert.ok(
      b === 0x0a || (b >= 0x20 && b <= 0x7e),
      `Byte at offset ${i} (0x${b.toString(16)}) must be pure 7-bit ASCII`,
    );
  }

  const ascii = new TextDecoder("utf-8").decode(pdfBytes);
  assert.equal(
    ascii.length,
    pdfBytes.byteLength,
    "7-bit ASCII string length must equal UTF-8 byteLength 1-for-1",
  );
  assert.ok(ascii.startsWith("%PDF-1.4\n"));
  assert.ok(ascii.endsWith("%%EOF\n"));

  // Every Type1 font dictionary (F1..F6 including Helvetica-BoldOblique) must declare /Encoding /WinAnsiEncoding.
  const fontMatches = ascii.match(/<< \/Type \/Font [^>]+ >>/g) ?? [];
  assert.equal(fontMatches.length, 6);
  for (const fontDict of fontMatches) {
    assert.match(fontDict, /\/Encoding \/WinAnsiEncoding/);
  }
  assert.match(ascii, /\/BaseFont \/Helvetica-BoldOblique/);

  // Verify every stream /Length matches exact stream payload bytes.
  const streamRegex = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/g;
  let streamMatch: RegExpExecArray | null;
  let streamCount = 0;
  while ((streamMatch = streamRegex.exec(ascii)) !== null) {
    streamCount += 1;
    const declaredLen = Number(streamMatch[1]);
    const actualBody = streamMatch[2] ?? "";
    assert.equal(actualBody.length, declaredLen);
  }
  assert.ok(streamCount >= 1);

  // Verify every 10-digit xref offset points to the exact object header byte.
  const startxrefMatch = /startxref\n(\d+)\n%%EOF\n$/.exec(ascii);
  assert.ok(startxrefMatch, "PDF must end with startxref offset");
  const xrefStart = Number(startxrefMatch[1]);
  assert.equal(ascii.slice(xrefStart, xrefStart + 5), "xref\n");

  const xrefLines = ascii
    .slice(xrefStart)
    .split("\n")
    .filter((line) => /^\d{10} 00000 n $/.test(line));
  assert.ok(xrefLines.length >= 11);
  xrefLines.forEach((line, idx) => {
    const objId = idx + 1;
    const offset = Number(line.slice(0, 10));
    const expectedPrefix = `${objId} 0 obj\n`;
    assert.equal(
      ascii.slice(offset, offset + expectedPrefix.length),
      expectedPrefix,
    );
  });

  return ascii;
};

const makeFlavorRow = (
  overrides: Partial<AttributionLeaderboardRow> & {
    key: string;
    label: string;
  },
): AttributionLeaderboardRow => ({
  kind: "flavor",
  isUnattributed: false,
  flavorId: 1,
  modelId: null,
  subtitle: null,
  stepCount: 3,
  dominantModelLabel: "Gemini 2.5 Pro",
  pipelineSteps: ["Gemini 2.5 Flash", "Gemini 2.5 Pro"],
  flavorCount: 1,
  captionCount: 12,
  exposures: 240,
  positive: 86,
  rate: 86 / 240,
  ciLow: 0.3,
  ciHigh: 0.42,
  sharedImageCount: 6,
  imageBaselineMean: 0.28,
  meanLift: 0.078,
  meanLiftPp: 7.8,
  pairWins: 5,
  pairLosses: 1,
  pairTies: 0,
  pairWinRate: 5 / 6,
  medianChainSeconds: 4.6,
  medianDwellMs: 3100,
  ...overrides,
});

const makeStudyBundle = (
  overrides?: Partial<StudyAttributionBundle>,
): StudyAttributionBundle => {
  const exposureBundle: AdaptedStudyExposures = {
    studyId: 20,
    mode: "swipe_navigation",
    isTransitionalLikert: false,
    detailHref: "/study/20/new-style-report",
    exposureUnitLabel: "seen cards",
    exposures: [],
    allExposureCount: 1200,
    allPositiveCount: 432,
    totalExposures: 1200,
    totalPositive: 432,
    distinctVoters: 96,
    medianStudyDwellMs: 2850,
    highRiskProfileIds: new Set(["r1", "r2", "r3"]),
    highRiskVoterCount: 3,
    excludedVoterCount: 0,
    excludedExposureCount: 0,
    userDiagnostics: new Map(),
    reconciliation: {
      rawNavigationEventCount: 1220,
      rawVoteEventCount: 440,
      timedVoteCount: 0,
      untimedVoteCount: 0,
    },
  };

  return {
    study: {
      id: 20,
      slug: "2026-10-14-campus-humor-benchmark",
      description: "Campus humor multi-flavor benchmark",
      start_datetime_utc: "2026-10-14T09:00:00Z",
      end_datetime_utc: "2026-10-21T23:59:00Z",
      created_datetime_utc: "2026-10-13T12:00:00Z",
      is_hidden: false,
      is_private: false,
    },
    studies: [],
    excludeHighRisk: false,
    mappedCaptionCount: 60,
    unattributedCaptionCount: 4,
    metadataAttributedCaptionCount: 2,
    studyRateCi: computeWilsonConfidenceInterval(432, 1200),
    exposureBundle,
    participationFunnel: {
      participationsStarted: 102,
      participationsEnded: 96,
      completionRate: 96 / 102,
      medianRunMinutes: 2.35,
      distinctVoters: 96,
      judgedAtLeastOneCount: 96,
      retentionCurve: [],
    },
    captionsById: new Map(),
    leaderboards: {
      flavors: [
        makeFlavorRow({
          key: "flavor:1",
          flavorId: 1,
          label: "deadpan_campus_observation_v3_hyper_specific",
          dominantModelLabel: "GPT-4.1",
          exposures: 400,
          positive: 168,
          rate: 0.42,
          ciLow: 0.372,
          ciHigh: 0.469,
          meanLiftPp: 11.4,
        }),
        makeFlavorRow({
          key: "flavor:2",
          flavorId: 2,
          label: "generic-one-shot-baseline",
          dominantModelLabel: "GPT-4o Mini",
          exposures: 400,
          positive: 96,
          rate: 0.24,
          ciLow: 0.201,
          ciHigh: 0.284,
          meanLiftPp: -6.6,
        }),
        makeFlavorRow({
          key: UNATTRIBUTED_BUCKET_KEY,
          kind: "unattributed",
          isUnattributed: true,
          flavorId: null,
          label: UNATTRIBUTED_BUCKET_LABEL,
          dominantModelLabel: null,
          stepCount: null,
          exposures: 50,
          positive: 15,
          rate: 0.3,
          ciLow: 0.191,
          ciHigh: 0.437,
          sharedImageCount: 0,
          meanLiftPp: null,
        }),
      ],
      models: [
        makeFlavorRow({
          key: "model:10",
          kind: "model",
          flavorId: null,
          modelId: 10,
          label: "GPT-4.1",
          subtitle: "OpenAI",
          flavorCount: 3,
          captionCount: 36,
          exposures: 700,
          positive: 280,
          rate: 0.4,
          ciLow: 0.364,
          ciHigh: 0.437,
          medianChainSeconds: 5.2,
        }),
      ],
      pipelines: [],
    },
    headToHead: {
      structuralSharedImageCount: 12,
      evaluatedSharedImageCount: 12,
      crossFlavorSharedImageCount: 12,
      comparableCaptionCount: 60,
      maxImageSpreadPp: 32.5,
      groups: [
        {
          imageId: "img-1",
          imageUrl: null,
          imageDescription:
            "Exhausted graduate students staring at a projector displaying a 47-slide methods appendix during a rainy Friday seminar",
          totalExposures: 120,
          imageMeanRate: 0.31,
          spreadPp: 32.5,
          captions: [
            {
              captionId: "cap-win",
              captionText:
                "“Let’s circle back” — when the café Wi-Fi dies at 2:47 AM 💀😭",
              flavorId: 1,
              flavorKey: "flavor:1",
              flavorSlug: "deadpan_campus_observation_v3_hyper_specific",
              terminalModelLabel: "GPT-4.1",
              exposures: 60,
              positive: 28,
              rate: 28 / 60,
              ciLow: 0.346,
              ciHigh: 0.591,
              liftPp: 15.7,
            },
            {
              captionId: "cap-low",
              captionText: '"Monday mood! 😂🔥"',
              flavorId: 2,
              flavorKey: "flavor:2",
              flavorSlug: "generic-one-shot-baseline",
              terminalModelLabel: "GPT-4o Mini",
              exposures: 60,
              positive: 8,
              rate: 8 / 60,
              ciLow: 0.069,
              ciHigh: 0.242,
              liftPp: -17.7,
            },
          ],
        },
      ],
    },
    demographics: {
      studyVoterCount: 96,
      surveyedVoterCount: 68,
      totalVisibleSegments: 6,
      totalMaskedSegments: 1,
      flavorColumns: [],
      questions: [],
      tasteGaps: [
        {
          questionId: 1,
          questionText: "What is your academic year?",
          questionLabel: "Academic Year",
          flavorId: 1,
          flavorKey: "flavor:1",
          flavorSlug: "deadpan_campus_observation_v3_hyper_specific",
          highAnswerLabel: "Graduate / PhD",
          highRate: 0.54,
          highVoters: 22,
          lowAnswerLabel: "First-year undergrad",
          lowRate: 0.29,
          lowVoters: 19,
          spreadPp: 25.0,
        },
      ],
    },
    ...overrides,
  };
};

describe("Pure-Vector %PDF-1.4 Written Research Report Engine & Export", () => {
  it("enforces single-study-only PDF scope with zero global Home Hub PDF exports", () => {
    assert.equal(
      "GLOBAL_ATTRIBUTION_PDF_FILENAME" in attributionExportModule,
      false,
    );
    assert.equal("buildGlobalPdfReportData" in pdfReportBuilderModule, false);
    assert.equal("renderGlobalAttributionPdf" in pdfReportBuilderModule, false);

    assert.equal(
      getStudyAttributionPdfFilename(20, false),
      "study-20-attribution-report.pdf",
    );
    assert.equal(
      getStudyAttributionPdfFilename(20, true),
      "study-20-attribution-report-clean-raters.pdf",
    );
  });

  it("normalizes Unicode punctuation, math symbols, accented Latin, and emoji to pure WinAnsi octal escapes without mojibake", () => {
    const sample =
      "Study #20 — Apr 17–21 · +8.3 pp (±2.1) “smart” ‘quotes’ … ≥5 ≤10 → café Łódź 💀🔥 (paren\\slash)";
    const normalized = normalizeToWinAnsiText(sample);
    assert.ok(!normalized.includes("\u{1F480}"));
    assert.ok(!normalized.includes("??"));
    assert.ok(normalized.includes("cafe") || normalized.includes("caf\u00e9"));
    assert.ok(normalized.includes("Lodz") || normalized.includes("L\u00f3dz"));
    assert.ok(normalized.includes(">=5"));
    assert.ok(normalized.includes("->"));

    const winAnsi = toWinAnsiBytes(sample);
    assert.ok(winAnsi.includes(0x97)); // em-dash
    assert.ok(winAnsi.includes(0x96)); // en-dash
    assert.ok(winAnsi.includes(0xb7)); // middle dot
    assert.ok(winAnsi.includes(0xb1)); // plus-minus
    assert.ok(winAnsi.includes(0x93)); // left double quote
    assert.ok(winAnsi.includes(0x85)); // ellipsis

    const literal = encodePdfLiteralString(sample);
    assert.match(literal, /\\227/);
    assert.match(literal, /\\226/);
    assert.match(literal, /\\267/);
    assert.match(literal, /\\\(paren\\\\slash\\\)/);
    for (let i = 0; i < literal.length; i += 1) {
      const code = literal.charCodeAt(i);
      assert.ok(code >= 0x20 && code <= 0x7e);
    }

    assert.equal(encodePdfMetadataTextString("Plain ASCII"), "(Plain ASCII)");
    const utf16Meta = encodePdfMetadataTextString("Study #20 — Apr 17");
    assert.match(utf16Meta, /^<FEFF[0-9A-F]+>$/);
    assert.ok(utf16Meta.includes("2014"));
  });

  it("measures exact Core-14 F1..F6 AFM glyph widths and layouts mixed-run prose without orphaning punctuation", () => {
    assert.equal(getWinAnsiGlyphAdvance(0x20, "F1"), 278);
    assert.equal(getWinAnsiGlyphAdvance(0x41, "F1"), 667);
    assert.equal(getWinAnsiGlyphAdvance(0x41, "F2"), 722);
    assert.equal(getWinAnsiGlyphAdvance(0x41, "F6"), 722);
    assert.equal(getWinAnsiGlyphAdvance(0x97, "F1"), 1000);
    assert.equal(getWinAnsiGlyphAdvance(0x41, "F4"), 600);
    assert.equal(getWinAnsiGlyphAdvance(0x41, "F5"), 600);

    assert.equal(measureTextWidthPt("A", "F1", 10), 6.67);
    assert.equal(measureTextWidthPt("abcde", "F4", 10), 30);

    const fitted = fitFontSizeToWidth({
      text: "deadpan_campus_observation_v3_hyper_specific",
      font: "F2",
      preferredSizePt: 15,
      minSizePt: 9,
      maxWidthPt: 108,
    });
    assert.ok(fitted >= 9 && fitted < 15);

    const slugLines = wrapTextLines(
      "_deadpan_campus_observation_v3_hyper_specific_and_extra_verbose_chain",
      {
        font: "F5",
        fontSizePt: 8.5,
        maxWidthPt: 140,
      },
    );
    assert.ok(slugLines.length >= 2);
    assert.ok(slugLines[0]?.startsWith("_deadpan_"));
    for (const line of slugLines) {
      assert.ok(measureTextWidthPt(line, "F5", 8.5) <= 138);
    }

    // Verify rank prefixes ("5. ") stay attached to compound hyphenated slugs instead of stranding alone.
    const rankedSlugBlock = layoutRichTextRuns(
      [
        { text: "5. ", font: "F2", fontSizePt: 8.5 },
        {
          text: "flavor-huh-oh-wait-thats-good",
          font: "F5",
          fontSizePt: 8,
        },
      ],
      {
        maxWidthPt: 148,
        lineHeightPt: 11.8,
        cushionPt: 1.5,
      },
    );
    assert.equal(rankedSlugBlock.lines.length, 2);
    assert.match(
      rankedSlugBlock.lines[0]?.spans.map((s) => s.text).join("") ?? "",
      /^5\. flavor-huh-/,
    );

    // Verify mixed-run inline flow keeps bold number + trailing period attached as one word.
    const mixedBlock = layoutRichTextRuns(
      [
        { text: "Positive reception reached ", font: "F1", fontSizePt: 9.5 },
        { text: "47.7%", font: "F2", fontSizePt: 9.5 },
        { text: ". Flavor ", font: "F1", fontSizePt: 9.5 },
        {
          text: "deadpan_campus_observation_v3_hyper_specific",
          font: "F4",
          fontSizePt: 9,
        },
        { text: " led.\nSecond explicit line.", font: "F3", fontSizePt: 9.5 },
      ],
      {
        maxWidthPt: 150,
        lineHeightPt: 14,
      },
    );
    assert.ok(mixedBlock.lines.length >= 3);
    assert.equal(mixedBlock.heightPt, mixedBlock.lines.length * 14);
    for (const line of mixedBlock.lines) {
      assert.ok(line.widthPt <= 148.01);
      const joinedText = line.spans.map((s) => s.text).join("");
      assert.notEqual(joinedText.trim(), ".");
    }
  });

  it("enforces the 500 pt US Letter measure and 730 pt body ceiling while allowing Pass-2 centered footers", () => {
    assert.equal(PDF_MARGIN_X_PT, 56);
    assert.equal(PDF_CONTENT_RIGHT_X_PT, 556);
    assert.equal(PDF_CONTENT_WIDTH_PT, 500);
    assert.equal(PDF_MAX_BODY_BOTTOM_Y_PT, 730);

    const doc = new PdfDocumentBuilder();
    doc.drawRect({
      x: 56,
      topY: 710,
      width: 500,
      height: 18,
      fill: PDF_COLORS.infoNoteBg,
    });
    assert.throws(() => {
      doc.drawRect({
        x: 56,
        topY: 720,
        width: 500,
        height: 15,
        fill: PDF_COLORS.infoNoteBg,
      });
    }, /730 pt body ceiling/);

    doc.stampStudyReportFooters(20);
    const bytes = doc.compile({
      title: "Ceiling Test",
      subject: "Unit test",
    });
    expectExactPdfAsciiStructure(bytes);
  });

  it("compiles a house-style written research report with zero SaaS web-dashboard chrome and valid Poppler/Ghostscript structure", () => {
    const cleanBundle = makeStudyBundle({
      excludeHighRisk: true,
      exposureBundle: {
        ...makeStudyBundle().exposureBundle,
        excludedVoterCount: 7,
        excludedExposureCount: 140,
      },
    });
    const exportPayload = buildStudyExportPayload(cleanBundle);
    assert.equal(
      exportPayload.pdfFilename,
      "study-20-attribution-report-clean-raters.pdf",
    );

    const pdfBytes = renderStudyAttributionPdf(exportPayload.pdfReport);
    expectExactPdfAsciiStructure(pdfBytes);

    const { pageCount, title, extractedText, bboxXml } =
      expectValidPopplerAndGhostscriptPdf(pdfBytes);
    assert.ok(pageCount >= 1);
    assert.match(title, /Study #20 Empirical Attribution Report —/);
    assert.match(
      extractedText,
      /EMPIRICAL STUDY REPORT\s+·\s+STUDY #20\s+·\s+RUSHED RATERS EXCLUDED/,
    );
    assert.match(
      extractedText.replace(/\s+/g, " "),
      /Study #20 \(Campus Humor Benchmark · Oct 14, 2026\): deadpan_campus_observation_v3_hyper_specific leads 2 prompt flavors at 42\.0% positive reception/,
    );
    assert.match(extractedText, /7 rushed raters excluded/);
    assert.match(extractedText, /01 · Study scope & headline findings/);
    assert.match(extractedText, /02 · Prompt flavor & model attribution/);
    assert.match(extractedText, /03 · Audience cohort reception/);
    assert.match(extractedText, /04 · Controlled same-image caption comparisons/);
    assert.match(extractedText, /Takeaway:/);
    assert.match(extractedText, /Let’s circle back/);
    assert.match(extractedText, /“Monday mood!”/);
    assert.match(
      extractedText,
      /The LOL Report\s+·\s+Study #20 Empirical Attribution Report\s+·\s+Page 1 of/,
    );

    // Zero SaaS web-dashboard print chrome allowed in extracted text.
    assert.ok(!extractedText.includes("PARTICIPANTS & COMPLETION"));
    assert.ok(!extractedText.includes("STUDY LIKE RATE"));
    assert.ok(!extractedText.includes("WINNER ·"));
    assert.ok(!extractedText.includes("LOWEST ·"));
    assert.ok(!extractedText.includes("Ã"));
    assert.ok(!extractedText.includes("â€"));

    // Verify horizontal bounds stay strictly within [56.0 .. 556.0 pt] (with sub-pixel tolerance).
    const wordMatches = [
      ...bboxXml.matchAll(
        /<word xMin="([0-9.]+)" yMin="([0-9.]+)" xMax="([0-9.]+)" yMax="([0-9.]+)">/g,
      ),
    ];
    assert.ok(wordMatches.length > 50);
    for (const m of wordMatches) {
      const xMin = Number(m[1]);
      const xMax = Number(m[3]);
      const yMax = Number(m[4]);
      assert.ok(xMin >= 55.0, `Word xMin=${xMin} must be >= 56 pt margin`);
      assert.ok(xMax <= 557.5, `Word xMax=${xMax} must be <= 556 pt margin`);
      assert.ok(yMax <= 760.0, `Word yMax=${yMax} must stay above page bottom`);
    }
  });

  it("paginates multi-page flavor & comparison tables cleanly with (continued) headings and repeated #E8F0FE headers", () => {
    const manyFlavors: AttributionLeaderboardRow[] = Array.from(
      { length: 24 },
      (_, idx) =>
        makeFlavorRow({
          key: `flavor:${idx + 1}`,
          flavorId: idx + 1,
          label: `experimental_humor_chain_variant_${idx + 1}_long_slug_identifier`,
          exposures: 300 - idx * 5,
          positive: 120 - idx * 2,
          rate: (120 - idx * 2) / (300 - idx * 5),
          ciLow: 0.3,
          ciHigh: 0.48,
          meanLiftPp: 12 - idx,
        }),
    );

    const manyGroups: SameImageComparisonGroup[] = Array.from(
      { length: 5 },
      (_, idx) => ({
        imageId: `img-${idx + 1}`,
        imageUrl: null,
        imageDescription: `Detailed visual scene #${idx + 1} with an intentionally lengthy description testing prompt truncation and four-column comparison table wrapping`,
        totalExposures: 180,
        imageMeanRate: 0.34,
        spreadPp: 28.4 - idx * 2,
        captions: [
          {
            captionId: `w-${idx}`,
            captionText:
              "When the group chat agrees on a 9 AM study session and nobody sets an alarm — classic tragedy in three acts.",
            flavorId: 1,
            flavorKey: "flavor:1",
            flavorSlug: "experimental_humor_chain_variant_1",
            terminalModelLabel: "Gemini 2.5 Pro",
            exposures: 90,
            positive: 46,
            rate: 46 / 90,
            ciLow: 0.4,
            ciHigh: 0.61,
            liftPp: 17.1,
          },
          {
            captionId: `l-${idx}`,
            captionText: "Too early for class today, need more coffee immediately.",
            flavorId: 2,
            flavorKey: "flavor:2",
            flavorSlug: "experimental_humor_chain_variant_2",
            terminalModelLabel: "GPT-4o Mini",
            exposures: 90,
            positive: 20,
            rate: 20 / 90,
            ciLow: 0.14,
            ciHigh: 0.32,
            liftPp: -11.3,
          },
        ],
      }),
    );

    const bundle = makeStudyBundle({
      leaderboards: {
        ...makeStudyBundle().leaderboards,
        flavors: manyFlavors,
      },
      headToHead: {
        ...makeStudyBundle().headToHead,
        groups: manyGroups,
      },
    });

    const report = buildStudyPdfReportData(bundle, {
      generatedAtUtc: "2026-11-06T14:30:00Z",
    });
    const pdfBytes = renderStudyAttributionPdf(report);
    expectExactPdfAsciiStructure(pdfBytes);

    const { pageCount, extractedText } =
      expectValidPopplerAndGhostscriptPdf(pdfBytes);
    assert.ok(pageCount >= 2, `Expected multi-page report, got ${pageCount}`);
    assert.match(
      extractedText,
      /02 · Prompt flavor & model attribution \(continued\)|04 · Controlled same-image caption comparisons \(continued\)/,
    );
    assert.match(extractedText, new RegExp(`Page ${pageCount} of ${pageCount}`));
  });

  it("enforces k >= 5 cohort privacy masking, zero-vote staging study flow, and empty study note boxes", () => {
    // 1. Sub-threshold surveyed voters (n = 3 < 5) must emit warning note box and mask exact 3 count.
    const lowSurveyBundle = makeStudyBundle({
      demographics: {
        studyVoterCount: 40,
        surveyedVoterCount: 3,
        totalVisibleSegments: 0,
        totalMaskedSegments: 3,
        flavorColumns: [],
        questions: [],
        tasteGaps: [
          {
            questionId: 9,
            questionText: "Hidden sub-threshold gap",
            flavorId: 1,
            flavorKey: "flavor:1",
            flavorSlug: "flavor-1",
            highAnswerLabel: "Group A",
            highRate: 0.8,
            highVoters: 3,
            lowAnswerLabel: "Group B",
            lowRate: 0.2,
            lowVoters: 2,
            spreadPp: 60,
          },
        ],
      },
    });
    const lowSurveyReport = buildStudyPdfReportData(lowSurveyBundle);
    const lowSurveySec3 = lowSurveyReport.sections[2]!;
    assert.equal(lowSurveySec3.primaryTable, undefined);
    assert.equal(lowSurveySec3.primaryNoteBox?.tone, "warning");
    const lowSurveyPdf = renderStudyAttributionPdf(lowSurveyReport);
    const { extractedText: lowSurveyText } =
      expectValidPopplerAndGhostscriptPdf(lowSurveyPdf);
    assert.ok(!lowSurveyText.includes("3 of 40"));
    assert.ok(!lowSurveyText.includes("Hidden sub-threshold gap"));
    assert.match(lowSurveyText, /withheld under the k >= 5 privacy threshold/);

    // 2. Zero-vote staging study renders 2-section staging flow without NaN% or 0/0 rates.
    const base = makeStudyBundle();
    const stagingBundle = makeStudyBundle({
      study: { ...base.study, id: 123, is_private: true },
      mappedCaptionCount: 18,
      studyRateCi: { rate: null, low: null, high: null },
      exposureBundle: {
        ...base.exposureBundle,
        studyId: 123,
        totalExposures: 0,
        totalPositive: 0,
        allExposureCount: 0,
        allPositiveCount: 0,
        distinctVoters: 0,
      },
      captionMetrics: [
        {
          captionId: "s1",
          captionText: "Staged campus joke #1 ready for tomorrow’s test run",
          imageUrl: null,
          imageDescription: "Library desk",
          exposures: 0,
          positive: 0,
          rate: null,
          ciLow: null,
          ciHigh: null,
          flavorSlug: "staged_witty_flavor",
          modelName: "Gemini 2.5 Pro",
        },
      ],
    });
    const stagingReport = buildStudyPdfReportData(stagingBundle);
    assert.equal(stagingReport.isZeroVoteStagingStudy, true);
    assert.equal(stagingReport.sections.length, 2);
    const stagingBytes = renderStudyAttributionPdf(stagingReport);
    expectExactPdfAsciiStructure(stagingBytes);
    const { extractedText: stagingText } =
      expectValidPopplerAndGhostscriptPdf(stagingBytes);
    assert.match(stagingText, /STAGING DECK/);
    assert.match(stagingText, /01 · Study scope & staging status/);
    assert.match(stagingText, /02 · Staged flavor configuration & sample captions/);
    assert.match(stagingText, /“Staged campus joke #1/);
    assert.ok(!stagingText.includes("NaN"));

    // 3. Empty 0-caption study renders clean info note box.
    const emptyBundle = makeStudyBundle({
      mappedCaptionCount: 0,
      exposureBundle: {
        ...base.exposureBundle,
        totalExposures: 0,
        totalPositive: 0,
        distinctVoters: 0,
      },
      leaderboards: { flavors: [], models: [], pipelines: [] },
    });
    const emptyBytes = renderStudyAttributionPdf(
      buildStudyPdfReportData(emptyBundle),
    );
    expectExactPdfAsciiStructure(emptyBytes);
    const { extractedText: emptyText } =
      expectValidPopplerAndGhostscriptPdf(emptyBytes);
    assert.match(emptyText, /Study deck awaiting caption assignment/);

    // 4. Single-flavor Likert study renders curly quotes and within-flavor dispersion narrative (zero tautological cross-flavor winner claims).
    const singleFlavorLikertBundle = makeStudyBundle({
      study: { ...base.study, id: 5, slug: "extra-credit" },
      exposureBundle: {
        ...base.exposureBundle,
        studyId: 5,
        mode: "likert_votes",
        exposureUnitLabel: "votes",
      },
      leaderboards: {
        ...base.leaderboards,
        flavors: [
          makeFlavorRow({
            key: "flavor:1",
            flavorId: 1,
            label: "ter-re-lyn-sidechat",
            dominantModelLabel: "GPT-4.1",
            exposures: 1200,
            positive: 503,
            rate: 503 / 1200,
            ciLow: 0.391,
            ciHigh: 0.447,
            meanLiftPp: 0,
          }),
        ],
      },
      headToHead: {
        ...base.headToHead,
        groups: [
          {
            imageId: "img-spongebob",
            imageUrl: null,
            imageDescription:
              'Patrick Star from the animated series "SpongeBob SquarePants." stands awkwardly.',
            totalExposures: 120,
            imageMeanRate: 0.449,
            spreadPp: 45.3,
            captions: [
              {
                captionId: "c1",
                captionText: "me realizing I have three finals left",
                flavorId: 1,
                flavorKey: "flavor:1",
                flavorSlug: "ter-re-lyn-sidechat",
                terminalModelLabel: "GPT-4.1",
                exposures: 60,
                positive: 46,
                rate: 46 / 60,
                ciLow: 0.64,
                ciHigh: 0.85,
                liftPp: 22.6,
              },
              {
                captionId: "c2",
                captionText: "when the test bank drops",
                flavorId: 1,
                flavorKey: "flavor:1",
                flavorSlug: "ter-re-lyn-sidechat",
                terminalModelLabel: "GPT-4.1",
                exposures: 60,
                positive: 19,
                rate: 19 / 60,
                ciLow: 0.21,
                ciHigh: 0.44,
                liftPp: -22.6,
              },
            ],
          },
        ],
      },
    });
    const singleFlavorBytes = renderStudyAttributionPdf(
      buildStudyPdfReportData(singleFlavorLikertBundle),
    );
    expectExactPdfAsciiStructure(singleFlavorBytes);
    const { extractedText: singleFlavorText } =
      expectValidPopplerAndGhostscriptPdf(singleFlavorBytes);
    const flatSingle = singleFlavorText.replace(/\s+/g, " ");
    assert.match(flatSingle, /“funny” and “very funny” ratings/);
    assert.match(flatSingle, /“SpongeBob SquarePants\.”/);
    assert.match(flatSingle, /isolates punchline-level variance/);
    assert.match(flatSingle, /Within-prompt punchline reception diverges by \+45\.0 pp/);
    assert.ok(!flatSingle.includes("capturing the highest-rated caption"));
  });
});
