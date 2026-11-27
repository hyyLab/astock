# Route and navigation truth audit

- Audited against `main` at `0f2b56500d4a4394b7dc64e62199acd99fba9cf2` on 2026-11-27.
- No application-code change was made because neither reported defect is present on the current `main`.

## Finding 1: alleged fake routes and `itemForRoute` highlight mismatch — not reproduced

- `src/app/page.tsx` documents the supported hash routes at lines 4-17, imports the route parser from `Header` at line 19, and renders views by their actual `route.view` values at lines 43-56.
- `src/components/lb/Header.tsx` defines the `Route` union at lines 7-14 and explicitly parses each supported route in `parseHash` at lines 17-33.
- There is no `itemForRoute` symbol in the default branch, and no navigation entry mapping historical review, sentiment cycle, or news tracking to `#/\` with `views: ['today']`. Historical review is intentionally represented by `#/review/{date}`, parsed to `{ view: "today", date }` at line 24; the page passes that date into `ReviewView` at line 43. The page comment identifies NewsTracker as an embedded home module at line 17, not a separate route.

## Finding 2: duplicated `NAV_ITEMS` / `NAV_GROUPS` navigation truth — not reproduced

- `src/app/page.tsx` contains no `NAV_GROUPS` declaration or navigation list; it only renders the selected view.
- The sole navigation data array on `main` is `NAV_ITEMS` in `src/components/lb/Header.tsx` at lines 35-47. The page imports and renders `Header` at lines 19 and 40.
- Repository code search on the default branch returned no matches for `NAV_GROUPS`.

## Scope

Only this audit note is added. No application source, `feature/ui-phase1`, or `feature/ui-style-b` was changed.
