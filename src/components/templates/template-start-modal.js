import { isolateModalEvents } from '../../core/modal-events.js';

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = String(text);
  return n;
}

function btn(text, kind = '', behaviorTarget = null) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${kind}`.trim();
  b.textContent = text;
  if (behaviorTarget) b.dataset.behaviorTarget = behaviorTarget;
  return b;
}

export function renderTemplateStartPickerModal({
  state,
  modal,
  onClose,
  onStartWithIndex,
}) {
  const templates = Array.isArray(state?.activityTemplates) ? state.activityTemplates : [];
  const template = templates.find(t => t.id === modal?.templateId);
  if (!template) return document.createDocumentFragment();

  let selectedIndex = Number.isInteger(modal?.startIndex) && modal.startIndex >= 0 && modal.startIndex < template.steps.length
    ? modal.startIndex
    : 0;

  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal-box template-start-picker-modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', `Commencer « ${template.name} » à une étape`);

  const head = el('div', 'modal-head');
  head.appendChild(el('h2', 'card-title', `Démarrer : ${template.name}`));
  const closeBtn = btn('×', 'modal-close', 'modal-close');
  closeBtn.onclick = onClose;
  head.appendChild(closeBtn);

  const body = el('div', 'template-modal-body');
  body.appendChild(el('p', 'muted template-modal-desc', 'Choisissez l’étape par laquelle démarrer ce gabarit (par défaut la 1ère étape) :'));

  const stepsList = el('div', 'template-start-steps-list');
  template.steps.forEach((step, idx) => {
    const row = el('label', `template-start-step-row ${idx === selectedIndex ? 'is-selected' : ''}`);
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'template-start-index';
    radio.value = String(idx);
    radio.checked = idx === selectedIndex;
    radio.onchange = () => {
      selectedIndex = idx;
      renderStepsList();
    };

    const info = el('div', 'template-start-step-info');
    info.appendChild(el('strong', null, `${idx + 1}. ${step.activity}`));
    if (step.targetMins) {
      info.appendChild(el('span', 'muted', ` (~${step.targetMins} min)`));
    }

    row.append(radio, info);
    stepsList.appendChild(row);
  });

  function renderStepsList() {
    const rows = stepsList.querySelectorAll('.template-start-step-row');
    rows.forEach((r, i) => {
      if (i === selectedIndex) r.classList.add('is-selected');
      else r.classList.remove('is-selected');
    });
  }

  body.appendChild(stepsList);

  const footer = el('div', 'action-row template-modal-footer');
  const cancelBtn = btn('Annuler', 'secondary', 'template-start-cancel');
  cancelBtn.onclick = onClose;

  const startBtn = btn(`▶ Lancer à l’étape ${selectedIndex + 1}`, 'primary', 'template-start-confirm');
  startBtn.onclick = () => {
    onStartWithIndex(template.id, selectedIndex);
  };

  footer.append(cancelBtn, startBtn);
  body.appendChild(footer);

  box.append(head, body);
  overlay.appendChild(box);
  isolateModalEvents(overlay, box, { onBackdropClose: onClose });
  return overlay;
}
