# Nimbus design research

This library records UI/UX references for Nimbus without importing third-party assets or changing the production interface. Research was performed on 2026-08-01 against the repository at commit `3078fd4`.

## Product and interface baseline

Nimbus is an API-first object-storage and file-collaboration platform for developers. Its primary user interface is a responsive web console built with Next.js 15, React 19, TypeScript, Auth.js, Lucide icons, and repository-owned CSS components and tokens. The application is not a consumer-drive clone: the interface must expose reliable uploads, immutable versions, permission boundaries, public links, background jobs, and recovery states without obscuring the underlying system behavior.

The implemented routes are `/files`, `/search`, `/jobs`, `/trash`, `/sign-in`, and `/public/[token]`; `/` redirects to `/files`. Recent, Shared, and Favorites appear as explicitly unavailable navigation items rather than implemented routes. There is currently no marketing landing page, onboarding flow, settings area, billing surface, organization model, or native mobile application.

The visual baseline is a compact, neutral developer-console aesthetic: a 232px sidebar, 48px top bar, 40px data rows, system sans-serif typography, 4–10px radii, hairline borders, cobalt-blue actions, light/dark system themes, and restrained shadows. Existing screenshots under `docs/assets/` show deterministic demo data.

## Current strengths

- Predictable app shell and route-level navigation.
- List/grid file browsing, breadcrumbs, sorting, multi-select, drag-and-drop, and contextual actions.
- Upload tray with progress, retry, cancellation, and resumable-upload recovery.
- File-detail drawer with Overview, Versions, and Sharing tabs.
- Purpose-built loading, empty, error, dialog, menu, toast, and destructive-confirmation components.
- Responsive mobile navigation with focus trapping, Escape dismissal, focus restoration, and body-scroll locking.
- System dark mode, visible focus styling, reduced-motion handling, skip link, semantic landmarks, and axe coverage for major routes.

## Highest-value UX opportunities

1. Clarify the developer-platform identity without turning the console into a decorative marketing surface.
2. Make dense file rows more informative through optional owner/access/status metadata while preserving scan speed.
3. Reconcile the global quick-search field with the richer Search page so the two controls feel like one workflow.
4. Make upload/finalization state more legible across the tray, file row, and Jobs route.
5. Improve responsive file management beyond merely moving the sidebar into a drawer: prioritize row fields and actions for narrow screens.
6. Create intentional first-run and empty-folder guidance before adding a broad onboarding tour.
7. Add settings only when real account, appearance, API-key, or storage-policy capabilities exist; do not add placeholder navigation.
8. Preserve keyboard and screen-reader behavior as components are visually refined.

## Library map

- [Source index](./source-index.md): every accessed source, direct URL, lesson, relevance, and usage-rights status.
- [Design principles](./design-principles.md): project-specific rules.
- [Pattern analysis](./pattern-analysis.md): cross-reference synthesis and suitability assessment.
- [Implementation plan](./implementation-plan.md): prioritized, file-scoped next steps.
- [`references/`](./references/): notes grouped by interface pattern.
- [Asset policy](./assets/README.md): screenshot and attribution rules.

## Research method and limitations

Only public pages reachable through normal web access were reviewed. No authentication, paywall, CAPTCHA, robots restriction, or rate limit was bypassed. Public visibility does not grant reuse rights; all third-party concepts remain inspiration only. No external screenshots were saved because the reviewed pages did not provide sufficiently clear permission to redistribute captures in this repository.

Some requested sources could not be substantively reviewed: UXArchive now redirects to Waldo, UI Sources redirects to ScreensDesign without exposing useful archive content to the research client, Screenlane and Page Flows returned HTTP 403, AppLaunchpad exposed an empty public shell to the research client, and Figma Community blocked automated access through robots.txt. These are listed for manual review rather than described as researched examples.
