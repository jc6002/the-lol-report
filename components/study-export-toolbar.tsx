"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, FileText } from "lucide-react";

import type { StudyExportPayload } from "@/utils/attribution-export";

export type StudyExportToolbarProps = {
  payload: StudyExportPayload;
};

type CopyStatus = "idle" | "copied" | "blocked";

const triggerBlobDownload = (
  content: string,
  filename: string,
  mimeType: string,
) => {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
};

export function StudyExportToolbar({ payload }: StudyExportToolbarProps) {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [csvDownloaded, setCsvDownloaded] = useState(false);
  const [briefDownloaded, setBriefDownloaded] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const csvTimerRef = useRef<number | null>(null);
  const briefTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      if (csvTimerRef.current !== null) {
        window.clearTimeout(csvTimerRef.current);
      }
      if (briefTimerRef.current !== null) {
        window.clearTimeout(briefTimerRef.current);
      }
    };
  }, []);

  const handleDownloadCsv = () => {
    triggerBlobDownload(
      `\uFEFF${payload.csvContent}`,
      payload.csvFilename,
      "text/csv;charset=utf-8;",
    );
    setCsvDownloaded(true);
    if (csvTimerRef.current !== null) {
      window.clearTimeout(csvTimerRef.current);
    }
    csvTimerRef.current = window.setTimeout(() => {
      setCsvDownloaded(false);
    }, 2000);
  };

  const handleCopyBrief = async () => {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(payload.briefMarkdown);
      setCopyStatus("copied");
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopyStatus("idle");
      }, 2000);
    } catch {
      setCopyStatus("blocked");
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopyStatus("idle");
      }, 3500);
    }
  };

  const handleDownloadBrief = () => {
    triggerBlobDownload(
      payload.briefMarkdown,
      payload.briefFilename,
      "text/markdown;charset=utf-8;",
    );
    setBriefDownloaded(true);
    if (briefTimerRef.current !== null) {
      window.clearTimeout(briefTimerRef.current);
    }
    briefTimerRef.current = window.setTimeout(() => {
      setBriefDownloaded(false);
    }, 2000);
  };

  const copyLabel =
    copyStatus === "copied"
      ? "Copied brief"
      : copyStatus === "blocked"
        ? "Clipboard blocked — use Brief .md"
        : "Copy Brief";

  return (
    <div
      role="group"
      aria-label="Export study results"
      className="flex flex-wrap items-center gap-2"
    >
      <button
        type="button"
        onClick={handleDownloadCsv}
        className="app-button inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 motion-reduce:transform-none motion-reduce:transition-none"
      >
        <Download className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{csvDownloaded ? "Exported CSV" : "Export CSV"}</span>
      </button>
      <button
        type="button"
        onClick={handleCopyBrief}
        aria-live="polite"
        className="app-button inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 motion-reduce:transform-none motion-reduce:transition-none"
      >
        {copyStatus === "copied" ? (
          <Check className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span>{copyLabel}</span>
      </button>
      <button
        type="button"
        onClick={handleDownloadBrief}
        className="app-button inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 motion-reduce:transform-none motion-reduce:transition-none"
      >
        <FileText className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{briefDownloaded ? "Saved .md" : "Brief .md"}</span>
      </button>
    </div>
  );
}
