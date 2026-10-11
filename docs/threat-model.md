# Threat model

## What is protected

- Money and payee details: payments, transfers, vendor bank details.
- Outbound messages sent in the user's name.
- Sharing and permissions on the user's files and mailbox.
- The user's mailbox rules, credentials and the AI's configuration.
- The accuracy of what an AI assistant tells the user about an email.

## Attacker

The attacker can send email to the user. They control the full message: HTML, CSS, headers, attachments and encodings. They cannot read the user's screen or reach the local machine. They know inboxguard exists and can read its source.

## Trust boundaries

- Email content is untrusted. This includes subject, sender display name, headers, attachments and anything decoded from them.
- The AI model is not trusted to judge email content. Its tool calls are treated as requests that may have been steered by an email.
- The upstream mail connector is trusted to return real mailbox data, but its output is still inspected.
- The person at the keyboard is trusted. Approval happens in their browser, outside the AI's channel.

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Instructions hidden with CSS, comments, attributes, hidden elements | `hidden.js` resolves inline styles, style sheets, legacy attributes and inherited state. Hidden text and carriers are inspected and removed from `cleanedText`. |
| Instructions in Base64, hex, percent-encoding or numeric entities | `decode.js` decodes up to depth 3 with a 1 MB budget. Decoded instructions are `high`. |
| Zero-width, tag-character and variation-selector smuggling | `unicode.js` detects runs and binary patterns, decodes tag characters and selector bytes, and strips them. Emoji and Indic or Persian joiners are kept. |
| Keyword evasion with spacing, hyphens, fullwidth letters or homoglyphs | Rules match on a normalized form: NFKC, lowercase, invisible characters removed, separators collapsed, Cyrillic and Greek look-alikes mapped. |
| Huge or deeply nested input used to evade inspection | Size, depth and time limits. Hitting any limit makes the verdict at least `suspicious`. |
| An AI tricked into paying or changing payee details | Payment and payee tools need approval. Every argument string is scanned for account numbers and amounts. `payees.json` mismatches are flagged on the approval page. |
| An AI tricked into forwarding mail or creating forwarding rules | Outbound mail needs approval. Mail rules are denied. |
| Approval prompt shows an AI-written summary instead of the real request | The approval page shows fields taken from the arguments and the raw arguments. All text is set with `textContent`. |
| Approval reused for a different call | Approval is bound to a SHA-256 of canonical JSON of the tool and arguments. Single use, 5 minute expiry. |
| Malicious web page drives the approval page | Server bound to 127.0.0.1 on a random port, Host header check against DNS rebinding, per-request token, Origin check and CSRF token on POST, strict CSP with a nonce. |
| Email floods the user with approval prompts | Pending approvals are capped. Identical requests collapse into one. |
| Attacker closes the delimiter block early | Look-alike delimiters and fake inboxguard notices are removed from content before wrapping. The block id is random per call. |
| Upstream crash, hang or oversized output used to slip content through | Timeouts, size cap with truncation before inspection, and clean errors. Nothing unsanitized is passed on. |
| Sensitive data leaking into logs | The audit log stores tool, decision, verdict and finding kinds only. Card numbers are never shown or logged. Config errors do not print values. |

## Out of scope

- Assistants built into Gmail, Outlook or other mail providers. The proxy cannot see their traffic.
- Text rendered inside images.
- A compromised local machine, browser or upstream connector.
- Social engineering aimed at the person who approves requests.

## Residual risk

- Rules and heuristics miss some attacks, especially visible text written to look ordinary.
- Delimiters reduce but do not remove the chance that a model follows instructions in content.
- The extension sees only the rendered page, which may differ from the raw message an API returns.
