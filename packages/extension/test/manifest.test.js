import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('manifest v3 asks only for storage and the four mail hosts', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    'https://mail.google.com/*',
    'https://outlook.live.com/*',
    'https://outlook.office.com/*',
    'https://outlook.office365.com/*',
  ]);
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
  assert.equal(manifest.background, undefined);
});
