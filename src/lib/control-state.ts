const labels = new WeakMap<HTMLButtonElement, { node?: Node; text: string; ariaLabel: string | null }>();

export function setButtonBusy(button: HTMLButtonElement, busy: boolean, unavailable = false, pendingLabel = button.dataset.pending) {
  if (busy && pendingLabel && !labels.has(button)) {
    const node = button.querySelector<HTMLElement>('[data-button-label], span') ??
      Array.from(button.childNodes).find(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
    labels.set(button, { node, text: node?.textContent ?? '', ariaLabel: button.getAttribute('aria-label') });
    if (node) node.textContent = pendingLabel;
    if (button.hasAttribute('aria-label') || !node) button.setAttribute('aria-label', pendingLabel);
  } else if (!busy) {
    const original = labels.get(button);
    if (original) {
      if (original.node) original.node.textContent = original.text;
      if (original.ariaLabel === null) button.removeAttribute('aria-label');
      else button.setAttribute('aria-label', original.ariaLabel);
      labels.delete(button);
    }
  }
  button.disabled = busy || unavailable;
  button.setAttribute('aria-busy', String(busy));
}
