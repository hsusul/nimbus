# Security Policy

Nimbus is an early-stage open-source project. Please do not publicly disclose security vulnerabilities before maintainers have had time to investigate.

## Reporting a Vulnerability

Until a dedicated security contact is configured, open a private security advisory on GitHub if available. If private advisories are not available, contact the repository owner directly and avoid posting exploit details in public issues.

Include:

- Affected component.
- Steps to reproduce.
- Impact.
- Suggested fix, if known.

## Secrets Policy

Do not commit:

- Real database URLs.
- API keys.
- Access keys.
- Secret keys.
- Auth tokens.
- Signed URLs.
- Private keys.

Use `.env.example` for safe local placeholders only.
