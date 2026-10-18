import test from 'node:test';
import assert from 'node:assert/strict';
import { validDate } from './validation.mjs';
test('manual expiry accepts empty and valid calendar dates', () => {
  for (const value of ['', '2026-10-18', '2028-02-29']) assert.equal(validDate(value), true);
});
test('manual expiry rejects invalid dates and types', () => {
  for (const value of [null, 123, {}, '2026-02-29', '2026-13-01', '2026-1-01', '<script>']) assert.equal(validDate(value), false);
});
