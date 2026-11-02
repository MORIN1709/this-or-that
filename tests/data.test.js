import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkData } from '../tools/check-data.mjs';

const DATA = fileURLToPath(new URL('../data', import.meta.url));

test('the committed data/ has the shape the site reads', { skip: !existsSync(DATA) && 'data/ not built yet' }, async () => {
  const { ok, errors } = await checkData(DATA);
  assert.ok(ok, errors.join('\n'));
});
