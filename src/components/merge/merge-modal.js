import { formatCategoryPath } from '../../core/category-tree.js';
import { createCategoryBadge } from '../../core/category-palette.js';
import { computeCategoryMergeImpact } from '../../state/category-actions.js';
import {
  collectMergeableActivities,
  computeActivityMergeImpact,
} from '../../state/activity-actions.js';
import { isolateModalEvents } from '../../core/modal-events.js';

/**
 * Pure helper to determine initial source and target selections when opening the merge modal.
 */
export function resolveInitialMergeSelection({
  mode = 'categories',
  categories = [],
  activities = [],
  entries = [],
  sourceCategoryId = null,
  targetCategoryId = null,
  sourceActivityKey = null,
  targetActivityKey = null,
} = {}) {
  if (mode === 'activities') {
    const mergeable = collectMergeableActivities({ activities, entries, categories });
    const first = (sourceActivityKey && mergeable.find(a => a.key === sourceActivityKey))
      || mergeable[0]
      || null;
    const second = (targetActivityKey && mergeable.find(a => a.key === targetActivityKey && a.key !== first?.key))
      || mergeable.find(a => a.key !== first?.key)
      || null;
    return {
      mode: 'activities',
      sourceKey: first?.key || '',
      targetKey: second?.key || '',
    };
  }

  const safeCategories = Array.isArray(categories) ? categories : [];
  const firstCat = (sourceCategoryId && safeCategories.find(c => c.id === sourceCategoryId))
    || safeCategories[0]
    || null;
  const secondCat = (targetCategoryId && safeCategories.find(c => c.id === targetCategoryId && c.id !== firstCat?.id))
    || safeCategories.find(c => c.id !== firstCat?.id && c.parentId !== firstCat?.id)
    || safeCategories.find(c => c.id !== firstCat?.id)
    || null;

  return {
    mode: 'categories',
    sourceId: firstCat?.id || '',
    targetId: secondCat?.id || '',
  };
}

/**
 * Renders the mobile-first modal dialog for merging two categories or two activities.
 */
export function renderMergeModal({
  state,
  modal,
  onClose,
  onSwitchMode,
  onSubmitCategoryMerge,
  onSubmitActivityMerge,
}) {
  const mode = modal?.mode === 'activities' ? 'activities' : 'categories';
  const safeCategories = Array.isArray(state?.categories) ? state.categories : [];
  const safeActivities = Array.isArray(state?.activities) ? state.activities : [];
  const safeEntries = Array.isArray(state?.entries) ? state.entries : [];

  const mergeableActivities = collectMergeableActivities({
    activities: safeActivities,
    entries: safeEntries,
    categories: safeCategories,
  });

  let selectedSourceCatId = modal?.sourceCategoryId ?? '';
  let selectedTargetCatId = modal?.targetCategoryId ?? '';
  if (mode === 'categories') {
    const initial = resolveInitialMergeSelection({
      mode: 'categories',
      categories: safeCategories,
      sourceCategoryId: selectedSourceCatId,
      targetCategoryId: selectedTargetCatId,
    });
    if (!selectedSourceCatId || !safeCategories.some(c => c.id === selectedSourceCatId)) {
      selectedSourceCatId = initial.sourceId;
    }
    if (!selectedTargetCatId || !safeCategories.some(c => c.id === selectedTargetCatId)) {
      selectedTargetCatId = initial.targetId;
    }
  }

  let selectedSourceActKey = modal?.sourceActivityKey ?? '';
  let selectedTargetActKey = modal?.targetActivityKey ?? '';
  if (mode === 'activities') {
    const initial = resolveInitialMergeSelection({
      mode: 'activities',
      categories: safeCategories,
      activities: safeActivities,
      entries: safeEntries,
      sourceActivityKey: selectedSourceActKey,
      targetActivityKey: selectedTargetActKey,
    });
    if (!selectedSourceActKey || !mergeableActivities.some(a => a.key === selectedSourceActKey)) {
      selectedSourceActKey = initial.sourceKey;
    }
    if (!selectedTargetActKey || !mergeableActivities.some(a => a.key === selectedTargetActKey)) {
      selectedTargetActKey = initial.targetKey;
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const box = document.createElement('div');
  box.className = 'modal-box merge-modal';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Fusionner des catégories ou activités');

  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = document.createElement('h2');
  title.className = 'card-title';
  title.textContent = mode === 'categories' ? 'Fusionner deux catégories' : 'Fusionner deux activités';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.dataset.behaviorTarget = 'modal-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Fermer');
  closeBtn.onclick = () => onClose?.();

  head.append(title, closeBtn);
  box.appendChild(head);

  // Mode Tabs (Catégories | Activités)
  const tabs = document.createElement('div');
  tabs.className = 'entry-mode-toggle merge-mode-tabs';

  const catTabBtn = document.createElement('button');
  catTabBtn.type = 'button';
  catTabBtn.className = `mode-toggle-btn ${mode === 'categories' ? 'active' : ''}`.trim();
  catTabBtn.dataset.behaviorTarget = 'merge-tab-categories';
  catTabBtn.textContent = 'Catégories';
  catTabBtn.onclick = () => {
    if (mode !== 'categories') onSwitchMode?.('categories');
  };

  const actTabBtn = document.createElement('button');
  actTabBtn.type = 'button';
  actTabBtn.className = `mode-toggle-btn ${mode === 'activities' ? 'active' : ''}`.trim();
  actTabBtn.dataset.behaviorTarget = 'merge-tab-activities';
  actTabBtn.textContent = 'Activités';
  actTabBtn.onclick = () => {
    if (mode !== 'activities') onSwitchMode?.('activities');
  };

  tabs.append(catTabBtn, actTabBtn);
  box.appendChild(tabs);

  const desc = document.createElement('p');
  desc.className = 'muted merge-desc';
  desc.textContent = mode === 'categories'
    ? 'La catégorie source sera supprimée et toutes ses sessions, sous-catégories, activités et tuiles seront transférées vers la catégorie cible.'
    : 'L’activité source sera fusionnée dans l’activité cible : toutes ses sessions, son compteur d’utilisation, le chronomètre actif et les tuiles seront transférés.';
  box.appendChild(desc);

  const availableCount = mode === 'categories' ? safeCategories.length : mergeableActivities.length;
  if (availableCount < 2) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'merge-warning-box';
    emptyNotice.textContent = mode === 'categories'
      ? 'Il faut au moins 2 catégories pour effectuer une fusion.'
      : 'Il faut au moins 2 activités (enregistrées ou issues de vos sessions) pour effectuer une fusion.';
    box.appendChild(emptyNotice);

    const actions = document.createElement('div');
    actions.className = 'action-row modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn secondary';
    cancelBtn.textContent = 'Fermer';
    cancelBtn.onclick = () => onClose?.();
    actions.appendChild(cancelBtn);
    box.appendChild(actions);
    overlay.appendChild(box);
    isolateModalEvents(overlay, box, { onBackdropClose: () => onClose?.() });
    return overlay;
  }

  const form = document.createElement('form');
  form.className = 'merge-form';
  form.dataset.behaviorForm = 'merge-form';

  const sourceField = document.createElement('div');
  sourceField.className = 'field';
  const sourceLabel = document.createElement('label');
  sourceLabel.textContent = mode === 'categories'
    ? 'Catégorie source (sera supprimée)'
    : 'Activité source (sera fusionnée et retirée)';
  const sourceSelect = document.createElement('select');
  sourceSelect.dataset.categorySelectorEnhanced = '1';
  sourceSelect.dataset.behaviorField = 'merge-source';

  const swapRow = document.createElement('div');
  swapRow.className = 'merge-swap-row';
  const swapBtn = document.createElement('button');
  swapBtn.type = 'button';
  swapBtn.className = 'btn small secondary merge-swap-btn';
  swapBtn.dataset.behaviorTarget = 'merge-swap';
  swapBtn.textContent = '⇄ Inverser source et cible';
  swapRow.appendChild(swapBtn);

  const targetField = document.createElement('div');
  targetField.className = 'field';
  const targetLabel = document.createElement('label');
  targetLabel.textContent = mode === 'categories'
    ? 'Catégorie cible (sera conservée)'
    : 'Activité cible (sera conservée)';
  const targetSelect = document.createElement('select');
  targetSelect.dataset.categorySelectorEnhanced = '1';
  targetSelect.dataset.behaviorField = 'merge-target';

  if (mode === 'categories') {
    const entryCounts = new Map();
    for (const e of safeEntries) {
      if (!e?.categoryId) continue;
      entryCounts.set(e.categoryId, (entryCounts.get(e.categoryId) || 0) + 1);
    }

    for (const cat of safeCategories) {
      const path = formatCategoryPath(safeCategories, cat.id);
      const count = entryCounts.get(cat.id) || 0;
      const suffix = count > 0 ? ` (${count} session${count > 1 ? 's' : ''})` : '';

      const sOpt = document.createElement('option');
      sOpt.value = cat.id;
      sOpt.textContent = `${path}${suffix}`;
      sOpt.selected = cat.id === selectedSourceCatId;
      sourceSelect.appendChild(sOpt);

      const tOpt = document.createElement('option');
      tOpt.value = cat.id;
      tOpt.textContent = `${path}${suffix}`;
      tOpt.selected = cat.id === selectedTargetCatId;
      targetSelect.appendChild(tOpt);
    }
  } else {
    for (const item of mergeableActivities) {
      const countSuffix = item.entryCount > 0 ? ` · ${item.entryCount} session${item.entryCount > 1 ? 's' : ''}` : '';
      const labelText = `${item.label} [${item.categoryPath}${countSuffix}]`;

      const sOpt = document.createElement('option');
      sOpt.value = item.key;
      sOpt.textContent = labelText;
      sOpt.selected = item.key === selectedSourceActKey;
      sourceSelect.appendChild(sOpt);

      const tOpt = document.createElement('option');
      tOpt.value = item.key;
      tOpt.textContent = labelText;
      tOpt.selected = item.key === selectedTargetActKey;
      targetSelect.appendChild(tOpt);
    }
  }

  sourceField.append(sourceLabel, sourceSelect);
  targetField.append(targetLabel, targetSelect);
  form.append(sourceField, swapRow, targetField);

  const previewCard = document.createElement('div');
  previewCard.className = 'merge-impact-card';
  previewCard.dataset.mergePreview = 'true';
  form.appendChild(previewCard);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'action-row modal-actions';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'btn primary';
  submitBtn.dataset.behaviorTarget = 'merge-confirm';
  submitBtn.textContent = 'Fusionner définitivement';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn secondary';
  cancelBtn.textContent = 'Annuler';
  cancelBtn.onclick = () => onClose?.();

  actionsRow.append(submitBtn, cancelBtn);
  form.appendChild(actionsRow);

  const activityByKey = new Map(mergeableActivities.map(item => [item.key, item]));

  function renderPreview() {
    previewCard.replaceChildren();

    if (mode === 'categories') {
      const sourceId = sourceSelect.value;
      const targetId = targetSelect.value;
      const impact = computeCategoryMergeImpact(state, { sourceId, targetId });

      if (!impact.valid) {
        const warn = document.createElement('div');
        warn.className = 'merge-warning-box';
        warn.textContent = impact.error;
        previewCard.appendChild(warn);
        submitBtn.disabled = true;
        return;
      }

      submitBtn.disabled = false;
      const visualRow = document.createElement('div');
      visualRow.className = 'merge-preview-flow';
      visualRow.append(
        createCategoryBadge(impact.sourceCategory, safeCategories, { showPath: true, size: 'small' }),
        Object.assign(document.createElement('span'), { className: 'merge-arrow', textContent: '→' }),
        createCategoryBadge(impact.targetCategory, safeCategories, { showPath: true, size: 'small' })
      );
      previewCard.appendChild(visualRow);

      const list = document.createElement('ul');
      list.className = 'merge-impact-list';
      const items = [
        `${impact.entriesCount} session${impact.entriesCount > 1 ? 's' : ''} transférée${impact.entriesCount > 1 ? 's' : ''}`,
        `${impact.savedActivitiesCount} activité${impact.savedActivitiesCount > 1 ? 's' : ''} enregistrée${impact.savedActivitiesCount > 1 ? 's' : ''} déplacée${impact.savedActivitiesCount > 1 ? 's' : ''}`
          + (impact.deduplicatedActivitiesCount > 0 ? ` (${impact.deduplicatedActivitiesCount} doublon${impact.deduplicatedActivitiesCount > 1 ? 's' : ''} fusionné${impact.deduplicatedActivitiesCount > 1 ? 's' : ''})` : ''),
      ];
      if (impact.childCategoriesCount > 0) {
        items.push(`${impact.childCategoriesCount} sous-catégorie${impact.childCategoriesCount > 1 ? 's' : ''} rattachée${impact.childCategoriesCount > 1 ? 's' : ''} à la cible`);
      }
      if (impact.affectsActiveTimer) {
        items.push('Chronomètre actif mis à jour vers la catégorie cible');
      }
      if (impact.quickTilesCount > 0) {
        items.push(`${impact.quickTilesCount} tuile${impact.quickTilesCount > 1 ? 's' : ''} Android mise${impact.quickTilesCount > 1 ? 's' : ''} à jour`);
      }
      for (const text of items) {
        const li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
      }
      previewCard.appendChild(list);
      return;
    }

    const srcItem = activityByKey.get(sourceSelect.value) || null;
    const dstItem = activityByKey.get(targetSelect.value) || null;
    const impact = computeActivityMergeImpact(state, { source: srcItem, target: dstItem });

    if (!impact.valid) {
      const warn = document.createElement('div');
      warn.className = 'merge-warning-box';
      warn.textContent = impact.error;
      previewCard.appendChild(warn);
      submitBtn.disabled = true;
      return;
    }

    submitBtn.disabled = false;
    const visualRow = document.createElement('div');
    visualRow.className = 'merge-preview-flow';
    const srcSpan = document.createElement('strong');
    srcSpan.textContent = impact.source.label;
    const arrow = document.createElement('span');
    arrow.className = 'merge-arrow';
    arrow.textContent = '→';
    const dstSpan = document.createElement('strong');
    dstSpan.textContent = impact.target.label;
    visualRow.append(srcSpan, arrow, dstSpan);
    previewCard.appendChild(visualRow);

    const list = document.createElement('ul');
    list.className = 'merge-impact-list';
    const items = [
      `${impact.entriesCount} session${impact.entriesCount > 1 ? 's' : ''} renommée${impact.entriesCount > 1 ? 's' : ''} et déplacée${impact.entriesCount > 1 ? 's' : ''}`,
    ];
    if (impact.savedActivitiesMerged > 0) {
      items.push('Raccourcis et statistiques d’utilisation combinés');
    }
    if (impact.affectsActiveTimer) {
      items.push('Chronomètre actif mis à jour vers l’activité cible');
    }
    if (impact.quickTilesCount > 0) {
      items.push(`${impact.quickTilesCount} tuile${impact.quickTilesCount > 1 ? 's' : ''} Android mise${impact.quickTilesCount > 1 ? 's' : ''} à jour`);
    }
    for (const text of items) {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    }
    previewCard.appendChild(list);
  }

  sourceSelect.addEventListener('change', () => {
    if (mode === 'categories') {
      modal.sourceCategoryId = sourceSelect.value;
    } else {
      modal.sourceActivityKey = sourceSelect.value;
    }
    renderPreview();
  });

  targetSelect.addEventListener('change', () => {
    if (mode === 'categories') {
      modal.targetCategoryId = targetSelect.value;
    } else {
      modal.targetActivityKey = targetSelect.value;
    }
    renderPreview();
  });

  swapBtn.onclick = () => {
    const prevSource = sourceSelect.value;
    const prevTarget = targetSelect.value;
    sourceSelect.value = prevTarget;
    targetSelect.value = prevSource;
    if (mode === 'categories') {
      modal.sourceCategoryId = sourceSelect.value;
      modal.targetCategoryId = targetSelect.value;
    } else {
      modal.sourceActivityKey = sourceSelect.value;
      modal.targetActivityKey = targetSelect.value;
    }
    renderPreview();
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (mode === 'categories') {
      await onSubmitCategoryMerge?.({
        sourceId: sourceSelect.value,
        targetId: targetSelect.value,
      });
    } else {
      const srcItem = activityByKey.get(sourceSelect.value) || null;
      const dstItem = activityByKey.get(targetSelect.value) || null;
      await onSubmitActivityMerge?.({
        source: srcItem,
        target: dstItem,
      });
    }
  };

  renderPreview();
  box.appendChild(form);
  overlay.appendChild(box);
  isolateModalEvents(overlay, box, { onBackdropClose: () => onClose?.() });
  return overlay;
}
