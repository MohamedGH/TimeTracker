export interface Category {
  id: string;
  label: string;
  parentId: string | null;
  color: string | null;
  builtin: boolean;
}

export interface CategoryInput {
  id: string;
  label: string;
  parentId?: string | null;
  color?: string | null;
  builtin?: boolean;
}

export interface CategoryTreeState {
  categories: Category[];
}
