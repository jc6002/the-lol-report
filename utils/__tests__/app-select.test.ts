import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  APP_SELECT_SEARCH_THRESHOLD,
  type AppSelectOption,
  buildStudySwitchHref,
  computeSelectMenuPosition,
  filterSelectOptions,
  findSelectedEnabledIndex,
  findTypeaheadOptionIndex,
  shouldShowSelectSearch,
  stepActiveOptionIndex,
} from "@/utils/app-select-helpers";

const SAMPLE_OPTIONS: ReadonlyArray<AppSelectOption> = [
  { value: "123", label: "123 - winter-finale", searchText: "Latest swipe deck" },
  { value: "122", label: "122 - campus-pack" },
  { value: "22", label: "22 - sad-girl-pack", disabled: true },
  { value: "4", label: "4 - early-likert", searchText: "Six-point baseline" },
];

describe("AppSelect search threshold & filtering helpers", () => {
  it("enables search strictly when option count exceeds APP_SELECT_SEARCH_THRESHOLD (10)", () => {
    assert.equal(APP_SELECT_SEARCH_THRESHOLD, 10);
    assert.equal(shouldShowSelectSearch(0), false);
    assert.equal(shouldShowSelectSearch(10), false);
    assert.equal(shouldShowSelectSearch(11), true);
    assert.equal(shouldShowSelectSearch(86), true);
  });

  it("filters case-insensitively across label, value, searchText, and exact #<id> study queries", () => {
    // Blank/whitespace or bare "#" prefix returns shallow copy of all options
    const all = filterSelectOptions(SAMPLE_OPTIONS, "   ");
    assert.equal(all.length, 4);
    assert.notEqual(all, SAMPLE_OPTIONS);
    assert.equal(filterSelectOptions(SAMPLE_OPTIONS, "#").length, 4);
    assert.equal(filterSelectOptions(SAMPLE_OPTIONS, "  # ").length, 4);

    // Exact #id only matches study 22, NOT 122
    assert.deepEqual(
      filterSelectOptions(SAMPLE_OPTIONS, "#22").map((opt) => opt.value),
      ["22"],
    );

    // #id can also match explicit # token in label or searchText
    const hashTagOptions: ReadonlyArray<AppSelectOption> = [
      { value: "alpha", label: "Cohort #99 summary" },
      { value: "beta", label: "Other cohort", searchText: "ref #42" },
    ];
    assert.deepEqual(
      filterSelectOptions(hashTagOptions, "#99").map((opt) => opt.value),
      ["alpha"],
    );
    assert.deepEqual(
      filterSelectOptions(hashTagOptions, "#42").map((opt) => opt.value),
      ["beta"],
    );

    // Plain substring matches 122 and 22 via value/label
    assert.deepEqual(
      filterSelectOptions(SAMPLE_OPTIONS, "22").map((opt) => opt.value),
      ["122", "22"],
    );

    // Case-insensitive searchText and label matching
    assert.deepEqual(
      filterSelectOptions(SAMPLE_OPTIONS, "SIX-POINT").map((opt) => opt.value),
      ["4"],
    );
    assert.deepEqual(
      filterSelectOptions(SAMPLE_OPTIONS, "WINTER").map((opt) => opt.value),
      ["123"],
    );
    assert.deepEqual(filterSelectOptions(SAMPLE_OPTIONS, "no-such-item"), []);
  });
});

describe("AppSelect keyboard stepping & typeahead helpers", () => {
  it("resolves initial selected index while skipping disabled or missing values", () => {
    assert.equal(findSelectedEnabledIndex(SAMPLE_OPTIONS, "122"), 1);
    // Value "22" is disabled -> falls back to first enabled index (0)
    assert.equal(findSelectedEnabledIndex(SAMPLE_OPTIONS, "22"), 0);
    // Missing value -> falls back to first enabled index (0)
    assert.equal(findSelectedEnabledIndex(SAMPLE_OPTIONS, "999"), 0);
    // All disabled or empty -> -1
    assert.equal(findSelectedEnabledIndex([], "any"), -1);
    assert.equal(
      findSelectedEnabledIndex([{ value: "a", label: "A", disabled: true }], "a"),
      -1,
    );
  });

  it("steps across Home, End, ArrowDown, and ArrowUp skipping disabled options and wrapping cleanly", () => {
    assert.equal(stepActiveOptionIndex([], 0, "ArrowDown"), -1);
    assert.equal(
      stepActiveOptionIndex([{ value: "x", label: "X", disabled: true }], 0, "Home"),
      -1,
    );

    assert.equal(stepActiveOptionIndex(SAMPLE_OPTIONS, 1, "Home"), 0);
    assert.equal(stepActiveOptionIndex(SAMPLE_OPTIONS, 0, "End"), 3);

    // Index 1 -> skips disabled index 2 -> lands on 3 -> wraps to 0
    assert.equal(stepActiveOptionIndex(SAMPLE_OPTIONS, 1, "ArrowDown"), 3);
    assert.equal(stepActiveOptionIndex(SAMPLE_OPTIONS, 3, "ArrowDown"), 0);
    assert.equal(stepActiveOptionIndex(SAMPLE_OPTIONS, -1, "ArrowDown"), 0);

    // Index 3 -> skips disabled index 2 -> lands on 1; index 0 wraps to 3
    assert.equal(stepActiveOptionIndex(SAMPLE_OPTIONS, 3, "ArrowUp"), 1);
    assert.equal(stepActiveOptionIndex(SAMPLE_OPTIONS, 0, "ArrowUp"), 3);
    assert.equal(stepActiveOptionIndex(SAMPLE_OPTIONS, -1, "ArrowUp"), 3);
  });

  it("cycles prefix typeahead matches after currentIndex and skips disabled entries", () => {
    const themeLike: ReadonlyArray<AppSelectOption> = [
      { value: "system", label: "System" },
      { value: "solar", label: "Solar", disabled: true },
      { value: "sepia", label: "Sepia" },
      { value: "dark", label: "Dark" },
    ];

    assert.equal(findTypeaheadOptionIndex(themeLike, 0, ""), -1);
    assert.equal(findTypeaheadOptionIndex([], 0, "s"), -1);
    // Starting at index 0 ("System"), typing "s" skips disabled "Solar" -> index 2 ("Sepia")
    assert.equal(findTypeaheadOptionIndex(themeLike, 0, "s"), 2);
    // Starting at index 2 ("Sepia"), typing "s" wraps to index 0 ("System")
    assert.equal(findTypeaheadOptionIndex(themeLike, 2, "S"), 0);
    // Out-of-range currentIndex starts search from 0
    assert.equal(findTypeaheadOptionIndex(themeLike, -1, "d"), 3);
    assert.equal(findTypeaheadOptionIndex(themeLike, 99, "z"), -1);
  });
});

describe("AppSelect fixed-portal viewport positioning", () => {
  it("opens below trigger when ample room exists and respects start alignment", () => {
    const pos = computeSelectMenuPosition({
      triggerRect: {
        top: 64,
        bottom: 100,
        left: 120,
        right: 280,
        width: 160,
        height: 36,
      },
      viewportWidth: 1440,
      viewportHeight: 900,
      align: "start",
      minWidthPx: 200,
    });

    assert.equal(pos.placement, "bottom");
    assert.equal(pos.left, 120);
    assert.equal(pos.top, 106);
    assert.equal(pos.bottom, null);
    assert.equal(pos.minWidth, 200);
    assert.equal(pos.maxWidth, 420);
    assert.equal(pos.maxHeight, 320);
  });

  it("clamps right-edge aligned navbar menus and narrow 375px mobile viewports cleanly", () => {
    // Navbar ThemeToggle near right edge with align="end"
    const rightAligned = computeSelectMenuPosition({
      triggerRect: {
        top: 12,
        bottom: 48,
        left: 1320,
        right: 1428,
        width: 108,
        height: 36,
      },
      viewportWidth: 1440,
      viewportHeight: 900,
      align: "end",
      minWidthPx: 148,
      intrinsicMenuWidthPx: 160,
    });
    assert.equal(rightAligned.left, 1268);
    assert.equal(rightAligned.placement, "bottom");

    // Start-aligned trigger near right edge gets clamped inside 8px right margin
    const mobileClamped = computeSelectMenuPosition({
      triggerRect: {
        top: 50,
        bottom: 86,
        left: 240,
        right: 360,
        width: 120,
        height: 36,
      },
      viewportWidth: 375,
      viewportHeight: 812,
      align: "start",
      minWidthPx: 320,
      maxWidthPx: 500,
    });
    assert.equal(mobileClamped.left, 47);
    assert.equal(mobileClamped.minWidth, 320);
    assert.equal(mobileClamped.maxWidth, 359);
  });

  it("flips upward with CSS bottom anchoring when space below is cramped and space above is larger", () => {
    const flipped = computeSelectMenuPosition({
      triggerRect: {
        top: 760,
        bottom: 796,
        left: 80,
        right: 280,
        width: 200,
        height: 36,
      },
      viewportWidth: 1280,
      viewportHeight: 840,
      align: "start",
      preferredMaxHeightPx: 300,
      intrinsicMenuHeightPx: 280,
    });

    assert.equal(flipped.placement, "top");
    assert.equal(flipped.top, null);
    // 840 - 760 + 6 = 86px from viewport bottom keeps popup docked 6px above trigger
    assert.equal(flipped.bottom, 86);
    assert.equal(flipped.maxHeight, 300);

    // When both top and bottom are shallow, stays below when spaceAbove <= spaceBelow
    const staysBottom = computeSelectMenuPosition({
      triggerRect: {
        top: 60,
        bottom: 96,
        left: 20,
        right: 180,
        width: 160,
        height: 36,
      },
      viewportWidth: 800,
      viewportHeight: 240,
      align: "start",
    });
    assert.equal(staysBottom.placement, "bottom");
    assert.equal(staysBottom.maxHeight, 130);
  });
});

describe("StudySubNav study-switch URL builder", () => {
  it("preserves excludeHighRisk=1 and tab params while ignoring blank or same-study selections", () => {
    assert.equal(
      buildStudySwitchHref({
        currentStudyId: 122,
        targetStudyId: "122",
        activeTab: "attribution",
        currentSearch: "?excludeHighRisk=1",
      }),
      null,
    );
    assert.equal(
      buildStudySwitchHref({
        currentStudyId: 122,
        targetStudyId: "   ",
        activeTab: "attribution",
        currentSearch: "",
      }),
      null,
    );
    assert.equal(
      buildStudySwitchHref({
        currentStudyId: 122,
        targetStudyId: "95",
        activeTab: "demographics",
        currentSearch: "?excludeHighRisk=1&studyId=122",
      }),
      "/study/95/demographics?excludeHighRisk=1",
    );
    assert.equal(
      buildStudySwitchHref({
        currentStudyId: 95,
        targetStudyId: "4",
        activeTab: "/head-to-head",
        currentSearch: "flavor=12&excludeHighRisk=1",
      }),
      "/study/4/head-to-head?flavor=12&excludeHighRisk=1",
    );
    assert.equal(
      buildStudySwitchHref({
        currentStudyId: 95,
        targetStudyId: "18",
        activeTab: "attribution",
        currentSearch: "",
      }),
      "/study/18/attribution",
    );
  });
});
