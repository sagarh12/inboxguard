import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simpleParser } from 'mailparser';

export const fixturesRoot = join(fileURLToPath(import.meta.url), '..', '..', 'fixtures');

export function readExpected() {
  return JSON.parse(readFileSync(join(fixturesRoot, 'expected.json'), 'utf8'));
}

export function listFixtures() {
  return ['attacks', 'benign'].flatMap((group) =>
    readdirSync(join(fixturesRoot, group)).map((name) => `${group}/${name}`),
  );
}

function headerValue(headers, name) {
  return headers.find((h) => h.name.toLowerCase() === name)?.value ?? '';
}

function decodeBase64Url(data) {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function collectGmailParts(part, out) {
  if (part.body?.data) out.push({ mimeType: part.mimeType, text: decodeBase64Url(part.body.data) });
  for (const child of part.parts ?? []) collectGmailParts(child, out);
  return out;
}

export function gmailMessageToInput(message) {
  const headers = message.payload?.headers ?? [];
  const parts = collectGmailParts(message.payload ?? {}, []);
  return {
    subject: headerValue(headers, 'subject'),
    from: headerValue(headers, 'from'),
    html: parts.find((p) => p.mimeType === 'text/html')?.text,
    text: parts.find((p) => p.mimeType === 'text/plain')?.text,
  };
}

export async function emlToInput(raw) {
  const mail = await simpleParser(raw, {
    skipImageLinks: true,
    skipTextToHtml: true,
    skipTextLinks: true,
  });
  return {
    subject: mail.subject ?? '',
    from: mail.from?.text ?? '',
    html: typeof mail.html === 'string' ? mail.html : undefined,
    text: mail.text,
    attachments: (mail.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: new Uint8Array(a.content),
    })),
  };
}

export async function loadFixture(relativePath) {
  const raw = readFileSync(join(fixturesRoot, relativePath));
  if (relativePath.endsWith('.json')) return gmailMessageToInput(JSON.parse(raw.toString('utf8')));
  return emlToInput(raw);
}
