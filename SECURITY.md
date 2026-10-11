# Security policy

## Reporting a vulnerability

Please report vulnerabilities through GitHub private vulnerability reporting on this repository: open the Security tab and choose "Report a vulnerability". Do not open a public issue for a vulnerability.

Include what you found, how to reproduce it, and the impact you expect. A sample email or tool call that bypasses detection or the approval flow is the most useful report.

## Scope

In scope:

- Hidden content that `inspectEmail` misses and that a model would act on.
- A way to run an `approve` or `deny` action without human approval.
- Weaknesses in the local approval page, such as missing host, token, origin or CSRF checks.
- Email content or payment data written to the audit log.
- Anything in the extension that breaks the host page or sends data off the machine.

Out of scope:

- Assistants built into mail providers, which the proxy cannot intercept.
- Text inside images.
- Attacks that require control of the local machine.

## Supported versions

Only the latest release gets fixes.
