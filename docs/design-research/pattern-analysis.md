# Pattern analysis

## Strongest recurring patterns

Across the accessible Refero, Layers, Dribbble, and Behance material, the strongest references converge on a stable sidebar, a restrained toolbar, a primary file list, visible storage/system status, contextual detail panels, and explicit upload feedback. The useful agreement is behavioral—not a mandate to reproduce the same card-heavy dashboard.

### Patterns that improve usability

- **Stable two-column shell:** persistent navigation and a large task surface reduce reorientation. Nimbus already follows this pattern.
- **Table-first browsing:** sortable rows remain the best default for names, types, sizes, access, timestamps, and bulk selection. Grid view remains optional for visual assets.
- **Contextual details:** a drawer preserves list context while exposing metadata, versions, sharing, and download actions.
- **Visible system status:** storage capacity, upload progress, finalization, and failures should appear where the user acts, with deeper history on Jobs.
- **Unified search and filters:** query, scope, type, and other filters should form one stateful model with clear reset behavior.
- **Progressive disclosure:** row menus and drawers keep the main list calm while retaining advanced operations.
- **Complete state design:** skeleton, empty, error, disabled, selected, retry, and permission states are part of the workflow, not edge-case polish.
- **Destination confirmation:** uploads, moves, restores, and destructive actions communicate exactly where or what will change.

### Patterns that are mainly decorative

- Large storage donuts when a compact used/total meter answers the question.
- Multiple colorful category cards that duplicate the file table.
- Floating glass panels, oversized shadows, and gradient canvases in an operational console.
- Lifestyle illustrations or 3D folder art inside routine file-management views.
- Marketing-style hero typography inside authenticated routes.
- Motion between every file view when a fast, stable transition is more usable.

### Patterns suitable for Nimbus

- Compact sidebar and top bar with one accent color.
- Flat, bordered surfaces and small radii, consistent with the existing token system.
- File rows that optionally expose access role, processing state, and owner when those fields aid decisions.
- Folder-scoped upload affordances and a persistent transfer tray.
- A command menu or keyboard shortcut layer only after existing actions have stable accessible names and permissions.
- A future landing page that uses a real Nimbus console screenshot and architecture proof rather than generic cloud artwork.
- First-run guidance embedded in authentic empty states rather than a long modal tour.

### Patterns that conflict with Nimbus goals

- A consumer-photo-drive identity that de-emphasizes API contracts, versions, permissions, and workers.
- A home dashboard that replaces direct access to files with analytics cards.
- Placeholder Recent, Shared, Favorites, Settings, or Billing screens that imply unsupported behavior.
- Auto-hiding critical upload/failure state in transient toasts alone.
- Mobile layouts that remove bulk operations, recovery, or location context.
- Copying the dark-sidebar/color/category system of a gallery concept closely enough to inherit another product's identity.

## Accessibility concerns

Nimbus already includes a skip link, semantic navigation, focus trapping/restoration for the mobile drawer, system color schemes, reduced-motion rules, visible focus tokens, accessible labels, and automated axe checks. Any visual iteration should additionally verify:

- 44px-equivalent touch targets for frequent mobile actions even when desktop rows remain compact.
- Non-color status labels for upload, job, access, and destructive states.
- Keyboard selection and bulk-action behavior in list and grid views.
- Screen-reader announcements for upload progress and completion without excessive live-region chatter.
- Drawer/dialog focus containment, Escape behavior, and return focus.
- Contrast in both light and dark tokens, especially muted metadata and disabled controls.
- Zoom/reflow at 200% and narrow landscape layouts, not only the existing 390×844 test.

## Mobile and responsive considerations

The current 899px breakpoint turns the sidebar into a modal drawer, and lower breakpoints reshape content. The next step is field prioritization: keep file name, type/status, and actions; progressively hide size or timestamp; move advanced filters into a labeled drawer; keep upload access visible; and preserve breadcrumb/location context. A native bottom-navigation pattern would conflict with the current responsive-web scope unless a true mobile information architecture is designed separately.

## Cohesive direction

**Primary direction — restrained infrastructure console.** Keep the current compact system-sans typography, cobalt accent, hairline borders, small radii, flat surfaces, and table-first file workspace. Add warmth through clearer hierarchy, better metadata grouping, more intentional empty states, and product-specific status language—not through ornamental cards.

**Backup direction — editorial developer workspace.** Borrow the warm paper/technical-document sensibility seen in Refero's PostHog and Tailscale references for a future public landing page and documentation surfaces, while leaving the authenticated console neutral and high-density.

### System recommendations

- **Typography:** retain the native UI sans stack for the console; use the existing mono stack for IDs, code, scopes, and technical metadata. Consider a distinct display face only for a future marketing surface.
- **Spacing:** formalize a 4px base with 4/8/12/16/24/32px steps; keep 40px desktop rows and use larger touch targets on mobile.
- **Radius:** keep 4px inputs/rows, 6px panels, and 10px overlays; reserve pills for status badges and segmented controls.
- **Navigation:** Files, Search, Jobs, and Trash remain primary. Add real routes only when backed by product behavior; move account/API-key/appearance controls into an account menu or settings route when implemented.
- **Hierarchy:** shell → page toolbar → status/notice → primary list/grid → contextual drawer/dialog → toast for transient confirmation.
- **Responsive strategy:** change information priority and interaction containers at breakpoints; do not merely compress desktop geometry.
- **Motion:** 120–240ms, ease-out, transform/opacity only where possible, reduced-motion respected, no ornamental parallax.
- **Accessibility baseline:** WCAG 2.2 AA target, keyboard-complete workflows, visible focus, semantic status, non-color cues, 200% zoom/reflow, and axe plus manual checks.
