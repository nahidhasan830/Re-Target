export const successPath = 'm5 12 4 4L19 6';

export function setFeedback(element: HTMLElement, message: string, successLabel = '', detail = '') {
  element.replaceChildren();
  element.classList.toggle('success-feedback', Boolean(successLabel));
  element.setAttribute('aria-atomic', 'true');
  if (!successLabel) {
    element.removeAttribute('title');
    element.textContent = message;
    return;
  }
  const description = [message, detail].filter(Boolean).join(' ');
  element.title = description;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(name, value);
  const path = document.createElementNS(icon.namespaceURI, 'path');
  path.setAttribute('d', successPath);
  icon.appendChild(path);
  const label = document.createElement('span');
  label.className = 'feedback-label';
  label.textContent = message;
  const visibleLabel = document.createElement('span');
  visibleLabel.setAttribute('aria-hidden', 'true');
  visibleLabel.textContent = successLabel;
  element.appendChild(icon);
  element.appendChild(label);
  element.appendChild(visibleLabel);
  if (detail) {
    const note = document.createElement('span');
    note.className = 'feedback-detail';
    note.textContent = detail;
    element.appendChild(note);
  }
}
