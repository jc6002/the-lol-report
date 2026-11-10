export type PdfFontId = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";

export type PdfRgb = readonly [number, number, number];

export type PdfTextAlign = "left" | "right" | "center";

export interface PdfTextRun {
  readonly text: string;
  readonly font?: PdfFontId;
  readonly fontSizePt?: number;
  readonly color?: PdfRgb;
}

export interface LayoutRichTextOptions {
  readonly maxWidthPt: number;
  readonly lineHeightPt: number;
  readonly defaultFont?: PdfFontId;
  readonly defaultFontSizePt?: number;
  readonly defaultColor?: PdfRgb;
  readonly align?: PdfTextAlign;
  readonly cushionPt?: number;
  readonly maxLines?: number;
}

export interface PdfPositionedRunSpan {
  readonly offsetXPt: number;
  readonly widthPt: number;
  readonly text: string;
  readonly font: PdfFontId;
  readonly fontSizePt: number;
  readonly color: PdfRgb;
}

export interface PdfRichTextLine {
  readonly widthPt: number;
  readonly maxFontSizePt: number;
  readonly spans: readonly PdfPositionedRunSpan[];
}

export interface PdfRichTextBlockLayout {
  readonly lines: readonly PdfRichTextLine[];
  readonly lineHeightPt: number;
  readonly heightPt: number;
  readonly maxWidthPt: number;
  readonly align: PdfTextAlign;
}

export interface WrapTextOptions {
  readonly font: PdfFontId;
  readonly fontSizePt: number;
  readonly maxWidthPt: number;
  readonly maxLines?: number;
  readonly cushionPt?: number;
}

export interface FitFontSizeOptions {
  readonly text: string;
  readonly font: PdfFontId;
  readonly preferredSizePt: number;
  readonly minSizePt: number;
  readonly maxWidthPt: number;
  readonly stepPt?: number;
}

export interface PdfDrawRectOptions {
  readonly x: number;
  readonly topY: number;
  readonly width: number;
  readonly height: number;
  readonly fill?: PdfRgb;
  readonly stroke?: PdfRgb;
  readonly lineWidthPt?: number;
}

export interface PdfDrawLineOptions {
  readonly x1: number;
  readonly topY1: number;
  readonly x2: number;
  readonly topY2: number;
  readonly stroke: PdfRgb;
  readonly lineWidthPt: number;
}

export interface PdfDrawTextOptions {
  readonly text: string;
  readonly x: number;
  readonly baselineTopY: number;
  readonly font: PdfFontId;
  readonly fontSizePt: number;
  readonly color: PdfRgb;
  readonly align?: PdfTextAlign;
}

export interface PdfCompileMetadata {
  readonly title: string;
  readonly subject: string;
}

export const PDF_PAGE_WIDTH_PT = 612;
export const PDF_PAGE_HEIGHT_PT = 792;
export const PDF_MARGIN_X_PT = 56;
export const PDF_CONTENT_RIGHT_X_PT = 556;
export const PDF_CONTENT_WIDTH_PT = 500;
export const PDF_PAGE_CENTER_X_PT = 306;
export const PDF_TOP_MARGIN_PT = 54;
export const PDF_RUNNING_HEADER_BASELINE_Y_PT = 42;
export const PDF_RUNNING_HEADER_RULE_Y_PT = 48;
export const PDF_CONTINUATION_BODY_START_Y_PT = 64;
export const PDF_MAX_BODY_BOTTOM_Y_PT = 730;
export const PDF_FOOTER_RULE_Y_PT = 742;
export const PDF_FOOTER_BASELINE_Y_PT = 754;

export const PDF_COLORS = {
  paper: [1.0, 1.0, 1.0] as PdfRgb,
  bodyInk: [0.125, 0.129, 0.141] as PdfRgb,
  houseBlue: [0.102, 0.451, 0.91] as PdfRgb,
  tableHeaderBg: [0.91, 0.941, 0.996] as PdfRgb,
  tableHeaderInk: [0.09, 0.306, 0.651] as PdfRgb,
  mutedInk: [0.373, 0.388, 0.408] as PdfRgb,
  positiveInk: [0.075, 0.451, 0.2] as PdfRgb,
  negativeInk: [0.773, 0.133, 0.122] as PdfRgb,
  noteBg: [0.996, 0.969, 0.878] as PdfRgb,
  amberAccentInk: [0.69, 0.376, 0.0] as PdfRgb,
  infoNoteBg: [0.953, 0.969, 0.992] as PdfRgb,
  subtleRowBg: [0.973, 0.976, 0.98] as PdfRgb,
  borderRule: [0.855, 0.863, 0.878] as PdfRgb,
} as const;

const COURIER_ADVANCE_WIDTH = 600;
const HELVETICA_REGULAR_FALLBACK_WIDTH = 556;
const HELVETICA_BOLD_FALLBACK_WIDTH = 611;

const CORE14_FONT_BASE_NAMES: Readonly<Record<PdfFontId, string>> = {
  F1: "Helvetica",
  F2: "Helvetica-Bold",
  F3: "Helvetica-Oblique",
  F4: "Courier",
  F5: "Courier-Bold",
  F6: "Helvetica-BoldOblique",
};

// Adobe Core-14 AFM advance widths (1/1000 em) for WinAnsi bytes 32..255 in Helvetica & Helvetica-Oblique.
const HELVETICA_REGULAR_WIDTHS_32_255: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584, 556, 556, 556, 222, 556, 333, 1000, 556, 556, 333,
  1000, 667, 333, 1000, 556, 611, 556, 556, 222, 222, 333, 333, 350, 556, 1000,
  333, 1000, 500, 333, 944, 556, 500, 667, 278, 333, 556, 556, 556, 556, 260,
  556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556,
  537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667,
  667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778,
  778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556,
  556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556,
  556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

// Adobe Core-14 AFM advance widths (1/1000 em) for WinAnsi bytes 32..255 in Helvetica-Bold & Helvetica-BoldOblique.
const HELVETICA_BOLD_WIDTHS_32_255: readonly number[] = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584, 611, 556, 611, 278, 556, 500, 1000, 556, 556, 333,
  1000, 667, 333, 1000, 611, 611, 611, 611, 278, 278, 500, 500, 350, 556, 1000,
  333, 1000, 556, 333, 944, 611, 500, 667, 278, 333, 556, 556, 556, 556, 280,
  556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611,
  556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722,
  722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778,
  778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556,
  556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611,
  611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

// Maps Windows-1252 0x80..0x9F Unicode code points to single-byte WinAnsi values.
const UNICODE_TO_WINANSI_SPECIALS: ReadonlyMap<number, number> = new Map([
  [0x20ac, 0x80], // €
  [0x201a, 0x82], // ‚
  [0x0192, 0x83], // ƒ
  [0x201e, 0x84], // „
  [0x2026, 0x85], // …
  [0x2020, 0x86], // †
  [0x2021, 0x87], // ‡
  [0x02c6, 0x88], // ˆ
  [0x2030, 0x89], // ‰
  [0x0160, 0x8a], // Š
  [0x2039, 0x8b], // ‹
  [0x0152, 0x8c], // Œ
  [0x017d, 0x8e], // Ž
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2013, 0x96], // –
  [0x2014, 0x97], // —
  [0x02dc, 0x98], // ˜
  [0x2122, 0x99], // ™
  [0x0161, 0x9a], // š
  [0x203a, 0x9b], // ›
  [0x0153, 0x9c], // œ
  [0x017e, 0x9e], // ž
  [0x0178, 0x9f], // Ÿ
]);

const UNICODE_MULTI_CHAR_REPLACEMENTS: ReadonlyMap<number, string> = new Map([
  [0x2265, ">="], // ≥
  [0x2264, "<="], // ≤
  [0x2248, "~"], // ≈
  [0x2260, "!="], // ≠
  [0x2192, "->"], // →
  [0x2190, "<-"], // ←
  [0x2194, "<->"], // ↔
  [0xfb00, "ff"],
  [0xfb01, "fi"],
  [0xfb02, "fl"],
  [0xfb03, "ffi"],
  [0xfb04, "ffl"],
  [0x0141, "L"], // Ł
  [0x0142, "l"], // ł
  [0x0110, "D"], // Đ
  [0x0111, "d"], // đ
]);

const normalizeSingleSegmentPreserveEdges = (rawInput: string): string => {
  if (rawInput.length === 0) {
    return "";
  }

  let out = "";
  for (const ch of rawInput) {
    const cp = ch.codePointAt(0);
    if (cp == null) {
      continue;
    }

    // Collapse tabs, NBSP, and Unicode space variants into ASCII space.
    if (
      cp === 0x09 ||
      cp === 0x0a ||
      cp === 0x0d ||
      cp === 0x20 ||
      cp === 0xa0 ||
      (cp >= 0x2000 && cp <= 0x200a) ||
      cp === 0x202f ||
      cp === 0x205f ||
      cp === 0x3000
    ) {
      out += " ";
      continue;
    }

    // Strip C0/C1 controls, soft hyphens, zero-width joiners, and variation selectors.
    if (
      cp < 0x20 ||
      (cp >= 0x7f && cp <= 0x9f) ||
      cp === 0xad ||
      (cp >= 0x200b && cp <= 0x200f) ||
      (cp >= 0x202a && cp <= 0x202e) ||
      (cp >= 0x2060 && cp <= 0x206f) ||
      (cp >= 0xfe00 && cp <= 0xfe0f) ||
      cp === 0xfeff
    ) {
      continue;
    }

    // Printable ASCII and Latin-1 Supplement map directly to WinAnsi.
    if ((cp >= 0x21 && cp <= 0x7e) || (cp >= 0xa1 && cp <= 0xff)) {
      out += ch;
      continue;
    }

    // Canonicalize mathematical minus and figure dashes to en-dash, and horizontal bar to em-dash.
    if (cp === 0x2212 || cp === 0x2012) {
      out += "\u2013";
      continue;
    }
    if (cp === 0x2010 || cp === 0x2011) {
      out += "-";
      continue;
    }
    if (cp === 0x2015) {
      out += "\u2014";
      continue;
    }
    if (cp === 0x2032 || cp === 0x02bb || cp === 0x02bc) {
      out += "\u2019";
      continue;
    }
    if (cp === 0x2033) {
      out += '"';
      continue;
    }
    if (cp === 0x25cf || cp === 0x2219) {
      out += "\u2022";
      continue;
    }

    if (UNICODE_TO_WINANSI_SPECIALS.has(cp)) {
      out += ch;
      continue;
    }

    const multiReplacement = UNICODE_MULTI_CHAR_REPLACEMENTS.get(cp);
    if (multiReplacement !== undefined) {
      out += multiReplacement;
      continue;
    }

    // Decompose remaining accented Latin characters into ASCII base letters when possible.
    const decomposed = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    let mappedAny = false;
    for (const sub of decomposed) {
      const subCp = sub.codePointAt(0);
      if (
        subCp != null &&
        ((subCp >= 0x20 && subCp <= 0x7e) ||
          (subCp >= 0xa1 && subCp <= 0xff && subCp !== 0xad) ||
          UNICODE_TO_WINANSI_SPECIALS.has(subCp))
      ) {
        out += sub;
        mappedAny = true;
      }
    }
    if (!mappedAny) {
      // Separate adjacent tokens cleanly when stripping emoji or non-Latin symbols.
      out += " ";
    }
  }

  return out.replace(/ {2,}/g, " ");
};

/**
 * Normalizes arbitrary UTF-16 input into canonical characters guaranteed to map
 * 1-for-1 into `/WinAnsiEncoding` without mojibake or `.notdef` boxes.
 */
export function normalizeToWinAnsiText(rawInput: string): string {
  return normalizeSingleSegmentPreserveEdges(rawInput).trim();
}

const charCodeToWinAnsiByte = (cp: number): number => {
  if (cp >= 0x20 && cp <= 0x7e) {
    return cp;
  }
  if (cp >= 0xa1 && cp <= 0xff) {
    return cp;
  }
  const special = UNICODE_TO_WINANSI_SPECIALS.get(cp);
  if (special !== undefined) {
    return special;
  }
  return 0x20;
};

const normalizedStringToWinAnsiBytes = (
  normalized: string,
): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(normalized.length);
  for (let i = 0; i < normalized.length; i += 1) {
    bytes[i] = charCodeToWinAnsiByte(normalized.charCodeAt(i));
  }
  return bytes;
};

/**
 * Converts arbitrary Unicode text into single-byte `/WinAnsiEncoding` codes (`0x20..0xFF`).
 */
export function toWinAnsiBytes(rawInput: string): Uint8Array<ArrayBuffer> {
  return normalizedStringToWinAnsiBytes(normalizeToWinAnsiText(rawInput));
}

const encodeNormalizedPdfLiteral = (normalized: string): string => {
  const bytes = normalizedStringToWinAnsiBytes(normalized);
  let ascii = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] ?? 0x20;
    if (b === 0x5c) {
      ascii += "\\\\";
    } else if (b === 0x28) {
      ascii += "\\(";
    } else if (b === 0x29) {
      ascii += "\\)";
    } else if (b >= 0x20 && b <= 0x7e) {
      ascii += String.fromCharCode(b);
    } else {
      ascii += `\\${b.toString(8).padStart(3, "0")}`;
    }
  }
  return ascii;
};

/**
 * Encodes text as a pure 7-bit ASCII PDF literal string inner payload (without outer parens),
 * escaping `\`, `(`, `)` and emitting 3-digit octal `\ooo` escapes for bytes `>= 0x80`.
 */
export function encodePdfLiteralString(rawInput: string): string {
  return encodeNormalizedPdfLiteral(normalizeToWinAnsiText(rawInput));
}

/**
 * Encodes a PDF `/Info` metadata text string (PDF 1.4 §3.8.1) using pure 7-bit ASCII:
 * emits `(...)` when pure ASCII, or `<FEFF...>` UTF-16BE hex when non-ASCII characters appear.
 */
export function encodePdfMetadataTextString(rawInput: string): string {
  const normalized = normalizeToWinAnsiText(rawInput);
  let hasNonAscii = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      hasNonAscii = true;
      break;
    }
  }
  if (!hasNonAscii) {
    return `(${encodeNormalizedPdfLiteral(normalized)})`;
  }

  let hex = "FEFF";
  for (let i = 0; i < normalized.length; i += 1) {
    hex += normalized.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return `<${hex}>`;
}

/**
 * Returns the exact Adobe Core-14 AFM glyph advance width in `1/1000 em` for a WinAnsi byte.
 */
export function getWinAnsiGlyphAdvance(byte: number, font: PdfFontId): number {
  if (font === "F4" || font === "F5") {
    return COURIER_ADVANCE_WIDTH;
  }
  const idx = byte - 32;
  if (font === "F2" || font === "F6") {
    return idx >= 0 && idx < HELVETICA_BOLD_WIDTHS_32_255.length
      ? (HELVETICA_BOLD_WIDTHS_32_255[idx] ?? HELVETICA_BOLD_FALLBACK_WIDTH)
      : HELVETICA_BOLD_FALLBACK_WIDTH;
  }
  return idx >= 0 && idx < HELVETICA_REGULAR_WIDTHS_32_255.length
    ? (HELVETICA_REGULAR_WIDTHS_32_255[idx] ?? HELVETICA_REGULAR_FALLBACK_WIDTH)
    : HELVETICA_REGULAR_FALLBACK_WIDTH;
}

const measureNormalizedWidthPt = (
  normalized: string,
  font: PdfFontId,
  fontSizePt: number,
): number => {
  if (normalized.length === 0 || fontSizePt <= 0) {
    return 0;
  }
  const bytes = normalizedStringToWinAnsiBytes(normalized);
  let totalThousandths = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    totalThousandths += getWinAnsiGlyphAdvance(bytes[i] ?? 0x20, font);
  }
  return (totalThousandths * fontSizePt) / 1000;
};

/**
 * Measures the exact horizontal advance width in PDF points (`pt`) of normalized text.
 */
export function measureTextWidthPt(
  text: string,
  font: PdfFontId,
  fontSizePt: number,
): number {
  return measureNormalizedWidthPt(
    normalizeToWinAnsiText(text),
    font,
    fontSizePt,
  );
}

/**
 * Steps font size down cleanly until a single-line value fits within `maxWidthPt`.
 */
export function fitFontSizeToWidth(options: FitFontSizeOptions): number {
  const step = options.stepPt ?? 0.5;
  let size = options.preferredSizePt;
  while (size > options.minSizePt) {
    if (
      measureTextWidthPt(options.text, options.font, size) <= options.maxWidthPt
    ) {
      return size;
    }
    size = Number((size - step).toFixed(2));
  }
  return options.minSizePt;
}

const sliceUnbrokenSegmentByWidth = (
  segment: string,
  font: PdfFontId,
  fontSizePt: number,
  limitPt: number,
): string[] => {
  if (measureNormalizedWidthPt(segment, font, fontSizePt) <= limitPt) {
    return [segment];
  }

  const pieces: string[] = [];
  let cursor = 0;
  while (cursor < segment.length) {
    const remaining = segment.slice(cursor);
    if (measureNormalizedWidthPt(remaining, font, fontSizePt) <= limitPt) {
      pieces.push(remaining);
      break;
    }

    let end = cursor + 1;
    while (end < segment.length) {
      const candidate = `${segment.slice(cursor, end + 1)}-`;
      if (measureNormalizedWidthPt(candidate, font, fontSizePt) > limitPt) {
        break;
      }
      end += 1;
    }
    pieces.push(`${segment.slice(cursor, end)}-`);
    cursor = end;
  }
  return pieces;
};

const splitOversizedToken = (
  token: string,
  font: PdfFontId,
  fontSizePt: number,
  limitPt: number,
): string[] => {
  const softParts = token.match(/[-_/.:]*[^-_/.:]+[-_/.:]*/g) ?? [token];
  const packed: string[] = [];
  let current = "";

  for (const rawPart of softParts) {
    const subPieces = sliceUnbrokenSegmentByWidth(
      rawPart,
      font,
      fontSizePt,
      limitPt,
    );
    for (const piece of subPieces) {
      if (current.length === 0) {
        current = piece;
      } else if (
        measureNormalizedWidthPt(`${current}${piece}`, font, fontSizePt) <=
        limitPt
      ) {
        current += piece;
      } else {
        packed.push(current);
        current = piece;
      }
    }
  }

  if (current.length > 0) {
    packed.push(current);
  }
  return packed.length > 0 ? packed : [token];
};

const truncateLineWithEllipsis = (
  line: string,
  font: PdfFontId,
  fontSizePt: number,
  limitPt: number,
): string => {
  const ellipsis = "\u2026";
  const cleanedLine = line.replace(/[\s,;:._/-]+$/, "");
  if (
    cleanedLine.length > 0 &&
    measureNormalizedWidthPt(`${cleanedLine}${ellipsis}`, font, fontSizePt) <=
      limitPt
  ) {
    return `${cleanedLine}${ellipsis}`;
  }

  let candidate = cleanedLine;
  while (candidate.length > 0) {
    candidate = candidate.slice(0, -1).replace(/[\s,;:._/-]+$/, "");
    if (
      measureNormalizedWidthPt(`${candidate}${ellipsis}`, font, fontSizePt) <=
      limitPt
    ) {
      return candidate.length > 0 ? `${candidate}${ellipsis}` : ellipsis;
    }
  }
  return ellipsis;
};

/**
 * Wraps normalized text within `maxWidthPt - cushionPt`, breaking on spaces first,
 * then soft delimiters (`-`, `_`, `/`, `.`, `:`), and hard-hyphenating only unbroken runs.
 */
export function wrapTextLines(
  rawText: string,
  options: WrapTextOptions,
): string[] {
  const cleaned = normalizeToWinAnsiText(rawText);
  if (cleaned.length === 0) {
    return [""];
  }

  const cushionPt = options.cushionPt ?? 2;
  const limitPt = Math.max(8, options.maxWidthPt - cushionPt);
  const words = cleaned.split(" ").filter((w) => w.length > 0);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length === 0) {
      if (
        measureNormalizedWidthPt(word, options.font, options.fontSizePt) <=
        limitPt
      ) {
        currentLine = word;
      } else {
        const pieces = splitOversizedToken(
          word,
          options.font,
          options.fontSizePt,
          limitPt,
        );
        for (let i = 0; i < pieces.length - 1; i += 1) {
          lines.push(pieces[i] ?? "");
        }
        currentLine = pieces[pieces.length - 1] ?? "";
      }
      continue;
    }

    const joined = `${currentLine} ${word}`;
    if (
      measureNormalizedWidthPt(joined, options.font, options.fontSizePt) <=
      limitPt
    ) {
      currentLine = joined;
      continue;
    }

    lines.push(currentLine);
    if (
      measureNormalizedWidthPt(word, options.font, options.fontSizePt) <=
      limitPt
    ) {
      currentLine = word;
    } else {
      const pieces = splitOversizedToken(
        word,
        options.font,
        options.fontSizePt,
        limitPt,
      );
      for (let i = 0; i < pieces.length - 1; i += 1) {
        lines.push(pieces[i] ?? "");
      }
      currentLine = pieces[pieces.length - 1] ?? "";
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  if (
    options.maxLines != null &&
    options.maxLines > 0 &&
    lines.length > options.maxLines
  ) {
    const truncated = lines.slice(0, options.maxLines);
    const lastIdx = options.maxLines - 1;
    truncated[lastIdx] = truncateLineWithEllipsis(
      truncated[lastIdx] ?? "",
      options.font,
      options.fontSizePt,
      limitPt,
    );
    return truncated;
  }

  return lines.length > 0 ? lines : [""];
}

interface StyledAtom {
  readonly text: string;
  readonly font: PdfFontId;
  readonly fontSizePt: number;
  readonly color: PdfRgb;
  readonly widthPt: number;
}

type RichFlowToken =
  | { readonly kind: "newline" }
  | {
      readonly kind: "space";
      readonly atom: StyledAtom;
    }
  | {
      readonly kind: "word";
      readonly atoms: StyledAtom[];
      readonly widthPt: number;
    };

const sameRgb = (a: PdfRgb, b: PdfRgb): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const makeStyledAtom = (
  text: string,
  font: PdfFontId,
  fontSizePt: number,
  color: PdfRgb,
): StyledAtom => ({
  text,
  font,
  fontSizePt,
  color,
  widthPt: measureNormalizedWidthPt(text, font, fontSizePt),
});

const splitOversizedWordToken = (
  atoms: readonly StyledAtom[],
  limitPt: number,
): Array<{ readonly atoms: StyledAtom[]; readonly widthPt: number }> => {
  const result: Array<{ atoms: StyledAtom[]; widthPt: number }> = [];
  let currentAtoms: StyledAtom[] = [];
  let currentWidth = 0;

  for (const atom of atoms) {
    const pieces =
      atom.widthPt <= limitPt
        ? [atom.text]
        : splitOversizedToken(atom.text, atom.font, atom.fontSizePt, limitPt);

    for (const piece of pieces) {
      const pieceAtom = makeStyledAtom(
        piece,
        atom.font,
        atom.fontSizePt,
        atom.color,
      );
      if (currentAtoms.length === 0) {
        currentAtoms = [pieceAtom];
        currentWidth = pieceAtom.widthPt;
      } else if (currentWidth + pieceAtom.widthPt <= limitPt) {
        currentAtoms.push(pieceAtom);
        currentWidth += pieceAtom.widthPt;
      } else {
        result.push({ atoms: currentAtoms, widthPt: currentWidth });
        currentAtoms = [pieceAtom];
        currentWidth = pieceAtom.widthPt;
      }
    }
  }

  if (currentAtoms.length > 0) {
    result.push({ atoms: currentAtoms, widthPt: currentWidth });
  }
  return result;
};

const trySplitCompoundSlugForRemainingLine = (
  atoms: readonly StyledAtom[],
  remainingPt: number,
  limitPt: number,
): Array<{ readonly atoms: StyledAtom[]; readonly widthPt: number }> | null => {
  const segmentAtoms: StyledAtom[] = [];
  for (const atom of atoms) {
    const parts = atom.text.match(/[-_]*[^-_]+[-_]?/g) ?? [atom.text];
    for (const part of parts) {
      segmentAtoms.push(
        makeStyledAtom(part, atom.font, atom.fontSizePt, atom.color),
      );
    }
  }
  if (segmentAtoms.length < 2) {
    return null;
  }

  let firstCount = 0;
  let firstWidth = 0;
  while (firstCount < segmentAtoms.length - 1) {
    const seg = segmentAtoms[firstCount]!;
    if (firstWidth + seg.widthPt > remainingPt) {
      break;
    }
    firstWidth += seg.widthPt;
    firstCount += 1;
  }
  if (firstCount === 0) {
    return null;
  }

  const headPiece = {
    atoms: segmentAtoms.slice(0, firstCount),
    widthPt: firstWidth,
  };
  const tailPieces = splitOversizedWordToken(
    segmentAtoms.slice(firstCount),
    limitPt,
  );
  return [headPiece, ...tailPieces];
};

const finalizeRichLine = (atoms: readonly StyledAtom[]): PdfRichTextLine => {
  if (atoms.length === 0) {
    return { widthPt: 0, maxFontSizePt: 0, spans: [] };
  }

  const spans: PdfPositionedRunSpan[] = [];
  let cursorX = 0;
  let maxFontSizePt = 0;

  for (const atom of atoms) {
    if (atom.text.length === 0) {
      continue;
    }
    if (atom.fontSizePt > maxFontSizePt) {
      maxFontSizePt = atom.fontSizePt;
    }
    const prev = spans[spans.length - 1];
    if (
      prev != null &&
      prev.font === atom.font &&
      prev.fontSizePt === atom.fontSizePt &&
      sameRgb(prev.color, atom.color)
    ) {
      const mergedText = `${prev.text}${atom.text}`;
      const mergedWidth = measureNormalizedWidthPt(
        mergedText,
        prev.font,
        prev.fontSizePt,
      );
      spans[spans.length - 1] = {
        ...prev,
        text: mergedText,
        widthPt: mergedWidth,
      };
      cursorX = prev.offsetXPt + mergedWidth;
    } else {
      spans.push({
        offsetXPt: cursorX,
        widthPt: atom.widthPt,
        text: atom.text,
        font: atom.font,
        fontSizePt: atom.fontSizePt,
        color: atom.color,
      });
      cursorX += atom.widthPt;
    }
  }

  return {
    widthPt: cursorX,
    maxFontSizePt,
    spans,
  };
};

const truncateAtomListWithEllipsis = (
  atoms: readonly StyledAtom[],
  limitPt: number,
  fallbackFont: PdfFontId,
  fallbackSizePt: number,
  fallbackColor: PdfRgb,
): StyledAtom[] => {
  if (atoms.length === 0) {
    return [makeStyledAtom("\u2026", fallbackFont, fallbackSizePt, fallbackColor)];
  }
  const working = atoms.map((a) => ({ ...a }));
  const lastStyle = working[working.length - 1]!;
  const ellipsisAtom = makeStyledAtom(
    "\u2026",
    lastStyle.font,
    lastStyle.fontSizePt,
    lastStyle.color,
  );

  while (working.length > 0) {
    const tail = working[working.length - 1]!;
    const cleaned = tail.text.replace(/[\s,;:._/-]+$/, "");
    if (cleaned.length === 0) {
      working.pop();
      continue;
    }
    const cleanedAtom = makeStyledAtom(
      cleaned,
      tail.font,
      tail.fontSizePt,
      tail.color,
    );
    const prefixWidth = working
      .slice(0, -1)
      .reduce((acc, item) => acc + item.widthPt, 0);
    if (prefixWidth + cleanedAtom.widthPt + ellipsisAtom.widthPt <= limitPt) {
      working[working.length - 1] = cleanedAtom;
      working.push(ellipsisAtom);
      return working;
    }
    if (cleaned.length === 1) {
      working.pop();
    } else {
      working[working.length - 1] = makeStyledAtom(
        cleaned.slice(0, -1),
        tail.font,
        tail.fontSizePt,
        tail.color,
      );
    }
  }

  return [ellipsisAtom];
};

/**
 * Deterministic mixed-run rich text wrapper (`Bold` + `Regular` + `Italic` + `Monospace`
 * on the same wrapped lines) with exact pre-measured block heights for atomic pagination.
 */
export function layoutRichTextRuns(
  runs: readonly PdfTextRun[],
  options: LayoutRichTextOptions,
): PdfRichTextBlockLayout {
  const defaultFont = options.defaultFont ?? "F1";
  const defaultFontSizePt = options.defaultFontSizePt ?? 9.5;
  const defaultColor = options.defaultColor ?? PDF_COLORS.bodyInk;
  const align = options.align ?? "left";
  const cushionPt = options.cushionPt ?? 2;
  const limitPt = Math.max(8, options.maxWidthPt - cushionPt);

  const tokens: RichFlowToken[] = [];

  for (const run of runs) {
    if (!run.text) {
      continue;
    }
    const font = run.font ?? defaultFont;
    const fontSizePt = run.fontSizePt ?? defaultFontSizePt;
    const color = run.color ?? defaultColor;

    const rawLines = run.text.split(/\r?\n/);
    rawLines.forEach((rawSegment, segIdx) => {
      if (segIdx > 0) {
        tokens.push({ kind: "newline" });
      }
      const normalized = normalizeSingleSegmentPreserveEdges(rawSegment);
      if (normalized.length === 0) {
        return;
      }

      const chunks = normalized.match(/ +|[^ ]+/g) ?? [];
      for (const chunk of chunks) {
        if (chunk.startsWith(" ")) {
          const prev = tokens[tokens.length - 1];
          if (prev != null && prev.kind !== "newline" && prev.kind !== "space") {
            tokens.push({
              kind: "space",
              atom: makeStyledAtom(" ", font, fontSizePt, color),
            });
          }
        } else {
          const wordAtom = makeStyledAtom(chunk, font, fontSizePt, color);
          const prev = tokens[tokens.length - 1];
          // Merge adjacent non-space atoms across run boundaries (e.g. bold "39.5%" + ".")
          // so trailing punctuation never wraps alone onto the next line.
          if (prev != null && prev.kind === "word") {
            prev.atoms.push(wordAtom);
            tokens[tokens.length - 1] = {
              kind: "word",
              atoms: prev.atoms,
              widthPt: prev.widthPt + wordAtom.widthPt,
            };
          } else {
            tokens.push({
              kind: "word",
              atoms: [wordAtom],
              widthPt: wordAtom.widthPt,
            });
          }
        }
      }
    });
  }

  const rawLinesAtoms: StyledAtom[][] = [];
  let currentLineAtoms: StyledAtom[] = [];
  let currentLineWidth = 0;
  let pendingSpace: StyledAtom | null = null;

  const pushWordPiece = (piece: {
    readonly atoms: StyledAtom[];
    readonly widthPt: number;
  }): void => {
    if (currentLineAtoms.length === 0) {
      currentLineAtoms = [...piece.atoms];
      currentLineWidth = piece.widthPt;
      pendingSpace = null;
      return;
    }

    const spaceW = pendingSpace ? pendingSpace.widthPt : 0;
    if (currentLineWidth + spaceW + piece.widthPt <= limitPt) {
      if (pendingSpace) {
        currentLineAtoms.push(pendingSpace);
        currentLineWidth += spaceW;
      }
      currentLineAtoms.push(...piece.atoms);
      currentLineWidth += piece.widthPt;
      pendingSpace = null;
      return;
    }

    rawLinesAtoms.push(currentLineAtoms);
    currentLineAtoms = [...piece.atoms];
    currentLineWidth = piece.widthPt;
    pendingSpace = null;
  };

  for (const token of tokens) {
    if (token.kind === "newline") {
      rawLinesAtoms.push(currentLineAtoms);
      currentLineAtoms = [];
      currentLineWidth = 0;
      pendingSpace = null;
      continue;
    }
    if (token.kind === "space") {
      if (currentLineAtoms.length > 0) {
        pendingSpace = token.atom;
      }
      continue;
    }

    if (token.widthPt <= limitPt) {
      const spaceW = pendingSpace ? pendingSpace.widthPt : 0;
      const remainingPt = limitPt - currentLineWidth - spaceW;
      const isCompoundSlug = token.atoms.some((a) =>
        /[A-Za-z0-9][-_][A-Za-z0-9]/.test(a.text),
      );
      if (
        currentLineAtoms.length > 0 &&
        currentLineWidth + spaceW + token.widthPt > limitPt &&
        isCompoundSlug &&
        token.widthPt >= 72 &&
        remainingPt >= 36
      ) {
        const splitSlug = trySplitCompoundSlugForRemainingLine(
          token.atoms,
          remainingPt,
          limitPt,
        );
        if (splitSlug != null) {
          for (const sub of splitSlug) {
            pushWordPiece(sub);
          }
          continue;
        }
      }
      pushWordPiece(token);
    } else {
      const subPieces = splitOversizedWordToken(token.atoms, limitPt);
      for (const sub of subPieces) {
        pushWordPiece(sub);
      }
    }
  }

  if (currentLineAtoms.length > 0 || rawLinesAtoms.length === 0) {
    rawLinesAtoms.push(currentLineAtoms);
  }

  let effectiveLinesAtoms = rawLinesAtoms;
  if (
    options.maxLines != null &&
    options.maxLines > 0 &&
    rawLinesAtoms.length > options.maxLines
  ) {
    effectiveLinesAtoms = rawLinesAtoms.slice(0, options.maxLines);
    const lastIdx = options.maxLines - 1;
    effectiveLinesAtoms[lastIdx] = truncateAtomListWithEllipsis(
      effectiveLinesAtoms[lastIdx] ?? [],
      limitPt,
      defaultFont,
      defaultFontSizePt,
      defaultColor,
    );
  }

  const lines = effectiveLinesAtoms.map(finalizeRichLine);
  return {
    lines,
    lineHeightPt: options.lineHeightPt,
    heightPt: lines.length * options.lineHeightPt,
    maxWidthPt: options.maxWidthPt,
    align,
  };
}

const fmtNum = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000;
  if (Object.is(rounded, -0)) {
    return "0";
  }
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(3).replace(/\.?0+$/, "");
};

const fmtFillRgb = (rgb: PdfRgb): string =>
  `${fmtNum(rgb[0])} ${fmtNum(rgb[1])} ${fmtNum(rgb[2])} rg`;

const fmtStrokeRgb = (rgb: PdfRgb): string =>
  `${fmtNum(rgb[0])} ${fmtNum(rgb[1])} ${fmtNum(rgb[2])} RG`;

/**
 * Pure 7-bit ASCII `%PDF-1.4` vector page stream builder using top-down `(x, topY)` coordinates.
 */
export class PdfDocumentBuilder {
  private readonly pages: string[][] = [];
  private activePageIndex = -1;
  private enforceBodyCeiling = true;
  private maxRecordedBodyBottomY = 0;

  constructor() {
    this.addPage();
  }

  getPageCount(): number {
    return this.pages.length;
  }

  getActivePageIndex(): number {
    return this.activePageIndex;
  }

  getMaxRecordedBodyBottomY(): number {
    return this.maxRecordedBodyBottomY;
  }

  addPage(): number {
    const ops: string[] = [
      // Paint explicit white paper canvas across the entire US Letter page.
      `q ${fmtFillRgb(PDF_COLORS.paper)} 0 0 ${PDF_PAGE_WIDTH_PT} ${PDF_PAGE_HEIGHT_PT} re f Q`,
    ];
    this.pages.push(ops);
    this.activePageIndex = this.pages.length - 1;
    return this.activePageIndex;
  }

  setActivePage(pageIndex: number): void {
    if (pageIndex < 0 || pageIndex >= this.pages.length) {
      throw new RangeError(`Invalid PDF page index ${pageIndex}.`);
    }
    this.activePageIndex = pageIndex;
  }

  setBodyCeilingEnforcement(enabled: boolean): void {
    this.enforceBodyCeiling = enabled;
  }

  drawRect(options: PdfDrawRectOptions): void {
    if (options.fill == null && options.stroke == null) {
      return;
    }
    const bottomTopY = options.topY + options.height;
    this.recordBodyBottom(bottomTopY);

    const pdfY = PDF_PAGE_HEIGHT_PT - bottomTopY;
    const cmds: string[] = ["q"];
    if (options.fill != null) {
      cmds.push(fmtFillRgb(options.fill));
    }
    if (options.stroke != null) {
      cmds.push(fmtStrokeRgb(options.stroke));
      cmds.push(`${fmtNum(options.lineWidthPt ?? 0.5)} w`);
    }
    cmds.push(
      `${fmtNum(options.x)} ${fmtNum(pdfY)} ${fmtNum(options.width)} ${fmtNum(options.height)} re`,
    );
    if (options.fill != null && options.stroke != null) {
      cmds.push("B");
    } else if (options.fill != null) {
      cmds.push("f");
    } else {
      cmds.push("S");
    }
    cmds.push("Q");
    this.pushOp(cmds.join(" "));
  }

  drawLine(options: PdfDrawLineOptions): void {
    this.recordBodyBottom(Math.max(options.topY1, options.topY2));
    const y1 = PDF_PAGE_HEIGHT_PT - options.topY1;
    const y2 = PDF_PAGE_HEIGHT_PT - options.topY2;
    this.pushOp(
      `q ${fmtStrokeRgb(options.stroke)} ${fmtNum(options.lineWidthPt)} w ${fmtNum(options.x1)} ${fmtNum(y1)} m ${fmtNum(options.x2)} ${fmtNum(y2)} l S Q`,
    );
  }

  drawText(options: PdfDrawTextOptions): void {
    const normalized = normalizeToWinAnsiText(options.text);
    if (normalized.length === 0) {
      return;
    }
    this.drawNormalizedSpan({
      normalizedText: normalized,
      x: options.x,
      baselineTopY: options.baselineTopY,
      font: options.font,
      fontSizePt: options.fontSizePt,
      color: options.color,
      align: options.align ?? "left",
    });
  }

  drawRichTextBlock(
    block: PdfRichTextBlockLayout,
    x: number,
    firstBaselineTopY: number,
  ): void {
    block.lines.forEach((line, idx) => {
      if (line.spans.length === 0) {
        return;
      }
      const baselineTopY = firstBaselineTopY + idx * block.lineHeightPt;
      let lineStartX = x;
      if (block.align === "right") {
        lineStartX = x + block.maxWidthPt - line.widthPt;
      } else if (block.align === "center") {
        lineStartX = x + (block.maxWidthPt - line.widthPt) / 2;
      }

      for (const span of line.spans) {
        this.drawNormalizedSpan({
          normalizedText: span.text,
          x: lineStartX + span.offsetXPt,
          baselineTopY,
          font: span.font,
          fontSizePt: span.fontSizePt,
          color: span.color,
          align: "left",
        });
      }
    });
  }

  stampStudyReportFooters(studyId: number): void {
    const previousPage = this.activePageIndex;
    const previousCeiling = this.enforceBodyCeiling;
    this.enforceBodyCeiling = false;

    const totalPages = this.pages.length;
    for (let idx = 0; idx < totalPages; idx += 1) {
      this.setActivePage(idx);
      this.drawLine({
        x1: PDF_MARGIN_X_PT,
        topY1: PDF_FOOTER_RULE_Y_PT,
        x2: PDF_CONTENT_RIGHT_X_PT,
        topY2: PDF_FOOTER_RULE_Y_PT,
        stroke: PDF_COLORS.borderRule,
        lineWidthPt: 0.5,
      });
      this.drawText({
        text: `The LOL Report  \u00b7  Study #${studyId} Empirical Attribution Report  \u00b7  Page ${idx + 1} of ${totalPages}`,
        x: PDF_PAGE_CENTER_X_PT,
        baselineTopY: PDF_FOOTER_BASELINE_Y_PT,
        font: "F3",
        fontSizePt: 8,
        color: PDF_COLORS.mutedInk,
        align: "center",
      });
    }

    this.enforceBodyCeiling = previousCeiling;
    this.setActivePage(previousPage);
  }

  compile(metadata: PdfCompileMetadata): Uint8Array<ArrayBuffer> {
    const pageCount = this.pages.length;
    const fontIds: readonly PdfFontId[] = ["F1", "F2", "F3", "F4", "F5", "F6"];
    // Object IDs: 1=Catalog, 2=Pages, 3..8=Fonts (F1..F6), 9=Info, 10..=Page/Content pairs.
    const infoObjId = 3 + fontIds.length;
    const firstPageObjId = infoObjId + 1;
    const totalObjects = infoObjId + pageCount * 2;
    const offsets = new Array<number>(totalObjects + 1).fill(0);
    const parts: string[] = [];
    let byteCursor = 0;

    const appendRaw = (chunk: string): void => {
      parts.push(chunk);
      byteCursor += chunk.length;
    };

    const appendObject = (objId: number, body: string): void => {
      offsets[objId] = byteCursor;
      appendRaw(`${objId} 0 obj\n${body}\nendobj\n`);
    };

    appendRaw("%PDF-1.4\n");

    const kidsRefs = Array.from(
      { length: pageCount },
      (_, idx) => `${firstPageObjId + idx * 2} 0 R`,
    ).join(" ");

    appendObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
    appendObject(
      2,
      `<< /Type /Pages /Kids [ ${kidsRefs} ] /Count ${pageCount} >>`,
    );

    fontIds.forEach((fontId, index) => {
      const baseName = CORE14_FONT_BASE_NAMES[fontId];
      appendObject(
        3 + index,
        `<< /Type /Font /Subtype /Type1 /BaseFont /${baseName} /Encoding /WinAnsiEncoding >>`,
      );
    });

    const encodedTitle = encodePdfMetadataTextString(metadata.title);
    const encodedSubject = encodePdfMetadataTextString(metadata.subject);
    appendObject(
      infoObjId,
      `<< /Title ${encodedTitle} /Author (The LOL Report Attribution Studio) /Subject ${encodedSubject} /Creator (The LOL Report Written Report Engine) /Producer (The LOL Report %PDF-1.4) >>`,
    );

    const fontResourceMap = fontIds
      .map((fontId, index) => `/${fontId} ${3 + index} 0 R`)
      .join(" ");

    for (let i = 0; i < pageCount; i += 1) {
      const pageObjId = firstPageObjId + i * 2;
      const contentObjId = pageObjId + 1;
      appendObject(
        pageObjId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH_PT} ${PDF_PAGE_HEIGHT_PT}] /Resources << /Font << ${fontResourceMap} >> >> /Contents ${contentObjId} 0 R >>`,
      );

      const streamContent = `${(this.pages[i] ?? []).join("\n")}\n`;
      appendObject(
        contentObjId,
        `<< /Length ${streamContent.length} >>\nstream\n${streamContent}endstream`,
      );
    }

    const xrefOffset = byteCursor;
    appendRaw(`xref\n0 ${totalObjects + 1}\n`);
    appendRaw("0000000000 65535 f \n");
    for (let objId = 1; objId <= totalObjects; objId += 1) {
      const offsetStr = String(offsets[objId] ?? 0).padStart(10, "0");
      appendRaw(`${offsetStr} 00000 n \n`);
    }

    appendRaw(
      `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R /Info ${infoObjId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );

    const fullAscii = parts.join("");
    const binary = new Uint8Array(fullAscii.length);
    for (let i = 0; i < fullAscii.length; i += 1) {
      const code = fullAscii.charCodeAt(i);
      if (code > 0x7f) {
        throw new Error(
          `Non-ASCII code unit 0x${code.toString(16)} emitted at PDF byte ${i}.`,
        );
      }
      binary[i] = code;
    }
    return binary;
  }

  private drawNormalizedSpan(options: {
    readonly normalizedText: string;
    readonly x: number;
    readonly baselineTopY: number;
    readonly font: PdfFontId;
    readonly fontSizePt: number;
    readonly color: PdfRgb;
    readonly align: PdfTextAlign;
  }): void {
    if (options.normalizedText.length === 0) {
      return;
    }
    // Account for descender depth below baseline when checking the 730 pt body ceiling.
    this.recordBodyBottom(options.baselineTopY + options.fontSizePt * 0.22);

    let drawX = options.x;
    if (options.align === "right" || options.align === "center") {
      const widthPt = measureNormalizedWidthPt(
        options.normalizedText,
        options.font,
        options.fontSizePt,
      );
      drawX =
        options.align === "right"
          ? options.x - widthPt
          : options.x - widthPt / 2;
    }

    const pdfY = PDF_PAGE_HEIGHT_PT - options.baselineTopY;
    const encoded = encodeNormalizedPdfLiteral(options.normalizedText);
    this.pushOp(
      `BT ${fmtFillRgb(options.color)} /${options.font} ${fmtNum(options.fontSizePt)} Tf 1 0 0 1 ${fmtNum(drawX)} ${fmtNum(pdfY)} Tm (${encoded}) Tj ET`,
    );
  }

  private recordBodyBottom(bottomTopY: number): void {
    if (!this.enforceBodyCeiling) {
      return;
    }
    if (bottomTopY > this.maxRecordedBodyBottomY) {
      this.maxRecordedBodyBottomY = bottomTopY;
    }
    if (bottomTopY > PDF_MAX_BODY_BOTTOM_Y_PT + 0.01) {
      throw new Error(
        `PDF body primitive bottom ${bottomTopY.toFixed(2)} pt exceeds the ${PDF_MAX_BODY_BOTTOM_Y_PT} pt body ceiling.`,
      );
    }
  }

  private pushOp(op: string): void {
    const page = this.pages[this.activePageIndex];
    if (!page) {
      throw new Error("No active PDF page stream.");
    }
    page.push(op);
  }
}
