/**
 * Pure functional domain module for Activity Sequence Templates ("Gabarits d'activité").
 * Supports manual creation, extraction from recorded time entries, and sequential timer execution.
 */

import { createTimeEntry } from '../core/time-entry.js';

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function generateId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function addMinutesToTime(hhmm, offsetMins) {
  const match = String(hhmm || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return { time: '00:00', overflowed: false };
  const base = Number(match[1]) * 60 + Number(match[2]);
  const total = Math.max(0, base + Math.max(0, Math.round(Number(offsetMins) || 0)));
  if (total >= 24 * 60) {
    const wrapped = total % (24 * 60);
    return {
      time: `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`,
      overflowed: true,
    };
  }
  return {
    time: `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
    overflowed: false,
  };
}

/**
 * Normalizes a single template step into canonical form.
 * Pure function.
 */
export function normalizeTemplateStep(step = {}, categories = []) {
  const activity = String(step?.activity ?? step?.label ?? '').trim();
  const rawCategoryId = step?.categoryId ?? step?.cat ?? null;
  const hasCategories = Array.isArray(categories) && categories.length > 0;
  const categoryIds = hasCategories ? new Set(categories.map(c => c.id)) : null;
  const categoryId = rawCategoryId && (!categoryIds || categoryIds.has(rawCategoryId))
    ? String(rawCategoryId)
    : null;
  const parsedMins = Number(step?.targetMins ?? step?.mins);
  const targetMins = Number.isFinite(parsedMins) && parsedMins > 0
    ? Math.round(parsedMins)
    : null;

  return {
    id: typeof step?.id === 'string' && step.id ? step.id : generateId(),
    activity,
    categoryId,
    targetMins,
  };
}

/**
 * Normalizes a complete activity template. Returns null if invalid.
 * Pure function.
 */
export function normalizeActivityTemplate(raw, categories = []) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
  const name = String(raw.name || '').trim();
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const steps = rawSteps
    .map(step => normalizeTemplateStep(step, categories))
    .filter(step => Boolean(step.activity));

  if (!id || !name || !steps.length) return null;

  const useCount = Number.isFinite(Number(raw.useCount)) ? Math.max(0, Math.round(Number(raw.useCount))) : 0;
  const updatedAt = Number.isFinite(Number(raw.updatedAt)) && Number(raw.updatedAt) > 0
    ? Number(raw.updatedAt)
    : Date.now();

  return {
    id,
    name,
    steps,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date(updatedAt).toISOString(),
    updatedAt,
    useCount,
    lastUsedAt: typeof raw.lastUsedAt === 'string' && raw.lastUsedAt ? raw.lastUsedAt : null,
  };
}

/**
 * Normalizes an array of persisted templates.
 * Pure function.
 */
export function normalizeTemplatesList(list = [], categories = []) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const normalized = normalizeActivityTemplate(item, categories);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out;
}

/**
 * Normalizes an active template run session.
 * Pure function.
 */
export function normalizeActiveTemplateRun(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const templateId = typeof raw.templateId === 'string' && raw.templateId ? raw.templateId : null;
  const templateName = String(raw.templateName || '').trim();
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .map(step => normalizeTemplateStep(step))
    .filter(step => Boolean(step.activity));
  if (!templateId || !templateName || !steps.length) return null;

  const rawIndex = Number(raw.currentIndex);
  const currentIndex = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < steps.length
    ? rawIndex
    : 0;
  const stepState = raw.stepState === 'ready' ? 'ready' : 'running';
  const completedEntriesCount = Number.isFinite(Number(raw.completedEntriesCount))
    ? Math.max(0, Math.round(Number(raw.completedEntriesCount)))
    : currentIndex;

  return {
    templateId,
    templateName,
    currentIndex,
    steps,
    startedAt: typeof raw.startedAt === 'string' && raw.startedAt ? raw.startedAt : new Date().toISOString(),
    stepState,
    completedEntriesCount,
  };
}

/**
 * Validates template draft fields before saving.
 * Pure function: ({ name, steps }) -> { valid, error, normalizedName, normalizedSteps }
 */
export function validateActivityTemplate({ name = '', steps = [] } = {}) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    return {
      valid: false,
      error: 'Veuillez donner un nom au gabarit.',
      normalizedName: '',
      normalizedSteps: [],
    };
  }

  const rawSteps = Array.isArray(steps) ? steps : [];
  if (!rawSteps.length) {
    return {
      valid: false,
      error: 'Ajoutez au moins une étape au gabarit.',
      normalizedName,
      normalizedSteps: [],
    };
  }

  const normalizedSteps = [];
  for (const step of rawSteps) {
    const normalized = normalizeTemplateStep(step);
    if (!normalized.activity) {
      return {
        valid: false,
        error: 'Chaque étape du gabarit doit contenir un nom d’activité.',
        normalizedName,
        normalizedSteps: [],
      };
    }
    normalizedSteps.push(normalized);
  }

  return {
    valid: true,
    error: null,
    normalizedName,
    normalizedSteps,
  };
}

/**
 * Reorders a step inside a step list without mutating the source array.
 * Pure function.
 */
export function reorderTemplateSteps(steps = [], fromIndex, toIndex) {
  const list = Array.isArray(steps) ? [...steps] : [];
  if (
    fromIndex < 0
    || toIndex < 0
    || fromIndex >= list.length
    || toIndex >= list.length
    || fromIndex === toIndex
  ) {
    return list;
  }
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  return list;
}

/**
 * Creates or updates a template in an array of templates.
 * Pure function.
 */
export function saveActivityTemplate(templates = [], input = {}, categories = [], nowMs = Date.now()) {
  const check = validateActivityTemplate(input);
  if (!check.valid) {
    throw new Error(check.error);
  }

  const list = Array.isArray(templates) ? templates : [];
  const existing = input.id ? list.find(t => t.id === input.id) : null;
  const nowIso = new Date(nowMs).toISOString();

  const normalizedSteps = check.normalizedSteps.map(step => normalizeTemplateStep(step, categories));

  const template = {
    id: existing?.id || input.id || generateId(),
    name: check.normalizedName,
    steps: normalizedSteps,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: Math.max(nowMs, (Number(existing?.updatedAt) || 0) + 1),
    useCount: existing?.useCount || 0,
    lastUsedAt: existing?.lastUsedAt || null,
  };

  const nextTemplates = existing
    ? list.map(t => (t.id === existing.id ? template : t))
    : [template, ...list];

  return {
    templates: nextTemplates,
    template,
    isEdit: Boolean(existing),
  };
}

/**
 * Removes a template by id.
 * Pure function.
 */
export function deleteActivityTemplate(templates = [], templateId) {
  const list = Array.isArray(templates) ? templates : [];
  return list.filter(t => t.id !== templateId);
}

/**
 * Records template execution metadata (`useCount` & `lastUsedAt`).
 * Pure function.
 */
export function recordTemplateUse(templates = [], templateId, nowMs = Date.now()) {
  const list = Array.isArray(templates) ? templates : [];
  const nowIso = new Date(nowMs).toISOString();
  return list.map(t => (
    t.id === templateId
      ? {
          ...t,
          useCount: (Number(t.useCount) || 0) + 1,
          lastUsedAt: nowIso,
          updatedAt: Math.max(nowMs, (Number(t.updatedAt) || 0) + 1),
        }
      : t
  ));
}

function compareEntriesChronological(a, b) {
  const dateA = String(a?.date || '');
  const dateB = String(b?.date || '');
  if (dateA !== dateB) return dateA.localeCompare(dateB);
  const startA = String(a?.start || '');
  const startB = String(b?.start || '');
  if (startA !== startB) return startA.localeCompare(startB);
  return String(a?.end || '').localeCompare(String(b?.end || ''));
}

/**
 * Builds an ordered template draft directly from recorded time entries.
 * Entries are sorted chronologically (date asc, start asc).
 * Pure function.
 */
export function buildTemplateFromEntries({
  name = '',
  entries = [],
  categories = [],
  collapseConsecutiveDuplicates = false,
  includeDurations = true,
} = {}) {
  const sorted = (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && String(entry.activity || '').trim())
    .slice()
    .sort(compareEntriesChronological);

  if (!sorted.length) {
    throw new Error('Sélectionnez au moins une session enregistrée pour créer un gabarit.');
  }

  const categoryIds = new Set((Array.isArray(categories) ? categories : []).map(c => c.id));
  const rawSteps = [];
  const sourceEntryIds = [];

  for (const entry of sorted) {
    sourceEntryIds.push(entry.id);
    const activity = String(entry.activity || '').trim();
    const categoryId = entry.categoryId && (!categoryIds.size || categoryIds.has(entry.categoryId))
      ? entry.categoryId
      : null;
    const mins = Number(entry.mins);
    const targetMins = includeDurations && Number.isFinite(mins) && mins > 0
      ? Math.round(mins)
      : null;

    const prev = rawSteps[rawSteps.length - 1];
    if (
      collapseConsecutiveDuplicates
      && prev
      && normalizeKey(prev.activity) === normalizeKey(activity)
      && (prev.categoryId || null) === (categoryId || null)
    ) {
      if (includeDurations) {
        prev.targetMins = (prev.targetMins || 0) + (targetMins || 0) || null;
      }
      continue;
    }

    rawSteps.push({
      id: generateId(),
      activity,
      categoryId,
      targetMins,
    });
  }

  const trimmedName = String(name || '').trim();
  const previewNames = rawSteps.slice(0, 3).map(s => s.activity).join(' → ');
  const suggestedName = trimmedName || (rawSteps.length > 3 ? `${previewNames}…` : previewNames);

  return {
    name: suggestedName,
    steps: rawSteps,
    sourceEntryIds,
  };
}

/**
 * Groups recorded entries by date in chronological order for easy template creation from history.
 * Pure function.
 */
export function collectEntrySequencesByDate(entries = [], { minSteps = 1 } = {}) {
  const byDate = new Map();
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    if (!entry?.date || !String(entry.activity || '').trim()) continue;
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }

  const days = [];
  for (const [date, dayEntries] of byDate.entries()) {
    const sorted = dayEntries.slice().sort(compareEntriesChronological);
    if (sorted.length < minSteps) continue;
    const totalMins = sorted.reduce((sum, e) => sum + (Number(e.mins) || 0), 0);
    const previewParts = sorted.slice(0, 3).map(e => String(e.activity || '').trim());
    const summaryLabel = sorted.length > 3
      ? `${previewParts.join(' → ')} → …`
      : previewParts.join(' → ');

    days.push({
      date,
      entries: sorted,
      totalMins,
      summaryLabel,
    });
  }

  days.sort((a, b) => b.date.localeCompare(a.date));
  return days;
}

/**
 * Detects recurring consecutive sequences of activities in recorded entries.
 * Useful to automatically propose routines (e.g. Mosquée trajet -> Mosquée prière -> Doha).
 * Pure function.
 */
export function detectRecurringSequences(
  entries = [],
  { minLength = 2, maxLength = 5, minOccurrences = 2 } = {}
) {
  const days = collectEntrySequencesByDate(entries, { minSteps: minLength });
  const buckets = new Map();

  for (const day of days) {
    const seq = day.entries;
    const seenKeysToday = new Set();

    for (let start = 0; start < seq.length; start += 1) {
      for (let len = minLength; len <= maxLength && start + len <= seq.length; len += 1) {
        const slice = seq.slice(start, start + len);
        const signature = slice
          .map(e => `${normalizeKey(e.activity)}::${e.categoryId || ''}`)
          .join('|');
        if (seenKeysToday.has(signature)) continue;
        seenKeysToday.add(signature);

        if (!buckets.has(signature)) {
          buckets.set(signature, {
            signature,
            length: len,
            dates: [],
            samples: [],
          });
        }
        const bucket = buckets.get(signature);
        bucket.dates.push(day.date);
        bucket.samples.push(slice);
      }
    }
  }

  const candidates = [...buckets.values()]
    .filter(b => b.dates.length >= minOccurrences);

  // Prune shorter sub-sequences completely covered by a longer candidate on identical occurrences
  const filtered = candidates.filter((cand) => {
    const candDateSig = cand.dates.slice().sort().join(',');
    return !candidates.some((other) => (
      other.length > cand.length
      && other.dates.length >= cand.dates.length
      && other.signature.includes(cand.signature)
      && other.dates.slice().sort().join(',') === candDateSig
    ));
  });

  return filtered
    .map((bucket) => {
      const steps = [];
      for (let i = 0; i < bucket.length; i += 1) {
        const first = bucket.samples[0][i];
        const minsList = bucket.samples
          .map(sample => Number(sample[i]?.mins))
          .filter(m => Number.isFinite(m) && m > 0);
        const avgMins = minsList.length
          ? Math.round(minsList.reduce((a, b) => a + b, 0) / minsList.length)
          : null;

        steps.push({
          id: generateId(),
          activity: String(first.activity || '').trim(),
          categoryId: first.categoryId || null,
          targetMins: avgMins,
        });
      }

      const suggestedName = steps.map(s => s.activity).join(' → ');
      const totalAvgMins = steps.reduce((sum, s) => sum + (s.targetMins || 0), 0);

      return {
        id: bucket.signature,
        suggestedName,
        steps,
        occurrences: bucket.dates.length,
        dates: bucket.dates.slice().sort((a, b) => b.localeCompare(a)),
        totalAvgMins,
      };
    })
    .sort((a, b) => (
      b.occurrences - a.occurrences
      || b.steps.length - a.steps.length
      || b.totalAvgMins - a.totalAvgMins
    ))
    .slice(0, 6);
}

/**
 * Starts a template run from step 0.
 * Pure function.
 */
export function startTemplateRun(template, { startedAt = new Date().toISOString(), startIndex = 0 } = {}) {
  const normalized = normalizeActivityTemplate(template);
  if (!normalized || !normalized.steps.length) {
    throw new Error('Ce gabarit ne contient aucune étape valide.');
  }

  const rawIndex = Number(startIndex);
  const currentIndex = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < normalized.steps.length
    ? rawIndex
    : 0;

  const run = {
    templateId: normalized.id,
    templateName: normalized.name,
    currentIndex,
    steps: normalized.steps.map(step => ({ ...step })),
    startedAt,
    stepState: 'running',
    completedEntriesCount: currentIndex,
  };

  return {
    run,
    firstStep: run.steps[currentIndex],
  };
}

/**
 * Advances an active template run to the next step, or completes it when on the final step.
 * Pure function.
 */
export function advanceTemplateRun(run, { recordedStep = true } = {}) {
  const normalized = normalizeActiveTemplateRun(run);
  if (!normalized) {
    return {
      completed: true,
      nextRun: null,
      nextStep: null,
      totalCompleted: 0,
    };
  }

  const nextCompleted = normalized.completedEntriesCount + (recordedStep ? 1 : 0);
  const nextIndex = normalized.currentIndex + 1;

  if (nextIndex >= normalized.steps.length) {
    return {
      completed: true,
      nextRun: null,
      nextStep: null,
      totalCompleted: nextCompleted,
    };
  }

  const nextRun = {
    ...normalized,
    currentIndex: nextIndex,
    stepState: 'running',
    completedEntriesCount: nextCompleted,
  };

  return {
    completed: false,
    nextRun,
    nextStep: nextRun.steps[nextIndex],
    totalCompleted: nextCompleted,
  };
}

/**
 * Transitions an active run to 'ready' for the next step when the user stops the timer directly
 * (or finishes the run if the stopped timer was on the final step).
 * Pure function.
 */
export function pauseTemplateRunAfterManualStop(run) {
  const normalized = normalizeActiveTemplateRun(run);
  if (!normalized) return null;

  const nextCompleted = normalized.completedEntriesCount + 1;
  const nextIndex = normalized.currentIndex + 1;
  if (nextIndex >= normalized.steps.length) {
    return null;
  }

  return {
    ...normalized,
    currentIndex: nextIndex,
    stepState: 'ready',
    completedEntriesCount: nextCompleted,
  };
}

/**
 * Resumes a paused/ready template run on its current step.
 * Pure function.
 */
export function resumeReadyTemplateRun(run) {
  const normalized = normalizeActiveTemplateRun(run);
  if (!normalized) return null;
  return {
    nextRun: {
      ...normalized,
      stepState: 'running',
    },
    currentStep: normalized.steps[normalized.currentIndex],
  };
}

/**
 * Computes UI view model for a template execution run.
 * Pure function.
 */
export function computeTemplateRunProgress(run) {
  const normalized = normalizeActiveTemplateRun(run);
  if (!normalized) return null;

  const totalSteps = normalized.steps.length;
  const currentStep = normalized.steps[normalized.currentIndex];
  const nextStep = normalized.currentIndex + 1 < totalSteps
    ? normalized.steps[normalized.currentIndex + 1]
    : null;

  return {
    templateId: normalized.templateId,
    templateName: normalized.templateName,
    currentIndex: normalized.currentIndex,
    stepNumber: normalized.currentIndex + 1,
    totalSteps,
    isLastStep: normalized.currentIndex === totalSteps - 1,
    stepState: normalized.stepState,
    completedEntriesCount: normalized.completedEntriesCount,
    currentStep,
    nextStep,
    completedSteps: normalized.steps.slice(0, normalized.currentIndex),
    upcomingSteps: normalized.steps.slice(normalized.currentIndex + 1),
  };
}

/**
 * Builds sequential time entries from a template starting at a given date & time
 * (for manual batch logging without running a live timer).
 * Pure function.
 */
export function buildEntriesFromTemplate(
  template,
  { date, startTime = '08:00', fallbackMins = 15 } = {}
) {
  const normalized = normalizeActivityTemplate(template);
  if (!normalized) {
    throw new Error('Gabarit invalide.');
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Date invalide pour la saisie du gabarit.');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
    throw new Error('Heure de début invalide.');
  }

  let cursorTime = startTime;
  const created = [];
  const defaultDuration = Math.max(1, Math.round(Number(fallbackMins) || 15));

  for (const step of normalized.steps) {
    const duration = step.targetMins && step.targetMins > 0 ? step.targetMins : defaultDuration;
    const { time: endTime } = addMinutesToTime(cursorTime, duration);
    created.push(createTimeEntry({
      id: generateId(),
      activity: step.activity,
      categoryId: step.categoryId || null,
      date,
      start: cursorTime,
      end: endTime,
      mins: duration,
      viaTimer: false,
    }));
    cursorTime = endTime;
  }

  return created;
}

/**
 * Reassigns category references inside templates when two categories are merged.
 * Pure function.
 */
export function reassignCategoryInTemplates(templates = [], sourceId, targetId) {
  if (!sourceId || !Array.isArray(templates)) return Array.isArray(templates) ? templates : [];
  const nextTarget = targetId || null;
  let changed = false;

  const updated = templates.map((tpl) => {
    const hasMatch = Array.isArray(tpl?.steps) && tpl.steps.some(s => (s.categoryId ?? null) === sourceId);
    if (!hasMatch) return tpl;
    changed = true;
    return {
      ...tpl,
      steps: tpl.steps.map(s => (
        (s.categoryId ?? null) === sourceId ? { ...s, categoryId: nextTarget } : s
      )),
      updatedAt: Math.max(Date.now(), (Number(tpl.updatedAt) || 0) + 1),
    };
  });

  return changed ? updated : templates;
}

/**
 * Reassigns activity references inside templates when two activities are merged.
 * Pure function.
 */
export function reassignActivityInTemplates(templates = [], source = {}, target = {}) {
  const srcKey = normalizeKey(source?.label);
  const srcCat = source?.categoryId ?? null;
  const dstLabel = String(target?.label || '').trim();
  const dstCat = target?.categoryId ?? null;
  if (!srcKey || !dstLabel || !Array.isArray(templates)) return Array.isArray(templates) ? templates : [];

  let changed = false;
  const updated = templates.map((tpl) => {
    const hasMatch = Array.isArray(tpl?.steps) && tpl.steps.some(
      s => normalizeKey(s.activity) === srcKey && (s.categoryId ?? null) === srcCat
    );
    if (!hasMatch) return tpl;
    changed = true;
    return {
      ...tpl,
      steps: tpl.steps.map(s => (
        normalizeKey(s.activity) === srcKey && (s.categoryId ?? null) === srcCat
          ? { ...s, activity: dstLabel, categoryId: dstCat }
          : s
      )),
      updatedAt: Math.max(Date.now(), (Number(tpl.updatedAt) || 0) + 1),
    };
  });

  return changed ? updated : templates;
}
