# Nimbus design principles

1. **The console is an operational workspace.** Favor fast scanning, stable placement, explicit status, and predictable actions over decorative dashboards.
2. **The API model remains visible.** Upload finalization, permissions, immutable versions, public-link scope, and background jobs should be explained in plain language rather than hidden behind generic success states.
3. **Navigation reflects real capabilities.** Do not add clickable routes, settings, billing, or collaboration destinations before backing behavior exists. Unavailable items should be minimized rather than used as roadmap decoration.
4. **Location is never ambiguous.** Preserve a single authoritative breadcrumb/current-folder hierarchy and show drag, move, upload, and restore destinations before commitment.
5. **Primary actions are scarce and obvious.** Each surface gets one dominant action; secondary actions remain quiet and destructive actions require explicit confirmation.
6. **Dense views support recognition and control.** File lists should expose the metadata needed for decisions, offer sorting/filtering, and avoid replacing useful rows with oversized decorative cards.
7. **Search is one coherent journey.** Quick search should lead into the same query and filter model as advanced search, with visible scope and removable filters.
8. **Every asynchronous state has a next step.** Uploads and jobs show queued, active, retryable, failed, and complete states with recovery actions and without leaking storage internals.
9. **Empty states teach the immediate task.** Explain why the surface is empty and offer a context-appropriate action such as uploading, creating a folder, clearing filters, or retrying.
10. **Responsive means reprioritized.** Narrow layouts preserve upload, browse, search, share, and recovery; they hide low-priority metadata before shrinking controls below usable sizes.
11. **Keyboard and screen-reader paths are first-class.** Maintain landmarks, labels, focus order, focus restoration, Escape behavior, skip links, reduced motion, and visible focus throughout visual changes.
12. **Dark mode is a token system, not an inversion.** Status colors, borders, scrims, focus rings, and overlays must retain meaning and contrast in both schemes.
13. **Motion explains change.** Use short transitions for drawers, trays, selection, and status updates; do not animate stable table geometry or block input during background work.
14. **Borrow principles, not identity.** Third-party references may shape hierarchy and behavior, but Nimbus retains its own typography, cobalt accent, compact radii, icons, copy, and implementation.
