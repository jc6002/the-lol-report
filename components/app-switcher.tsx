"use client";

import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";

const subscribe = () => () => undefined;

const APPS = [
  { id: "chucklesome", name: "Chucklesome", description: "Admin Studio" },
  { id: "toosoon", name: "Prompt Chain Studio", description: "Too Soon Matrix" },
  { id: "lolreport", name: "The LOL Report", description: "Attribution Studio" },
  { id: "puniversity", name: "Student Brain", description: "Puniversity Arena" },
];

export function AppSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const getAppUrl = (appId: string) => {
    if (!mounted || typeof window === "undefined") return "#";
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1";
    const isStaging = host.includes("almostcrackd.ai") || host.includes("slightlyhumorous.org");

    if (isLocal) {
      switch (appId) {
        case "chucklesome": return `http://${host}:3001`;
        case "toosoon": return `http://${host}:3002`;
        case "lolreport": return `http://${host}:3007`;
        case "puniversity": return `http://${host}:3000`;
      }
    }

    if (isStaging) {
      switch (appId) {
        case "chucklesome": return "https://admin.almostcrackd.ai";
        case "toosoon": return "https://matrix.almostcrackd.ai";
        case "lolreport": return "https://stats.slightlyhumorous.org";
        case "puniversity": return "https://brain.almostcrackd.ai";
      }
    }

    switch (appId) {
      case "chucklesome": return "https://admin.crackd.ai";
      case "toosoon": return "https://matrix.crackd.ai";
      case "lolreport": return "https://stats.humorstudy.org";
      case "puniversity": return "https://brain.crackd.ai";
    }
    return "#";
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="app-button flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        aria-label="App Switcher"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect width="7" height="7" x="3" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="14" rx="1" />
          <rect width="7" height="7" x="3" y="14" rx="1" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Humor Suite Apps"
          className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] origin-top-right overflow-hidden rounded-xl border border-slate-200/95 bg-[#fffaf5] text-foreground shadow-2xl focus:outline-none dark:border-cyan-200/18 dark:bg-[#0b1424]"
        >
          <div className="border-b border-slate-200/70 px-4 py-2.5 dark:border-slate-700/70">
            <h3 className="app-muted text-xs font-semibold uppercase tracking-wider">
              Humor Suite
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-2 p-3">
            {APPS.map((app) => (
              <Link
                key={app.id}
                role="menuitem"
                href={getAppUrl(app.id)}
                className="app-card flex flex-col items-center justify-center rounded-lg p-3.5 text-center transition hover:bg-slate-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/6"
                onClick={() => setIsOpen(false)}
              >
                <span className="text-xs font-semibold text-foreground sm:text-sm">
                  {app.name}
                </span>
                <span className="app-muted mt-0.5 text-[11px]">
                  {app.description}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
