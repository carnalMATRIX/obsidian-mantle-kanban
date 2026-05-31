export type Priority = "low" | "medium" | "high" | "critical";

export type SortType = "alphabetical" | "deadline" | "created" | "priority" | "none";
export type SortOrder = "asc" | "desc";

export interface ColumnFilter {
  sortType: SortType;
  sortOrder: SortOrder;
  priorities: Priority[]; // Empty means all
}

export interface BoardFilter {
  columns: string[]; // List of column IDs or ["all"]
  priorities: Priority[];
  sortType: SortType;
  sortOrder: SortOrder;
}

export interface KanbanCard {
  id: string;
  title: string;
  content: string;
  priority?: Priority;
  deadline?: string;
  linkedFile?: string;
  completed: boolean;
  createdAt: number;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
  filter?: ColumnFilter;
  color?: string;
  icon?: string;
}

export interface KanbanData {
  columns: KanbanColumn[];
  metadata?: Record<string, any>;
}

export const KANBAN_VIEW_TYPE = "mantle-kanban-view";
