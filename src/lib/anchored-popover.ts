export function anchorPopover(trigger: HTMLElement, popover: HTMLElement) {
  function position() {
    if (!trigger.isConnected || !popover.matches(':popover-open')) return;
    const margin = 12, gap = 8;
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0, topEdge = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
    const anchor = trigger.getBoundingClientRect();
    popover.style.maxHeight = `${height - margin * 2}px`;
    const naturalHeight = popover.getBoundingClientRect().height;
    const below = Math.max(0, topEdge + height - margin - anchor.bottom - gap);
    const above = Math.max(0, anchor.top - topEdge - margin - gap);
    const openBelow = naturalHeight <= below || below >= above;
    popover.style.maxHeight = `${Math.min(height - margin * 2, openBelow ? below : above)}px`;
    const bounds = popover.getBoundingClientRect();
    const left = Math.max(leftEdge + margin, Math.min(anchor.left, leftEdge + width - bounds.width - margin));
    const top = openBelow ? anchor.bottom + gap : anchor.top - bounds.height - gap;
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(topEdge + margin, Math.min(top, topEdge + height - bounds.height - margin))}px`;
  }
  popover.addEventListener('toggle', position);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  window.visualViewport?.addEventListener('resize', position);
  window.visualViewport?.addEventListener('scroll', position);
}
