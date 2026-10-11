# inboxguard

inboxguard is a security layer between email and AI assistants. It finds instructions that attackers hide in email for an AI to read, removes them, and stops sensitive actions until a person approves them.

Barracuda Research described this attack in live phishing campaigns in its October 7, 2026 post "Email attacks target both humans and AI in the same message". The hiding techniques it lists are HTML comments, CSS-hidden text, Base64 blocks and zero-width Unicode characters. The goals it lists include making an AI summary call a phishing email legitimate, adding a fake action that changes vendor payment details, rating a resume 10/10, making a support bot reveal its configuration, and making a code assistant insert credential-stealing code.

The rule the project follows: anything that touches money, payee details, outbound messages or permissions never runs just because an AI asked for it. A person approves it, outside the AI's channel.

## Packages

| Package | What it does |
| --- | --- |
| `packages/core` | The engine. `inspectEmail` cleans and inspects an email. `evaluateAction` decides whether a proposed action can run automatically. Runs in Node and in the browser. No network, no filesystem. |
| `packages/proxy` | An MCP proxy. The AI client sees a normal email connector. The real connector sees a normal AI client. Results are cleaned on the way back. Sensitive calls wait for human approval. |
| `packages/extension` | A Chrome Manifest V3 extension for Gmail and Outlook on the web. It shows a banner on each opened message and can clear hidden text in the page. |

## Requirements

Node 20.19 or newer. No build step for core or proxy. The extension is bundled with esbuild.

## Run the checks

```bash
npm ci
npm run check:style
npm run lint
npm test
npm run bench
```

`check:style` fails if any file in `packages/*/src` or `scripts` contains a comment, then runs Prettier. `bench` prints the detection rate on `fixtures/attacks` and the false-positive rate on `fixtures/benign`. It fails below 95 percent detection or above 2 percent false positives.

## Core engine

```js
import { inspectEmail, evaluateAction } from '@inboxguard/core';

const result = inspectEmail({ html, text, subject, from, headers, attachments });
result.verdict;
result.cleanedText;
result.findings;

const decision = evaluateAction({ tool: 'send_payment', args, session }, policy);
decision.decision;
decision.reasons;
```

`inspectEmail` returns `clean`, `suspicious` or `malicious`, a score, the visible text only, and a list of findings. It never throws. If it fails internally, or hits a size, depth or time limit, the verdict is at least `suspicious`.

`evaluateAction` returns `allow`, `approve` or `deny`. It is plain deterministic code and never asks a model. Precedence is deny, then approve, then allow. Unknown tools need approval.

Injection phrases live in `packages/core/rules/*.json`, one file per language: English, Hindi (Devanagari and Hinglish), French, Spanish, German, Portuguese and Chinese. Only the English set is broad. The others are small. A new language file also needs one import line in `packages/core/src/detect.js`.

## MCP proxy

1. Copy `inboxguard.config.example.json` to `inboxguard.config.json` and set your real mail connector under `upstreams`. Use `command`, `args` and `env` for a stdio server, or `url` for an HTTP server.
2. Optionally copy `payees.example.json` to `payees.json` and list your real payees with their known accounts, emails and domains.
3. Point your AI client at the proxy instead of the mail connector. For a client that uses an `mcpServers` config:

```json
{
  "mcpServers": {
    "mail": {
      "command": "node",
      "args": ["/path/to/inboxguard/packages/proxy/src/server.js", "--config", "/path/to/inboxguard.config.json"]
    }
  }
}
```

What the proxy does:

- Re-exposes the upstream tools with the same names and schemas. If two upstreams have a tool with the same name, those tools get the server name as a prefix.
- Runs the gate before forwarding a call. `deny` returns an error. `approve` starts the approval flow. `allow` forwards.
- Cleans every string in tool results, resource reads and prompt results, including nested JSON and Gmail-style base64url bodies. Images pass through untouched.
- Wraps email content in `<untrusted_email id="...">` with a random id per call, after removing look-alike delimiters from the content.
- Replaces the body of a malicious email with a notice. Sender, subject, date and ids stay.
- Marks the session after any suspicious or malicious result. After that, every write needs approval.
- Writes a JSONL audit log with one line per call: time, tool, verdict, finding kinds, decision and outcome. No email bodies. It rotates by size.

Approval flow: the proxy does not block the call. It returns a result saying approval is required and nothing was sent. It opens a local page in your browser and prints the URL to stderr. The page listens on 127.0.0.1 on a random port and shows the real arguments, any payee mismatch and the reasons. The AI never sees the URL. An approval is bound to a SHA-256 of the exact tool name and arguments, works once, and expires after 5 minutes. When the AI repeats the identical call, it is forwarded. Any changed argument needs a new approval. Rejected or expired requests return "Rejected by user" and nothing runs.

Results that say approval is required, rejected or denied carry `isError: true`. The SDK client rejects a result without `structuredContent` for tools that declare an `outputSchema`, unless it is marked as an error.

## Extension

```bash
npm run build -w packages/extension
```

Load `packages/extension/dist` as an unpacked extension in Chrome. See `docs/manual-testing.md`.

Banner states:

- green: nothing hidden found
- amber: hidden text or encoded content found, no instructions
- red: hidden instructions aimed at AI found
- grey: unable to check this message, or the message is over 2 MB

The extension asks only for the `storage` permission. It makes no network calls and stores nothing from email. By default it clears hidden text in amber and red messages, so a browser-based AI agent reading the page does not see it. It never removes Gmail or Outlook structure nodes.

## Policy

The default policy is `packages/core/policy/default-policy.json`. Set `policyPath` in the proxy config to use your own copy.

| Category | Default | Matches tool names with |
| --- | --- | --- |
| credentials | deny | password, OTP, verification code, API key |
| mail-rules | deny | filter, rule, auto forward, delegate |
| payment | approve | pay, transfer, wire, purchase, checkout |
| payee-change | approve | payee, beneficiary, vendor, bank account |
| outbound-mail | approve | send, reply, forward. `trustedDomains` can allow internal mail without attachments |
| destructive | approve | delete, trash, remove |
| sharing | approve | share, permission, invite |

Tools that only match read words such as get, list, search, read and fetch are allowed. Any other tool needs approval.

Every string in the arguments is checked for IBANs (mod-97), SWIFT/BIC codes, US routing numbers (checksum), Canadian transit, institution and account numbers, crypto wallet addresses, money amounts and card numbers (Luhn). Any hit means approval is needed, even for a read tool. Payment words and Interac e-Transfer language trigger approval for write tools only, so that a search for "invoice" still runs. Card numbers are counted but never shown or logged.

## Limitations

- Detection is probabilistic. It uses rules and heuristics, and some attacks will get through.
- Text inside images is not read.
- Visible instructions that are worded to look normal can slip through.
- Built-in assistants such as Gmail's Gemini or Outlook's Copilot read mail inside Google or Microsoft. The proxy cannot intercept them.
- The extension only sees the page the web client rendered. Gmail and Outlook can strip content such as HTML comments before rendering, while an AI connected through an API sees the raw source. The proxy is the stronger defence.
- The Gmail and Outlook selectors could not be checked against a signed-in account for this release. When they stop matching, the extension shows "unable to check this message".
- Delimiters around email content reduce the risk that a model follows instructions in it. They do not remove it.
- The time budget is checked between stages. JavaScript cannot interrupt a regular expression that is already running, so inputs are capped in size and the regular expressions are written to run in linear time.
- The bench measures fixtures written for this project. It catches regressions. It is not a measure of real-world accuracy.
- The proxy keeps session state for the lifetime of one proxy process.

## License

MIT. See `LICENSE`.
