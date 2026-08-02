# Authentication

The implemented sign-in surface is deliberately small: Nimbus branding, a clear workspace-access heading, supporting copy, and a GitHub sign-in action. Production supports GitHub OAuth; no password, invitation, organization picker, or plan-selection flow exists.

## Refero login category

- **Source platform:** Refero
- **Product/design:** Apps catalog — Log In category
- **Direct URL:** https://refero.design/apps
- **UI category:** Authentication discovery
- **Platform:** Web
- **What works well:** Real-product comparisons can help audit hierarchy, provider clarity, trust copy, recovery paths, and responsive layout.
- **What should not be copied:** Additional authentication methods, testimonials, security claims, or recovery actions Nimbus does not support.
- **Reusable principle:** Authentication screens should state the destination, provider, consequence, and recovery path without unnecessary product chrome.
- **Nimbus application:** Keep the single GitHub action prominent; add provider-error recovery and support guidance before visual ornament.
- **Rights/status:** Public catalog; no individual capture reused.

## Recommended checks

- Provider button name and focus state remain explicit.
- OAuth errors explain whether retrying is safe.
- Return destinations are preserved after sign-in where supported.
- No fake email/password fields or plan selectors are introduced.
- Dark mode and 200% zoom remain readable.
