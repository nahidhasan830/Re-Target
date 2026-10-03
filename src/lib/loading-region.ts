export function setRegionLoading(id: string, pending: boolean) {
  const region = document.getElementById(id);
  if (!region) return;
  region.setAttribute('aria-busy', String(pending));
  const content = region.querySelector<HTMLElement>(':scope > .region-content');
  if (content) content.inert = pending;
}
