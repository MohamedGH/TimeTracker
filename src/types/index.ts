export interface Category {
  id: string;
  label: string;
  color: string | null;
  parentId: string | null;
  builtin?: boolean;
}

export interface TimeEntry {
  id: string;
  activity: string;
  categoryId: string | null;
  date: string;
  start: string;
  end: string;
  endDate?: string;
  mins: number;
}

export interface ActiveTimer {
  activity: string;
  categoryId: string | null;
  cat?: string | null;
  startTs: number;
  startTime: string;
  date: string;
}

export interface SavedActivity {
  id: string;
  label: string;
  categoryId: string | null;
  name?: string;
  activity?: string;
  cat?: string;
}

export interface ExportPayload {
  version: number;
  exportedAt: string;
  entries: TimeEntry[];
  savedActivities: SavedActivity[];
  categories: Category[];
}
