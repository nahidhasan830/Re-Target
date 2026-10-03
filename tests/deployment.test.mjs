import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkLiveSite, release } from '../scripts/deployment.mjs';

for (const failure of ['validate', 'preflight', 'backup', 'migrate', 'publish', 'smoke']) {
  test(`deployment stops after ${failure} fails`, async () => {
    const order = ['validate', 'preflight', 'backup', 'migrate', 'publish', 'smoke'];
    const called = [];
    const steps = Object.fromEntries(order.map((name) => [name, async () => {
      called.push(name);
      if (name === failure) throw new Error('failed');
    }]));
    await assert.rejects(release(steps), /failed/);
    assert.deepEqual(called, order.slice(0, order.indexOf(failure) + 1));
  });
}

function site({ id = 'new-release', health = 200, anonymous = 401, authenticated = 200 } = {}) {
  return async (url, options) => {
    if (url.pathname === '/api/health') return Response.json({ status: 'ok' }, { status: health, headers: { 'X-Deployment-Id': id } });
    if (url.pathname === '/') return new Response('Home');
    return new Response('{}', { status: options.headers.Authorization ? authenticated : anonymous });
  };
}

test('live checks reject a healthy but stale deployment', async () => {
  await assert.rejects(checkLiveSite('https://example.com', 'new-release', null, site({ id: 'old-release' })), /not serving this deployment/);
});
test('live checks reject storage failures and unprotected APIs', async () => {
  await assert.rejects(checkLiveSite('https://example.com', 'new-release', null, site({ health: 503 })), /not ready/);
  await assert.rejects(checkLiveSite('https://example.com', 'new-release', null, site({ anonymous: 200 })), /did not reject/);
});
test('live checks verify a newly installed admin token', async () => {
  await assert.rejects(checkLiveSite('https://example.com', 'new-release', 'secret', site({ authenticated: 401 })), /not accepted/);
  await checkLiveSite('https://example.com', 'new-release', 'secret', site());
});
