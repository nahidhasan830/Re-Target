export function initPasswordToggles() {
  for (const toggle of document.querySelectorAll<HTMLButtonElement>('[data-password-toggle]')) toggle.hidden = false;
  document.addEventListener('click', event => {
    const toggle = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-password-toggle]') : null;
    const input = toggle && document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    if (!toggle || !(input instanceof HTMLInputElement)) return;
    const visible = input.type === 'password';
    const subject = toggle.dataset.passwordToggle || 'password';
    input.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${subject}`);
  });
}
