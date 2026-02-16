# Security Policy

## Supported Versions

This project currently supports the latest release on the default branch.

## Reporting a Vulnerability

If you discover a security issue, do not open a public issue with exploit details.

Please report privately with:
- A clear description of the issue
- Reproduction steps
- Impact assessment
- Suggested fix (if available)

If repository security advisories are enabled, use GitHub private reporting.

## Secret Handling

- Never commit `.env` or real credentials.
- Use `.env.example` as a template only.
- Rotate keys immediately if exposure is suspected.

## Runtime Hardening Recommendations

- Run gateway on localhost unless remote access is required.
- Set `gateway.authToken` during onboarding when exposing beyond localhost.
- Keep Node.js and dependencies updated.
- Review `gnami-action` shell capabilities before exposing to untrusted networks.
