import { test } from 'node:test';
import assert from 'node:assert/strict';

test('proxy package loads', async () => {
  assert.ok(await import('../src/index.js'));
});
