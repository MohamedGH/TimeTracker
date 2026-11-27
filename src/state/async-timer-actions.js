import { createTimeEntry } from '../core/time-entry.js';
import { createTimerState, elapsedMinutes, elapsedSeconds } from '../core/timer.js';
import { normalizeLocation } from '../core/geo/geo-location.js';

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatClockHHMM(ts = Date.now()) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateYYYYMMDD(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function normalizeTargetMins(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normalizeAsyncTimer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const activity = cleanText(raw.activity || raw.label || raw.name);
  const categoryId = raw.categoryId ?? raw.cat ?? null;
  const startTs = Number(raw.startTs);
  if (!activity || !Number.isFinite(startTs) || startTs <= 0) return null;

  const id = cleanText(raw.id) || crypto.randomUUID();
  const startTime = cleanText(raw.startTime) || formatClockHHMM(startTs);
  const date = cleanText(raw.date) || formatDateYYYYMMDD(startTs);
  const startLocation = normalizeLocation(raw.startLocation ?? raw.location);
  const targetMins = normalizeTargetMins(raw.targetMins);
  const content = cleanText(raw.content);
  const startContent = cleanText(raw.startContent);
  const endContent = cleanText(raw.endContent);

  return {
    id,
    activity,
    categoryId,
    cat: categoryId,
    startTs,
    startTime,
    date,
    isAsync: true,
    ...(targetMins ? { targetMins } : {}),
    ...(raw.alerted ? { alerted: true } : {}),
    ...(startLocation ? { startLocation } : {}),
    ...(content ? { content } : {}),
    ...(startContent ? { startContent } : {}),
    ...(endContent ? { endContent } : {}),
  };
}

export function normalizeAsyncTimersList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const normalized = normalizeAsyncTimer(item);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out.sort((a, b) => a.startTs - b.startTs);
}

export function createAsyncTimer({
  id = crypto.randomUUID(),
  activity,
  categoryId = null,
  cat = categoryId,
  startTs = Date.now(),
  startTime = formatClockHHMM(startTs),
  date = formatDateYYYYMMDD(startTs),
  targetMins = null,
  startLocation = null,
  location = null,
  content = '',
  startContent = '',
  endContent = '',
} = {}) {
  const cleanActivity = cleanText(activity);
  const resolvedCategoryId = categoryId ?? cat ?? null;
  if (!cleanActivity || !resolvedCategoryId || !Number.isFinite(Number(startTs))) {
    throw new Error('Activité asynchrone invalide.');
  }

  return normalizeAsyncTimer({
    id,
    activity: cleanActivity,
    categoryId: resolvedCategoryId,
    startTs: Number(startTs),
    startTime,
    date,
    targetMins,
    startLocation: startLocation ?? location,
    content,
    startContent,
    endContent,
  });
}

export function startAsyncTimerInList(list = [], payload = {}) {
  const normalizedList = normalizeAsyncTimersList(list);
  const timer = createAsyncTimer(payload);
  return {
    timers: [...normalizedList, timer].sort((a, b) => a.startTs - b.startTs),
    timer,
  };
}

export function stopAsyncTimerInList(
  list = [],
  timerId,
  {
    nowTs = Date.now(),
    endTime = formatClockHHMM(nowTs),
    endDate = formatDateYYYYMMDD(nowTs),
    entryId = crypto.randomUUID(),
    endLocation = null,
  } = {}
) {
  const normalizedList = normalizeAsyncTimersList(list);
  const target = normalizedList.find(t => t.id === timerId);
  if (!target) {
    return {
      timers: normalizedList,
      stoppedTimer: null,
      entry: null,
      durationMinutes: 0,
    };
  }

  const durationMinutes = elapsedMinutes(target, nowTs);
  const entry = createTimeEntry({
    id: entryId,
    activity: target.activity,
    categoryId: target.categoryId ?? target.cat ?? null,
    date: target.date,
    start: target.startTime,
    end: endTime,
    ...(endDate && endDate !== target.date ? { endDate } : {}),
    mins: durationMinutes,
    viaTimer: true,
    isAsync: true,
    startLocation: target.startLocation ?? null,
    endLocation: normalizeLocation(endLocation),
    content: target.content || '',
    startContent: target.startContent || '',
    endContent: target.endContent || '',
  });

  return {
    timers: normalizedList.filter(t => t.id !== timerId),
    stoppedTimer: target,
    entry,
    durationMinutes,
  };
}

export function discardAsyncTimerInList(list = [], timerId) {
  const normalizedList = normalizeAsyncTimersList(list);
  const discardedTimer = normalizedList.find(t => t.id === timerId) || null;
  return {
    timers: normalizedList.filter(t => t.id !== timerId),
    discardedTimer,
  };
}

export function updateAsyncTimerTargetInList(list = [], timerId, targetMins) {
  const normalizedList = normalizeAsyncTimersList(list);
  const nextTarget = normalizeTargetMins(targetMins);
  let updatedTimer = null;
  const timers = normalizedList.map((item) => {
    if (item.id !== timerId) return item;
    const { targetMins: _prevTarget, alerted: _prevAlerted, ...rest } = item;
    updatedTimer = nextTarget ? { ...rest, targetMins: nextTarget } : rest;
    return updatedTimer;
  });
  return { timers, updatedTimer };
}

export function markAsyncTimerAlertedInList(list = [], timerId) {
  const normalizedList = normalizeAsyncTimersList(list);
  return normalizedList.map(item => (item.id === timerId ? { ...item, alerted: true } : item));
}

export function demoteActiveTimerToAsync(activeTimer, activeAsyncTimers = [], { targetMins = null, id = crypto.randomUUID() } = {}) {
  const normalizedList = normalizeAsyncTimersList(activeAsyncTimers);
  if (!activeTimer) {
    return {
      activeTimer: null,
      activeAsyncTimers: normalizedList,
      movedTimer: null,
    };
  }
  const movedTimer = createAsyncTimer({
    id,
    activity: activeTimer.activity,
    categoryId: activeTimer.categoryId ?? activeTimer.cat ?? null,
    startTs: activeTimer.startTs,
    startTime: activeTimer.startTime,
    date: activeTimer.date,
    targetMins,
    startLocation: activeTimer.startLocation ?? activeTimer.location ?? null,
    content: activeTimer.content || '',
    startContent: activeTimer.startContent || '',
    endContent: activeTimer.endContent || '',
  });

  return {
    activeTimer: null,
    activeAsyncTimers: [...normalizedList, movedTimer].sort((a, b) => a.startTs - b.startTs),
    movedTimer,
  };
}

export function promoteAsyncTimerToActive(activeTimer, activeAsyncTimers = [], timerId) {
  const normalizedList = normalizeAsyncTimersList(activeAsyncTimers);
  const target = normalizedList.find(t => t.id === timerId);
  if (!target) {
    return {
      activeTimer,
      activeAsyncTimers: normalizedList,
      promotedTimer: null,
      demotedTimer: null,
    };
  }

  let nextList = normalizedList.filter(t => t.id !== timerId);
  let demotedTimer = null;
  if (activeTimer) {
    const demoted = demoteActiveTimerToAsync(activeTimer, nextList);
    nextList = demoted.activeAsyncTimers;
    demotedTimer = demoted.movedTimer;
  }

  const promotedTimer = createTimerState({
    activity: target.activity,
    categoryId: target.categoryId ?? target.cat ?? null,
    startTs: target.startTs,
    startTime: target.startTime,
    date: target.date,
    startLocation: target.startLocation ?? null,
    content: target.content || '',
    startContent: target.startContent || '',
    endContent: target.endContent || '',
  });

  return {
    activeTimer: promotedTimer,
    activeAsyncTimers: nextList,
    promotedTimer,
    demotedTimer,
  };
}

export function computeAsyncTimerProgress(timer, nowTs = Date.now()) {
  if (!timer) {
    return {
      elapsedSecs: 0,
      elapsedMins: 0,
      targetSecs: null,
      remainingSecs: null,
      overdueSecs: 0,
      isOverdue: false,
      progressRatio: 0,
    };
  }
  const elapsedSecs = elapsedSeconds(timer, nowTs);
  const elapsedMins = elapsedMinutes(timer, nowTs);
  const targetMins = normalizeTargetMins(timer.targetMins);
  if (!targetMins) {
    return {
      elapsedSecs,
      elapsedMins,
      targetSecs: null,
      remainingSecs: null,
      overdueSecs: 0,
      isOverdue: false,
      progressRatio: 0,
    };
  }
  const targetSecs = targetMins * 60;
  const diff = targetSecs - elapsedSecs;
  const isOverdue = diff <= 0;
  return {
    elapsedSecs,
    elapsedMins,
    targetSecs,
    remainingSecs: Math.max(0, diff),
    overdueSecs: isOverdue ? Math.abs(diff) : 0,
    isOverdue,
    progressRatio: Math.min(1, elapsedSecs / targetSecs),
  };
}
