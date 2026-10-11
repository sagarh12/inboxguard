import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';

const ALLOWED_FIELDS = [
  'tool',
  'upstream',
  'decision',
  'category',
  'verdict',
  'findingKinds',
  'outcome',
  'approvalId',
];

function sizeOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function rotate(path, keep) {
  const oldest = `${path}.${keep}`;
  if (existsSync(oldest)) unlinkSync(oldest);
  for (let i = keep - 1; i >= 1; i -= 1) {
    if (existsSync(`${path}.${i}`)) renameSync(`${path}.${i}`, `${path}.${i + 1}`);
  }
  if (existsSync(path)) renameSync(path, `${path}.1`);
}

function pickAllowed(entry) {
  const line = { time: new Date().toISOString() };
  for (const field of ALLOWED_FIELDS) if (entry[field] !== undefined) line[field] = entry[field];
  return line;
}

export function createAuditLog({ path, maxBytes = 5 * 1024 * 1024, keep = 3, onError = () => {} }) {
  return {
    record(entry) {
      try {
        const line = `${JSON.stringify(pickAllowed(entry))}\n`;
        if (sizeOf(path) + line.length > maxBytes) rotate(path, keep);
        appendFileSync(path, line, { mode: 0o600 });
      } catch (error) {
        onError(error);
      }
    },
  };
}
