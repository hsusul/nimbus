# Search

Nimbus has a quick-search field in the global top bar and a richer `/search` route with query, type, and MIME controls. The research direction is to make these one journey.

## File Manager Dashboard Concept

- **Source platform:** Dribbble
- **Product/design:** Murad Hossain's File Manager Dashboard Concept
- **Direct URL:** https://dribbble.com/shots/26977410-File-Manager-Dashboard-Concept
- **UI category:** Search, filtering, folder hierarchy
- **Platform:** Web
- **What works well:** It frames hierarchy, quick search, previews, smart filters, and drag-and-drop as parts of the same productivity workflow.
- **What should not be copied:** Unvalidated “smart” behavior, its visual skin, or controls unsupported by Nimbus metadata.
- **Reusable principle:** Search controls should match the attributes users can see and understand in results.
- **Nimbus application:** Keep type and MIME filters, make active scope removable, preserve URL state, and show result count/status consistently.
- **Rights/status:** Visual inspiration only.

## Dropbox search documentation

- **Source platform:** Supplemental first-party documentation
- **Product/design:** Dropbox search
- **Direct URL:** https://help.dropbox.com/view-edit/search
- **UI category:** Search and filtering behavior
- **Platform:** Web, desktop, and mobile
- **What works well:** Search-as-you-type is paired with filters such as folder, type, date, and collaborator where supported.
- **What should not be copied:** Content/OCR/image search promises that Nimbus does not implement.
- **Reusable principle:** Progressive filters should reflect real indexed fields and remain understandable after navigation.
- **Nimbus application:** Unify query entry first; consider folder and updated-date filters only after API support exists.
- **Rights/status:** Public product documentation; no assets reused.
