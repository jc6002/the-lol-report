# AGENTS.md

## Project Overview
- Project: `the-lol-report`
- Current status: Next.js App Router scaffold with Supabase Google auth + `profiles.is_superadmin` route protection.
- Goal: build a modern Next.js app with Tailwind CSS and Supabase-backed data/auth.

## Current Stack
- Next.js `16.1.6`
- React `19.2.4`
- TypeScript `^5`
- Tailwind CSS `^4` with `@tailwindcss/postcss`
- Recharts `^3.8.0`
- ESLint `^9` with `eslint-config-next`

## Repository Layout
- `app/`: App Router pages and layout.
- `app/page.tsx`: Protected Executive Study Hub (`/?tab=studies|flavors|models&q=<filter>`) showing cross-study attribution leaderboards, smart benchmark entry points, catalog-wide KPIs, and a filterable, sortable directory across all studies.
- `app/login/page.tsx`: Google-only login route (public).
- `app/auth/callback/route.ts`: OAuth callback + `profiles.is_superadmin` gate.
- `app/study/[id]/attribution/page.tsx`: Protected prompt flavor, synthesis model, and full-pipeline attribution report (`/study/<id>/attribution?excludeHighRisk=1&groupBy=flavor|model|pipeline&flavor=<id_or_slug>&model=<id_or_name>`) combining unified study exposures with `humor_flavors`, `humor_flavor_steps`, `llm_model_responses`, and `study_participations`, with adaptive 0-vote staging and single-flavor layouts, Wilson 95% confidence intervals, deck-clamped retention curves, labeled auto-fitted scatter and caption-distribution charts, interactive row-to-caption and prompt drilldown, and a pinned `Unattributed / Manual` reconciliation row.
- `app/study/[id]/demographics/page.tsx`: Protected demographic cohort explorer (`/study/<id>/demographics?excludeHighRisk=1`) joining voter exposures against canonicalized `demographic_user_responses`, `demographic_answer_question_mapping`, `demographic_questions`, and `demographic_answers` with an interactive cohort-by-flavor heatmap, single-flavor column deduplication, cell caption drilldown, question-qualified segment taste-gap ranking, and strict `k >= 5` distinct-voter privacy masking.
- `app/study/[id]/head-to-head/page.tsx`: Protected controlled same-image comparison and cross-study flavor trajectory page (`/study/<id>/head-to-head?flavor=<id_or_slug>&rival=<id_or_slug>&excludeHighRisk=1`) with mean-centered same-image lift rankings, viewport-fitted pairwise side-by-side caption showdowns, adaptive single-flavor top-vs-lowest caption comparison, and CSV / Markdown research brief exports.
- `app/reports/study-comparison/page.tsx`: Protected report page that compares two studies (`?studyA=<id>&studyB=<id>`) using caption coverage, vote-derived metrics, overlap counts, and deltas in an on-page comparison table.
- `app/reports/new-style-report/page.tsx`: Redirect helper that resolves a selected or latest study ID 7+ into the new study interface report route.
- `app/reports/study-detail/page.tsx`: Redirect helper that resolves a selected or latest study into the study detail route.
- `app/study/[id]/engagement-risk/page.tsx`: Protected report page that scores per-user participation risk for a selected study (`/study/<id>/engagement-risk?minVotes=<n>`) using voting speed/read-load, leave-one-out consensus agreement, vote monotony, and polarity extremity.
- `app/study/[id]/new-style-report/page.tsx`: Protected report page for the newer study interface used by study IDs 7+ (`/study/<id>/new-style-report?minUserNavigationEvents=<n>`), comparing `study_caption_navigation_events` against `study_caption_vote_events` for same-session vote coverage, skip rate, dwell timing, and user/caption breakdowns.
- `app/reports/weekly-study-summary/page.tsx`: Protected report page for weekly study analytics from `studies` + caption/vote mappings. Uses lightweight study-level aggregates to chart weighted score, caption volume, vote volume, and votes-per-caption across the loaded study window (`?limit=<n>`).
- `app/study/[id]/study-detail/page.tsx`: Protected report page that shows basic vote-level detail for one study (`/study/<id>/study-detail`), including overall vote totals, vote distribution, vote timing summary, and caption-level vote coverage.
- `app/study/[id]/vote-timing/page.tsx`: Protected report page that shows each user's elapsed first-vote-to-last-vote span for a selected study (`/study/<id>/vote-timing?minVotes=<n>`), with KPI cards and an on-page timing table.
- `app/study/[id]/user-upvote-rate/page.tsx`: Protected report page that shows per-user upvote percentage for a selected study (`/study/<id>/user-upvote-rate`), sorted by upvote percentage descending with user-level vote counts.
- `app/study/[id]/selected-user-report/page.tsx`: Protected report page that starts with no selected users and lets you add/remove profiles through a searchable modal to calculate a combined upvote percentage for only the chosen subset (`/study/<id>/selected-user-report?userId=<profile>&userId=<profile>`).
- `app/api/study-search/route.ts`: Authenticated superadmin route handler backing the global `Cmd+K` / `Ctrl+K` command palette to search studies, prompt flavors, LLM models, and global reports (`?q=<term>`).
- `app/api/profile-search/route.ts`: Authenticated route handler used by the selected-user-report modal to search the `profiles` table by name, email, or id.
- `app/actions/auth.ts`: server actions for sign-in/sign-out.
- `components/`: shared Server and Client UI components, including `app-select.tsx` (accessible viewport-clamped portal listbox dropdown with automatic search filtering), `top-navbar.tsx` / `top-navbar-client.tsx` (global `Cmd+K` search palette and recent study activity popover), `study-directory-table.tsx`, `study-sub-nav.tsx` (shared study switcher, era indicator, `?excludeHighRisk=1` quality toggle, and report tabs), `study-attribution-charts.tsx`, `study-attribution-leaderboard.tsx`, `demographic-cohort-heatmap.tsx`, `same-image-showdown-feed.tsx`, and `study-export-toolbar.tsx`.
- `utils/`: shared data loaders, statistics, UI, and export modules, including `supabase-pagination.ts` (chunked range pagination and transient backoff retry), `study-exposure-adapter.ts` (dual-era Likert vote vs. swipe navigation exposure adapter, rater quality diagnostics, and deck-clamped participation funnel builder), `attribution-stats.ts` (Wilson 95% confidence intervals, within-image mean-centered lift, caption histogram and drilldown sample selection, leaderboard aggregation, and `k >= 5` demographic matrix builder), `study-lineage-loader.ts` (live superadmin-gated bounded 60s LRU caches, concurrent chunked event pagination, and two-tier caption lineage resolution), `attribution-ui-helpers.ts`, `app-select-helpers.ts`, and `attribution-export.ts` (formula-neutralized CSV and privacy-checked Markdown research brief serializers).
- `utils/supabase/`: shared Supabase server/client/proxy helpers.
- `proxy.ts`: global route protection (Next.js 16 proxy).
- `amplify.yml`: AWS Amplify Hosting build spec for SSR deployment.
- `public/`: static assets.
- `next.config.ts`: Next.js config.
- `tsconfig.json`: TypeScript config.
- `eslint.config.mjs`: lint config.

## Local Development
1. Install dependencies (requires Node.js 24.x and npm 11.x per `package.json` `engines`):
```bash
npm install
```
2. Start dev server (listens on port `3007` by default):
```bash
npm run dev
```
3. Run unit tests:
```bash
npm test
```
4. Production build:
```bash
npm run build
```
5. Run lint:
```bash
npm run lint
```

## Conventions
- Prefer Server Components by default in `app/`; add `'use client'` only when needed.
- Keep TypeScript strict and avoid `any` unless necessary.
- Store secrets in `.env.local`; never commit secrets.
- Use small, focused components and keep business logic out of page files when possible.

## Testing
- `npm test` runs the pure TypeScript unit test suites under `utils/__tests__/*.test.ts` on Node.js 24's built-in `node:test` runner via `utils/__tests__/register-test-loader.mjs` (covers pagination/retry splitting, dual-era exposure reconciliation and rater quality flags, Wilson CIs and same-image lift, `k >= 5` demographic privacy masking including subtraction suppression, lineage loaders, UI sorting/filtering/search response classification, and CSV/brief export safety).
- Add unit tests in `utils/__tests__/` whenever adding or changing data, statistical, filtering, or export logic.

## Setup and commands
- Required env vars in `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, either `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; `NEXT_PUBLIC_SITE_URL` can be used for callback origin fallback.
- Google OAuth/Supabase redirect allowlists must include the deployed callback URLs (`https://stats.humorstudy.org/auth/callback`, `https://stats.slightlyhumorous.org/auth/callback`) plus the local callback URL for whichever dev port is used.
- OAuth callback redirects must prefer `NEXT_PUBLIC_SITE_URL` over request-derived origins because Amplify SSR can expose internal localhost origins in route handlers.
- Install/run: `npm install`, `npm run dev`; test: `npm test`; lint: `npm run lint`; build: `npm run build`.
- AWS hosting uses the committed `amplify.yml` build spec plus console-managed Amplify GitHub App connections. Staging is `the-lol-report-staging` from the `staging` branch to `stats.slightlyhumorous.org`; production is `the-lol-report-production` from `main` to `stats.humorstudy.org`. Setup notes live in `README.md`.
- Public routes: `/login` and `/auth/callback`; all others require an authenticated user whose matching `profiles` row has `is_superadmin = true`.

## Authentication sessions
- Auth cookies are scoped to this app and Supabase project using `getSupabaseAuthCookieOptions`; browser, server, and proxy clients must use the same options.
- Ordinary logout and auth cleanup use `signOut({ scope: "local" })` so other apps remain signed in.
- Existing shared auth cookies are not imported; users sign in once per app after this change.

## Supabase schema
- The latest database types live in src/types/supabase.ts
- This is generated by running npm run supabase:types
- The user does not want to use a SUPABASE_ROLE_KEY.  All actions should use the logged-in user's JWT key.

## Conventions and reminders
- Use the shared Supabase client helpers (`createClient`) for server/client contexts instead of instantiating ad hoc.
- Update the public route allowlist in `utils/supabase/proxy.ts` whenever adding unauthenticated pages.
- Tailwind v4 uses CSS-driven tokens in `app/globals.css` (with `@custom-variant dark (&:where(.dark, .dark *));` bound to `next-themes` class mode) rather than a config file.
- Do not crop caption images—render them fully (object-contain) and adjust layout instead of cutting off any part of the image.
- COMMANDMENT: Caption text must sit immediately under its image with nothing in between. No badges/pills/buttons may intrude.
- COMMANDMENT: Never let UI overlap—avoid stacking divs so badges, buttons, or bars cover image or caption.
- COMMANDMENT: Before finishing work, run `npm run build` and resolve build errors.
- Keep this doc updated when adding routes, changing auth flow, or adjusting environment requirements.
