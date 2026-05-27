// Canonical column split for the OnboardingWalkthrough steps on the
// landing page. Any step that wants a "narrative on the left, visual on
// the right" layout MUST use these classes so the middle margin (the
// gutter between left text and right visual) sits at the same vertical
// position across every step.
//
// Today this pattern is used by:
// - Step 01 (Integrate) in src/app/page.tsx -> Connect Granola popup
// - Step 02 (Zipper) in live-zippering-demo.tsx -> Canonical wide row
//
// Steps 03-05 use full-width content; if any of them ever switches to a
// split layout, pull in the constants from here and the alignment stays
// guaranteed.
//
// Don't change the 5/7 ratio without auditing every callsite. The eye
// reads the vertical line where the right panel begins as a primary
// rhythm cue; drifting it by even a column breaks the page.

export const STEP_GRID_CLASS = "grid grid-cols-1 lg:grid-cols-12";
export const STEP_LEFT_COL_CLASS = "lg:col-span-5";
export const STEP_RIGHT_COL_CLASS = "lg:col-span-7";
