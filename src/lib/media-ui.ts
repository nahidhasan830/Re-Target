import { LIMITS } from './campaign-content';
import { setButtonBusy } from './control-state';

export type MediaAsset = {
  id: string;
  name: string;
  kind: 'image' | 'video';
  mime?: string;
  bytes?: number;
  state?: string;
  width?: number;
  height?: number;
  created_at?: number;
  in_use?: number;
  error?: string | null;
};
type MediaPage = { items: MediaAsset[]; total: number; page: number; pages: number; pageSize: number };
const find = <T = HTMLElement>(root: HTMLElement, selector: string) => root.querySelector(selector) as T;
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
const appendChildren = (parent: Node, ...children: Node[]) => children.forEach((child) => parent.appendChild(child));
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request failed. Try again.';
function message(target: HTMLElement, text: string, error = false) {
  target.textContent = text;
  target.classList.toggle('error', error);
}
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'The request failed. Try again.');
  return result;
}
function icon(path: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(svg.namespaceURI, 'path');
  for (const [key, value] of Object.entries({ d: path, stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) shape.setAttribute(key, value);
  appendChildren(svg, shape);
  return svg;
}
function mediaElement(asset: MediaAsset, preview = false) {
  const node = element(asset.kind === 'video' ? 'video' : 'img');
  node.src = `/api/campaign-assets/${asset.id}`;
  if (node instanceof HTMLVideoElement) {
    node.preload = 'metadata';
    node.controls = preview;
    node.playsInline = true;
    node.muted = !preview;
  } else { node.alt = preview ? asset.name : ''; node.loading = 'lazy'; }
  return node;
}
export function initMediaBrowser(root: HTMLElement, options: {
  selected?: Map<string, MediaAsset>;
  maximum?: number;
  onSelect?: () => void;
  onPreview?: (asset: MediaAsset) => void;
  onDelete?: (asset: MediaAsset) => void;
} = {}) {
  const picker = root.dataset.picker === 'true';
  const grid = find(root, '[data-media-grid]');
  const feedback = find(root, '[data-media-feedback]');
  const empty = find(root, '[data-media-empty]');
  const search = find<HTMLInputElement>(root, 'input[name=search]');
  const kind = find<HTMLSelectElement>(root, 'select[name=kind]');
  const previous = find<HTMLButtonElement>(root, '[data-media-previous]');
  const next = find<HTMLButtonElement>(root, '[data-media-next]');
  const refresh = find<HTMLButtonElement>(root, '[data-media-refresh]');
  const events = new AbortController();
  let pending: AbortController | undefined, generation = 0, page = 1, pages = 1, items: MediaAsset[] = [], timer: ReturnType<typeof setTimeout>, poll: ReturnType<typeof setTimeout>;
  const pageSize = () => {
    if (window.matchMedia('(max-width:760px)').matches) return 4;
    if (picker || window.matchMedia('(max-width:1100px)').matches) return 6;
    return window.matchMedia('(min-width:1360px)').matches ? 6 : 4;
  };
  let size = pageSize();
  function draw() {
    grid.replaceChildren();
    for (const asset of items) {
      const card = element('article', '', 'media-card');
      const selected = options.selected?.has(asset.id) ?? false;
      card.dataset.selected = String(selected);
      const thumbnail = element('button', '', 'media-thumbnail');
      thumbnail.type = 'button';
      thumbnail.setAttribute('aria-label', `${picker ? 'Select' : 'Preview'} ${asset.name}`);
      thumbnail.disabled = asset.state !== 'ready';
      if (asset.state === 'ready') appendChildren(thumbnail, mediaElement(asset));
      else appendChildren(thumbnail, element('span', asset.state === 'preparing' ? 'Preparing…' : 'Preparation failed'));
      if (asset.kind === 'video' && asset.state === 'ready') {
        const mark = element('div', '', 'media-video-mark');
        appendChildren(mark, icon('m9 5 11 7-11 7V5Z'), element('span', 'Video'));
        appendChildren(thumbnail, mark);
      }
      const body = element('div', '', 'media-card-body');
      const title = element('h3', asset.name);
      title.title = asset.name;
      const bytes = ((asset.bytes ?? 0) / 1024 / 1024).toLocaleString('en-BD', { maximumFractionDigits: 1 });
      appendChildren(body, title, element('p', `${asset.kind === 'image' ? 'Image' : 'Video'}${asset.in_use ? ' · In use' : ''} · ${bytes} MB${asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ''}`));
      const actions = element('div', '', 'media-card-actions');
      if (picker) {
        const select = element('button', selected ? `Selected ${Array.from(options.selected!.keys()).indexOf(asset.id) + 1}` : 'Select', 'secondary media-select');
        select.type = 'button';
        select.dataset.mediaSelect = asset.id;
        select.setAttribute('aria-label', `${selected ? 'Deselect' : 'Select'} ${asset.name}`);
        select.setAttribute('aria-pressed', String(selected));
        select.disabled = asset.state !== 'ready' || (!selected && (options.selected?.size ?? 0) >= (options.maximum ?? LIMITS.attachments));
        const toggle = () => {
          if (selected) options.selected?.delete(asset.id);
          else if (asset.state === 'ready' && (options.selected?.size ?? 0) < (options.maximum ?? LIMITS.attachments)) options.selected?.set(asset.id, asset);
          options.onSelect?.();
          draw();
          grid.querySelectorAll<HTMLButtonElement>('[data-media-select]').forEach((button) => { if (button.dataset.mediaSelect === asset.id) button.focus({ preventScroll: true }); });
        };
        select.onclick = toggle;
        thumbnail.disabled = select.disabled;
        thumbnail.onclick = toggle;
        appendChildren(actions, select);
      } else {
        const preview = element('button', '', 'secondary media-preview');
        preview.type = 'button';
        preview.setAttribute('aria-label', `Open preview for ${asset.name}`);
        preview.title = `Preview ${asset.name}`;
        appendChildren(preview, icon('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'), element('span', 'Preview'));
        preview.disabled = asset.state !== 'ready';
        preview.onclick = thumbnail.onclick = () => options.onPreview?.(asset);
        const remove = element('button', '', 'secondary media-delete');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Delete ${asset.name}`);
        remove.title = asset.in_use ? 'Used in a campaign' : asset.state === 'preparing' ? 'Wait for preparation to finish' : 'Delete media';
        remove.disabled = Boolean(asset.in_use) || asset.state === 'preparing';
        appendChildren(remove, icon('M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'));
        remove.onclick = () => options.onDelete?.(asset);
        appendChildren(actions, preview, remove);
      }
      appendChildren(body, actions);
      appendChildren(card, thumbnail, body);
      appendChildren(grid, card);
    }
  }
  async function load() {
    clearTimeout(poll);
    pending?.abort();
    pending = new AbortController();
    const token = ++generation;
    grid.setAttribute('aria-busy', 'true');
    setButtonBusy(refresh, true, false, 'Refreshing...');
    previous.disabled = next.disabled = true;
    message(feedback, 'Loading media…');
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(size), search: search.value, kind: kind.value });
      const result = await api<MediaPage>(`/api/campaign-assets?${query}`, { signal: pending.signal });
      if (token !== generation) return;
      items = result.items;
      page = result.page;
      pages = result.pages;
      draw();
      message(feedback, '');
      empty.hidden = items.length > 0;
      const filtered = Boolean(search.value || kind.value !== 'all');
      find(empty, '[data-empty-title]').textContent = filtered ? 'No matching media' : 'No media yet';
      find(empty, '[data-empty-copy]').textContent = filtered ? 'Try another filename or media type.' : picker ? 'Upload images and videos on the Media page, then choose them here.' : 'Upload images and videos to use in your campaigns.';
      find(root, '[data-media-count]').textContent = result.total ? `${(page - 1) * size + 1}–${Math.min(page * size, result.total)} of ${result.total}` : '0 files';
      previous.disabled = page <= 1;
      next.disabled = page >= pages;
      if (items.some((asset) => asset.state === 'preparing')) poll = setTimeout(() => { if (!document.hidden) void load(); }, 5000);
    } catch (error) {
      if (token !== generation || pending.signal.aborted) return;
      message(feedback, `${errorText(error)} Use Refresh to try again.`, true);
    } finally { if (token === generation) { grid.removeAttribute('aria-busy'); setButtonBusy(refresh, false); } }
  }
  const reset = () => { page = 1; void load(); };
  find<HTMLFormElement>(root, 'form').addEventListener('submit', (event) => { event.preventDefault(); clearTimeout(timer); reset(); }, { signal: events.signal });
  search.addEventListener('input', () => { pending?.abort(); ++generation; clearTimeout(timer); timer = setTimeout(reset, 250); }, { signal: events.signal });
  kind.addEventListener('change', reset, { signal: events.signal });
  find(root, '[data-media-refresh]').addEventListener('click', reset, { signal: events.signal });
  previous.addEventListener('click', () => { --page; void load(); }, { signal: events.signal });
  next.addEventListener('click', () => { ++page; void load(); }, { signal: events.signal });
  window.addEventListener('resize', () => { if (size !== pageSize()) { size = pageSize(); reset(); } }, { signal: events.signal });
  return { load, destroy() { ++generation; events.abort(); pending?.abort(); clearTimeout(timer); clearTimeout(poll); } };
}
export function uploadMedia(file: File, progress: (value: number) => void) {
  return new Promise<MediaAsset>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/campaign-assets');
    request.timeout = 180000;
    request.setRequestHeader('Content-Type', file.type);
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    request.onerror = request.ontimeout = () => reject(new Error('Upload interrupted. Refresh media before retrying.'));
    request.onload = () => {
      try {
        const result = JSON.parse(request.responseText);
        if (request.status >= 200 && request.status < 300) resolve(result);
        else reject(new Error(result.error ?? 'Upload failed.'));
      } catch { reject(new Error('Upload interrupted. Refresh media before retrying.')); }
    };
    request.send(file);
  });
}
export function initMediaLibrary() {
  const root = document.querySelector<HTMLElement>('[data-media-library]');
  if (!root) return;
  const preview = find<HTMLDialogElement>(root, '[data-media-preview]');
  const deletion = find<HTMLDialogElement>(root, '[data-media-delete]');
  let deleting: MediaAsset | undefined, deleteBusy = false, uploading = false;
  const browser = initMediaBrowser(find(root, '[data-media-browser]'), {
    onPreview(asset) {
      find(root, '#media-preview-title').textContent = asset.name;
      find(root, '[data-preview-content]').replaceChildren(mediaElement(asset, true));
      preview.showModal();
    },
    onDelete(asset) {
      deleting = asset;
      find(root, '[data-delete-name]').textContent = `“${asset.name}” will be permanently deleted.`;
      message(find(root, '[data-delete-error]'), '');
      deletion.showModal();
    },
  });
  find(root, '[data-preview-close]').onclick = () => preview.close();
  preview.addEventListener('close', () => find(root, '[data-preview-content]').replaceChildren());
  find(root, '[data-delete-cancel]').onclick = () => { if (!deleteBusy) deletion.close(); };
  deletion.addEventListener('cancel', (event) => { if (deleteBusy) event.preventDefault(); });
  find(root, '[data-delete-confirm]').onclick = async () => {
    if (!deleting || deleteBusy) return;
    deleteBusy = true;
    deletion.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.disabled = true);
    const confirm = find<HTMLButtonElement>(root, '[data-delete-confirm]');
    setButtonBusy(confirm, true, false, 'Deleting...');
    message(find(root, '[data-delete-error]'), 'Deleting media...');
    try { await api(`/api/campaign-assets/${deleting.id}`, { method: 'DELETE' }); deletion.close(); find<HTMLInputElement>(root, 'input[name=search]').focus({ preventScroll: true }); await browser.load(); }
    catch (error) { message(find(root, '[data-delete-error]'), errorText(error), true); }
    finally { deleteBusy = false; deletion.querySelectorAll<HTMLButtonElement>('button').forEach((button) => button.disabled = false); setButtonBusy(confirm, false); if (deletion.open) confirm.focus(); }
  };
  const files = find<HTMLInputElement>(root, '[data-media-files]');
  files.addEventListener('change', async () => {
    if (uploading || !files.files?.length) return;
    const selected = Array.from(files.files);
    const feedback = find(root, '[data-upload-feedback]');
    const state = find(root, '[data-upload-state]');
    const progress = find<HTMLProgressElement>(root, '[data-upload-progress]');
    let completed = 0;
    uploading = true;
    files.disabled = true;
    message(feedback, '');
    try {
      for (const file of selected) {
        if (!['image/jpeg', 'image/png', 'video/mp4'].includes(file.type)) throw new Error('Use JPEG, PNG, or MP4.');
        if (!file.size || file.size > (file.type === 'video/mp4' ? LIMITS.video : LIMITS.image)) throw new Error(`Use ${file.type === 'video/mp4' ? 'an MP4 up to 100 MB' : 'an image up to 5 MB'}.`);
      }
      state.hidden = false;
      for (const file of selected) {
        progress.value = 0;
        find(root, '[data-upload-label]').textContent = `Uploading ${file.name} (${completed + 1}/${selected.length})…`;
        await uploadMedia(file, (value) => { progress.value = value; if (value >= 100) find(root, '[data-upload-label]').textContent = `Preparing ${file.name}…`; });
        ++completed;
        await browser.load();
      }
      message(feedback, `${completed} ${completed === 1 ? 'file' : 'files'} ready to use.`);
    } catch (error) { message(feedback, `${completed ? `${completed} files uploaded. ` : ''}${errorText(error)}`, true); }
    finally { uploading = false; files.disabled = false; files.value = ''; state.hidden = true; await browser.load(); }
  });
  window.addEventListener('beforeunload', (event) => { if (uploading) event.preventDefault(); });
  void browser.load();
}
export function initMediaPicker(root: HTMLElement, current: () => MediaAsset[], apply: (assets: MediaAsset[]) => void, maximum = LIMITS.attachments) {
  const dialog = find<HTMLDialogElement>(root, '[data-media-picker]');
  let browser: ReturnType<typeof initMediaBrowser> | undefined, selected = new Map<string, MediaAsset>();
  const count = find(root, '[data-picker-count]');
  const update = () => { count.textContent = `${selected.size} / ${maximum} selected`; };
  const opener = find<HTMLButtonElement>(root, '[data-open-media-picker]');
  opener.onclick = () => {
    selected = new Map(current().map((asset) => [asset.id, asset]));
    update();
    dialog.showModal();
    browser = initMediaBrowser(find(dialog, '[data-media-browser]'), { selected, maximum, onSelect: update });
    void browser.load();
  };
  find(dialog, '[data-picker-cancel]').onclick = () => dialog.close();
  find(dialog, '[data-picker-apply]').onclick = () => { apply(Array.from(selected.values())); dialog.close(); };
  dialog.addEventListener('close', () => { browser?.destroy(); browser = undefined; opener.focus({ preventScroll: true }); });
}
