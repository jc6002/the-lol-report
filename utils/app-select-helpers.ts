/**
 * Pure geometry, filtering, keyboard-stepping, and route helpers backing
 * `components/app-select.tsx` and study switcher navigation.
 */

export const APP_SELECT_SEARCH_THRESHOLD = 10;

const VIEWPORT_MARGIN_PX = 8;
const MENU_OFFSET_GAP_PX = 6;
const DEFAULT_MAX_WIDTH_PX = 420;
const DEFAULT_MAX_HEIGHT_PX = 320;
const MIN_COMFORTABLE_BELOW_PX = 220;
const MIN_MENU_HEIGHT_PX = 96;
const MIN_VIEWPORT_WIDTH_FLOOR_PX = 120;

export interface AppSelectOption<V extends string = string> {
  readonly value: V;
  readonly label: string;
  readonly searchText?: string;
  readonly disabled?: boolean;
}

export type AppSelectAlign = "start" | "end";
export type AppSelectNavKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export interface ViewportRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly height: number;
}

export interface SelectMenuPositionInput {
  readonly triggerRect: ViewportRect;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly align: AppSelectAlign;
  readonly minWidthPx?: number;
  readonly maxWidthPx?: number;
  readonly preferredMaxHeightPx?: number;
  readonly intrinsicMenuWidthPx?: number;
  readonly intrinsicMenuHeightPx?: number;
}

export interface SelectMenuPosition {
  readonly placement: "bottom" | "top";
  readonly left: number;
  readonly top: number | null;
  readonly bottom: number | null;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
}

export interface BuildStudySwitchHrefParams {
  readonly currentStudyId: number;
  readonly targetStudyId: string;
  readonly activeTab: string;
  readonly currentSearch: string;
}

/** Returns true when the option count exceeds the inline search threshold. */
export function shouldShowSelectSearch(optionCount: number): boolean {
  return optionCount > APP_SELECT_SEARCH_THRESHOLD;
}

/**
 * Filters listbox options case-insensitively against label, value, and optional
 * searchText, including `#<id>` exact-study shorthand queries.
 */
export function filterSelectOptions<V extends string>(
  options: ReadonlyArray<AppSelectOption<V>>,
  query: string,
): AppSelectOption<V>[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed === "#") {
    return [...options];
  }

  const hashIdNeedle = /^#\d+$/.test(trimmed) ? trimmed.slice(1) : null;

  return options.filter((option) => {
    const lowerValue = option.value.toLowerCase();
    const lowerLabel = option.label.toLowerCase();
    const lowerSearch = (option.searchText ?? "").toLowerCase();

    if (hashIdNeedle !== null) {
      return (
        lowerValue === hashIdNeedle ||
        lowerLabel.startsWith(`${hashIdNeedle} -`) ||
        lowerLabel.includes(trimmed) ||
        lowerSearch.includes(trimmed)
      );
    }

    return (
      lowerLabel.includes(trimmed) ||
      lowerValue.includes(trimmed) ||
      lowerSearch.includes(trimmed)
    );
  });
}

/**
 * Resolves the active option index when opening or resetting a menu: chooses
 * the selected enabled option when present, else the first enabled option.
 */
export function findSelectedEnabledIndex<V extends string>(
  options: ReadonlyArray<AppSelectOption<V>>,
  value: V,
): number {
  const selectedIndex = options.findIndex(
    (option) => option.value === value && !option.disabled,
  );
  if (selectedIndex >= 0) {
    return selectedIndex;
  }
  return options.findIndex((option) => !option.disabled);
}

/**
 * Computes the next highlighted enabled option index for keyboard navigation,
 * wrapping around at list boundaries on ArrowDown/ArrowUp.
 */
export function stepActiveOptionIndex<V extends string>(
  options: ReadonlyArray<AppSelectOption<V>>,
  currentIndex: number,
  key: AppSelectNavKey,
): number {
  const enabledIndices: number[] = [];
  for (let i = 0; i < options.length; i += 1) {
    if (!options[i].disabled) {
      enabledIndices.push(i);
    }
  }
  if (enabledIndices.length === 0) {
    return -1;
  }

  switch (key) {
    case "Home":
      return enabledIndices[0];
    case "End":
      return enabledIndices[enabledIndices.length - 1];
    case "ArrowDown": {
      const currentPos = enabledIndices.indexOf(currentIndex);
      if (currentPos < 0) {
        return enabledIndices[0];
      }
      return enabledIndices[(currentPos + 1) % enabledIndices.length];
    }
    case "ArrowUp": {
      const currentPos = enabledIndices.indexOf(currentIndex);
      if (currentPos < 0) {
        return enabledIndices[enabledIndices.length - 1];
      }
      return enabledIndices[
        (currentPos - 1 + enabledIndices.length) % enabledIndices.length
      ];
    }
  }
}

/**
 * Finds the next enabled option matching a typed prefix starting strictly after
 * `currentIndex` (wrapping around), for single-character/prefix typeahead on
 * compact non-searchable menus.
 */
export function findTypeaheadOptionIndex<V extends string>(
  options: ReadonlyArray<AppSelectOption<V>>,
  currentIndex: number,
  prefix: string,
): number {
  const normalized = prefix.trim().toLowerCase();
  if (normalized.length === 0 || options.length === 0) {
    return -1;
  }

  const startOffset =
    currentIndex >= 0 && currentIndex < options.length ? currentIndex + 1 : 0;

  for (let offset = 0; offset < options.length; offset += 1) {
    const idx = (startOffset + offset) % options.length;
    const candidate = options[idx];
    if (
      !candidate.disabled &&
      candidate.label.trim().toLowerCase().startsWith(normalized)
    ) {
      return idx;
    }
  }
  return -1;
}

/**
 * Computes fixed-viewport coordinates for a portaled listbox popup, clamping
 * horizontally within viewport margins and flipping upward (`bottom`-anchored)
 * when space below the trigger is tighter than space above.
 */
export function computeSelectMenuPosition(
  input: SelectMenuPositionInput,
): SelectMenuPosition {
  const availableWidth = Math.max(
    MIN_VIEWPORT_WIDTH_FLOOR_PX,
    input.viewportWidth - VIEWPORT_MARGIN_PX * 2,
  );
  const requestedMin = Math.max(input.triggerRect.width, input.minWidthPx ?? 0);
  const minWidth = Math.round(Math.min(availableWidth, requestedMin));
  const requestedMax = Math.max(
    minWidth,
    input.maxWidthPx ?? DEFAULT_MAX_WIDTH_PX,
  );
  const maxWidth = Math.round(Math.min(availableWidth, requestedMax));
  const effectiveWidth = Math.min(
    maxWidth,
    Math.max(minWidth, input.intrinsicMenuWidthPx ?? minWidth),
  );

  const preferredLeft =
    input.align === "end"
      ? input.triggerRect.right - effectiveWidth
      : input.triggerRect.left;
  const maxLeft = Math.max(
    VIEWPORT_MARGIN_PX,
    input.viewportWidth - effectiveWidth - VIEWPORT_MARGIN_PX,
  );
  const left = Math.round(
    Math.min(Math.max(VIEWPORT_MARGIN_PX, preferredLeft), maxLeft),
  );

  const preferredMaxHeight = input.preferredMaxHeightPx ?? DEFAULT_MAX_HEIGHT_PX;
  const spaceBelow =
    input.viewportHeight -
    input.triggerRect.bottom -
    MENU_OFFSET_GAP_PX -
    VIEWPORT_MARGIN_PX;
  const spaceAbove =
    input.triggerRect.top - MENU_OFFSET_GAP_PX - VIEWPORT_MARGIN_PX;
  const neededBelow = Math.min(
    preferredMaxHeight,
    input.intrinsicMenuHeightPx ?? preferredMaxHeight,
    MIN_COMFORTABLE_BELOW_PX,
  );
  const shouldFlipTop = spaceBelow < neededBelow && spaceAbove > spaceBelow;

  if (shouldFlipTop) {
    return {
      placement: "top",
      left,
      top: null,
      bottom: Math.round(
        Math.max(
          VIEWPORT_MARGIN_PX,
          input.viewportHeight - input.triggerRect.top + MENU_OFFSET_GAP_PX,
        ),
      ),
      minWidth,
      maxWidth,
      maxHeight: Math.round(
        Math.max(MIN_MENU_HEIGHT_PX, Math.min(preferredMaxHeight, spaceAbove)),
      ),
    };
  }

  return {
    placement: "bottom",
    left,
    top: Math.round(
      Math.max(VIEWPORT_MARGIN_PX, input.triggerRect.bottom + MENU_OFFSET_GAP_PX),
    ),
    bottom: null,
    minWidth,
    maxWidth,
    maxHeight: Math.round(
      Math.max(MIN_MENU_HEIGHT_PX, Math.min(preferredMaxHeight, spaceBelow)),
    ),
  };
}

/**
 * Builds the next `/study/<id>/<tab>` URL when switching studies from
 * `StudySubNav`, preserving query params such as `excludeHighRisk=1` while
 * returning `null` for empty or unchanged study selections.
 */
export function buildStudySwitchHref(
  params: BuildStudySwitchHrefParams,
): string | null {
  const trimmedId = params.targetStudyId.trim();
  if (trimmedId.length === 0 || trimmedId === String(params.currentStudyId)) {
    return null;
  }

  const rawQuery = params.currentSearch.startsWith("?")
    ? params.currentSearch.slice(1)
    : params.currentSearch;
  const nextParams = new URLSearchParams(rawQuery);
  nextParams.delete("studyId");

  const normalizedTab = params.activeTab.replace(/^\/+/, "");
  const nextPath = `/study/${encodeURIComponent(trimmedId)}/${normalizedTab}`;
  const nextQuery = nextParams.toString();
  return nextQuery.length > 0 ? `${nextPath}?${nextQuery}` : nextPath;
}
