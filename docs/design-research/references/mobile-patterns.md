# Mobile patterns

Nimbus is responsive web software, not a native mobile app. Mobile inspiration must preserve browser semantics and the same core capabilities.

## Dropbox mobile uploads

- **Source platform:** Supplemental first-party documentation
- **Product/design:** Dropbox mobile upload workflow
- **Direct URL:** https://help.dropbox.com/create-upload/upload-mobile
- **UI category:** Mobile upload and destination selection
- **Platform:** Mobile
- **What works well:** The upload begins from a known folder, uses a clear creation action, and asks the user to choose or confirm a destination.
- **What should not be copied:** Native-only capture/audio integrations or platform-specific navigation that does not fit responsive web.
- **Reusable principle:** On small screens, location and destination are more important than exposing every desktop control simultaneously.
- **Nimbus application:** Keep Upload reachable, show the active folder, move secondary actions into a labeled menu, and retain resumable progress after navigation.
- **Rights/status:** Public documentation; no assets reused.

## Manual-review libraries

UXArchive, UI Sources/ScreensDesign, Screenlane, Page Flows, and AppLaunchpad were not substantively accessible to the automated research client. No mobile-screen claims were derived from them. If a native Nimbus client is planned, manually review direct examples for onboarding, file browsing, upload, search, settings, and store imagery, then add creator URLs and rights status here.

## Responsive requirements

- Preserve Files, Search, Jobs, Trash, upload progress, and recovery.
- Keep at least file name plus type/status visible; collapse lower-priority metadata before reducing touch targets.
- Move advanced filters into a drawer or sheet with an explicit active-filter count and clear action.
- Maintain drawer focus trap, Escape behavior where keyboards exist, and focus restoration.
- Test 320px and 390px widths, landscape, 200% zoom/reflow, long filenames, and error copy.
- Do not introduce native bottom navigation unless the information architecture is intentionally redesigned for a native client.
