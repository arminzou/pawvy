import express, { type NextFunction, type Request, type Response } from 'express';
import type { Database } from 'better-sqlite3';
import type { AssigneeType, TaskStatus } from '../../../domain/task';
import { TaskRepository } from '../../../repositories/taskRepository';
import { ProjectRepository } from '../../../repositories/projectRepository';
import { TaskService } from '../../../services/taskService';
import { AnchorService } from '../../../services/anchorService';
import { HttpError } from '../errors/httpError';

export type BroadcastFn = (data: unknown) => void;

function parseId(raw: unknown): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== 'string') throw new HttpError(400, 'Invalid id');

  const id = Number(s);
  if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid id');
  return id;
}

function parseNonNegativeInt(raw: unknown, field: string): number | undefined {
  if (raw == null) return undefined;
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== 'string') throw new HttpError(400, `Invalid ${field}`);

  const trimmed = s.trim();
  if (!trimmed) throw new HttpError(400, `Invalid ${field}`);
  if (!/^\d+$/.test(trimmed)) throw new HttpError(400, `Invalid ${field}`);

  const value = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(value) || value < 0) throw new HttpError(400, `Invalid ${field}`);
  return value;
}

function parseBooleanQuery(raw: string | undefined, field: string): boolean | undefined {
  if (raw == null) return undefined;
  if (raw === '1' || raw.toLowerCase() === 'true') return true;
  if (raw === '0' || raw.toLowerCase() === 'false') return false;
  throw new HttpError(400, `Invalid ${field}`);
}

function parseAssigneeTypeQuery(raw: string | undefined): AssigneeType | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'agent' || normalized === 'human') return normalized;
  throw new HttpError(400, 'Invalid assigned_to_type');
}

export function createTasksRouter({ db, broadcast }: { db: Database; broadcast?: BroadcastFn }) {
  const router = express.Router();

  const repo = new TaskRepository(db);
  const projectRepo = new ProjectRepository(db);
  const service = new TaskService(repo);
  const anchors = new AnchorService(projectRepo);

  // GET /api/tasks
  router.get('/', (req: Request, res: Response, next: NextFunction) => {
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
    } = req.query as Record<string, string | undefined>;

    try {
      const parsedProjectId = project_id != null ? Number(project_id) : undefined;
      if (project_id != null && !Number.isFinite(parsedProjectId)) {
        throw new HttpError(400, 'Invalid project_id');
      }

      const parsedAssignedToId = assigned_to_id === undefined
        ? undefined
        : (assigned_to_id.trim() === '' ? null : assigned_to_id.trim());

      const tasks = service.list({
        status: status as TaskStatus | undefined,
        assigned_to_type: parseAssigneeTypeQuery(assigned_to_type),
        assigned_to_id: parsedAssignedToId,
        non_agent: parseBooleanQuery(non_agent, 'non_agent'),
        include_archived: include_archived === '1' || include_archived === 'true',
        project_id: parsedProjectId,
        context_key,
        context_type,
        is_someday: parseBooleanQuery(is_someday, 'is_someday'),
        limit: parseNonNegativeInt(limit, 'limit'),
        offset: parseNonNegativeInt(offset, 'offset'),
      });
      res.json(anchors.enrichMany(tasks));
    } catch (err) {
      next(err);
    }
  });

  // GET /api/tasks/:id
  router.get('/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      const task = service.getById(id);
      res.json(anchors.enrich(task));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/tasks
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const task = anchors.enrich(service.create(req.body));
      broadcast?.({ type: 'task_created', data: task });
      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/tasks/bulk/project
  router.post('/bulk/project', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { ids?: unknown; project_id?: unknown };
      const ids = Array.isArray(body.ids) ? body.ids.map((id) => Number(id)) : [];
      const projectId = body.project_id === undefined || body.project_id === null ? null : Number(body.project_id);
      const result = service.bulkAssignProject(ids, projectId);
      broadcast?.({ type: 'tasks_bulk_updated', data: { project_assigned: result.updated, project_id: projectId } });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/tasks/bulk/assignee
  router.post('/bulk/assignee', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { ids?: unknown; assigned_to_type?: unknown; assigned_to_id?: unknown };
      const ids = Array.isArray(body.ids) ? body.ids.map((id) => Number(id)) : [];
      const result = service.bulkAssignAssignee(ids, body.assigned_to_type, body.assigned_to_id);
      broadcast?.({
        type: 'tasks_bulk_updated',
        data: {
          assignee_assigned: result.updated,
          assigned_to_type: body.assigned_to_type ?? null,
          assigned_to_id: body.assigned_to_id ?? null,
        },
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/tasks/bulk/status
  router.post('/bulk/status', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { ids?: unknown; status?: unknown };
      const ids = Array.isArray(body.ids) ? body.ids.map((id) => Number(id)) : [];
      const statusValue = body.status;
      const result = service.bulkUpdateStatus(ids, statusValue);
      broadcast?.({ type: 'tasks_bulk_updated', data: { status_updated: result.updated, status: statusValue } });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/tasks/bulk/delete
  router.post('/bulk/delete', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as { ids?: unknown };
      const ids = Array.isArray(body.ids) ? body.ids.map((id) => Number(id)) : [];
      const result = service.bulkDelete(ids);
      broadcast?.({ type: 'tasks_bulk_updated', data: { deleted: result.deleted } });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/tasks/:id
  router.patch('/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      const before = service.getById(id);
      const task = anchors.enrich(service.update(id, req.body));
      broadcast?.({ type: 'task_updated', data: task });
      if (before.status !== 'done' && task.status === 'done') {
        const dependents = service.listNewlyUnblockedDependents(id);
        if (dependents.length > 0) {
          broadcast?.({
            type: 'tasks_newly_unblocked',
            data: {
              completed_task_id: id,
              dependents,
            },
          });
        }
      }
      res.json(task);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/tasks/:id
  router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      service.delete(id);
      broadcast?.({ type: 'task_deleted', data: { id } });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
