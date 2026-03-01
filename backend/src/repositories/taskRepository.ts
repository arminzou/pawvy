import type { Database } from 'better-sqlite3';
import type { AssigneeType, Task, TaskRow, TaskStatus } from '../domain/task';

function normalizeTags(input: unknown): string[] {
  if (input === undefined || input === null) return [];

  if (Array.isArray(input)) {
    return input.map(String).map((t) => t.trim()).filter(Boolean);
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return parsed.map(String).map((t) => t.trim()).filter(Boolean);
      } catch {
        // fall through
      }
    }

    return trimmed
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeNullableString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function normalizeDependencyIds(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of input) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function hydrateTask(row: TaskRow): Task {
  return {
    ...row,
    description: row.description ?? null,
    due_date: row.due_date ?? null,
    blocked_reason: row.blocked_reason ?? null,
    assigned_to_type: (row.assigned_to_type ?? null) as AssigneeType,
    assigned_to_id: row.assigned_to_id ?? null,
    non_agent: Boolean(row.non_agent),
    anchor: row.anchor ?? null,
    completed_at: row.completed_at ?? null,
    archived_at: row.archived_at ?? null,
    project_id: row.project_id ?? null,
    context_key: row.context_key ?? null,
    context_type: row.context_type ?? null,
    tags: normalizeTags(row.tags),
    is_someday: Boolean(row.is_someday),
    blocked_by_task_ids: [],
    blocks_task_ids: [],
    is_dependency_blocked: false,
    resolved_anchor: null,
    anchor_source: null,
  };
}

export type ListTasksParams = {
  status?: TaskStatus;
  assigned_to_type?: AssigneeType;
  assigned_to_id?: string | null;
  non_agent?: boolean;
  include_archived?: boolean;
  project_id?: number;
  context_key?: string;
  context_type?: string;
  is_someday?: boolean;
  limit?: number;
  offset?: number;
};

export type CreateTaskBody = {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: Task['priority'];
  due_date?: string | null;
  tags?: string[] | string;
  blocked_reason?: string | null;
  assigned_to_type?: AssigneeType;
  assigned_to_id?: string | null;
  non_agent?: boolean;
  anchor?: string | null;
  project_id?: number | null;
  context_key?: string | null;
  context_type?: string | null;
  is_someday?: boolean;
  blocked_by_task_ids?: number[];
};

export type UpdateTaskBody = Partial<
  Pick<
    Task,
    | 'title'
    | 'description'
    | 'status'
    | 'priority'
    | 'due_date'
    | 'assigned_to_type'
    | 'assigned_to_id'
    | 'non_agent'
    | 'anchor'
    | 'archived_at'
    | 'blocked_reason'
    | 'project_id'
    | 'context_key'
    | 'context_type'
    | 'is_someday'
  >
> & {
  tags?: string[] | string | null;
  blocked_by_task_ids?: number[];
};

export type BulkAssignProjectInput = {
  ids: number[];
  project_id: number | null;
};

export type BulkAssignAssigneeInput = {
  ids: number[];
  assigned_to_type: AssigneeType;
  assigned_to_id: string | null;
};

export type BulkUpdateStatusInput = {
  ids: number[];
  status: TaskStatus;
};

type DependencyStatusRow = {
  task_id: number;
  depends_on_task_id: number;
  dependency_status: TaskStatus | null;
};

type DependencyEdgeRow = {
  blocker_id: number;
  dependent_id: number;
};

export type DependencyTaskSummary = {
  id: number;
  title: string;
};

export class TaskRepository {
  constructor(private readonly db: Database) {}

  private ensureTags(tags: string[]) {
    if (!tags.length) return;
    const insert = this.db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    const insertMany = this.db.transaction((names: string[]) => {
      for (const name of names) insert.run(name);
    });
    insertMany(tags);
  }

  private enrichDependencies(tasks: Task[]): Task[] {
    if (!tasks.length) return [];

    const ids = tasks.map((task) => task.id);
    const placeholders = ids.map(() => '?').join(', ');

    const dependencyStatusRows = this.db
      .prepare(
        `
        SELECT
          td.task_id,
          td.depends_on_task_id,
          dep.status AS dependency_status
        FROM task_dependencies td
        LEFT JOIN tasks dep ON dep.id = td.depends_on_task_id
        WHERE td.task_id IN (${placeholders})
      `,
      )
      .all(...ids) as DependencyStatusRow[];

    const downstreamRows = this.db
      .prepare(
        `
        SELECT
          depends_on_task_id AS blocker_id,
          task_id AS dependent_id
        FROM task_dependencies
        WHERE depends_on_task_id IN (${placeholders})
      `,
      )
      .all(...ids) as DependencyEdgeRow[];

    const blockedByMap = new Map<number, number[]>();
    const blocksMap = new Map<number, number[]>();
    const unresolvedCount = new Map<number, number>();

    for (const row of dependencyStatusRows) {
      const blockedBy = blockedByMap.get(row.task_id) ?? [];
      blockedBy.push(row.depends_on_task_id);
      blockedByMap.set(row.task_id, blockedBy);

      if (row.dependency_status !== 'done') {
        unresolvedCount.set(row.task_id, (unresolvedCount.get(row.task_id) ?? 0) + 1);
      }
    }

    for (const row of downstreamRows) {
      const blocks = blocksMap.get(row.blocker_id) ?? [];
      blocks.push(row.dependent_id);
      blocksMap.set(row.blocker_id, blocks);
    }

    return tasks.map((task) => {
      const blockedBy = Array.from(new Set(blockedByMap.get(task.id) ?? [])).sort((a, b) => a - b);
      const blocks = Array.from(new Set(blocksMap.get(task.id) ?? [])).sort((a, b) => a - b);
      return {
        ...task,
        blocked_by_task_ids: blockedBy,
        blocks_task_ids: blocks,
        is_dependency_blocked: (unresolvedCount.get(task.id) ?? 0) > 0,
      };
    });
  }

  replaceDependencies(taskId: number, blockedByTaskIds: number[]): number[] {
    const normalized = normalizeDependencyIds(blockedByTaskIds).filter((id) => id !== taskId);
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      if (normalized.length > 0) {
        const placeholders = normalized.map(() => '?').join(', ');
        const existingRows = this.db
          .prepare(`SELECT id FROM tasks WHERE id IN (${placeholders})`)
          .all(...normalized) as Array<{ id: number }>;
        if (existingRows.length !== normalized.length) {
          throw new Error('Dependency task not found');
        }
      }

      this.db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(taskId);
      if (normalized.length > 0) {
        const insert = this.db.prepare(
          'INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)',
        );
        for (const dependencyId of normalized) {
          insert.run(taskId, dependencyId);
        }
      }

      this.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, taskId);
    });

    tx();
    return normalized;
  }

  listNewlyUnblockedDependents(prerequisiteTaskId: number): DependencyTaskSummary[] {
    return this.db
      .prepare(
        `
        SELECT d.id, d.title
        FROM tasks d
        JOIN task_dependencies trigger_dep
          ON trigger_dep.task_id = d.id
         AND trigger_dep.depends_on_task_id = ?
        LEFT JOIN task_dependencies all_dep ON all_dep.task_id = d.id
        LEFT JOIN tasks prereq ON prereq.id = all_dep.depends_on_task_id
        WHERE d.archived_at IS NULL
          AND d.status != 'done'
        GROUP BY d.id, d.title
        HAVING SUM(CASE WHEN prereq.id IS NULL OR prereq.status = 'done' THEN 0 ELSE 1 END) = 0
        ORDER BY d.id ASC
      `,
      )
      .all(prerequisiteTaskId) as DependencyTaskSummary[];
  }

  list(params: ListTasksParams = {}): Task[] {
    const {
      status,
      assigned_to_type,
      assigned_to_id,
      non_agent,
      include_archived,
      project_id,
      context_key,
      context_type,
      is_someday,
      limit,
      offset,
    } = params;

    let query = 'SELECT * FROM tasks';
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (include_archived !== true) conditions.push('archived_at IS NULL');

    if (status) {
      conditions.push('status = ?');
      values.push(status);
    }

    if (assigned_to_type !== undefined) {
      if (assigned_to_type === null) {
        conditions.push('assigned_to_type IS NULL');
      } else {
        conditions.push('assigned_to_type = ?');
        values.push(assigned_to_type);
      }
    }

    if (assigned_to_id !== undefined) {
      if (assigned_to_id === null) {
        conditions.push('assigned_to_id IS NULL');
      } else {
        conditions.push('assigned_to_id = ?');
        values.push(assigned_to_id);
      }
    }

    if (non_agent !== undefined) {
      conditions.push('non_agent = ?');
      values.push(non_agent ? 1 : 0);
    }

    if (project_id != null) {
      conditions.push('project_id = ?');
      values.push(project_id);
    }

    if (context_key) {
      conditions.push('context_key = ?');
      values.push(context_key);
    }

    if (context_type) {
      conditions.push('context_type = ?');
      values.push(context_type);
    }

    if (is_someday !== undefined) {
      conditions.push('is_someday = ?');
      values.push(is_someday ? 1 : 0);
    }

    if (conditions.length > 0) query += ` WHERE ${conditions.join(' AND ')}`;

    query += ' ORDER BY created_at ASC, id ASC';

    if (limit !== undefined) {
      query += ' LIMIT ?';
      values.push(limit);
    }

    if (offset !== undefined) {
      if (limit === undefined) query += ' LIMIT -1';
      query += ' OFFSET ?';
      values.push(offset);
    }

    const rows = this.db.prepare(query).all(...values) as TaskRow[];
    return this.enrichDependencies(rows.map(hydrateTask));
  }

  getById(id: number): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!row) return null;
    return this.enrichDependencies([hydrateTask(row)])[0] ?? null;
  }

  create(body: CreateTaskBody): Task {
    const title = body.title;
    const description = normalizeNullableString(body.description);
    const status = body.status ?? 'backlog';
    const priority = body.priority ?? null;
    const due_date = normalizeNullableString(body.due_date);
    const normalizedTags = body.tags === undefined ? undefined : normalizeTags(body.tags);
    const tagsJson = normalizedTags === undefined ? null : JSON.stringify(normalizedTags);
    if (normalizedTags) this.ensureTags(normalizedTags);
    const blocked_reason = normalizeNullableString(body.blocked_reason);
    const assigned_to_type = body.assigned_to_type ?? null;
    const assigned_to_id = normalizeNullableString(body.assigned_to_id);
    const non_agent = body.non_agent === true ? 1 : 0;
    const anchor = normalizeNullableString(body.anchor);
    const project_id = body.project_id != null ? Number(body.project_id) : null;
    const context_key = normalizeNullableString(body.context_key);
    const context_type = normalizeNullableString(body.context_type);
    const is_someday = body.is_someday === true ? 1 : 0;

    const completedAt = status === 'done' ? new Date().toISOString() : null;

    const result = this.db
      .prepare(
        `
        INSERT INTO tasks (
          title, description, status, priority, due_date,
          tags, blocked_reason, assigned_to_type, assigned_to_id,
          non_agent, anchor, project_id,
          context_key, context_type, completed_at, is_someday
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        title,
        description,
        status,
        priority,
        due_date,
        tagsJson,
        blocked_reason,
        assigned_to_type,
        assigned_to_id,
        non_agent,
        anchor,
        project_id,
        context_key,
        context_type,
        completedAt,
        is_someday,
      );

    const createdId = Number(result.lastInsertRowid);
    if (Array.isArray(body.blocked_by_task_ids)) {
      this.replaceDependencies(createdId, body.blocked_by_task_ids);
    }

    const created = this.getById(createdId);
    if (!created) throw new Error('Failed to create task');
    return created;
  }

  update(id: number, patch: UpdateTaskBody): Task {
    const updates: string[] = [];
    const values: unknown[] = [];
    const existing = this.getById(id);

    if (patch.title !== undefined) {
      updates.push('title = ?');
      values.push(patch.title);
    }
    if (patch.description !== undefined) {
      updates.push('description = ?');
      values.push(normalizeNullableString(patch.description));
    }
    if (patch.status !== undefined) {
      updates.push('status = ?');
      values.push(patch.status);
      if (patch.status === 'done') {
        const existingCompleted = existing?.status === 'done' ? existing.completed_at : null;
        updates.push('completed_at = ?');
        values.push(existingCompleted ?? new Date().toISOString());
      } else {
        updates.push('completed_at = ?');
        values.push(null);
      }
    }
    if (patch.priority !== undefined) {
      updates.push('priority = ?');
      values.push(patch.priority);
    }
    if (patch.due_date !== undefined) {
      updates.push('due_date = ?');
      values.push(normalizeNullableString(patch.due_date));
    }
    if (patch.tags !== undefined) {
      const normalized = normalizeTags(patch.tags);
      updates.push('tags = ?');
      values.push(JSON.stringify(normalized));
      this.ensureTags(normalized);
    }
    if (patch.blocked_reason !== undefined) {
      updates.push('blocked_reason = ?');
      values.push(normalizeNullableString(patch.blocked_reason));
    }
    if (patch.assigned_to_type !== undefined) {
      updates.push('assigned_to_type = ?');
      values.push(patch.assigned_to_type);
    }
    if (patch.assigned_to_id !== undefined) {
      updates.push('assigned_to_id = ?');
      values.push(normalizeNullableString(patch.assigned_to_id));
    }
    if (patch.non_agent !== undefined) {
      updates.push('non_agent = ?');
      values.push(patch.non_agent ? 1 : 0);
    }
    if (patch.anchor !== undefined) {
      updates.push('anchor = ?');
      values.push(normalizeNullableString(patch.anchor));
    }
    if (patch.archived_at !== undefined) {
      updates.push('archived_at = ?');
      values.push(patch.archived_at);
    }
    if (patch.project_id !== undefined) {
      updates.push('project_id = ?');
      values.push(patch.project_id != null ? Number(patch.project_id) : null);
    }
    if (patch.context_key !== undefined) {
      updates.push('context_key = ?');
      values.push(normalizeNullableString(patch.context_key));
    }
    if (patch.context_type !== undefined) {
      updates.push('context_type = ?');
      values.push(normalizeNullableString(patch.context_type));
    }
    if (patch.is_someday !== undefined) {
      updates.push('is_someday = ?');
      values.push(patch.is_someday ? 1 : 0);
    }

    if (updates.length === 0) throw new Error('No fields to update');

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const updated = this.getById(id);
    if (!updated) throw new Error('Task not found');
    return updated;
  }

  bulkAssignProject(input: BulkAssignProjectInput): { updated: number } {
    const uniqueIds = Array.from(new Set(input.ids));
    if (!uniqueIds.length) return { updated: 0 };

    const now = new Date().toISOString();
    const projectId = input.project_id != null ? Number(input.project_id) : null;
    const stmt = this.db.prepare('UPDATE tasks SET project_id = ?, updated_at = ? WHERE id = ?');

    const tx = this.db.transaction((ids: number[]) => {
      let updated = 0;
      for (const id of ids) {
        const result = stmt.run(projectId, now, id) as { changes: number };
        updated += result.changes;
      }
      return updated;
    });

    return { updated: tx(uniqueIds) };
  }

  bulkAssignAssignee(input: BulkAssignAssigneeInput): { updated: number } {
    const uniqueIds = Array.from(new Set(input.ids));
    if (!uniqueIds.length) return { updated: 0 };

    const now = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE tasks SET assigned_to_type = ?, assigned_to_id = ?, updated_at = ? WHERE id = ?');

    const tx = this.db.transaction((ids: number[]) => {
      let updated = 0;
      for (const id of ids) {
        const result = stmt.run(input.assigned_to_type, normalizeNullableString(input.assigned_to_id), now, id) as { changes: number };
        updated += result.changes;
      }
      return updated;
    });

    return { updated: tx(uniqueIds) };
  }

  bulkUpdateStatus(input: BulkUpdateStatusInput): { updated: number } {
    const uniqueIds = Array.from(new Set(input.ids));
    if (!uniqueIds.length) return { updated: 0 };

    const now = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?');

    const tx = this.db.transaction((ids: number[]) => {
      let updated = 0;
      for (const id of ids) {
        const existing = this.getById(id);
        if (!existing) continue;

        const completedAt = input.status === 'done'
          ? (existing.status === 'done' ? existing.completed_at : now)
          : null;
        const result = stmt.run(input.status, completedAt, now, id) as { changes: number };
        updated += result.changes;
      }
      return updated;
    });

    return { updated: tx(uniqueIds) };
  }

  bulkDelete(ids: number[]): { deleted: number } {
    const uniqueIds = Array.from(new Set(ids));
    if (!uniqueIds.length) return { deleted: 0 };

    const clearDependencies = this.db.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?');
    const stmt = this.db.prepare('DELETE FROM tasks WHERE id = ?');
    const tx = this.db.transaction((taskIds: number[]) => {
      let deleted = 0;
      for (const id of taskIds) {
        clearDependencies.run(id, id);
        const result = stmt.run(id) as { changes: number };
        deleted += result.changes;
      }
      return deleted;
    });

    return { deleted: tx(uniqueIds) };
  }

  delete(id: number): { changes: number } {
    this.db.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_task_id = ?').run(id, id);
    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id) as { changes: number };
    return { changes: result.changes };
  }
}
