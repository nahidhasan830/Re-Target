import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function load(path) {
  const compiled = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const { loadingDestination, initPageLoading } = await load('src/lib/page-loading.ts');
const { setRegionLoading } = await load('src/lib/loading-region.ts');

test('admin and business navigation choose the destination layout, including nested campaign routes', () => {
  for (const role of ['admin', 'app']) {
    for (const variant of ['leads', 'campaigns', 'courier', 'whatsapp', 'account']) assert.equal(loadingDestination(new URL(`https://example.com/${role}/${variant}`)).variant, variant);
    assert.equal(loadingDestination(new URL(`https://example.com/${role}/`)).variant, 'dashboard');
    assert.equal(loadingDestination(new URL(`https://example.com/${role}/campaigns/new?audience=all`)).variant, 'campaign-editor');
    assert.equal(loadingDestination(new URL(`https://example.com/${role}/campaigns/campaign-1`)).variant, 'campaign-detail');
  }
  assert.equal(loadingDestination(new URL('https://example.com/admin/users')).variant, 'users');
  assert.equal(loadingDestination(new URL('https://example.com/invite/token')).variant, 'auth');
  assert.equal(loadingDestination(new URL('https://example.com/api/logout')), null);
  assert.equal(loadingDestination(new URL('https://example.com/admin/unknown')), null);
});

test('native navigation restores content after back navigation or a cancelled unsaved-change prompt', async () => {
  const originals = new Map(['document', 'window', 'location', 'Element', 'HTMLElement', 'setTimeout', 'clearTimeout'].map(key => [key, globalThis[key]]));
  const documentEvents = new Map(), windowEvents = new Map();
  class ElementMock {
    constructor() { this.attrs = new Map(); this.inert = false; this.dataset = {}; }
    setAttribute(key, value) { this.attrs.set(key, value); }
    removeAttribute(key) { this.attrs.delete(key); }
    hasAttribute(key) { return this.attrs.has(key); }
    closest() { return this; }
  }
  const contentChild = new ElementMock(), alreadyInert = new ElementMock(); alreadyInert.inert = true;
  const main = new ElementMock(), classes = new Set();
  main.classList = { add: value => classes.add(value), remove: value => classes.delete(value) };
  main.querySelectorAll = () => main.children.filter(child => child.dataset.navigationInert !== undefined);
  const overlay = new ElementMock(); overlay.hidden = true;
  overlay.querySelector = () => ({ content: { cloneNode: () => ({ skeleton: true }) } });
  main.children = [contentChild, alreadyInert, overlay];
  const content = { replaceChildren() {} }, status = { textContent: '' }, title = { textContent: 'Leads' };
  const link = new ElementMock(); link.href = 'https://example.com/admin/courier'; link.target = '';
  try {
    globalThis.Element = globalThis.HTMLElement = ElementMock;
    globalThis.location = new URL('https://example.com/admin/leads');
    globalThis.setTimeout = () => 1; globalThis.clearTimeout = () => {};
    globalThis.document = { querySelector: selector => selector === 'main' ? main : title, getElementById: id => ({ 'page-loading': overlay, 'page-loading-content': content, 'page-loading-status': status })[id], addEventListener: (name, handler) => documentEvents.set(name, handler) };
    globalThis.window = { addEventListener: (name, handler) => windowEvents.set(name, handler) };
    initPageLoading();
    title.textContent = 'Updated campaign';
    windowEvents.get('pageshow')();
    assert.equal(title.textContent, 'Updated campaign');
    title.textContent = 'Leads';
    const click = documentEvents.get('click');
    click({ target: link, button: 0, ctrlKey: true });
    assert.equal(overlay.hidden, true);
    click({ target: link, button: 0, defaultPrevented: true });
    assert.equal(overlay.hidden, true);
    link.href = 'https://elsewhere.example/admin/courier'; click({ target: link, button: 0 });
    assert.equal(overlay.hidden, true);
    link.href = 'https://example.com/admin/courier'; click({ target: link, button: 0 });
    assert.equal(overlay.hidden, false); assert.equal(contentChild.inert, true); assert.equal(title.textContent, 'Courier');
    windowEvents.get('pageshow')();
    assert.equal(overlay.hidden, true); assert.equal(contentChild.inert, false); assert.equal(alreadyInert.inert, true); assert.equal(title.textContent, 'Leads');
    click({ target: link, button: 0 });
    windowEvents.get('beforeunload')({ defaultPrevented: true });
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(overlay.hidden, true); assert.equal(contentChild.inert, false);
  } finally { for (const [key, value] of originals) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
});

test('loading sections prevent editing until results or errors replace the skeleton', () => {
  const original = globalThis.document;
  const content = { inert: false }, attributes = new Map();
  globalThis.document = { getElementById: id => id === 'test-settings-loading' ? { setAttribute: (key, value) => attributes.set(key, value), querySelector: () => content } : null };
  try {
    setRegionLoading('test-settings-loading', true);
    assert.equal(content.inert, true); assert.equal(attributes.get('aria-busy'), 'true');
    setRegionLoading('test-settings-loading', false);
    assert.equal(content.inert, false); assert.equal(attributes.get('aria-busy'), 'false');
    assert.doesNotThrow(() => setRegionLoading('missing-region', true));
  } finally { globalThis.document = original; }
});
