export type TaskStatus = 'backlog' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent' | null;
export type AssigneeType = 'agent' | 'human' | null;
export type AnchorSource = 'task' | 'project' | 'category' | 'scratch' | null;

/**
 * Canonical Task shape returned by the API.
 * Matches the `tasks` table, except `tags` is hydrated to `string[]`.
 */
export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  tags: string[];
  blocked_reason: string | null;
  assigned_to_type: AssigneeType;
  assigned_to_id: string | null;
  non_agent: boolean;
  anchor: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
  project_id: number | null;
  context_key: string | null;
  context_type: string | null;
  is_someday: boolean;
  blocked_by_task_ids: number[];
  blocks_task_ids: number[];
  is_dependency_blocked: boolean;
  resolved_anchor: string | null;
  anchor_source: AnchorSource;
}

/**
 * Raw DB row shape (as returned by better-sqlite3). `tags` is stored as JSON string.
 */
export interface TaskRow extends Omit<
  Task,
  'tags' | 'is_someday' | 'non_agent' | 'blocked_by_task_ids' | 'blocks_task_ids' | 'is_dependency_blocked' | 'resolved_anchor' | 'anchor_source'
> {
  tags: string | null;
  is_someday: number; // SQLite stores boolean as 0/1
  non_agent: number;
}
