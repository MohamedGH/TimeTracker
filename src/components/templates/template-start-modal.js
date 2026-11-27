import { isolateModalEvents } from '../../core/modal-events.js';
import { reorderTemplateSteps } from '../../state/template-actions.js';

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

  let draftSteps = template.steps.map((step, i) => ({
    ...step,
    _included: true,
    _origIdx: i,
  }));

  const initialStart = Number.isInteger(modal?.startIndex) && modal.startIndex >= 0 && modal.startIndex < draftSteps.length
    ? modal.startIndex
    : 0;
  let hasExplicitSelection = Number.isInteger(modal?.startIndex) && modal.startIndex > 0;
  let selectedStepId = draftSteps[initialStart]?.id || null;

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
  body.appendChild(
    el(
      'p',
      'muted template-modal-desc',
      'Choisissez l’étape de départ, décochez celles à passer, ou réorganisez l’ordre pour cette session :'
    )
  );

  const stepsList = el('div', 'template-start-steps-list');
  const footer = el('div', 'action-row template-modal-footer');
  const cancelBtn = btn('Annuler', 'secondary', 'template-start-cancel');
  cancelBtn.onclick = onClose;
  const startBtn = btn('▶ Lancer', 'primary', 'template-start-confirm');
  footer.append(cancelBtn, startBtn);

  function getIncludedSteps() {
    return draftSteps.filter(s => s._included);
  }

  function ensureValidSelectedStep() {
    const included = getIncludedSteps();
    if (!included.length) {
      selectedStepId = null;
      return;
    }
    if (!hasExplicitSelection || !included.some(s => s.id === selectedStepId)) {
      selectedStepId = included[0].id;
    }
  }

  function updateStartButton() {
    const included = getIncludedSteps();
    const startIdx = included.findIndex(s => s.id === selectedStepId);
    if (!included.length || startIdx < 0) {
      startBtn.disabled = true;
      startBtn.textContent = '▶ Lancer';
      return;
    }
    startBtn.disabled = false;
    startBtn.textContent = `▶ Lancer à l’étape ${startIdx + 1}`;
  }

  function renderStepsList() {
    ensureValidSelectedStep();
    stepsList.replaceChildren();
    const includedCount = getIncludedSteps().length;

    draftSteps.forEach((step, idx) => {
      const isSelected = step._included && step.id === selectedStepId;
      const row = el(
        'div',
        `template-start-step-row ${isSelected ? 'is-selected' : ''} ${!step._included ? 'is-skipped' : ''}`.trim()
      );
      row.dataset.templateStartStepIndex = String(idx);

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'template-start-index';
      radio.value = String(idx);
      radio.checked = isSelected;
      radio.disabled = !step._included;
      radio.setAttribute('aria-label', `Commencer à l’étape ${step.activity}`);
      radio.onchange = () => {
        if (!step._included) return;
        hasExplicitSelection = true;
        selectedStepId = step.id;
        renderStepsList();
      };

      const info = el('div', 'template-start-step-info');
      info.onclick = () => {
        if (!step._included) return;
        hasExplicitSelection = true;
        selectedStepId = step.id;
        renderStepsList();
      };
      info.appendChild(el('strong', null, `${idx + 1}. ${step.activity}`));
      if (step.targetMins) {
        info.appendChild(el('span', 'muted', ` (~${step.targetMins} min)`));
      }

      const controls = el('div', 'template-start-step-controls');

      const upBtn = btn('↑', 'small secondary', 'template-start-move-up');
      upBtn.title = 'Monter';
      upBtn.setAttribute('aria-label', `Monter ${step.activity}`);
      upBtn.disabled = idx === 0;
      upBtn.onclick = (e) => {
        e.stopPropagation();
        draftSteps = reorderTemplateSteps(draftSteps, idx, idx - 1);
        renderStepsList();
      };

      const downBtn = btn('↓', 'small secondary', 'template-start-move-down');
      downBtn.title = 'Descendre';
      downBtn.setAttribute('aria-label', `Descendre ${step.activity}`);
      downBtn.disabled = idx === draftSteps.length - 1;
      downBtn.onclick = (e) => {
        e.stopPropagation();
        draftSteps = reorderTemplateSteps(draftSteps, idx, idx + 1);
        renderStepsList();
      };

      const skipToggleBtn = btn(
        step._included ? 'Passer' : 'Inclure',
        `small ${step._included ? 'secondary' : 'primary'}`,
        'template-start-toggle-skip'
      );
      skipToggleBtn.setAttribute('aria-label', step._included ? `Passer ${step.activity}` : `Inclure ${step.activity}`);
      skipToggleBtn.disabled = step._included && includedCount <= 1;
      skipToggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (step._included && includedCount <= 1) return;
        step._included = !step._included;
        renderStepsList();
      };

      controls.append(upBtn, downBtn, skipToggleBtn);
      row.append(radio, info, controls);
      stepsList.appendChild(row);
    });

    updateStartButton();
  }

  startBtn.onclick = () => {
    const included = getIncludedSteps();
    if (!included.length) return;
    const startIdx = Math.max(0, included.findIndex(s => s.id === selectedStepId));
    const cleanSteps = included.map(({ _included, _origIdx, ...rest }) => rest);
    onStartWithIndex(template.id, startIdx, cleanSteps);
  };

  renderStepsList();
  body.append(stepsList, footer);

  box.append(head, body);
  overlay.appendChild(box);
  isolateModalEvents(overlay, box, { onBackdropClose: onClose });
  return overlay;
}
