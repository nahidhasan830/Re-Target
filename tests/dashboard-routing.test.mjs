import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

async function route(path) {
  const source = (await readFile(path, 'utf8')).split('---')[1].replace(/^import .*;\n/gm, '');
  const compiled = ts.transpileModule(`async function run(Astro, dependencies) {
    const { authenticate, createAccountSession, currentAccount, limitLogin, requireSameOrigin, HttpError, readBody, validateLogin, accountSettings, setupProgress } = dependencies;
    ${source}
    return { status: Astro.response.status };
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(`${compiled}; return run;`)();
}
const login = await route('src/pages/index.astro');
const userDashboard = await route('src/pages/app/index.astro');
const adminDashboard = await route('src/pages/admin.astro');
const userAccount = await route('src/pages/app/account.astro');
const adminAccount = await route('src/pages/admin/account.astro');
function context(path, method = 'GET') {
  return { request: new Request(`https://example.com${path}`, { method, ...(method === 'POST' ? { body: 'phone=01712345678&password=correct-password', headers: { 'content-type': 'application/x-www-form-urlencoded' } } : {}) }), cookies: {}, url: new URL(`https://example.com${path}`), response: { status: 200, headers: new Headers() }, redirect: (location, status) => ({ location, status }) };
}
function dependencies(account) {
  return { currentAccount: async () => account, authenticate: async () => account, createAccountSession: async () => {}, limitLogin: async () => {}, requireSameOrigin: () => {}, readBody: request => request.text(), validateLogin: input => ({ errors: {}, result: { success: true, data: input } }), setupProgress: async () => ({ companyName: account.companyName }), accountSettings: async () => ({ status: 200, saved: true, form: 'company' }) };
}

test('successful and already authenticated logins land on the role dashboard', async () => {
  for (const role of ['user', 'admin']) {
    const account = { role, id: role, companyName: 'Ready Cart' };
    const location = role === 'admin' ? '/admin' : '/app';
    assert.deepEqual(await login(context('/', 'POST'), dependencies(account)), { location, status: 303 });
    assert.deepEqual(await login(context('/'), dependencies(account)), { location, status: 302 });
  }
});

test('dashboards redirect guests and enforce the matching account role', async () => {
  assert.deepEqual(await userDashboard(context('/app'), dependencies(null)), { location: '/', status: 302 });
  assert.deepEqual(await adminDashboard(context('/admin'), dependencies(null)), { location: '/', status: 302 });
  assert.deepEqual(await userDashboard(context('/app'), dependencies({ role: 'admin' })), { location: '/admin', status: 302 });
  assert.deepEqual(await adminDashboard(context('/admin'), dependencies({ role: 'user' })), { location: '/app', status: 302 });
});

test('saving Account returns to the relocated Account form', async () => {
  assert.deepEqual(await userAccount(context('/app/account', 'POST'), dependencies({ role: 'user' })), { location: '/app/account?saved=company', status: 303 });
  assert.deepEqual(await adminAccount(context('/admin/account', 'POST'), dependencies({ role: 'admin' })), { location: '/admin/account?saved=company', status: 303 });
});

test('Account forms opened before the route change preserve their POST on redirect', async () => {
  assert.deepEqual(await userDashboard(context('/app', 'POST'), dependencies({ role: 'user' })), { location: '/app/account', status: 307 });
  assert.deepEqual(await adminDashboard(context('/admin', 'POST'), dependencies({ role: 'admin' })), { location: '/admin/account', status: 307 });
});
