// Minimal real test so `pnpm run test` exercises the runner rather than exiting trivially.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the fixture runs', () => {
  assert.equal(1 + 1, 2);
});
