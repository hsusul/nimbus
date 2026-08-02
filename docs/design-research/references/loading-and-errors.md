# Loading and errors

Nimbus already includes list/table skeletons, inline notices, error notices with retry, upload-item errors, dialogs, and toasts. Research supports connecting these states across the workflow.

## EverCloud

- **Source platform:** Dribbble
- **Product/design:** EverCloud cloud-storage dashboard by Rijal / Sogee
- **Direct URL:** https://dribbble.com/shots/22434483-evercloud-Cloud-Storage-Dashboard
- **UI category:** System status, file operations, trust
- **Platform:** Web
- **What works well:** The concept emphasizes storage visibility, sync/backup status, operation feedback, confirmations, and hierarchy.
- **What should not be copied:** Claims of sync, backup, or security behavior Nimbus has not implemented; visual treatment is conceptual.
- **Reusable principle:** Reliable systems expose progress, failure, recovery, and eventual completion in plain language.
- **Nimbus application:** Align upload tray, file-row processing state, Jobs labels, retry action, and terminal failure copy around a shared state vocabulary.
- **Rights/status:** Visual inspiration only.

## Interaction rules

- Skeletons should preserve approximate table geometry and avoid indefinite animation.
- Background refresh must not replace existing content with a full-page loader.
- A toast confirms a completed low-risk action; persistent failures stay near the affected object or transfer.
- Error copy should distinguish retryable network/worker state from permission, validation, and terminal failure.
- Upload cancellation and destructive file operations require precise object/destination language.
- Internal bucket names, object keys, stack traces, tokens, and signed URLs must never appear.
- Progress updates should be throttled for assistive technology and use text labels in addition to bars or color.
