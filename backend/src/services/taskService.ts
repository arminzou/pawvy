import type { AssigneeType, Task, TaskStatus } from '../domain/task';
import type { CreateTaskBody, ListTasksParams, TaskRepository, UpdateTaskBody } from '../repositories/taskRepository';
import { HttpError } from '../presentation/http/errors/httpError';

const ALLOWED_STATUSES: TaskStatus[] = ['backlog', 'in_progress', 'review', 'done'];
const ALLOWED_ASSIGNEE_TYPES: AssigneeType[] = ['agent', 'human', null];

type AssigneePair = {
  type: AssigneeType;
  id: string | null;
};

function normalizeNullableString(input: unknown): string | null {
  if (input == null) return null;
  const value = String(input).trim();
  return value ? value : null;
}

function normalizeAssigneeType(input: unknown): AssigneeType {
  if (input == null || input === '') return null;
  if (typeof input !== 'string') throw new HttpError(400, 'Invalid assigned_to_type');
  const normalized = input.trim().toLowerCase();
  if (normalized !== 'agent' && normalized !== 'human') throw new HttpError(400, 'Invalid assigned_to_type');
  return normalized;
}

function validateAssigneePair(pair: AssigneePair): void {
  if (!ALLOWED_ASSIGNEE_TYPES.includes(pair.type)) {
    throw new HttpError(400, 'Invalid assigned_to_type');
  }

  if (pair.type === null && pair.id !== null) {
    throw new HttpError(400, 'assigned_to_id requires assigned_to_type');
  }

  if (pair.type !== null && pair.id === null) {
    throw new HttpError(400, 'assigned_to_id is required when assigned_to_type is set');
  }
}

function normalizeDependencyIds(input: unknown): number[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new HttpError(400, 'blocked_by_task_ids must be an array');
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of input) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid blocked_by_task_ids value');
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export class TaskService {
  constructor(private readonly repo: TaskRepository) {}

  private normalizeBulkIds(ids: number[]): number[] {
    if (!Array.isArray(ids) || ids.length === 0) throw new HttpError(400, 'No task ids provided');
    const uniqueIds = Array.from(new Set(ids.map((raw) => Number(raw))));
    if (uniqueIds.some((id) => !Number.isFinite(id))) throw new HttpError(400, 'Invalid task id');
    return uniqueIds;
  }

  private enforceAssigneeCompatibility(nonAgent: boolean, pair: AssigneePair): void {
    validateAssigneePair(pair);
    if (nonAgent && pair.type === 'agent') {
      throw new HttpError(400, 'non_agent tasks cannot be assigned to agents');
    }
  }

  list(params: ListTasksParams = {}): Task[] {
    return this.repo.list(params);
  }

  getById(id: number): Task {
    const task = this.repo.getById(id);
    if (!task) throw new HttpError(404, 'Task not found');
    return task;
  }

  create(body: CreateTaskBody): Task {
    if (!body.title || !body.title.trim()) throw new HttpError(400, 'Title is required');

    if (body.status && !ALLOWED_STATUSES.includes(body.status)) {
      throw new HttpError(400, 'Invalid status');
    }

    const assigneeType = normalizeAssigneeType(body.assigned_to_type);
    const assigneeId = normalizeNullableString(body.assigned_to_id);
    const nonAgent = body.non_agent === true;
    this.enforceAssigneeCompatibility(nonAgent, { type: assigneeType, id: assigneeId });
    const blockedByTaskIds = body.blocked_by_task_ids === undefined
      ? undefined
      : normalizeDependencyIds(body.blocked_by_task_ids);

    try {
      return this.repo.create({
        ...body,
        title: body.title.trim(),
        due_date: normalizeNullableString(body.due_date),
        assigned_to_type: assigneeType,
        assigned_to_id: assigneeId,
        non_agent: nonAgent,
        anchor: normalizeNullableString(body.anchor),
        blocked_by_task_ids: blockedByTaskIds,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Dependency task not found') throw new HttpError(400, 'Dependency task not found');
      throw err;
    }
  }

  update(id: number, patch: UpdateTaskBody): Task {
    if (!patch || Object.keys(patch).length === 0) throw new HttpError(400, 'No fields to update');

    const existing = this.getById(id);
    const hasDependencyPatch = Object.prototype.hasOwnProperty.call(patch, 'blocked_by_task_ids');

    const normalized: UpdateTaskBody = { ...patch };
    if (typeof normalized.title === 'string') normalized.title = normalized.title.trim();
    if (typeof normalized.due_date === 'string') normalized.due_date = normalized.due_date.trim();
    if (typeof normalized.anchor === 'string') normalized.anchor = normalized.anchor.trim();

    if (normalized.status && !ALLOWED_STATUSES.includes(normalized.status)) {
      throw new HttpError(400, 'Invalid status');
    }

    const hasTypePatch = Object.prototype.hasOwnProperty.call(normalized, 'assigned_to_type');
    const hasIdPatch = Object.prototype.hasOwnProperty.call(normalized, 'assigned_to_id');

    const nextType = hasTypePatch ? normalizeAssigneeType(normalized.assigned_to_type) : existing.assigned_to_type;
    const nextId = hasIdPatch ? normalizeNullableString(normalized.assigned_to_id) : existing.assigned_to_id;

    if (hasTypePatch) normalized.assigned_to_type = nextType;
    if (hasIdPatch) normalized.assigned_to_id = nextId;

    if (hasTypePatch && !hasIdPatch && nextType === null) {
      normalized.assigned_to_id = null;
    }

    const finalPair: AssigneePair = {
      type: hasTypePatch ? (normalized.assigned_to_type ?? null) : nextType,
      id: Object.prototype.hasOwnProperty.call(normalized, 'assigned_to_id')
        ? normalizeNullableString(normalized.assigned_to_id)
        : nextId,
    };

    const finalNonAgent = normalized.non_agent ?? existing.non_agent;
    this.enforceAssigneeCompatibility(finalNonAgent, finalPair);

    const dependencies = hasDependencyPatch
      ? normalizeDependencyIds((patch as UpdateTaskBody).blocked_by_task_ids)
      : undefined;
    if (dependencies?.includes(id)) {
      throw new HttpError(400, 'A task cannot depend on itself');
    }

    delete (normalized as UpdateTaskBody & { blocked_by_task_ids?: number[] }).blocked_by_task_ids;

    if (Object.keys(normalized).length === 0 && dependencies !== undefined) {
      try {
        this.repo.replaceDependencies(id, dependencies);
        return this.getById(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'Dependency task not found') throw new HttpError(400, 'Dependency task not found');
        throw err;
      }
    }

    try {
      const updated = this.repo.update(id, normalized);
      if (dependencies !== undefined) {
        this.repo.replaceDependencies(id, dependencies);
        return this.getById(id);
      }
      return updated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Task not found') throw new HttpError(404, 'Task not found');
      if (msg === 'No fields to update') throw new HttpError(400, 'No fields to update');
      if (msg === 'Dependency task not found') throw new HttpError(400, 'Dependency task not found');
      throw err;
    }
  }

  bulkAssignProject(ids: number[], projectId: number | null): { updated: number } {
    const uniqueIds = this.normalizeBulkIds(ids);

    let normalizedProjectId: number | null = null;
    if (projectId !== null) {
      const n = Number(projectId);
      if (!Number.isFinite(n)) throw new HttpError(400, 'Invalid project id');
      normalizedProjectId = n;
    }

    return this.repo.bulkAssignProject({
      ids: uniqueIds,
      project_id: normalizedProjectId,
    });
  }

  bulkAssignAssignee(ids: number[], assigneeTypeRaw: unknown, assigneeIdRaw: unknown): { updated: number } {
    const uniqueIds = this.normalizeBulkIds(ids);
    const pair: AssigneePair = {
      type: normalizeAssigneeType(assigneeTypeRaw),
      id: normalizeNullableString(assigneeIdRaw),
    };
    validateAssigneePair(pair);

    if (pair.type === 'agent') {
      for (const id of uniqueIds) {
        const task = this.repo.getById(id);
        if (task?.non_agent) {
          throw new HttpError(400, 'Cannot assign agents to non_agent tasks');
        }
      }
    }

    return this.repo.bulkAssignAssignee({
      ids: uniqueIds,
      assigned_to_type: pair.type,
      assigned_to_id: pair.id,
    });
  }

  bulkUpdateStatus(ids: number[], statusRaw: unknown): { updated: number } {
    const uniqueIds = this.normalizeBulkIds(ids);
    const status = statusRaw as TaskStatus;
    if (!ALLOWED_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');

    return this.repo.bulkUpdateStatus({
      ids: uniqueIds,
      status,
    });
  }

  bulkDelete(ids: number[]): { deleted: number } {
    const uniqueIds = this.normalizeBulkIds(ids);
    return this.repo.bulkDelete(uniqueIds);
  }

  delete(id: number): void {
    const { changes } = this.repo.delete(id);
    if (changes === 0) throw new HttpError(404, 'Task not found');
  }

  listNewlyUnblockedDependents(taskId: number): Array<{ id: number; title: string }> {
    return this.repo.listNewlyUnblockedDependents(taskId);
  }
}
