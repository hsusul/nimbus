# Settings

Nimbus does not currently expose a settings or billing route. The repository does include an account menu, system-driven light/dark tokens, and API-key behavior elsewhere in the platform.

## Research status

Refero's public Apps catalog lists Profile & Account and Paywall & Subscription categories at https://refero.design/apps, but no specific settings screen was used as a recommendation. Screenlane and Page Flows could not be accessed automatically, and Figma Community license details could not be verified.

## Direction

Create settings only when there is real behavior to configure. A future information architecture could be:

1. **Account:** identity and sign-out; provider-managed fields clearly labeled.
2. **Appearance:** light, dark, or system if explicit theme preference is implemented.
3. **Developer access:** personal API keys and scopes, with secret-once semantics.
4. **Storage:** usage and limits; no lifecycle-policy controls until the backend supports them.
5. **Security:** active sessions or access review only when those capabilities exist.

Billing and plan selection should remain absent because organizations, subscriptions, and billing are explicit product non-goals today. Do not add decorative pricing tiers to make the product look more “SaaS.”

## Accessibility and safety

Use clear section headings, saved-state feedback, explicit destructive confirmation, and non-optimistic error recovery for security-sensitive actions. Secret values must never be placed in screenshots or research artifacts.
