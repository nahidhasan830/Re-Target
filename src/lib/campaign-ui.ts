import { initMediaPicker } from './media-ui';
import { createDataTable } from './data-table';
import type { CellComponent } from 'tabulator-tables';
import { setRegionLoading } from './loading-region';
import { setButtonBusy } from './control-state';
import { setFeedback } from './feedback';
import { campaignPath, campaignView, editorSteps } from './campaign-routes';
import {
  compileParts,
  codePoints,
  reasonLabels,
  DAILY_SEND_ATTEMPTS,
  type Audience,
  type Content,
  type Part,
} from './campaign-content';
import type { detailCampaign, campaignProgress } from './campaigns';
type Detail = Awaited<ReturnType<typeof detailCampaign>>;
type UIAsset = {
  id: string;
  kind: 'image' | 'video';
  name: string;
  mime?: string;
  bytes?: number;
  state?: string;
};
type Preview = {
  page: number;
  pages: number;
  pageSize: number;
  total: number;
  ready: number;
  breakdown: Record<string, number>;
  incompleteChecks: number;
  noWhatsappCount: number;
  sample: { id: string; name: string; phone: string; reasons: string[]; whatsappExists: number | null; deliveryCount: number; totalParcelValue: number | null }[];
};
const el = <T = HTMLElement>(id: string) => document.getElementById(id) as T;
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const appendNodes = (parent: Node, ...children: Node[]) =>
  children.forEach((child) => parent.appendChild(child));
const label = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, (s) => s.toUpperCase());
const dateLabel = (value: number | null) =>
  value
    ? new Intl.DateTimeFormat('en-BD', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Dhaka',
      }).format(new Date(value * 1000))
    : '—';
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'The request failed. Try again.';
function status(id: string, text: string, error = false, success = '', detail = '') {
  const element = el(id);
  if (element) {
    setFeedback(element, text, success, detail);
    element.classList.toggle('error', error);
  }
}
export async function campaignApi<T>(
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(result.error ?? 'The request failed. Try again.');
  return result;
}
export function initTestSettings() {
  const form = el<HTMLFormElement>('test-settings');
  if (!form) return;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
  const numbersField = field('numbers') as HTMLTextAreaElement;
  const numbers = () => numbersField.value.split(/[\s,]+/).filter(Boolean);
  function updateCount() {
    const count = numbers().length;
    el('test-number-count').textContent = `${count} / 10`;
    numbersField.setCustomValidity(count > 10 ? 'Use up to 10 test numbers.' : '');
    numbersField.setAttribute('aria-invalid', String(count > 10));
  }
  numbersField.addEventListener('input', updateCount);
  numbersField.addEventListener('input', () => {
    if (el('test-settings-message').classList.contains('success-feedback')) status('test-settings-message', '');
  });
  const save = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  let saving = false;
  const retry = el<HTMLButtonElement>('retry-test-settings');
  async function loadSettings() {
    save.disabled = true;
    retry.hidden = true;
    setRegionLoading('test-settings-loading', true);
    status('test-settings-message', '');
    try {
      const result = await campaignApi<{ items: { phone: string; evidenceRef: string }[] }>(
        '/api/campaign-test-destinations',
      );
      field('numbers').value = result.items.map((r) => r.phone).join('\n');
      updateCount();
      save.disabled = false;
    } catch (error) {
      status('test-settings-message', errorText(error), true);
      retry.hidden = false;
    } finally {
      setRegionLoading('test-settings-loading', false);
    }
  }
  retry.addEventListener('click', () => void loadSettings());
  void loadSettings();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || save.disabled) return;
    saving = true;
    const button = form.querySelector<HTMLButtonElement>('button')!;
    setButtonBusy(button, true, false, 'Verifying...');
    numbersField.readOnly = true;
    form.setAttribute('aria-busy', 'true');
    status('test-settings-message', 'Verifying WhatsApp numbers…');
    try {
      await campaignApi('/api/campaign-test-destinations', 'POST', {
        numbers: numbers(),
        requestId: crypto.randomUUID(),
      });
      status(
        'test-settings-message',
        'Test destinations saved for all your campaigns.',
        false, 'Saved',
      );
    } catch (error) {
      status('test-settings-message', errorText(error), true);
    } finally {
      saving = false;
      numbersField.readOnly = false;
      form.removeAttribute('aria-busy');
      setButtonBusy(button, false);
    }
  });
}
export function initCampaignList() {
  const root = document.querySelector<HTMLElement>('[data-campaign-list]');
  if (!root) return;
  let page = 1,
    pages = 1;
  const base = root.dataset.base!;
  const panel = el('campaign-list-panel');
  const skeleton = el('campaign-list-loading');
  const list = el('campaign-list');
  const empty = el('campaign-empty');
  const failure = el('campaign-list-error');
  const archivedField = el<HTMLInputElement>('show-archived');
  const refresh = el<HTMLButtonElement>('refresh-campaigns');
  let busy = false, loaded = false, deleting = false, copying = false;
  async function load() {
    if (busy || deleting || copying) return;
    busy = true;
    panel.setAttribute('aria-busy', 'true');
    refresh.setAttribute('aria-busy', 'true');
    refresh.disabled = archivedField.disabled = true;
    el<HTMLButtonElement>('retry-campaigns').disabled = true;
    el<HTMLButtonElement>('campaign-previous').disabled = true;
    el<HTMLButtonElement>('campaign-next').disabled = true;
    skeleton.hidden = loaded;
    failure.hidden = true;
    el('campaign-list-message').classList.add('is-loading');
    status('campaign-list-message', 'Loading campaigns…');
    try {
      const result = await campaignApi<{
        items: {
          id: string;
          name: string;
          status: string;
          recipients: number;
          leadCount: number;
          revision: number;
          createdAt: number;
          scheduledAt: number | null;
        }[];
        pages: number;
        total: number;
      }>(
        `/api/campaigns?page=${page}&archived=${archivedField.checked}`,
      );
      pages = result.pages;
      list.replaceChildren();
      for (const campaign of result.items) {
        const card = node('article', undefined, 'campaign-card');
        const heading = node('div', undefined, 'campaign-card-heading');
        const title = node('h2');
        const link = node('a', campaign.name, 'campaign-card-link');
        link.href = campaignPath(base, campaign.id, campaign.status === 'draft' ? 'audience' : 'sending');
        appendNodes(title, link);
        const badge = node('span', label(campaign.status), 'campaign-card-status');
        badge.dataset.status = campaign.status;
        appendNodes(heading, title, badge);
        const facts = node('dl', undefined, 'campaign-card-facts');
        const leads = node('div');
        appendNodes(leads, node('dt', campaign.status === 'draft' ? 'Matching leads' : 'Leads'), node('dd', new Intl.NumberFormat('en-BD').format(campaign.leadCount)));
        const date = node('div');
        const time = node('time', dateLabel(campaign.scheduledAt ?? campaign.createdAt));
        time.dateTime = new Date((campaign.scheduledAt ?? campaign.createdAt) * 1000).toISOString();
        const dateValue = node('dd');
        appendNodes(dateValue, time);
        appendNodes(date, node('dt', campaign.scheduledAt ? 'Scheduled' : 'Created'), dateValue);
        appendNodes(facts, leads, date);
        const actions = node('div', undefined, 'campaign-card-actions');
        const sending = node('a', 'Sending', 'secondary campaign-card-action');
        sending.href = campaignPath(base, campaign.id, 'sending');
        sending.setAttribute('aria-label', `View sending for ${campaign.name}`);
        appendNodes(actions, sending);
        const feedback = node('p', undefined, 'campaign-card-feedback');
        feedback.setAttribute('role', 'status');
        const edit = campaign.status === 'draft' ? node('a', undefined, 'secondary campaign-card-action') : node('button', undefined, 'secondary campaign-card-action');
        appendNodes(edit, actionIcon(icons.edit), node('span', campaign.status === 'draft' ? 'Edit' : 'Edit copy'));
        edit.setAttribute('aria-label', `${campaign.status === 'draft' ? 'Edit' : 'Edit a copy of'} ${campaign.name}`);
        if (edit instanceof HTMLAnchorElement) edit.href = link.href;
        else {
          edit.type = 'button';
          edit.onclick = async () => {
            if (busy || deleting || copying || edit.disabled) return;
            copying = true;
            feedback.textContent = 'Creating copy...';
            setButtonBusy(edit, true, false, 'Creating copy...');
            try {
              const copy = await campaignApi<{ id: string }>(`/api/campaigns/${campaign.id}/actions`, 'POST', { action: 'duplicate', revision: campaign.revision, requestId: crypto.randomUUID() });
              location.href = campaignPath(base, copy.id, 'audience');
            } catch (error) { feedback.textContent = errorText(error); }
            finally { copying = false; setButtonBusy(edit, false); }
          };
        }
        appendNodes(actions, edit);
        const remove = node('button', undefined, 'secondary campaign-delete campaign-card-action');
        appendNodes(remove, actionIcon(icons.delete), node('span', 'Delete'));
        remove.type = 'button';
        remove.setAttribute('aria-label', `Delete ${campaign.name}`);
        remove.disabled = !['draft', 'completed', 'cancelled', 'archived'].includes(campaign.status);
        if (remove.disabled) remove.title = 'Cancel this campaign before deleting it';
        remove.onclick = () => {
          if (busy || deleting || copying || root!.querySelector('.campaign-delete-dialog')) return;
          const confirmation = node('dialog', undefined, 'campaign-delete-dialog');
          const title = node('h2', `Delete “${campaign.name}”?`);
          title.id = 'campaign-delete-title';
          confirmation.setAttribute('aria-labelledby', title.id);
          const prompt = node('p', 'Permanently delete this campaign and its message history? This cannot be undone.');
          prompt.id = 'campaign-delete-description';
          confirmation.setAttribute('aria-describedby', prompt.id);
          const modalFeedback = node('p', undefined, 'campaign-card-feedback');
          modalFeedback.setAttribute('role', 'status');
          const modalActions = node('div', undefined, 'campaign-delete-confirmation');
          const cancel = node('button', 'Keep campaign', 'secondary');
          const confirm = node('button', undefined, 'secondary campaign-delete campaign-card-action');
          appendNodes(confirm, actionIcon(icons.delete), node('span', 'Delete campaign'));
          cancel.type = confirm.type = 'button';
          cancel.autofocus = true;
          cancel.onclick = () => confirmation.close();
          confirmation.addEventListener('cancel', event => { if (deleting) event.preventDefault(); });
          confirmation.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            if (deleting) event.preventDefault();
            else if (event.shiftKey && document.activeElement === cancel) { event.preventDefault(); confirm.focus(); }
            else if (!event.shiftKey && document.activeElement === confirm) { event.preventDefault(); cancel.focus(); }
          });
          confirmation.addEventListener('close', () => { confirmation.remove(); if (remove.isConnected) remove.focus(); });
          confirm.onclick = async () => {
            if (busy || deleting) return;
            deleting = true;
            refresh.disabled = archivedField.disabled = true;
            const buttons = [...root!.querySelectorAll<HTMLButtonElement>('button')];
            const disabled = buttons.map(button => button.disabled);
            buttons.forEach(button => button.disabled = true);
            setButtonBusy(confirm, true);
            modalFeedback.textContent = '';
            let deleted = false;
            try {
              await campaignApi(`/api/campaigns/${campaign.id}`, 'DELETE', { revision: campaign.revision });
              deleted = true;
              if (list.children.length === 1 && page > 1) page--;
            } catch (error) { modalFeedback.textContent = errorText(error); }
            finally {
              deleting = false;
              setButtonBusy(confirm, false);
              buttons.forEach((button, index) => button.disabled = disabled[index]!);
              refresh.disabled = archivedField.disabled = false;
            }
            if (deleted) { confirmation.close(); await load(); refresh.focus(); }
          };
          appendNodes(modalActions, cancel, confirm);
          appendNodes(confirmation, title, prompt, modalFeedback, modalActions);
          feedback.textContent = '';
          appendNodes(root!, confirmation);
          confirmation.showModal();
          cancel.focus();
        };
        appendNodes(actions, remove);
        appendNodes(card, heading, facts, actions, feedback);
        appendNodes(list, card);
      }
      loaded = true;
      list.hidden = !result.items.length;
      empty.hidden = Boolean(result.items.length);
      el('campaign-empty-title').textContent = archivedField.checked ? 'No archived campaigns' : 'No campaigns yet';
      el('campaign-empty-description').textContent = archivedField.checked ? 'Archived campaigns will appear here.' : 'Prepare your first offer for your delivered customers.';
      el('campaign-empty-create').hidden = archivedField.checked;
      status(
        'campaign-list-message',
        result.total
          ? `${result.total} campaign${result.total === 1 ? '' : 's'}`
          : '',
      );
      el('campaign-page').textContent = `${page} / ${pages}`;
      el('campaign-pagination').hidden = pages <= 1;
    } catch (error) {
      status('campaign-list-message', errorText(error), true);
      failure.hidden = loaded;
    } finally {
      busy = false;
      el('campaign-list-message').classList.remove('is-loading');
      skeleton.hidden = true;
      panel.setAttribute('aria-busy', 'false');
      refresh.setAttribute('aria-busy', 'false');
      refresh.disabled = archivedField.disabled = false;
      el<HTMLButtonElement>('retry-campaigns').disabled = false;
      el<HTMLButtonElement>('campaign-previous').disabled = page <= 1;
      el<HTMLButtonElement>('campaign-next').disabled = page >= pages;
    }
  }
  el('retry-campaigns').addEventListener('click', () => void load());
  el('refresh-campaigns').addEventListener('click', () => void load());
  el('show-archived').addEventListener('change', () => {
    page = 1;
    void load();
  });
  el('campaign-previous').addEventListener('click', () => {
    page--;
    void load();
  });
  el('campaign-next').addEventListener('click', () => {
    page++;
    void load();
  });
  void load();
}
function appendInlineFormatting(parent: HTMLElement, text: string) {
  const regex = /```([^`]+)```|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let last = 0;
  for (const match of text.matchAll(regex)) {
    appendNodes(parent, document.createTextNode(text.slice(last, match.index)));
    const tag = match[1] || match[2] ? 'code' : match[3] ? 'strong' : match[4] ? 'em' : 's';
    appendNodes(parent, node(tag, match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]));
    last = match.index! + match[0].length;
  }
  appendNodes(parent, document.createTextNode(text.slice(last)));
}
function appendFormatting(parent: HTMLElement, text: string) {
  // Keep newlines inside monospace spans together.
  const lines = text.match(/(?:```[^`]*```|[^\n])+/g) ?? [];
  let list: HTMLUListElement | HTMLOListElement | null = null;
  let listKind = '';
  let previousEnd = 0;
  let previousBlock = false;
  for (const line of lines) {
    const start = text.indexOf(line, previousEnd);
    const gap = text.slice(previousEnd, start);
    const visibleGap = previousBlock && gap.startsWith('\n') ? gap.slice(1) : gap;
    const bullet = line.match(/^[-*] (.*)$/);
    const numbered = line.match(/^(\d+)\. (.*)$/);
    const kind = bullet ? 'ul' : numbered ? 'ol' : '';
    if (gap.length > 1) list = null;
    if (kind) {
      if (!list || kind !== listKind) {
        if (gap.length > 1) appendNodes(parent, document.createTextNode(gap.slice(1)));
        list = node(kind as 'ul' | 'ol');
        if (list instanceof HTMLOListElement) list.start = Number(numbered![1]);
        appendNodes(parent, list);
      }
      const item = node('li');
      if (numbered && item instanceof HTMLLIElement) item.value = Number(numbered[1]);
      appendInlineFormatting(item, bullet ? bullet[1]! : numbered![2]!);
      appendNodes(list, item);
    } else {
      list = null;
      appendNodes(parent, document.createTextNode(visibleGap));
      if (line.startsWith('> ')) {
        const quote = node('blockquote');
        appendInlineFormatting(quote, line.slice(2));
        appendNodes(parent, quote);
      } else appendInlineFormatting(parent, line);
    }
    listKind = kind;
    previousBlock = Boolean(kind || line.startsWith('> '));
    previousEnd = start + line.length;
  }
  appendNodes(parent, document.createTextNode(text.slice(previousEnd)));
}
function previewMedia(asset: UIAsset) {
  const wrapper = node('div', undefined, 'preview-media');
  const media = node(asset.kind === 'video' ? 'video' : 'img');
  const failure = node('div', undefined, 'preview-media-error');
  const retry = node('button', `Retry ${asset.kind}`, 'secondary');
  retry.type = 'button';
  failure.hidden = true;
  appendNodes(failure, node('span', `${label(asset.kind)} unavailable.`), retry);
  media.src = `/api/campaign-assets/${asset.id}`;
  if (media instanceof HTMLVideoElement) {
    media.controls = true;
    media.preload = 'metadata';
    media.playsInline = true;
  } else media.alt = asset.name;
  media.addEventListener('error', () => {
    media.hidden = true;
    failure.hidden = false;
  });
  retry.addEventListener('click', () => {
    failure.hidden = true;
    media.hidden = false;
    media.src = `/api/campaign-assets/${asset.id}?retry=${Date.now()}`;
    if (media instanceof HTMLVideoElement) media.load();
  });
  appendNodes(wrapper, media, failure);
  return wrapper;
}
function showParts(container: HTMLElement, parts: Part[], assets: UIAsset[]) {
  const existing = new Map(Array.from(container.children, (bubble) => [
    (bubble as HTMLElement).dataset.partKey, bubble as HTMLElement,
  ]));
  parts.forEach((part, index) => {
    const key = part.assetId ?? 'text';
    let bubble = existing.get(key);
    if (!bubble) {
      bubble = node('div', undefined, 'chat-bubble');
      bubble.dataset.partKey = key;
      if (part.assetId) appendNodes(bubble, previewMedia(assets.find((a) => a.id === part.assetId)!));
      const text = node('div');
      text.dataset.partText = '';
      appendNodes(bubble, text, node('small'));
    }
    const text = bubble.querySelector<HTMLElement>('[data-part-text]')!;
    text.replaceChildren();
    appendFormatting(text, part.text);
    bubble.querySelector('small')!.textContent = `Message ${part.ordinal + 1} · ${label(part.kind)}`;
    // Keep loaded media connected while text and personalization change.
    if (container.children[index] !== bubble) container.insertBefore(bubble, container.children[index] ?? null);
    existing.delete(key);
  });
  for (const bubble of existing.values()) bubble.remove();
}
const icons = {
  edit: 'm16 3 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16l-1 4Z',
  delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  duplicate: 'M9 9h12v12H9V9ZM15 9V3H3v12h6',
  archive: 'M3 3h18v5H3V3ZM5 8v13h14V8M10 12h4',
  up: 'M6 14l6-6 6 6',
  down: 'M6 10l6 6 6-6',
  remove: 'M6 6l12 12M18 6 6 18',
};
function actionIcon(path: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(svg.namespaceURI, 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('stroke', 'currentColor');
  shape.setAttribute('stroke-width', '1.7');
  shape.setAttribute('stroke-linecap', 'round');
  shape.setAttribute('stroke-linejoin', 'round');
  appendNodes(svg, shape);
  return svg;
}
function iconButton(name: string, path: string) {
  const button = node('button', undefined, 'icon-button');
  button.type = 'button';
  button.setAttribute('aria-label', name);
  appendNodes(button, actionIcon(path));
  return button;
}
export function initCampaignEditor(initialDetail?: Detail) {
  const root = document.querySelector<HTMLElement>('[data-campaign-editor]');
  if (!root || root.dataset.initialized) return;
  if (root.closest('#draft-editor-slot')?.hasAttribute('hidden')) return;
  root.dataset.initialized = 'true';
  const form = el<HTMLFormElement>('campaign-form'),
    base = root.dataset.base!;
  let id = root.dataset.id ?? '',
    revision = 1,
    step = Math.max(0, editorSteps.findIndex(view => view === (campaignView(location.pathname) ?? root.dataset.view))),
    busy = false,
    company = root.dataset.company ?? '',
    connectedPhone: string | null = null,
    assets: UIAsset[] = [],
    selectedIds: string[] = [],
    eligibility: Audience['eligibility'] = 'all',
    preview: Preview | null = null,
    detail: Detail | null = null,
    dirty = false,
    saving = false,
    editVersion = 0,
    memoryReady = false;
  const field = (name: string) =>
    form.elements.namedItem(name) as
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  const setDirty = () => {
    ++editVersion;
    dirty = true;
    if (!saving) status('draft-state', 'Unsaved changes');
    for (const id of ['composer-message', 'test-send-message']) {
      if (el(id).classList.contains('success-feedback')) status(id, '');
    }
    rememberDraft();
  };
  const content = (): Content => ({
    text: field('text').value,
    assetIds: assets.map((a) => a.id),
    separateText: (field('separateText') as HTMLInputElement).checked,
  });
  const audience = () => {
    const q: Record<string, unknown> = {
      mode: selectedIds.length ? 'selected' : 'all',
      ids: selectedIds,
      eligibility,
    };
    for (const key of ['source', 'whatsapp']) {
      const value = field(key).value;
      if (value) q[key] = value;
    }
    for (const key of ['minDeliveries', 'minValue']) {
      if (field(key).value) q[key] = Number(field(key).value);
    }
    return q as Audience;
  };
  const timestamp = (name: string) =>
    field(name).value
      ? Math.floor(Date.parse(`${field(name).value}:00+06:00`) / 1000)
      : null;
  const draftKey = () => `campaign-editor:${root!.dataset.owner}:${id || 'new'}`;
  function rememberDraft() {
    if (!memoryReady) return;
    try {
      sessionStorage.setItem(draftKey(), JSON.stringify({
        id, revision, dirty, name: field('name').value, content: content(),
        audience: audience(), assets,
        launchMode: field('launchMode').value, scheduledAt: field('scheduledAt').value,
      }));
    } catch {}
  }
  function restoreDraft() {
    try {
      const stored = sessionStorage.getItem(draftKey());
      if (!stored) return;
      const draft = JSON.parse(stored);
      if (draft.id !== id || draft.revision !== revision) {
        sessionStorage.removeItem(draftKey());
        return;
      }
      field('name').value = draft.name;
      field('text').value = draft.content.text;
      (field('separateText') as HTMLInputElement).checked = draft.content.separateText;
      assets = draft.assets;
      selectedIds = draft.audience.ids ?? [];
      eligibility = draft.audience.eligibility ?? 'all';
      for (const [key, value] of Object.entries(draft.audience)) {
        if (form.elements.namedItem(key)) field(key).value = String(value);
      }
      field('launchMode').value = draft.launchMode;
      field('scheduledAt').value = draft.scheduledAt;
      el('schedule-field').hidden = draft.launchMode !== 'schedule';
      el('launch-help').textContent = draft.launchMode === 'schedule'
        ? 'Starts sending at the chosen time, once the campaign is ready.'
        : 'Starts sending as soon as the campaign is ready.';
      dirty = draft.dirty;
      if (dirty) status('draft-state', 'Unsaved changes restored');
    } catch { try { sessionStorage.removeItem(draftKey()); } catch {} }
  }
  function updateStepUrl(replace = false) {
    const path = campaignPath(base, id, editorSteps[step]!);
    if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState'](null, '', path + location.search);
    const sending = el<HTMLAnchorElement>('editor-sending-link');
    sending.hidden = !id;
    sending.href = campaignPath(base, id, 'sending');
    rememberDraft();
  }
  function setEditorBusy(value: boolean, button: HTMLButtonElement, pendingLabel?: string) {
    busy = value;
    form.setAttribute('aria-busy', String(value));
    setButtonBusy(button, value, false, pendingLabel);
    root!.querySelectorAll<HTMLButtonElement>('[data-step], #composer-back, #composer-next, #save-draft').forEach(control => {
      control.disabled = value;
    });
    updateReceivers();
  }
  function steps(value: number, clearMessage = true, syncUrl = true) {
    step = value;
    if (syncUrl) updateStepUrl();
    if (clearMessage) status('composer-message', '');
    for (const panel of root!.querySelectorAll<HTMLElement>('[data-panel]'))
      panel.hidden = Number(panel.dataset.panel) !== step;
    for (const button of root!.querySelectorAll<HTMLElement>('[data-step]')) {
      button.dataset.complete = String(Number(button.dataset.step) < step);
      if (Number(button.dataset.step) === step)
        button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    el('composer-back').hidden = step === 0;
    el('composer-next').querySelector('span')!.textContent =
      step < 2
        ? 'Next'
        : field('launchMode').value === 'schedule'
          ? 'Schedule campaign'
          : 'Start campaign';
    el('composer-next').querySelector('svg')!.dataset.reviewArrow = String(step === 2);
    requestAnimationFrame(resizeAudience);
    if (step === 2) review();
    else el<HTMLButtonElement>('composer-next').disabled = busy;
    root!
      .querySelector('.campaign-steps')
      ?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function parts() {
    return compileParts(
      content(),
      assets,
      el<HTMLInputElement>('sample-name').value,
      company,
    );
  }
  function previewMessage() {
    status(
      'text-length',
      `${codePoints(field('text').value).toLocaleString()} / 4,000 characters`,
    );
    try {
      const outgoing = parts();
      showParts(el('chat-preview'), outgoing, assets);
      el('part-count').textContent =
        `${outgoing.length} WhatsApp message${outgoing.length === 1 ? '' : 's'} per customer`;
      if (step === 2) showParts(el('review-preview'), outgoing, assets);
    } catch (error) {
      status('composer-message', errorText(error), true);
    }
  }
  function drawAssets() {
    const list = el('attachment-list');
    el('separate-text-option').hidden = assets.length === 0;
    list.replaceChildren();
    assets.forEach((asset, index) => {
      const row = node('li', undefined, 'attachment-row'),
        media = node(asset.kind === 'video' ? 'video' : 'img');
      media.src = `/api/campaign-assets/${asset.id}`;
      if (media instanceof HTMLVideoElement) media.preload = 'metadata';
      else media.alt = '';
      appendNodes(
        row,
        media,
        node('span', `${index + 1}. ${asset.name}`, 'attachment-name'),
      );
      const controls = node('div', undefined, 'attachment-actions');
      const up = iconButton(`Move ${asset.name} up`, icons.up),
        down = iconButton(`Move ${asset.name} down`, icons.down),
        remove = iconButton(`Remove ${asset.name}`, icons.remove);
      up.disabled = index === 0;
      down.disabled = index === assets.length - 1;
      up.onclick = () => {
        [assets[index - 1], assets[index]] = [
          assets[index]!,
          assets[index - 1]!,
        ];
        drawAssets();
        setDirty();
      };
      down.onclick = () => {
        [assets[index + 1], assets[index]] = [
          assets[index]!,
          assets[index + 1]!,
        ];
        drawAssets();
        setDirty();
      };
      remove.onclick = () => {
        assets.splice(index, 1);
        drawAssets();
        setDirty();
      };
      appendNodes(controls, up, down, remove);
      appendNodes(row, controls);
      appendNodes(list, row);
    });
    previewMessage();
  }
  type AudienceRow = Preview['sample'][number];
  type AudiencePage = Preview & { data: AudienceRow[]; last_page: number; last_row: number };
  let audienceData: ReturnType<typeof createDataTable<AudienceRow, AudiencePage>> | undefined;
  let audienceTableReady = false;
  let audienceTimer: ReturnType<typeof setTimeout> | undefined;
  const compactAudience = window.matchMedia('(max-width: 760px)');
  const audienceHost = el('campaign-audience-table');
  const audiencePanel = root.querySelector<HTMLElement>('.audience-table-panel')!;
  const money = new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function audienceIdentity(cell: CellComponent) {
    const lead = cell.getRow().getData() as AudienceRow;
    const identity = node('div', undefined, 'audience-identity');
    const name = node('strong', lead.name || 'Unnamed customer');
    name.title = lead.name || 'Unnamed customer';
    appendNodes(identity, name);
    if (lead.reasons.length)
      appendNodes(identity, node('small', reasonLabels[lead.reasons[0]!] ?? label(lead.reasons[0]!)));
    return identity;
  }
  function audienceContact(cell: CellComponent) {
    if (cell.getValue() !== 1) return node('span', cell.getValue() === 0 ? 'None' : 'Not checked');
    const contact = node('span', undefined, 'audience-contact');
    contact.setAttribute('aria-label', 'WhatsApp');
    contact.title = 'WhatsApp';
    contact.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 11.5a9 9 0 0 1-13.4 7.9L3 21l1.6-4.6A9 9 0 1 1 21 11.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 7.5c0 4.5 4 8.5 8.5 8.5l1-2.5-3-1-1 1c-1.7-.8-3-2.1-3.8-3.8l1-1-1-3-1.7 1.8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    return contact;
  }
  function resizeAudience() {
    if (!audienceTableReady || !audienceData || !audienceHost.isConnected || !audienceHost.offsetWidth) return;
    const desktopHeight = window.innerHeight >= 700 && window.innerWidth > 1000;
    const available = audiencePanel.querySelector<HTMLElement>('.data-table-body')!.clientHeight;
    const height = desktopHeight ? Math.max(180, available) : compactAudience.matches ? 300 : 400;
    if (Math.abs(parseFloat(audienceHost.style.height) - height) > 1) {
      const holder = audienceHost.querySelector<HTMLElement>('.tabulator-tableholder')!;
      const scroll = holder.scrollTop;
      audienceData.table.setHeight(height);
      holder.scrollTop = scroll;
    }
  }
  function audienceSummary(result: Preview) {
    preview = result;
    const warning = el('audience-warning');
    const missing = result.noWhatsappCount ?? 0;
    warning.hidden = !missing && !result.incompleteChecks;
    warning.textContent = [
      missing ? `${missing} lead${missing === 1 ? ' has' : 's have'} no WhatsApp and will be skipped.` : '',
      result.incompleteChecks ? `${result.incompleteChecks} WhatsApp checks are incomplete or stale.` : '',
    ].filter(Boolean).join(' ');
    el('audience-empty').hidden = Boolean(result.total);
    audienceHost.classList.toggle('is-empty', !result.total);
    el('selected-audience-note').textContent = selectedIds.length ? 'Matching leads from your selection' : 'All matching leads are included';
    if (step === 2) review();
  }
  function setupAudience() {
    const firstLoad = new Promise<void>(resolve => {
      audienceData = createDataTable<AudienceRow, AudiencePage>(root!.querySelector<HTMLElement>('[data-table="campaign-audience-table"]')!, {
        rowLabel: 'leads', batchSize: compactAudience.matches ? 25 : 50,
        columns: [
          { title: 'Name', field: 'name', minWidth: 100, widthGrow: 2, formatter: audienceIdentity },
          { title: 'Phone', field: 'phone', minWidth: 115, width: 125, formatter: 'plaintext' },
          { title: 'Contact', field: 'whatsappExists', minWidth: 100, width: 110, visible: !compactAudience.matches, formatter: audienceContact },
          { title: 'Deliveries', field: 'deliveryCount', minWidth: 90, width: 100, visible: !compactAudience.matches, formatter: cell => Number(cell.getValue()).toLocaleString('en-BD') },
          { title: 'Total Value (BDT)', field: 'totalParcelValue', minWidth: 120, widthGrow: 1, visible: !compactAudience.matches, formatter: cell => cell.getValue() === null ? 'Unknown' : money.format(cell.getValue()) },
        ],
        tableOptions: { movableColumns: false, selectableRows: false, columnDefaults: { headerSort: false } },
        fetchPage: async (page, size, _sort, signal) => {
          const response = await fetch(`/api/campaign-audience-preview?page=${page}&size=${size}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(audience()), signal });
          const result = await response.json() as Preview & { error?: string };
          if (!response.ok) throw new Error(result.error ?? 'Could not load audience. Try again.');
          return { ...result, data: result.sample, last_page: result.pages, last_row: result.total };
        },
        onResponse: audienceSummary,
        onState: state => {
          if (state.loading && !state.rows.length) {
            el('audience-empty').hidden = true;
            audienceHost.classList.remove('is-empty');
          }
          if (state.error) {
            el('audience-empty').hidden = true;
          }
          if (!state.loading) resolve();
          requestAnimationFrame(resizeAudience);
        },
      });
    });
    audienceData!.table.on('tableBuilt', () => { audienceTableReady = true; resizeAudience(); });
    const observer = new ResizeObserver(resizeAudience);
    observer.observe(audiencePanel);
    window.addEventListener('resize', resizeAudience);
    compactAudience.addEventListener('change', () => {
      for (const field of ['whatsappExists', 'deliveryCount', 'totalParcelValue'])
        if (compactAudience.matches) audienceData!.table.hideColumn(field); else audienceData!.table.showColumn(field);
      audienceData!.table.redraw(true);
      resizeAudience();
    });
    return firstLoad;
  }
  async function loadAudience() {
    clearTimeout(audienceTimer);
    return audienceData ? audienceData.reload() : false;
  }
  function updateAudience(immediate = false) {
    clearTimeout(audienceTimer);
    if (immediate) void audienceData?.reload();
    else audienceTimer = setTimeout(() => void audienceData?.reload(), 300);
  }
  for (const key of ['source', 'whatsapp', 'minDeliveries', 'minValue']) {
    const input = field(key);
    input.addEventListener(input instanceof HTMLSelectElement ? 'change' : 'input', () => updateAudience(input instanceof HTMLSelectElement));
  }
  async function save() {
    if (!field('name').value.trim())
      throw new Error('Name your campaign before saving.');
    const parsedContent = content();
    if (!parsedContent.text.trim() && !assets.length)
      throw new Error('Add a message or attachment before saving.');
    parts();
    const input = {
      name: field('name').value,
      content: parsedContent,
      audience: audience(),
      ...(id ? { revision } : {}),
    };
    const savedVersion = editVersion;
    saving = true;
    status('draft-state', 'Saving...');
    try {
      const result = await campaignApi<Detail>(
        id ? `/api/campaigns/${id}` : '/api/campaigns',
        id ? 'PATCH' : 'POST',
        input,
      );
      const previousKey = draftKey();
      id = result.id;
      root!.dataset.id = id;
      revision = result.revision;
      detail = result;
      root!.dispatchEvent(new CustomEvent('campaign-draft-saved', { bubbles: true, detail: result }));
      dirty = editVersion !== savedVersion;
      try { if (previousKey !== draftKey()) sessionStorage.removeItem(previousKey); } catch {}
      updateStepUrl(true);
      status('draft-state', dirty ? 'Unsaved changes' : `Draft saved · revision ${revision}`, false, dirty ? '' : 'Saved');
      return result;
    } catch (error) {
      status('draft-state', 'Save failed', true);
      throw error;
    } finally { saving = false; }
  }
  async function saveToContinue() {
    await save();
    if (dirty) throw new Error('Changes were made while saving. Save again to continue.');
  }
  function review() {
    previewMessage();
    const facts = el('review-facts');
    facts.replaceChildren();
    let count = 0;
    try {
      count = parts().length;
    } catch {}
    for (const [name, value] of [
      [
        'Audience',
        `${preview?.ready ?? 0} ready / ${preview?.total ?? 0} selected`,
      ],
      ['Messages per customer', String(count)],
      [
        'Sender',
        detail?.sender_phone ??
          connectedPhone ??
          detail?.connectedSender?.phone ??
          'Connect WhatsApp',
      ],
      ['Content revision', String(revision)],
    ])
      appendNodes(facts, node('dt', name!), node('dd', value!));
    el('review-part-count').textContent = `${count} message${count === 1 ? '' : 's'} per customer`;
    el<HTMLButtonElement>('composer-next').disabled = busy;
    const recipients = preview?.ready ?? 0,
      attempts = recipients * count,
      sendingDays = count ? Math.ceil(recipients / Math.floor(DAILY_SEND_ATTEMPTS / count)) : 0;
    status(
      'sending-estimate',
      `Estimated: ${attempts.toLocaleString('en-BD')} send attempt${attempts === 1 ? '' : 's'} over ${sendingDays} sending day${sendingDays === 1 ? '' : 's'}. Other sends, retries or pauses may take longer.`,
    );
  }
  root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((button) =>
    button.addEventListener('click', async () => {
      if (busy) return;
      const next = Number(button.dataset.step);
      if (next !== 2) { steps(next); return; }
      setEditorBusy(true, button);
      status('composer-message', '');
      try {
        if (next === 2) {
          await saveToContinue();
          if (!await loadAudience()) return;
        }
        steps(next);
      } catch (error) {
        status('composer-message', errorText(error), true);
      } finally { setEditorBusy(false, button); }
    }),
  );
  form.addEventListener('input', (event) => {
    if (!(event.target as HTMLElement).closest('#test-receiver-menu')) setDirty();
  });
  field('text').addEventListener('input', previewMessage);
  field('separateText').addEventListener('change', previewMessage);
  el('sample-name').addEventListener('input', previewMessage);
  field('launchMode').addEventListener('change', () => {
    const scheduled = field('launchMode').value === 'schedule';
    el('schedule-field').hidden = !scheduled;
    el('launch-help').textContent = scheduled
      ? 'Starts sending at the chosen time, once the campaign is ready.'
      : 'Starts sending as soon as the campaign is ready.';
    steps(step);
  });
  el('composer-back').addEventListener('click', () => steps(step - 1));
  el('save-draft').addEventListener('click', async () => {
    if (busy) return;
    const button = el<HTMLButtonElement>('save-draft');
    setEditorBusy(true, button, 'Saving...');
    status('composer-message', '');
    try {
      await save();
      status('composer-message', '');
    } catch (error) {
      status('composer-message', errorText(error), true);
    } finally {
      setEditorBusy(false, button);
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const button = el<HTMLButtonElement>('composer-next');
    const schedule = field('launchMode').value === 'schedule';
    setEditorBusy(true, button, step === 0 ? 'Loading...' : step === 1 ? 'Saving...' : schedule ? 'Scheduling...' : 'Starting...');
    status('composer-message', '');
    try {
      if (step === 0) {
        for (const name of ['name', 'minDeliveries', 'minValue']) {
          if (!field(name).reportValidity()) return;
        }
        if (!await loadAudience()) return;
        steps(1);
      } else if (step === 1) {
        await saveToContinue();
        if (!await loadAudience()) return;
        steps(2);
      } else {
        if (dirty || !id) await saveToContinue();
        status('composer-message', schedule ? 'Scheduling campaign...' : 'Starting campaign...');
        const result = await campaignApi<Detail>(
          `/api/campaigns/${id}/actions`,
          'POST',
          {
            action: schedule ? 'schedule' : 'start',
            requestId: crypto.randomUUID(),
            revision,
            ...(schedule ? { scheduledAt: timestamp('scheduledAt') } : {}),
          },
        );
        dirty = false;
        try { sessionStorage.removeItem(draftKey()); } catch {}
        location.href = campaignPath(base, result.id, 'sending');
      }
    } catch (error) {
      status('composer-message', errorText(error), true);
    } finally {
      setEditorBusy(false, button);
      steps(step, false);
    }
  });
  const receiverMenu = el<HTMLElement>('test-receiver-menu');
  const receiverToggle = el<HTMLButtonElement>('test-receiver');
  const receiverOptions = el<HTMLFieldSetElement>('test-receiver-options');
  const selectAll = el<HTMLInputElement>('test-select-all');
  const testButton = el<HTMLButtonElement>('send-test');
  const receiverInputs = () => Array.from(receiverOptions.querySelectorAll<HTMLInputElement>('input'));
  const selectedReceivers = () => receiverInputs().filter((input) => input.checked).map((input) => input.value);
  function updateReceivers() {
    const inputs = receiverInputs(), phones = selectedReceivers();
    el('test-receiver-label').textContent = !inputs.length ? 'No configured receivers' : !phones.length ? 'Choose test receivers' : phones.length === 1 ? phones[0]! : `${phones.length} receivers selected`;
    const count = el('test-receiver-count');
    count.textContent = String(phones.length);
    count.hidden = !phones.length;
    selectAll.checked = !!inputs.length && phones.length === inputs.length;
    selectAll.indeterminate = phones.length > 0 && phones.length < inputs.length;
    testButton.disabled = busy || !phones.length;
    receiverToggle.disabled = busy || !inputs.length;
  }
  receiverOptions.addEventListener('change', updateReceivers);
  selectAll.addEventListener('change', () => {
    receiverInputs().forEach((input) => input.checked = selectAll.checked);
    updateReceivers();
  });
  let receiverMenuAnchorTop = 0;
  receiverMenu.addEventListener('beforetoggle', (event) => {
    const open = (event as ToggleEvent).newState === 'open';
    receiverToggle.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const rect = receiverToggle.getBoundingClientRect();
    receiverMenuAnchorTop = rect.top;
    receiverMenu.style.width = `${Math.min(Math.max(rect.width, 260), innerWidth - 24)}px`;
    receiverMenu.style.maxHeight = `${Math.min(420, Math.max(rect.top - 12, innerHeight - rect.bottom - 12))}px`;
    receiverMenu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - parseFloat(receiverMenu.style.width) - 12))}px`;
    const height = Math.min(420, 96 + receiverInputs().length * 44);
    receiverMenu.style.top = `${rect.bottom + height + 8 <= innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - Math.min(height, parseFloat(receiverMenu.style.maxHeight)) - 6)}px`;
  });
  receiverToggle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    receiverMenu.showPopover();
    selectAll.focus();
  });
  const closeReceivers = () => { if (receiverMenu.matches(':popover-open')) receiverMenu.hidePopover(); };
  window.addEventListener('resize', closeReceivers);
  window.addEventListener('scroll', (event) => {
    if ((! (event.target instanceof Node) || !receiverMenu.contains(event.target)) && Math.abs(receiverToggle.getBoundingClientRect().top - receiverMenuAnchorTop) > 1) closeReceivers();
  }, { capture: true, passive: true });
  el('send-test').addEventListener('click', async () => {
    if (busy) return;
    const phones = selectedReceivers();
    if (!phones.length) return;
    closeReceivers();
    setEditorBusy(true, testButton, 'Sending...');
    status('test-send-message', 'Preparing test…');
    try {
      if (dirty || !id) await saveToContinue();
      const result = await campaignApi<Detail>(
        `/api/campaigns/${id}/test`, 'POST',
        { requestId: crypto.randomUUID(), revision, phones },
      );
      const link = node('a', 'View test results');
      link.href = campaignPath(base, result.id, 'sending');
      status('test-send-message', `Test queued for ${phones.length} receiver${phones.length === 1 ? '' : 's'}.`, false, 'Queued');
      appendNodes(el('test-send-message'), link);
    } catch (error) {
      status('test-send-message', errorText(error), true);
    } finally {
      setEditorBusy(false, testButton);
    }
  });
  const formatMenu = el<HTMLElement>('format-more-menu');
  const formatToggle = el<HTMLButtonElement>('format-more-toggle');
  formatMenu.addEventListener('beforetoggle', (event) => {
    if ((event as ToggleEvent).newState !== 'open') return;
    const anchor = formatToggle.getBoundingClientRect();
    formatMenu.style.left = `${Math.max(8, Math.min(anchor.right - 168, window.innerWidth - 176))}px`;
    formatMenu.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - 150))}px`;
  });
  const closeFormatMenu = () => {
    if (formatMenu.matches(':popover-open')) formatMenu.hidePopover();
  };
  window.addEventListener('resize', closeFormatMenu);
  window.addEventListener('scroll', closeFormatMenu, { passive: true });
  root.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((button) =>
    button.addEventListener('click', () => {
      const editor = el<HTMLTextAreaElement>('offer-text'),
        kind = button.dataset.format;
      let start = editor.selectionStart, end = editor.selectionEnd;
      if (kind === 'list' || kind === 'quote') {
        start = editor.value.lastIndexOf('\n', start - 1) + 1;
        if (end > start && editor.value[end - 1] === '\n') end--;
        const lineEnd = editor.value.indexOf('\n', end);
        end = lineEnd < 0 ? editor.value.length : lineEnd;
      }
      const selection = editor.value.slice(start, end) || 'text';
      const wrapLines = (marker: string) => selection.split('\n').map((line) => line ? `${marker}${line}${marker}` : '').join('\n');
      const inserted =
        kind === 'bold'
          ? wrapLines('*')
          : kind === 'italic'
            ? wrapLines('_')
            : kind === 'strike'
              ? wrapLines('~')
              : kind === 'code'
                ? wrapLines('`')
                : kind === 'mono'
                  ? `\`\`\`${selection}\`\`\``
                  : kind === 'name'
                    ? '{{name}}'
                    : kind === 'company'
                      ? '{{company}}'
                      : kind === 'list'
                        ? selection.split('\n').map((line) => `- ${line}`).join('\n')
                        : selection.split('\n').map((line) => `> ${line}`).join('\n');
      closeFormatMenu();
      editor.setRangeText(inserted, start, end, 'end');
      editor.focus();
      setDirty();
      previewMessage();
    }),
  );
  initMediaPicker(root, () => assets, (selected) => { assets = selected; drawAssets(); setDirty(); });
  async function initialize() {
    try {
      if (id) {
        const result = initialDetail ?? await campaignApi<Detail>(`/api/campaigns/${id}`);
        if (result.status !== 'draft') { location.replace(campaignPath(base, id, 'sending')); return; }
        detail = result;
        revision = result.revision;
        company = result.company_name;
        field('name').value = result.name;
        field('text').value = result.content.text;
        (field('separateText') as HTMLInputElement).checked =
          result.content.separateText;
        assets = result.assets as UIAsset[];
        selectedIds = result.audience.ids ?? [];
        eligibility = result.audience.eligibility ?? 'all';
        for (const [key, value] of Object.entries(result.audience)) {
          if (form.elements.namedItem(key)) field(key).value = String(value);
        }
        status('draft-state', `Draft saved · revision ${revision}`, false, 'Saved');
      } else {
        const pending = sessionStorage.getItem('campaign-audience');
        if (pending) {
          sessionStorage.removeItem('campaign-audience');
          const q = JSON.parse(pending);
          selectedIds = q.ids ?? [];
          eligibility = q.eligibility ?? 'all';
          for (const [key, value] of Object.entries(q)) {
            if (form.elements.namedItem(key)) field(key).value = String(value);
          }
        }
      }
      restoreDraft();
      memoryReady = true;
      updateStepUrl(true);
      steps(step, false, false);
      if (!['yes', 'all'].includes(field('whatsapp').value)) field('whatsapp').value = 'all';
      drawAssets();
      await setupAudience();
      try {
        const state = await campaignApi<{ phone: string | null }>(
          '/api/whatsapp',
        );
        connectedPhone = state.phone;
        if (step === 2) review();
      } catch {
        connectedPhone = null;
      }
      const receivers = await campaignApi<{ items: { phone: string }[] }>(
        '/api/campaign-test-destinations',
      );
      for (const receiver of receivers.items) {
        const label = node('label');
        const checkbox = node('input');
        checkbox.type = 'checkbox';
        checkbox.value = receiver.phone;
        appendNodes(label, checkbox, node('span', receiver.phone));
        appendNodes(receiverOptions, label);
      }
      updateReceivers();
    } catch (error) {
      el('test-receiver-label').textContent = 'Receivers unavailable';
      status('composer-message', errorText(error), true);
    }
  }
  void initialize();
  window.addEventListener('popstate', () => {
    const view = campaignView(location.pathname);
    const next = editorSteps.findIndex(item => item === view);
    const routeId = location.pathname.split('/')[3];
    if (next < 0 || (routeId !== (id || 'new') && routeId !== 'new')) { location.reload(); return; }
    steps(next, true, false);
    if (routeId === 'new' && id) updateStepUrl(true);
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty) {
      event.preventDefault();
    }
  });
}
export function initCampaignDetail() {
  const root = document.querySelector<HTMLElement>('[data-campaign-detail]');
  if (!root) return;
  const id = root.dataset.id!,
    base = root.dataset.base!;
  const requestedView = campaignView(location.pathname) ?? root.dataset.view;
  const sendingPage = requestedView === 'sending';
  let campaign: Detail | null = null,
    page = 1,
    pages = 1,
    actionBusy = false;
  let activeLoad: Promise<void> | null = null;
  let recoveryTrigger: HTMLButtonElement | null = null;
  let recoveryRecipient: string | null = null;
  function updateHeader(value: Detail) {
    const heading = document.querySelector<HTMLElement>('.topbar h1');
    if (heading) heading.textContent = value.name;
    el('detail-campaign-status').textContent = `${value.is_test ? 'Test send' : 'Campaign'} · ${label(value.status)}`;
    document.title = `${value.name} · Re-Target`;
  }
  root.addEventListener('campaign-draft-saved', event => {
    campaign = (event as CustomEvent<Detail>).detail;
    updateHeader(campaign);
  });
  async function action(action: string, extra: Record<string, unknown> = {}) {
    if (!campaign) return;
    const result = await campaignApi<Detail>(
      `/api/campaigns/${id}/actions`,
      'POST',
      {
        action,
        revision: campaign.revision,
        requestId: crypto.randomUUID(),
        ...extra,
      },
    );
    if (result.id !== id) {
      location.href = campaignPath(base, result.id, 'audience');
      return;
    }
    await load();
  }
  function load(live = false): Promise<void> {
    if (activeLoad) return live ? activeLoad : activeLoad.then(() => load());
    activeLoad = performLoad(live).finally(() => { activeLoad = null; });
    return activeLoad;
  }
  async function performLoad(live: boolean) {
    const refresh = el<HTMLButtonElement>('refresh-results');
    if (!live) setButtonBusy(refresh, true, true);
    try {
      const previousStatus = campaign?.status, previousRevision = campaign?.revision;
      campaign = live && campaign
        ? { ...campaign, ...await campaignApi<Awaited<ReturnType<typeof campaignProgress>>>(`/api/campaigns/${id}/progress`) }
        : await campaignApi<Detail>(`/api/campaigns/${id}`);
      if (live && actionBusy) return;
      const editing = campaign.status === 'draft' && !sendingPage;
      if (campaign.status !== 'draft' && requestedView && requestedView !== 'sending') {
        location.replace(campaignPath(base, id, 'sending'));
        return;
      }
      if (!requestedView) history.replaceState(null, '', campaignPath(base, id, editing ? 'audience' : 'sending') + location.search);
      el('retry-campaign-detail').hidden = true;
      setRegionLoading('campaign-detail-loading', false);
      status('campaign-detail-message', '');
      updateHeader(campaign);
      const controls = el('campaign-controls');
      if (!editing) el('campaign-detail-actions').appendChild(controls);
      if (!live || previousStatus !== campaign.status || previousRevision !== campaign.revision) {
        controls.replaceChildren();
        const options =
          campaign.status === 'draft'
            ? ['duplicate', 'archive']
            : ['running', 'scheduled'].includes(campaign.status)
              ? ['pause', 'cancel', 'duplicate']
              : campaign.status === 'paused'
                ? ['resume', 'cancel', 'duplicate']
                : campaign.status === 'preparing'
                  ? ['cancel']
                  : ['completed', 'cancelled'].includes(campaign.status)
                    ? ['duplicate', 'archive']
                    : ['duplicate'];
        controls.dataset.compact = String(options.every(name => name === 'duplicate' || name === 'archive'));
        for (const name of options) {
          const button = node('button', undefined, name === 'resume' ? 'primary' : 'secondary');
          if (name === 'duplicate' || name === 'archive') {
            button.classList.add('campaign-control-icon');
            button.setAttribute('aria-label', label(name));
            button.title = label(name);
            appendNodes(button, actionIcon(icons[name]));
          }
          appendNodes(button, node('span', label(name)));
          button.onclick = async () => {
            if (actionBusy) return;
            actionBusy = true;
            const pending = ({ duplicate: 'Duplicating...', archive: 'Archiving...', pause: 'Pausing...', cancel: 'Cancelling...', resume: 'Resuming...' } as Record<string, string>)[name];
            controls.querySelectorAll<HTMLButtonElement>('button').forEach(control => control.disabled = true);
            setButtonBusy(button, true, false, pending);
            status('campaign-detail-message', pending);
            try {
              await action(name);
            } catch (error) {
              status('campaign-detail-message', errorText(error), true);
            } finally {
              actionBusy = false;
              controls.querySelectorAll<HTMLButtonElement>('button').forEach(control => control.disabled = false);
              setButtonBusy(button, false);
            }
          };
          appendNodes(controls, button);
        }
      }
      const results = el('campaign-results');
      results.replaceChildren();
      const counts = campaign.messageCounts;
      for (const [key, title] of [
        ['sent', 'Sent'], ['skipped', 'Skipped'], ['failed', 'Failed'],
        ['pending', 'Pending'], ['submitting', 'Sending'], ['unconfirmed', 'Unconfirmed'],
        ['cancelled', 'Cancelled'], ['delivered', 'Delivered'], ['read', 'Read'],
      ] as const) {
        if (!['sent', 'pending'].includes(key) && !counts[key]) continue;
        const group = node('div');
        appendNodes(group, node('dt', key === 'pending' ? 'Waiting' : title), node('dd', String(counts[key] ?? 0)));
        appendNodes(results, group);
      }
      el('campaign-recipient-total').textContent = `Contacts · ${campaign.recipientTotal}`;
      const reasons = el('campaign-reason-results');
      reasons.replaceChildren();
      const reasonGroups = [
        ['Skipped recipients', campaign.recipientSkipReasons],
        ['Skipped messages', campaign.messageReasons.filter(row => row.status === 'skipped')],
        ['Failed messages', campaign.messageReasons.filter(row => row.status === 'failed')],
      ] as const;
      el('campaign-outcome-reasons').hidden = !reasonGroups.some(([, rows]) => rows.length);
      for (const [title, rows] of reasonGroups) {
        if (!rows.length) continue;
        appendNodes(reasons, node('h4', title, 'campaign-reason-heading'));
        const list = node('dl', undefined, 'campaign-reason-list');
        for (const row of rows) {
          const group = node('div');
          appendNodes(group, node('dt', reasonLabels[row.reason] ?? row.reason), node('dd', String(row.count)));
          appendNodes(list, group);
        }
        appendNodes(reasons, list);
      }
      status('campaign-live-status', 'Live updates');
      const sender = campaign.sender;
      const nextDue = counts.nextDue === null ? null : Math.max(counts.nextDue, Number(sender?.nextAllowedAt ?? 0), campaign.scheduled_at ?? 0);
      const title = campaign.status === 'paused' ? 'Sending paused'
        : campaign.status === 'running' ? 'Sending messages'
        : campaign.status === 'preparing' ? 'Preparing contacts'
        : label(campaign.status);
      const sessionPause = sender?.pauseReason?.includes('session changed') || sender?.pauseReason?.includes('WhatsApp disconnected');
      const explanation = campaign.status === 'paused'
        ? counts.unconfirmed > 0 ? 'Check the highlighted message in WhatsApp before resuming.'
          : sessionPause ? 'WhatsApp lost its connection. Resume to check the sender and continue.'
          : sender?.pauseReason ?? (campaign.infrastructureFailure ? 'Background sending stopped. Resume to try again.' : 'Resume when you’re ready to continue.')
        : campaign.status === 'running'
          ? counts.submitting > 0 ? 'Sending in background. You can leave this page.'
            : nextDue && nextDue > campaign.checkedAt ? `Next message: ${dateLabel(nextDue)}.`
            : counts.pending > 0 ? 'Waiting for the background sender.' : 'Finishing up.'
          : campaign.status === 'preparing' ? `${campaign.preparation_done} of ${campaign.recipientTotal} contacts ready.`
          : campaign.status === 'scheduled' ? `Starts ${dateLabel(campaign.scheduled_at)}.`
          : campaign.status === 'completed' ? 'All contacts have been processed.'
          : campaign.status === 'cancelled' ? 'Remaining messages will not be sent.' : '';
      const runState = el('campaign-run-state');
      runState.replaceChildren();
      if (!editing) appendNodes(runState,
        node('h2', title), node('p', explanation),
        node('p', `From ${campaign.sender_phone?.replace(/^880/, '0') ?? 'WhatsApp'}`, 'run-sender'));
      const reviewLink = el<HTMLAnchorElement>('draft-review-link');
      reviewLink.href = campaignPath(base, id, 'review');
      reviewLink.hidden = !sendingPage || campaign.status !== 'draft';
      if (sendingPage && campaign.status === 'draft') {
        runState.replaceChildren(node('h2', 'Ready when you are'), node('p', 'Review your message and audience to start sending.'));
      }
      if (!live) {
        const history = el('campaign-test-history');
        history.replaceChildren();
        const testHistory = el('campaign-tests');
        (editing ? el('test-history-slot') : el('sending-test-history')).appendChild(testHistory);
        testHistory.hidden = !campaign.tests.length;
        for (const test of campaign.tests) {
          const link = node(
            'a',
            `${test.destination.split(',').length} contacts · ${label(test.status)} · ${dateLabel(test.createdAt)}`,
            'campaign-row',
          );
          link.href = campaignPath(base, test.id, 'sending');
          appendNodes(history, link);
        }
      }
      el('campaign-detail-grid').hidden = editing;
      el('campaign-progress').hidden = campaign.status === 'draft';
      el('draft-editor-slot').hidden = !editing;
      el('launched-results').hidden = editing;
      el('campaign-results').hidden = campaign.status === 'draft';
      if (campaign.status === 'draft' || campaign.status === 'archived') el('recovery-controls').hidden = true;
      if (editing) initCampaignEditor(campaign);
      else if (campaign.status === 'draft') {
        el('campaign-recipient-total').textContent = 'Contacts';
        el('recipient-results').replaceChildren(node('p', 'Contacts appear here when sending starts.', 'sending-empty muted'));
        el('recipient-pagination').hidden = true;
        setRegionLoading('recipients-loading', false);
      } else await recipients();
    } catch (error) {
      if (live) status('campaign-live-status', 'Live update failed · Retrying in 5s', true);
      else status('campaign-detail-message', errorText(error), true);
      el('retry-campaign-detail').hidden = false;
    } finally {
      if (!live) setButtonBusy(refresh, false);
      setRegionLoading('campaign-detail-loading', false);
    }
  }
  let recipientRequest = 0;
  async function recipients() {
    const request = ++recipientRequest;
    const requestedPage = page, requestedState = el<HTMLSelectElement>('recipient-status').value;
    setRegionLoading('recipients-loading', !el('recipient-results').children.length);
    try {
      const result = await campaignApi<{
        items: {
          id: string;
          name: string;
          phone: string;
          state: string;
          skip_reason: string | null;
          reasons_json: string;
          deliveredParts: number;
          totalParts: number;
          parts: {
            id: string;
            ordinal: number;
            kind: string;
            text: string;
            status: string;
            gateway_id: string | null;
            delivered_at: number | null;
            read_at: number | null;
            error: string | null;
          }[];
        }[];
        pages: number;
      }>(
        `/api/campaigns/${id}/recipients?page=${requestedPage}&state=${requestedState}`,
      );
      if (request !== recipientRequest) return;
      pages = result.pages;
      if (page > pages) { page = pages; await recipients(); return; }
      const list = el('recipient-results');
      const focusedSummary = document.activeElement instanceof HTMLElement && document.activeElement.matches('summary')
        ? document.activeElement.closest<HTMLElement>('.recipient-result')?.dataset.recipientId
        : null;
      if (list.contains(document.activeElement) && !focusedSummary) return;
      const expanded = new Set(Array.from(list.querySelectorAll<HTMLDetailsElement>('details[open]')).map(item => item.dataset.recipientId));
      list.replaceChildren();
      for (const recipient of result.items) {
        const details = node('details', undefined, 'recipient-result'),
          summary = node('summary'),
          identity = node('span', undefined, 'recipient-identity');
        if (!campaign?.is_test) appendNodes(identity, node('span', recipient.name || 'Unnamed customer'));
        appendNodes(identity, node('span', recipient.phone, 'recipient-phone'));
        const sentParts = recipient.parts.filter(part => part.status === 'sent').length;
        const deliveredParts = recipient.parts.filter(part => part.delivered_at).length;
        const readParts = recipient.parts.filter(part => part.read_at).length;
        const delivery = recipient.state === 'fully_sent'
          ? readParts === recipient.parts.length ? 'Read' : deliveredParts === recipient.parts.length ? 'Delivered' : 'Sent'
          : recipient.state === 'queued' ? campaign?.status === 'paused' ? 'Paused' : 'Waiting'
          : recipient.state === 'partially_sent' ? `${sentParts}/${recipient.parts.length} sent`
          : recipient.state === 'unconfirmed' ? 'Check send' : label(recipient.state);
        const badge = node('small', delivery, 'recipient-delivery');
        badge.dataset.state = recipient.state;
        appendNodes(
          summary,
          identity,
          badge,
        );
        details.dataset.recipientId = recipient.id;
        details.open = expanded.has(recipient.id);
        appendNodes(details, summary);
        if (recipient.skip_reason) {
          const reasons = JSON.parse(recipient.reasons_json)
            .filter(Boolean)
            .map((r: string) => reasonLabels[r] ?? r);
          appendNodes(details, node('p', reasons.join(' · ') || reasonLabels[recipient.skip_reason] || recipient.skip_reason));
        }
        const parts = node('ol');
        for (const part of recipient.parts) {
          const item = node('li');
          const partStatus = part.read_at ? 'Read' : part.delivered_at ? 'Delivered'
            : part.status === 'pending' ? campaign?.status === 'paused' ? 'Paused' : 'Waiting'
            : part.status === 'unconfirmed' ? 'Check send' : label(part.status);
          appendNodes(item, node('strong', `${label(part.kind)} · ${partStatus}`));
          if (part.text) appendNodes(item, node('pre', part.text));
          if (part.error) appendNodes(item, node('p', part.error, 'error'));
          if (part.status === 'unconfirmed' || (part.status === 'failed' && part.kind !== 'text')) {
            const button = node('button', part.status === 'failed' ? 'Replace attachment' : 'Check send', 'secondary');
            button.type = 'button';
            button.onclick = () => {
              const form = el<HTMLFormElement>('recovery-form');
              form.reset();
              recoveryTrigger = button;
              recoveryRecipient = recipient.id;
              replacementMedia = [];
              (form.elements.namedItem('assetId') as HTMLInputElement).value = '';
              el('recovery-media-name').textContent = 'No replacement selected';
              status('recovery-message', '');
              el('recovery-title').textContent = part.status === 'failed' ? 'Replace attachment' : 'Check send';
              el('recovery-context').textContent = `${recipient.phone} · ${label(part.kind)}`;
              (form.elements.namedItem('messageId') as HTMLInputElement).value =
                part.id;
              const recoveryAction = el<HTMLSelectElement>('recovery-action');
              for (const option of recoveryAction.options) {
                option.disabled = part.status === 'failed' ? option.value !== 'recover_part' : option.value === 'recover_part';
                option.hidden = option.disabled;
              }
              recoveryAction.value = part.status === 'failed' ? 'recover_part' : 'sent';
              recoveryAction.closest('label')!.hidden = part.status === 'failed';
              el('recovery-attachment').hidden = part.status !== 'failed';
              el('recovery-controls').hidden = false;
              updateRecoveryFields();
              el('recovery-controls').scrollIntoView({ block: 'start' });
              (part.status === 'failed' ? el('recovery-attachment').querySelector<HTMLButtonElement>('button')! : recoveryAction).focus({ preventScroll: true });
            };
            appendNodes(item, button);
          }
          appendNodes(parts, item);
        }
        appendNodes(details, parts);
        appendNodes(list, details);
      }
      if (focusedSummary) {
        const restored = Array.from(list.querySelectorAll<HTMLElement>('.recipient-result')).find(item => item.dataset.recipientId === focusedSummary);
        restored?.querySelector('summary')?.focus({ preventScroll: true });
      }
      if (!result.items.length)
        appendNodes(list, node('p', 'No recipients in this view.', 'muted'));
      el('recipient-pagination').hidden = pages <= 1;
      el('recipient-page').textContent = `${page} / ${pages}`;
      el<HTMLButtonElement>('recipient-previous').disabled = page <= 1;
      el<HTMLButtonElement>('recipient-next').disabled = page >= pages;
    } catch (error) {
      if (request === recipientRequest) status('campaign-detail-message', errorText(error), true);
    } finally {
      if (request === recipientRequest) setRegionLoading('recipients-loading', false);
    }
  }
  el('refresh-results').addEventListener('click', () => void load());
  el('retry-campaign-detail').addEventListener('click', () => { setRegionLoading('campaign-detail-loading', true); el('retry-campaign-detail').hidden = true; void load(); });
  el('recipient-status').addEventListener('change', () => {
    page = 1;
    void recipients();
  });
  el('recipient-previous').addEventListener('click', () => {
    page--;
    void recipients();
  });
  el('recipient-next').addEventListener('click', () => {
    page++;
    void recipients();
  });
  const recoveryForm = el<HTMLFormElement>('recovery-form');
  recoveryForm.addEventListener('input', () => {
    if (el('recovery-message').classList.contains('success-feedback')) status('recovery-message', '');
  });
  function updateRecoveryFields() {
    const resolution = el<HTMLSelectElement>('recovery-action').value;
    el('recovery-attachment').hidden = resolution !== 'recover_part';
    const gateway = recoveryForm.elements.namedItem('gatewayId') as HTMLInputElement;
    gateway.closest('label')!.hidden = resolution !== 'sent';
    gateway.required = resolution === 'sent';
    const risk = recoveryForm.elements.namedItem('acknowledgeDuplicateRisk') as HTMLInputElement;
    risk.closest('label')!.hidden = resolution !== 'unsent';
    risk.required = resolution === 'unsent';
  }
  el('close-recovery').addEventListener('click', () => {
    el('recovery-controls').hidden = true;
    const recipient = Array.from(el('recipient-results').querySelectorAll<HTMLElement>('.recipient-result'))
      .find(item => item.dataset.recipientId === recoveryRecipient);
    if (recoveryTrigger && recoveryTrigger.isConnected) recoveryTrigger.focus();
    else (recipient?.querySelector<HTMLElement>('summary') ?? el<HTMLButtonElement>('refresh-results')).focus();
  });
  el('recovery-action').addEventListener('change', updateRecoveryFields);
  let replacementMedia: UIAsset[] = [];
  initMediaPicker(el('recovery-controls'), () => replacementMedia, (selected) => {
    replacementMedia = selected;
    (recoveryForm.elements.namedItem('assetId') as HTMLInputElement).value = selected[0]?.id ?? '';
    el('recovery-media-name').textContent = selected[0]?.name ?? 'No replacement selected';
  }, 1);
  el<HTMLFormElement>('recovery-form').addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();
      if (actionBusy) return;
      const form = event.target as HTMLFormElement,
        data = new FormData(form),
        recovery = data.get('resolution') === 'recover_part';
      const extra: Record<string, unknown> = {
        messageId: data.get('messageId'),
        evidence: data.get('evidence'),
      };
      if (recovery) extra.assetId = data.get('assetId');
      else {
        extra.resolution = data.get('resolution');
        extra.acknowledgeDuplicateRisk =
          data.get('acknowledgeDuplicateRisk') === 'on';
        if (data.get('gatewayId')) extra.gatewayId = data.get('gatewayId');
      }
      actionBusy = true;
      const button = form.querySelector<HTMLButtonElement>('button[type=submit], button:not([type])')!;
      setButtonBusy(button, true, false, 'Recording...');
      form.setAttribute('aria-busy', 'true');
      status('recovery-message', 'Recording recovery...');
      try {
        await action(recovery ? 'recover_part' : 'resolve', extra);
        status(
          'recovery-message',
          'Recovery recorded.', false, 'Recorded',
          'Resume sending when you’re ready.',
        );
      } catch (error) {
        status('recovery-message', errorText(error), true);
      } finally { actionBusy = false; form.removeAttribute('aria-busy'); setButtonBusy(button, false); }
    },
  );
  void load();
  const poll = () => {
    if (
      !document.hidden &&
      !actionBusy &&
      campaign &&
      !['draft', 'archived'].includes(campaign.status)
    )
      void load(true);
  };
  let timer = setInterval(poll, 5000);
  window.addEventListener('pageshow', event => {
    if (event.persisted) { timer = setInterval(poll, 5000); poll(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !actionBusy && campaign && !['draft', 'archived'].includes(campaign.status)) void load(true);
  });
  window.addEventListener('pagehide', () => clearInterval(timer));
}
