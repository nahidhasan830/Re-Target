import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));

test('localhost uses the single production database, bucket and queue producers', () => {
  assert.equal(config.d1_databases.length, 1);
  assert.equal(config.d1_databases[0].database_name, 're-target-production');
  assert.equal(config.r2_buckets.length, 1);
  for (const binding of [...config.d1_databases, ...config.r2_buckets, ...config.queues.producers]) {
    assert.equal(binding.remote, true);
  }
  assert.equal(config.env, undefined);
});

test('development cannot fall back to persistent local application data', async () => {
  const astro = await readFile('astro.config.mjs', 'utf8');
  assert.match(astro, /persistState:\s*false/);
  assert.match(astro, /remoteBindings:\s*true/);
  const { scripts } = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(scripts['db:migrate:local'], undefined);
  assert.ok(!Object.values(scripts).some((command) => command.includes('--local')));
  const verify = await readFile('scripts/verify.mjs', 'utf8');
  assert.doesNotMatch(verify, /\.dev\.vars|--local|db:migrate|astro\(/);
});
