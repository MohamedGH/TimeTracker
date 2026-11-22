import { formatCategoryPath } from '../../core/category-tree.js';
import { formatDuration } from '../../core/statistics.js';
import { today } from '../../core/time.js';
import { isolateModalEvents } from '../../core/modal-events.js';
import { getUsualCategoryForActivity } from '../../core/suggestions-engine.js';
import {
  buildEntriesFromTemplate,
  buildTemplateFromEntries,
  collectEntrySequencesByDate,
  detectRecurringSequences,
  reorderTemplateSteps,
  validateActivityTemplate,
} from '../../state/template-actions.js';

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

function createDraftStep(overrides = {}) {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    activity: '',
    categoryId: null,
    targetMins: null,
    ...overrides,
  };
}

function collectQuickActivityPicks({ activities = [], entries = [] } = {}) {
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

/**
 * Renders the mobile-first Activity Sequence Template creator / editor modal.
 * Supports both Manual step building and Extraction from recorded history entries.
 */
export function renderTemplateEditorModal({
  state,
  modal,
  onClose,
  onSaveTemplate,
}) {
  const safeCategories = Array.isArray(state?.categories) ? state.categories : [];
  const safeActivities = Array.isArray(state?.activities) ? state.activities : [];
  const safeEntries = Array.isArray(state?.entries) ? state.entries : [];
  const existingTemplates = Array.isArray(state?.activityTemplates) ? state.activityTemplates : [];
  const editingTemplate = modal?.templateId
    ? existingTemplates.find(t => t.id === modal.templateId) || null
    : null;

  const isEdit = Boolean(editingTemplate);
  const daySequences = collectEntrySequencesByDate(safeEntries, { minSteps: 1 });
  const recurringSequences = detectRecurringSequences(safeEntries, {
    minLength: 2,
    maxLength: 5,
    minOccurrences: 2,
  });

  const defaultDay = daySequences.find(d => d.entries.length >= 2) || daySequences[0] || null;
  let activeTab = modal?.sourceMode === 'history' && !isEdit ? 'history' : 'manual';
  let selectedHistoryDate = defaultDay?.date || '';
  let selectedEntryIds = new Set(defaultDay ? defaultDay.entries.map(e => e.id) : []);
  let includeHistoryDurations = true;
  let collapseDuplicates = false;
  let localError = null;

  const initialSteps = editingTemplate?.steps?.length
    ? editingTemplate.steps.map(step => createDraftStep({
        id: step.id,
        activity: step.activity,
        categoryId: step.categoryId ?? null,
        targetMins: step.targetMins ?? null,
      }))
    : [
        createDraftStep({ categoryId: safeCategories[0]?.id || null }),
        createDraftStep({ categoryId: safeCategories[0]?.id || null }),
      ];

  const draft = {
    id: editingTemplate?.id || null,
    name: editingTemplate?.name || '',
    steps: initialSteps,
    fromHistory: false,
  };

  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal-box template-editor-modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const modalTitleText = isEdit ? 'Modifier le gabarit' : 'Nouveau gabarit d’activité';
  box.setAttribute('aria-label', modalTitleText);

  const head = el('div', 'modal-head');
  const title = el('h2', 'card-title', modalTitleText);
  const closeBtn = btn('×', 'modal-close', 'modal-close');
  closeBtn.setAttribute('aria-label', 'Fermer');
  closeBtn.onclick = onClose;
  head.append(title, closeBtn);

  const body = el('div', 'template-modal-body');

  function renderBody() {
    body.replaceChildren();

    const desc = el(
      'p',
      'muted template-modal-desc',
      'Enchaînez plusieurs activités ou chronos dans l’ordre (ex : Mosquée trajet → Mosquée prière → Doha).'
    );
    body.appendChild(desc);

    if (!isEdit) {
      const modeTabs = el('div', 'entry-mode-toggle template-mode-tabs');
      modeTabs.setAttribute('role', 'tablist');

      const manualTab = btn('Création manuelle', `mode-toggle-btn ${activeTab === 'manual' ? 'active' : ''}`, 'template-tab-manual');
      manualTab.setAttribute('role', 'tab');
      manualTab.setAttribute('aria-selected', String(activeTab === 'manual'));
      manualTab.onclick = () => {
        activeTab = 'manual';
        localError = null;
        renderBody();
      };

      const historyTab = btn('Depuis les données enregistrées', `mode-toggle-btn ${activeTab === 'history' ? 'active' : ''}`, 'template-tab-history');
      historyTab.setAttribute('role', 'tab');
      historyTab.setAttribute('aria-selected', String(activeTab === 'history'));
      historyTab.onclick = () => {
        activeTab = 'history';
        localError = null;
        renderBody();
      };

      modeTabs.append(manualTab, historyTab);
      body.appendChild(modeTabs);
    }

    if (localError) {
      const errBox = el('div', 'template-error-banner', localError);
      errBox.dataset.templateError = '1';
      errBox.setAttribute('role', 'alert');
      body.appendChild(errBox);
    }

    if (activeTab === 'history') {
      renderHistoryExtractor(body);
    } else {
      renderManualBuilder(body);
    }
  }

  function renderManualBuilder(container) {
    const form = el('form', 'template-editor-form');
    form.dataset.behaviorForm = 'template-form';

    const nameField = el('div', 'field');
    nameField.appendChild(el('label', null, 'Nom du gabarit'));
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Ex : Mosquée (trajet → prière → doha)';
    nameInput.value = draft.name;
    nameInput.required = true;
    nameInput.dataset.templateField = 'name';
    nameInput.oninput = () => {
      draft.name = nameInput.value;
      localError = null;
    };
    nameField.appendChild(nameInput);
    form.appendChild(nameField);

    const stepsHeader = el('div', 'template-steps-header');
    stepsHeader.appendChild(el('span', 'template-steps-title', `Étapes dans l’ordre (${draft.steps.length})`));
    const addStepBtn = btn('+ Ajouter une étape', 'small secondary', 'template-add-step');
    addStepBtn.onclick = () => {
      draft.steps = [...draft.steps, createDraftStep({ categoryId: safeCategories[0]?.id || null })];
      localError = null;
      renderBody();
    };
    stepsHeader.appendChild(addStepBtn);
    form.appendChild(stepsHeader);

    const stepsList = el('div', 'template-steps-editor-list');
    stepsList.dataset.templateSteps = '1';

    draft.steps.forEach((step, idx) => {
      const row = el('div', 'template-step-editor-row');
      row.dataset.templateStepIndex = String(idx);

      const topBar = el('div', 'template-step-row-top');
      topBar.appendChild(el('span', 'template-step-badge', `${idx + 1}`));

      const actInput = document.createElement('input');
      actInput.type = 'text';
      actInput.className = 'template-step-activity-input';
      actInput.placeholder = `Activité étape ${idx + 1}`;
      actInput.value = step.activity;
      actInput.dataset.templateStepActivity = String(idx);
      actInput.oninput = () => {
        step.activity = actInput.value;
        localError = null;
        const trimmed = actInput.value.trim();
        if (trimmed) {
          const usualCat = getUsualCategoryForActivity(trimmed, safeEntries, safeActivities);
          if (usualCat && catSelect.value !== usualCat && !step._categoryManuallySet) {
            step.categoryId = usualCat;
            catSelect.value = usualCat;
          }
        }
        updatePreviewLine();
      };

      const controls = el('div', 'template-step-row-controls');
      const upBtn = btn('↑', 'small secondary template-step-move-btn', 'template-step-up');
      upBtn.setAttribute('aria-label', `Monter l’étape ${idx + 1}`);
      upBtn.disabled = idx === 0;
      upBtn.onclick = () => {
        draft.steps = reorderTemplateSteps(draft.steps, idx, idx - 1);
        renderBody();
      };

      const downBtn = btn('↓', 'small secondary template-step-move-btn', 'template-step-down');
      downBtn.setAttribute('aria-label', `Descendre l’étape ${idx + 1}`);
      downBtn.disabled = idx === draft.steps.length - 1;
      downBtn.onclick = () => {
        draft.steps = reorderTemplateSteps(draft.steps, idx, idx + 1);
        renderBody();
      };

      const removeBtn = btn('×', 'small danger template-step-remove-btn', 'template-step-remove');
      removeBtn.setAttribute('aria-label', `Supprimer l’étape ${idx + 1}`);
      removeBtn.disabled = draft.steps.length <= 1;
      removeBtn.onclick = () => {
        if (draft.steps.length <= 1) return;
        draft.steps = draft.steps.filter((_, i) => i !== idx);
        renderBody();
      };

      controls.append(upBtn, downBtn, removeBtn);
      topBar.append(actInput, controls);

      const bottomBar = el('div', 'template-step-row-bottom');
      const catSelect = document.createElement('select');
      catSelect.className = 'template-step-category-select';
      catSelect.dataset.categorySelectorEnhanced = '1';
      catSelect.dataset.templateStepCategory = String(idx);
      catSelect.setAttribute('aria-label', `Catégorie étape ${idx + 1}`);

      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = 'Sans catégorie';
      emptyOpt.selected = !step.categoryId;
      catSelect.appendChild(emptyOpt);

      for (const cat of safeCategories) {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = formatCategoryPath(safeCategories, cat.id);
        opt.selected = cat.id === step.categoryId;
        catSelect.appendChild(opt);
      }

      catSelect.onchange = () => {
        step.categoryId = catSelect.value || null;
        step._categoryManuallySet = true;
      };

      const minsWrap = el('div', 'template-step-mins-wrap');
      const minsInput = document.createElement('input');
      minsInput.type = 'number';
      minsInput.min = '1';
      minsInput.max = '1440';
      minsInput.className = 'template-step-mins-input';
      minsInput.placeholder = 'Durée';
      minsInput.value = step.targetMins ? String(step.targetMins) : '';
      minsInput.dataset.templateStepMins = String(idx);
      minsInput.setAttribute('aria-label', `Durée estimée en minutes pour l’étape ${idx + 1}`);
      minsInput.oninput = () => {
        const parsed = Number(minsInput.value);
        step.targetMins = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
      };
      minsWrap.append(minsInput, el('span', 'template-step-mins-unit', 'min'));

      bottomBar.append(catSelect, minsWrap);
      row.append(topBar, bottomBar);
      stepsList.appendChild(row);
    });

    form.appendChild(stepsList);

    const picks = collectQuickActivityPicks({ activities: safeActivities, entries: safeEntries });
    if (picks.length) {
      const picksSection = el('div', 'template-quick-picks');
      picksSection.appendChild(el('span', 'template-quick-picks-label', 'Ajout rapide depuis vos activités :'));
      const chipsWrap = el('div', 'template-quick-picks-list');
      for (const pick of picks) {
        const chip = btn(`+ ${pick.label}`, 'small secondary template-quick-pick-btn', 'template-quick-pick');
        chip.onclick = () => {
          const emptyIdx = draft.steps.findIndex(s => !String(s.activity || '').trim());
          if (emptyIdx >= 0) {
            draft.steps[emptyIdx].activity = pick.label;
            draft.steps[emptyIdx].categoryId = pick.categoryId ?? draft.steps[emptyIdx].categoryId;
          } else {
            draft.steps = [
              ...draft.steps,
              createDraftStep({ activity: pick.label, categoryId: pick.categoryId }),
            ];
          }
          renderBody();
        };
        chipsWrap.appendChild(chip);
      }
      picksSection.appendChild(chipsWrap);
      form.appendChild(picksSection);
    }

    const previewLine = el('div', 'template-draft-preview');
    function updatePreviewLine() {
      const names = draft.steps
        .map(s => String(s.activity || '').trim())
        .filter(Boolean);
      previewLine.textContent = names.length
        ? `Suite : ${names.join(' → ')}`
        : 'Saisissez vos étapes pour prévisualiser l’enchaînement.';
    }
    updatePreviewLine();
    form.appendChild(previewLine);

    const footer = el('div', 'action-row template-modal-footer');
    const cancelBtn = btn('Annuler', 'secondary', 'template-cancel');
    cancelBtn.onclick = onClose;
    const saveBtn = btn(
      isEdit ? 'Enregistrer les modifications' : 'Enregistrer le gabarit',
      'primary',
      'template-save'
    );
    saveBtn.type = 'submit';
    footer.append(cancelBtn, saveBtn);
    form.appendChild(footer);

    form.onsubmit = async (e) => {
      e.preventDefault();
      const validation = validateActivityTemplate({
        name: draft.name,
        steps: draft.steps,
      });
      if (!validation.valid) {
        localError = validation.error;
        renderBody();
        return;
      }

      await onSaveTemplate({
        id: draft.id,
        name: validation.normalizedName,
        steps: validation.normalizedSteps,
        fromHistory: draft.fromHistory,
        isEdit,
      });
    };

    container.appendChild(form);
  }

  function renderHistoryExtractor(container) {
    if (!daySequences.length) {
      const emptyBox = el('div', 'template-history-empty');
      emptyBox.append(
        el('p', 'muted', 'Aucune session enregistrée pour le moment. Enregistrez quelques activités ou créez votre gabarit manuellement.'),
        btn('Passer à la création manuelle', 'secondary', 'template-switch-manual')
      );
      emptyBox.querySelector('button').onclick = () => {
        activeTab = 'manual';
        renderBody();
      };
      container.appendChild(emptyBox);
      return;
    }

    if (recurringSequences.length) {
      const recSection = el('div', 'template-recurring-section');
      recSection.appendChild(el('h3', 'template-subsection-title', 'Suites fréquentes détectées'));

      const recList = el('div', 'template-recurring-list');
      for (const candidate of recurringSequences) {
        const card = el('div', 'template-recurring-card');
        const info = el('div', 'template-recurring-info');
        info.appendChild(el('strong', 'template-recurring-flow', candidate.suggestedName));
        const metaText = `${candidate.occurrences}× détectée · ${candidate.steps.length} étapes${candidate.totalAvgMins > 0 ? ` · ~${formatDuration(candidate.totalAvgMins)}` : ''}`;
        info.appendChild(el('span', 'muted template-recurring-meta', metaText));

        const useBtn = btn('Utiliser cette suite', 'small primary', 'template-load-recurring');
        useBtn.onclick = () => {
          if (!String(draft.name || '').trim() || draft.fromHistory) {
            draft.name = candidate.suggestedName;
          }
          draft.steps = candidate.steps.map(step => createDraftStep({
            activity: step.activity,
            categoryId: step.categoryId,
            targetMins: step.targetMins,
          }));
          draft.fromHistory = true;
          activeTab = 'manual';
          localError = null;
          renderBody();
        };

        card.append(info, useBtn);
        recList.appendChild(card);
      }
      recSection.appendChild(recList);
      container.appendChild(recSection);
    }

    const daySection = el('div', 'template-history-day-section');
    daySection.appendChild(el('h3', 'template-subsection-title', 'Extraire depuis une journée enregistrée'));

    const dayField = el('div', 'field');
    dayField.appendChild(el('label', null, 'Journée source (ordre chronologique)'));
    const daySelect = document.createElement('select');
    daySelect.dataset.categorySelectorEnhanced = '1';
    daySelect.dataset.templateHistoryDate = '1';

    for (const day of daySequences) {
      const opt = document.createElement('option');
      opt.value = day.date;
      opt.textContent = `${day.date} — ${day.entries.length} session${day.entries.length > 1 ? 's' : ''} (${formatDuration(day.totalMins)})`;
      opt.selected = day.date === selectedHistoryDate;
      daySelect.appendChild(opt);
    }

    daySelect.onchange = () => {
      selectedHistoryDate = daySelect.value;
      const chosen = daySequences.find(d => d.date === selectedHistoryDate);
      selectedEntryIds = new Set(chosen ? chosen.entries.map(e => e.id) : []);
      localError = null;
      renderBody();
    };
    dayField.appendChild(daySelect);
    daySection.appendChild(dayField);

    const activeDay = daySequences.find(d => d.date === selectedHistoryDate) || daySequences[0];
    if (activeDay) {
      const bulkRow = el('div', 'template-history-bulk-row');
      const selectAllBtn = btn('Tout cocher', 'small secondary', 'template-history-select-all');
      selectAllBtn.onclick = () => {
        selectedEntryIds = new Set(activeDay.entries.map(e => e.id));
        renderBody();
      };
      const selectNoneBtn = btn('Tout décocher', 'small secondary', 'template-history-select-none');
      selectNoneBtn.onclick = () => {
        selectedEntryIds = new Set();
        renderBody();
      };
      bulkRow.append(selectAllBtn, selectNoneBtn);
      daySection.appendChild(bulkRow);

      const entriesList = el('div', 'template-history-entries-list');
      for (const entry of activeDay.entries) {
        const itemLabel = el('label', 'template-history-entry-item');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedEntryIds.has(entry.id);
        checkbox.dataset.templateHistoryEntryId = entry.id;
        checkbox.onchange = () => {
          if (checkbox.checked) selectedEntryIds.add(entry.id);
          else selectedEntryIds.delete(entry.id);
          updateExtractButtonState();
        };

        const content = el('div', 'template-history-entry-content');
        content.appendChild(el('strong', null, entry.activity));
        const catPath = entry.categoryId ? formatCategoryPath(safeCategories, entry.categoryId) : 'Sans catégorie';
        content.appendChild(el(
          'span',
          'muted template-history-entry-meta',
          `${entry.start}–${entry.end} · ${catPath} · ${formatDuration(entry.mins)}`
        ));

        itemLabel.append(checkbox, content);
        entriesList.appendChild(itemLabel);
      }
      daySection.appendChild(entriesList);

      const optionsWrap = el('div', 'template-history-options');
      const durLabel = el('label', 'template-history-option-toggle');
      const durCheck = document.createElement('input');
      durCheck.type = 'checkbox';
      durCheck.checked = includeHistoryDurations;
      durCheck.onchange = () => { includeHistoryDurations = durCheck.checked; };
      durLabel.append(durCheck, el('span', null, 'Conserver la durée de chaque session comme estimation'));

      const collapseLabel = el('label', 'template-history-option-toggle');
      const collapseCheck = document.createElement('input');
      collapseCheck.type = 'checkbox';
      collapseCheck.checked = collapseDuplicates;
      collapseCheck.onchange = () => { collapseDuplicates = collapseCheck.checked; };
      collapseLabel.append(collapseCheck, el('span', null, 'Regrouper les activités identiques consécutives'));

      optionsWrap.append(durLabel, collapseLabel);
      daySection.appendChild(optionsWrap);

      const footer = el('div', 'action-row template-modal-footer');
      const cancelBtn = btn('Annuler', 'secondary', 'template-cancel');
      cancelBtn.onclick = onClose;

      const extractBtn = btn('', 'primary', 'template-load-from-entries');
      function updateExtractButtonState() {
        const count = activeDay.entries.filter(e => selectedEntryIds.has(e.id)).length;
        extractBtn.disabled = count === 0;
        extractBtn.textContent = count > 0
          ? `Charger ces ${count} étape${count > 1 ? 's' : ''} dans le gabarit`
          : 'Sélectionnez au moins 1 session';
      }
      updateExtractButtonState();

      extractBtn.onclick = () => {
        const chosenEntries = activeDay.entries.filter(e => selectedEntryIds.has(e.id));
        if (!chosenEntries.length) {
          localError = 'Sélectionnez au moins une session enregistrée.';
          renderBody();
          return;
        }
        const built = buildTemplateFromEntries({
          name: draft.fromHistory ? '' : draft.name,
          entries: chosenEntries,
          categories: safeCategories,
          collapseConsecutiveDuplicates: collapseDuplicates,
          includeDurations: includeHistoryDurations,
        });
        draft.name = built.name;
        draft.steps = built.steps.map(step => createDraftStep(step));
        draft.fromHistory = true;
        activeTab = 'manual';
        localError = null;
        renderBody();
      };

      footer.append(cancelBtn, extractBtn);
      daySection.appendChild(footer);
    }

    container.appendChild(daySection);
  }

  renderBody();
  box.append(head, body);
  overlay.appendChild(box);
  isolateModalEvents(overlay, box, { onBackdropClose: onClose });
  return overlay;
}

/**
 * Renders the modal to manually log a saved template as consecutive chronological entries
 * (useful when recording a completed sequence retroactively without live timers).
 */
export function renderTemplateManualLogModal({
  state,
  modal,
  onClose,
  onSubmitManualLog,
}) {
  const templates = Array.isArray(state?.activityTemplates) ? state.activityTemplates : [];
  const template = templates.find(t => t.id === modal?.templateId);
  if (!template) return document.createDocumentFragment();

  let selectedDate = modal?.date || today();
  const now = new Date();
  const fallbackClock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let selectedStartTime = modal?.startTime || fallbackClock;
  let fallbackMins = 15;
  let localError = null;

  const overlay = el('div', 'modal-overlay');
  const box = el('div', 'modal-box template-manual-log-modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', `Enregistrer « ${template.name} »`);

  const head = el('div', 'modal-head');
  head.appendChild(el('h2', 'card-title', `Enregistrer : ${template.name}`));
  const closeBtn = btn('×', 'modal-close', 'modal-close');
  closeBtn.onclick = onClose;
  head.appendChild(closeBtn);

  const form = el('form', 'template-manual-log-form');
  form.dataset.behaviorForm = 'template-manual-log-form';

  const errorContainer = el('div');
  const previewContainer = el('div', 'template-manual-preview-list');

  const row = el('div', 'row');
  const dateWrap = el('div', 'field');
  dateWrap.appendChild(el('label', null, 'Date'));
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = selectedDate;
  dateInput.required = true;
  dateInput.dataset.templateLogField = 'date';
  dateWrap.appendChild(dateInput);

  const timeWrap = el('div', 'field');
  timeWrap.appendChild(el('label', null, 'Heure de début'));
  const timeInput = document.createElement('input');
  timeInput.type = 'time';
  timeInput.value = selectedStartTime;
  timeInput.required = true;
  timeInput.dataset.templateLogField = 'start';
  timeWrap.appendChild(timeInput);

  const durWrap = el('div', 'field');
  durWrap.appendChild(el('label', null, 'Durée par défaut (min)'));
  const durInput = document.createElement('input');
  durInput.type = 'number';
  durInput.min = '1';
  durInput.max = '480';
  durInput.value = String(fallbackMins);
  durInput.required = true;
  durInput.dataset.templateLogField = 'fallbackMins';
  durWrap.appendChild(durInput);

  row.append(dateWrap, timeWrap, durWrap);

  function refreshPreview() {
    errorContainer.replaceChildren();
    previewContainer.replaceChildren();
    if (localError) {
      const errBox = el('div', 'template-error-banner', localError);
      errBox.dataset.templateError = '1';
      errorContainer.appendChild(errBox);
    }

    try {
      const entries = buildEntriesFromTemplate(template, {
        date: dateInput.value,
        startTime: timeInput.value,
        fallbackMins: Number(durInput.value) || 15,
      });
      for (const entry of entries) {
        const line = el('div', 'template-manual-preview-row');
        line.append(
          el('span', 'template-manual-preview-time', `${entry.start}–${entry.end}`),
          el('strong', null, entry.activity),
          el('span', 'muted', formatDuration(entry.mins))
        );
        previewContainer.appendChild(line);
      }
    } catch (err) {
      previewContainer.appendChild(el('p', 'muted', err.message));
    }
  }

  dateInput.oninput = () => { selectedDate = dateInput.value; localError = null; refreshPreview(); };
  timeInput.oninput = () => { selectedStartTime = timeInput.value; localError = null; refreshPreview(); };
  durInput.oninput = () => { fallbackMins = Number(durInput.value) || 15; localError = null; refreshPreview(); };

  const footer = el('div', 'action-row template-modal-footer');
  const cancelBtn = btn('Annuler', 'secondary', 'template-manual-log-cancel');
  cancelBtn.onclick = onClose;
  const submitBtn = btn(
    `Enregistrer ${template.steps.length} étape${template.steps.length > 1 ? 's' : ''}`,
    'primary',
    'template-manual-log-submit'
  );
  submitBtn.type = 'submit';
  footer.append(cancelBtn, submitBtn);

  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await onSubmitManualLog({
        template,
        date: dateInput.value,
        startTime: timeInput.value,
        fallbackMins: Number(durInput.value) || 15,
      });
    } catch (err) {
      localError = err.message;
      refreshPreview();
    }
  };

  refreshPreview();
  form.append(
    el('p', 'muted template-modal-desc', 'Enregistrez toutes les étapes du gabarit à la suite sans lancer de chronomètre.'),
    errorContainer,
    row,
    previewContainer,
    footer
  );
  box.append(head, form);
  overlay.appendChild(box);
  isolateModalEvents(overlay, box, { onBackdropClose: onClose });
  return overlay;
}
