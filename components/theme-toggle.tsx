"use client";

import { useId, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

import { AppSelect, type AppSelectOption } from "@/components/app-select";

const THEME_OPTIONS: ReadonlyArray<AppSelectOption> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const subscribe = () => () => undefined;

export function ThemeToggle() {
  const selectId = useId();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  if (!mounted) {
    return (
      <div className="flex items-center gap-2 text-xs font-medium">
        <span className="app-muted hidden sm:inline">Theme</span>
        <div
          aria-hidden="true"
          className="app-input h-9 w-[6.75rem] rounded-lg opacity-75"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs font-medium">
      <label htmlFor={selectId} className="app-muted hidden sm:inline">
        Theme
      </label>
      <AppSelect
        id={selectId}
        ariaLabel="Select theme"
        options={THEME_OPTIONS}
        value={theme ?? "system"}
        onValueChange={setTheme}
        menuMinWidthPx={148}
        className="w-[6.75rem] rounded-lg text-sm"
      />
    </div>
  );
}
