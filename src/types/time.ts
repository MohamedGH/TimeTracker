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

export interface SavedActivity {
  id: string;
  label: string;
  categoryId: string | null;
}

export interface ActiveTimer {
  activity: string;
  categoryId: string;
  startTs: number;
  startTime: string;
  date: string;
}
