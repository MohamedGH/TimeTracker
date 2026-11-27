import { formatCategoryPath } from '../../core/category-tree.js';
import { formatDuration } from '../../core/statistics.js';
import { isolateModalEvents } from '../../core/modal-events.js';
import { getUsualCategoryForActivity } from '../../core/suggestions-engine.js';
import {
  getDefaultSplitPoint,
  resolveEntryTimeBounds,
  validateEntrySplit,
} from '../../state/entry-actions.js';

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

function collectActivityQuickPicks({ activities = [], entries = [] } = {}) {
  const seen = new Set();
  const picks = [];

  for (const act of (Array.isArray(activities) ? activities : [])) {
    const label = String(act?.label || act?.name || act?.activity || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push({ label, categoryId: act.categoryId ?? act.cat ?? null });
  }

  for (const entry of (Array.isArray(entries) ? entries : [])) {
    const label = String(entry?.activity || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picks.push({ label, categoryId: entry.categoryId ?? null });
  }

  return picks.slice(0, 10);
}

function populateCategorySelect(selectEl, categories, selectedId) {
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'Aucune catégorie';
  selectEl.appendChild(noneOpt);

  for (const c of categories) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = formatCategoryPath(categories, c.id) || c.label;
    selectEl.appendChild(opt);
  }
  selectEl.value = selectedId || '';
}

/**
 * Renders a modal dialog to split a recorded time entry at a new end date/time
 * into two customizable parts:
 * 1) First part [start -> splitDate/splitTime] (editable activity & category)
 * 2) Second part [splitDate/splitTime -> original end] (editable activity & category)
 */
export function renderEntrySplitModal({
  state,
  modal,
  onClose,
  onSplitEntry,
}) {
  const safeEntries = Array.isArray(state?.entries) ? state.entries : [];
  const safeActivities = Array.isArray(state?.activities) ? state.activities : [];
  const safeCategories = Array.isArray(state?.categories) ? state.categories : [];

  const entry = safeEntries.find(e => e?.id === modal?.entryId) || null;
  if (!entry) return document.createDocumentFragment();

  const bounds = resolveEntryTimeBounds(entry);
  const defaults = getDefaultSplitPoint(entry);

  let splitDate = modal?.splitDate || defaults.splitDate || entry.date;
  let splitTime = modal?.splitTime || defaults.splitTime || entry.start;

  let firstActivity = modal?.firstActivity !== undefined ? modal.firstActivity : (entry.activity || '');
  let firstCategoryId = modal?.firstCategoryId !== undefined
    ? modal.firstCategoryId
    : (entry.categoryId ?? null);
  let firstCategoryManuallyChanged = false;

  let secondActivity = modal?.secondActivity || '';
  let secondCategoryId = modal?.secondCategoryId !== undefined
    ? modal.secondCategoryId
    : (entry.categoryId ?? null);
  let secondCategoryManuallyChanged = false;

  let activeTargetPart = 2;
  let createMissingActivity = true;
  let localError = null;

  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal-box entry-split-modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', `Couper l’activité ${entry.activity}`);

  const head = el('div', 'modal-head');
  head.appendChild(el('h2', 'card-title', 'Couper la session'));
  const closeBtn = btn('×', 'modal-close', 'modal-close');
  closeBtn.onclick = onClose;
  head.appendChild(closeBtn);
  box.appendChild(head);

  const form = el('form', 'entry-split-form');

  const originBox = el('div', 'entry-split-origin');
  originBox.appendChild(el('strong', 'entry-split-origin-title', entry.activity));
  const originTimeText = bounds.valid && bounds.endDate !== bounds.startDate
    ? `${bounds.startDate} ${bounds.startTime} → ${bounds.endDate} ${bounds.endTime} (${formatDuration(bounds.totalMins)})`
    : `${entry.date} · ${entry.start}–${entry.end} (${formatDuration(bounds.totalMins || entry.mins)})`;
  originBox.appendChild(el('div', 'muted', originTimeText));
  form.appendChild(originBox);

  const errorBanner = el('div', 'notice error');
  errorBanner.hidden = true;
  form.appendChild(errorBanner);

  // Split date & time inputs
  const dateTimeRow = el('div', 'entry-split-datetime-row');

  const splitDateField = el('div', 'field');
  const splitDateId = 'entry-split-date';
  const splitDateLabel = el('label', null, 'Nouvelle date de fin');
  splitDateLabel.setAttribute('for', splitDateId);
  const splitDateInput = document.createElement('input');
  splitDateInput.type = 'date';
  splitDateInput.id = splitDateId;
  splitDateInput.required = true;
  splitDateInput.value = splitDate;
  splitDateInput.dataset.behaviorField = 'entry-split-date';
  if (bounds.valid) {
    splitDateInput.min = bounds.startDate;
    splitDateInput.max = bounds.endDate;
  }
  splitDateField.append(splitDateLabel, splitDateInput);

  const splitTimeField = el('div', 'field');
  const splitTimeId = 'entry-split-time';
  const splitTimeLabel = el('label', null, 'Nouvelle heure de fin');
  splitTimeLabel.setAttribute('for', splitTimeId);
  const splitTimeInput = document.createElement('input');
  splitTimeInput.type = 'time';
  splitTimeInput.id = splitTimeId;
  splitTimeInput.required = true;
  splitTimeInput.value = splitTime;
  splitTimeInput.dataset.behaviorField = 'entry-split-time';
  splitTimeField.append(splitTimeLabel, splitTimeInput);

  dateTimeRow.append(splitDateField, splitTimeField);
  form.appendChild(dateTimeRow);

  const quickPicks = collectActivityQuickPicks({
    activities: safeActivities,
    entries: safeEntries,
  });

  const datalistId = 'entry-split-activity-options';
  const datalist = document.createElement('datalist');
  datalist.id = datalistId;
  for (const pick of quickPicks) {
    const opt = document.createElement('option');
    opt.value = pick.label;
    datalist.appendChild(opt);
  }
  form.appendChild(datalist);

  // Part 1 editable block
  const part1Group = el('div', 'entry-split-part-group');
  const part1Header = el('div', 'entry-split-part-header', '1ʳᵉ partie');
  const part1Fields = el('div', 'entry-split-part-fields');

  const firstActField = el('div', 'field');
  const firstActId = 'entry-split-first-activity';
  const firstActLabel = el('label', null, 'Activité (1ʳᵉ partie)');
  firstActLabel.setAttribute('for', firstActId);
  const firstActInput = document.createElement('input');
  firstActInput.type = 'text';
  firstActInput.id = firstActId;
  firstActInput.required = true;
  firstActInput.setAttribute('list', datalistId);
  firstActInput.placeholder = 'Libellé de la 1ʳᵉ activité';
  firstActInput.value = firstActivity;
  firstActInput.dataset.behaviorField = 'entry-split-first-label';
  firstActField.append(firstActLabel, firstActInput);

  const firstCatField = el('div', 'field');
  const firstCatId = 'entry-split-first-category';
  const firstCatLabel = el('label', null, 'Catégorie');
  firstCatLabel.setAttribute('for', firstCatId);
  const firstCatSelect = document.createElement('select');
  firstCatSelect.id = firstCatId;
  firstCatSelect.dataset.behaviorField = 'entry-split-first-category';
  populateCategorySelect(firstCatSelect, safeCategories, firstCategoryId);
  firstCatField.append(firstCatLabel, firstCatSelect);

  part1Fields.append(firstActField, firstCatField);
  part1Group.append(part1Header, part1Fields);
  form.appendChild(part1Group);

  // Part 2 editable block
  const part2Group = el('div', 'entry-split-part-group');
  const part2Header = el('div', 'entry-split-part-header', '2ᵉ partie');
  const part2Fields = el('div', 'entry-split-part-fields');

  const secondActField = el('div', 'field');
  const secondActId = 'entry-split-second-activity';
  const secondActLabel = el('label', null, 'Activité (2ᵉ partie)');
  secondActLabel.setAttribute('for', secondActId);
  const secondActInput = document.createElement('input');
  secondActInput.type = 'text';
  secondActInput.id = secondActId;
  secondActInput.required = true;
  secondActInput.setAttribute('list', datalistId);
  secondActInput.placeholder = 'Ex : Repos, Pause, Trajet…';
  secondActInput.value = secondActivity;
  secondActInput.dataset.behaviorField = 'entry-split-label';
  secondActField.append(secondActLabel, secondActInput);

  const secondCatField = el('div', 'field');
  const secondCatId = 'entry-split-second-category';
  const secondCatLabel = el('label', null, 'Catégorie');
  secondCatLabel.setAttribute('for', secondCatId);
  const secondCatSelect = document.createElement('select');
  secondCatSelect.id = secondCatId;
  secondCatSelect.dataset.behaviorField = 'entry-split-category';
  populateCategorySelect(secondCatSelect, safeCategories, secondCategoryId);
  secondCatField.append(secondCatLabel, secondCatSelect);

  part2Fields.append(secondActField, secondCatField);
  part2Group.append(part2Header, part2Fields);
  form.appendChild(part2Group);

  // Quick activity picks (targets whichever part input was focused last, defaulting to part 2)
  if (quickPicks.length) {
    const picksWrap = el('div', 'entry-split-suggestions');
    const picksLabel = el(
      'span',
      'muted entry-split-suggestions-label',
      'Suggestions (remplit la 2ᵉ partie ou le champ actif) :'
    );
    picksWrap.appendChild(picksLabel);
    const picksList = el('div', 'entry-split-suggestions-list');
    for (const pick of quickPicks) {
      const chip = btn(pick.label, 'small secondary', 'entry-split-suggestion');
      chip.onclick = () => {
        if (activeTargetPart === 1) {
          firstActivity = pick.label;
          firstActInput.value = pick.label;
          if (!firstCategoryManuallyChanged && pick.categoryId) {
            firstCategoryId = pick.categoryId;
            firstCatSelect.value = pick.categoryId;
          }
        } else {
          secondActivity = pick.label;
          secondActInput.value = pick.label;
          if (!secondCategoryManuallyChanged && pick.categoryId) {
            secondCategoryId = pick.categoryId;
            secondCatSelect.value = pick.categoryId;
          }
        }
        localError = null;
        updatePreview();
      };
      picksList.appendChild(chip);
    }
    picksWrap.appendChild(picksList);
    form.appendChild(picksWrap);
  }

  // Auto-create saved activities checkbox
  const createLabel = el('label', 'entry-create-activity-label');
  const createCheckbox = document.createElement('input');
  createCheckbox.type = 'checkbox';
  createCheckbox.checked = createMissingActivity;
  createCheckbox.dataset.behaviorField = 'entry-split-create-activity';
  createCheckbox.onchange = () => {
    createMissingActivity = createCheckbox.checked;
  };
  createLabel.append(
    createCheckbox,
    el('span', 'entry-create-activity-text', 'Créer les activités manquantes automatiquement')
  );
  form.appendChild(createLabel);

  // Live 2-part preview
  const previewBox = el('div', 'entry-split-preview');
  previewBox.dataset.entrySplitPreview = 'true';
  form.appendChild(previewBox);

  const actions = el('div', 'modal-actions');
  const cancelBtn = btn('Annuler', 'secondary', 'entry-split-cancel');
  cancelBtn.onclick = onClose;
  const confirmBtn = btn('Couper l’activité', 'primary', 'entry-split-confirm');
  confirmBtn.type = 'submit';
  actions.append(cancelBtn, confirmBtn);
  form.appendChild(actions);

  function renderError() {
    if (localError) {
      errorBanner.hidden = false;
      errorBanner.textContent = localError;
    } else {
      errorBanner.hidden = true;
      errorBanner.textContent = '';
    }
  }

  function updatePreview() {
    renderError();
    previewBox.replaceChildren();

    const previewFirstLabel = firstActivity.trim() || '1ʳᵉ activité';
    const previewSecondLabel = secondActivity.trim() || '2ᵉ activité';
    const check = validateEntrySplit(entry, {
      splitDate,
      splitTime,
      firstActivity: previewFirstLabel,
      secondActivity: previewSecondLabel,
    });

    if (!check.valid) {
      previewBox.appendChild(el('div', 'muted entry-split-preview-error', check.error));
      confirmBtn.disabled = true;
      return;
    }

    confirmBtn.disabled = false;

    const p1 = el('div', 'entry-split-preview-item');
    const p1Range = check.splitDate !== check.startDate
      ? `${check.startDate} ${check.startTime} → ${check.splitDate} ${check.splitTime}`
      : `${check.startTime} → ${check.splitTime}`;
    p1.append(
      el('strong', null, `1. ${firstActivity.trim() || '…'}`),
      el('span', 'muted', `${p1Range} (${formatDuration(check.part1Mins)})`)
    );

    const p2 = el('div', 'entry-split-preview-item');
    const p2Range = check.endDate !== check.splitDate
      ? `${check.splitDate} ${check.splitTime} → ${check.endDate} ${check.endTime}`
      : `${check.splitTime} → ${check.endTime}`;
    p2.append(
      el('strong', null, `2. ${secondActivity.trim() || '…'}`),
      el('span', 'muted', `${p2Range} (${formatDuration(check.part2Mins)})`)
    );

    previewBox.append(p1, p2);
  }

  splitDateInput.oninput = () => {
    splitDate = splitDateInput.value;
    localError = null;
    updatePreview();
  };

  splitTimeInput.oninput = () => {
    splitTime = splitTimeInput.value;
    localError = null;
    updatePreview();
  };

  firstActInput.onfocus = () => {
    activeTargetPart = 1;
  };
  firstActInput.oninput = () => {
    firstActivity = firstActInput.value;
    localError = null;
    const trimmed = firstActivity.trim();
    if (trimmed && !firstCategoryManuallyChanged) {
      const usualCat = getUsualCategoryForActivity(trimmed, safeEntries, safeActivities);
      if (usualCat && safeCategories.some(c => c.id === usualCat)) {
        firstCategoryId = usualCat;
        firstCatSelect.value = usualCat;
      }
    }
    updatePreview();
  };

  firstCatSelect.onchange = () => {
    firstCategoryManuallyChanged = true;
    firstCategoryId = firstCatSelect.value || null;
  };

  secondActInput.onfocus = () => {
    activeTargetPart = 2;
  };
  secondActInput.oninput = () => {
    secondActivity = secondActInput.value;
    localError = null;
    const trimmed = secondActivity.trim();
    if (trimmed && !secondCategoryManuallyChanged) {
      const usualCat = getUsualCategoryForActivity(trimmed, safeEntries, safeActivities);
      if (usualCat && safeCategories.some(c => c.id === usualCat)) {
        secondCategoryId = usualCat;
        secondCatSelect.value = usualCat;
      }
    }
    updatePreview();
  };

  secondCatSelect.onchange = () => {
    secondCategoryManuallyChanged = true;
    secondCategoryId = secondCatSelect.value || null;
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    const check = validateEntrySplit(entry, {
      splitDate,
      splitTime,
      firstActivity,
      secondActivity,
    });
    if (!check.valid) {
      localError = check.error;
      renderError();
      return;
    }

    onSplitEntry?.({
      entryId: entry.id,
      splitDate: check.splitDate,
      splitTime: check.splitTime,
      firstActivity: check.firstActivity,
      firstCategoryId,
      secondActivity: check.secondActivity,
      secondCategoryId,
      createMissingActivity,
    });
  };

  updatePreview();
  box.appendChild(form);
  overlay.appendChild(box);
  isolateModalEvents(overlay, box, { onBackdropClose: onClose });
  queueMicrotask(() => secondActInput.focus());
  return overlay;
}
