import { test } from 'node:test';
import assert from 'node:assert/strict';

test('extension package loads', async () => {
  assert.ok(await import('../src/index.js'));
});
