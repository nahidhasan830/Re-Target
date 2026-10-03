export function loadingDestination(url: URL) {
  const path = url.pathname.replace(/\/$/, '') || '/';
  if (path === '/' || path.startsWith('/invite/')) return { variant: 'auth', title: path === '/' ? 'Sign in' : 'Account setup' };
  const match = path.match(/^\/(admin|app)(?:\/(.*))?$/);
  if (!match) return null;
  const section = match[2] || 'dashboard';
  if (section === 'campaigns/new') return { variant: 'campaign-editor', title: 'New campaign' };
  if (section.startsWith('campaigns/')) return { variant: 'campaign-detail', title: 'Campaign' };
  const titles: Record<string, string> = { dashboard: 'Dashboard', leads: 'Leads', campaigns: 'Campaigns', users: 'Users', account: 'Account', courier: 'Courier', whatsapp: 'WhatsApp' };
  return titles[section] ? { variant: section, title: titles[section] } : null;
}

export function initPageLoading() {
  const main = document.querySelector<HTMLElement>('main')!;
  const overlay = document.getElementById('page-loading')!;
  const content = document.getElementById('page-loading-content')!;
  const status = document.getElementById('page-loading-status')!;
  const title = document.querySelector<HTMLElement>('.topbar h1');
  let originalTitle: string | undefined;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const restore = () => {
    clearTimeout(resetTimer);
    overlay.hidden = true;
    main.classList.remove('page-pending');
    main.removeAttribute('aria-busy');
    main.querySelectorAll<HTMLElement>('[data-navigation-inert]').forEach(element => { element.inert = false; element.removeAttribute('data-navigation-inert'); });
    if (title && originalTitle !== undefined) title.textContent = originalTitle;
    originalTitle = undefined;
    status.textContent = '';
  };
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || link.hasAttribute('download') || link.target && link.target !== '_self') return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname === location.pathname && url.search === location.search) return;
    const destination = loadingDestination(url);
    const template = destination && overlay.querySelector<HTMLTemplateElement>(`[data-page-skeleton="${destination.variant}"]`);
    if (!template || !destination) return;
    content.replaceChildren(template.content.cloneNode(true));
    main.classList.add('page-pending');
    main.setAttribute('aria-busy', 'true');
    for (const child of main.children) {
      if (child instanceof HTMLElement && child !== overlay && !child.inert) { child.inert = true; child.dataset.navigationInert = ''; }
    }
    if (title) {
      if (overlay.hidden) originalTitle = title.textContent ?? '';
      title.textContent = destination.title;
    }
    status.textContent = `Loading ${destination.title.toLowerCase()}…`;
    overlay.hidden = false;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(restore, 15000);
  });
  window.addEventListener('pageshow', restore);
  window.addEventListener('beforeunload', event => { queueMicrotask(() => { if (event.defaultPrevented) restore(); }); });
  window.addEventListener('pagehide', () => clearTimeout(resetTimer));
}
