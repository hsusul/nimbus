# Empty states

Nimbus already has reusable empty-state components. The next improvement is specificity.

## Refero SaaS state guidance

- **Source platform:** Refero
- **Product/design:** SaaS App Design Prompts for AI Agents
- **Direct URL:** https://styles.refero.design/ai-agents/saas-app-design-prompts
- **UI category:** Empty, loading, error, disabled, selected, and permission states
- **Platform:** Web
- **What works well:** It treats workflow states as first-order design requirements rather than polish after the happy path.
- **What should not be copied:** Generated visual themes or generic state copy detached from Nimbus behavior.
- **Reusable principle:** Every state explains what happened, what remains true, and what the user can do next.
- **Nimbus application:** Use different copy/action pairs for first workspace, empty folder, zero search results, empty Jobs, and empty Trash.
- **Rights/status:** Public reference only.

## Recommended state matrix

| Surface    | Why empty   | Primary response                                                  |
| ---------- | ----------- | ----------------------------------------------------------------- |
| Files root | First use   | Upload a file or create a folder; briefly explain direct uploads. |
| Folder     | No children | Upload here or create a subfolder; state the destination.         |
| Search     | Blank query | Explain searchable metadata and focus the search field.           |
| Search     | No matches  | Show active filters and offer Clear filters.                      |
| Jobs       | No jobs     | Explain which background work appears here; no fake CTA.          |
| Trash      | Empty       | Confirm there is nothing to restore.                              |

Decorative illustrations are optional and should not displace the explanation or action.
