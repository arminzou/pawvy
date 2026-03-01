import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../utils/testApp';
import { resetConfigCacheForTests } from '../../src/config';

type TaskLike = {
  id: number;
  status: string;
  archived_at?: string | null;
  assigned_to_type?: 'agent' | 'human' | null;
  assigned_to_id?: string | null;
  project_id?: number | null;
  completed_at?: string | null;
  blocked_by_task_ids?: number[];
  blocks_task_ids?: number[];
  is_dependency_blocked?: boolean;
  resolved_anchor?: string | null;
  anchor_source?: 'task' | 'project' | 'category' | 'scratch' | null;
  non_agent?: boolean;
};

type TestDb = ReturnType<typeof createTestApp>['db'];

describe('Tasks API', () => {
  let db: TestDb | null = null;
  let previousConfigPath: string | undefined;

  beforeEach(() => {
    process.env.CLAWBOARD_API_KEY = '';
    previousConfigPath = process.env.CLAWBOARD_CONFIG;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawboard-tasks-router-'));
    const cfgPath = path.join(dir, 'config.json');
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({
        scratch_root: '/tmp/test-scratch',
        allow_scratch_fallback: true,
        scratch_per_task: false,
      }),
    );

    process.env.CLAWBOARD_CONFIG = cfgPath;
    resetConfigCacheForTests();
  });

  afterEach(() => {
    if (db) db.close();
    db = null;
    process.env.CLAWBOARD_CONFIG = previousConfigPath;
    resetConfigCacheForTests();
  });

  it('creates, updates, lists, and deletes tasks with typed assignee fields', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const create = await request(appCtx.app)
      .post('/api/tasks')
      .send({
        title: 'Typed Task',
        status: 'backlog',
        assigned_to_type: 'agent',
        assigned_to_id: 'tee',
      })
      .expect(201);

    expect(create.body.title).toBe('Typed Task');
    expect(create.body.assigned_to_type).toBe('agent');
    expect(create.body.assigned_to_id).toBe('tee');
    expect(create.body).toHaveProperty('resolved_anchor');
    expect(create.body).toHaveProperty('anchor_source');
    expect(broadcast).toHaveBeenCalledWith({ type: 'task_created', data: create.body });

    const list = await request(appCtx.app).get('/api/tasks').expect(200);
    expect(list.body).toHaveLength(1);

    const update = await request(appCtx.app)
      .patch(`/api/tasks/${create.body.id}`)
      .send({ status: 'in_progress' })
      .expect(200);
    expect(update.body.status).toBe('in_progress');
    expect(update.body.assigned_to_type).toBe('agent');
    expect(broadcast).toHaveBeenCalledWith({ type: 'task_updated', data: update.body });

    await request(appCtx.app).delete(`/api/tasks/${create.body.id}`).expect(204);
    expect(broadcast).toHaveBeenCalledWith({ type: 'task_deleted', data: { id: create.body.id } });

    const after = await request(appCtx.app).get('/api/tasks').expect(200);
    expect(after.body).toHaveLength(0);
  });

  it('enriches list response with resolved_anchor and anchor_source', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    const project = appCtx.db
      .prepare('INSERT INTO projects (name, slug, path) VALUES (?, ?, ?)')
      .run('Clawboard', 'clawboard', '/tmp/clawboard-project');
    const projectId = Number(project.lastInsertRowid);

    await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'Project task', status: 'backlog', project_id: projectId })
      .expect(201);

    const list = await request(appCtx.app).get('/api/tasks').expect(200);
    const task = (list.body as TaskLike[])[0];

    expect(task.resolved_anchor).toBe('/tmp/clawboard-project');
    expect(task.anchor_source).toBe('project');
  });

  it('supports archive_done with typed assignee filter', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const taskA = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'A', status: 'done', assigned_to_type: 'agent', assigned_to_id: 'tee' })
      .expect(201);

    await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'B', status: 'done', assigned_to_type: 'agent', assigned_to_id: 'fay' })
      .expect(201);

    await request(appCtx.app)
      .post('/api/tasks/archive_done')
      .send({ assigned_to_type: 'agent', assigned_to_id: 'tee' })
      .expect(200);

    const includeArchived = await request(appCtx.app).get('/api/tasks?include_archived=1').expect(200);
    const archived = (includeArchived.body as TaskLike[]).find((t) => t.id === taskA.body.id);
    expect(archived?.archived_at).toBeTruthy();

    expect(broadcast).toHaveBeenCalledWith({ type: 'tasks_bulk_updated', data: { archived_done: 1 } });
  });

  it('assigns assignee for multiple tasks in one request using typed fields', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const taskA = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'A', status: 'backlog' })
      .expect(201);

    const taskB = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'B', status: 'backlog' })
      .expect(201);

    const assign = await request(appCtx.app)
      .post('/api/tasks/bulk/assignee')
      .send({ ids: [taskA.body.id, taskB.body.id], assigned_to_type: 'agent', assigned_to_id: 'tee' })
      .expect(200);

    expect(assign.body).toEqual({ updated: 2 });
    expect(broadcast).toHaveBeenCalledWith({
      type: 'tasks_bulk_updated',
      data: { assignee_assigned: 2, assigned_to_type: 'agent', assigned_to_id: 'tee' },
    });

    const tasks = await request(appCtx.app).get('/api/tasks').expect(200);
    const mapped = new Map((tasks.body as TaskLike[]).map((t) => [t.id, t]));
    expect(mapped.get(taskA.body.id)?.assigned_to_type).toBe('agent');
    expect(mapped.get(taskA.body.id)?.assigned_to_id).toBe('tee');
    expect(mapped.get(taskB.body.id)?.assigned_to_type).toBe('agent');
    expect(mapped.get(taskB.body.id)?.assigned_to_id).toBe('tee');
  });

  it('assigns project for multiple tasks in one request', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const project = appCtx.db
      .prepare('INSERT INTO projects (name, slug, path) VALUES (?, ?, ?)')
      .run('Clawboard', 'clawboard', '/tmp/clawboard-project');
    const projectId = Number(project.lastInsertRowid);

    const taskA = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'A', status: 'backlog' })
      .expect(201);

    const taskB = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'B', status: 'backlog' })
      .expect(201);

    const assign = await request(appCtx.app)
      .post('/api/tasks/bulk/project')
      .send({ ids: [taskA.body.id, taskB.body.id], project_id: projectId })
      .expect(200);

    expect(assign.body).toEqual({ updated: 2 });
    expect(broadcast).toHaveBeenCalledWith({
      type: 'tasks_bulk_updated',
      data: { project_assigned: 2, project_id: projectId },
    });

    const tasks = await request(appCtx.app).get('/api/tasks').expect(200);
    const mapped = new Map((tasks.body as TaskLike[]).map((t) => [t.id, t]));
    expect(mapped.get(taskA.body.id)?.project_id).toBe(projectId);
    expect(mapped.get(taskB.body.id)?.project_id).toBe(projectId);
  });

  it('updates status for multiple tasks in one request', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const taskA = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'A', status: 'backlog' })
      .expect(201);

    const taskB = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'B', status: 'in_progress' })
      .expect(201);

    const update = await request(appCtx.app)
      .post('/api/tasks/bulk/status')
      .send({ ids: [taskA.body.id, taskB.body.id], status: 'done' })
      .expect(200);

    expect(update.body).toEqual({ updated: 2 });
    expect(broadcast).toHaveBeenCalledWith({
      type: 'tasks_bulk_updated',
      data: { status_updated: 2, status: 'done' },
    });

    const tasks = await request(appCtx.app).get('/api/tasks').expect(200);
    const mapped = new Map((tasks.body as TaskLike[]).map((t) => [t.id, t]));
    expect(mapped.get(taskA.body.id)?.status).toBe('done');
    expect(mapped.get(taskB.body.id)?.status).toBe('done');
    expect(mapped.get(taskA.body.id)?.completed_at).toBeTruthy();
    expect(mapped.get(taskB.body.id)?.completed_at).toBeTruthy();
  });

  it('deletes multiple tasks in one request', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const taskA = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'A', status: 'backlog' })
      .expect(201);

    const taskB = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'B', status: 'backlog' })
      .expect(201);

    const result = await request(appCtx.app)
      .post('/api/tasks/bulk/delete')
      .send({ ids: [taskA.body.id, taskB.body.id] })
      .expect(200);

    expect(result.body).toEqual({ deleted: 2 });
    expect(broadcast).toHaveBeenCalledWith({
      type: 'tasks_bulk_updated',
      data: { deleted: 2 },
    });

    const tasks = await request(appCtx.app).get('/api/tasks').expect(200);
    expect(tasks.body).toHaveLength(0);
  });

  it('returns 400 for invalid bulk assignee payload', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    const task = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'A', status: 'backlog' })
      .expect(201);

    await request(appCtx.app)
      .post('/api/tasks/bulk/assignee')
      .send({ ids: [], assigned_to_type: 'agent', assigned_to_id: 'tee' })
      .expect(400);

    await request(appCtx.app)
      .post('/api/tasks/bulk/assignee')
      .send({ ids: [task.body.id], assigned_to_type: 'agent', assigned_to_id: null })
      .expect(400);

    await request(appCtx.app)
      .post('/api/tasks/bulk/assignee')
      .send({ ids: [task.body.id], assigned_to_type: null, assigned_to_id: 'tee' })
      .expect(400);

    await request(appCtx.app)
      .post('/api/tasks/bulk/status')
      .send({ ids: [task.body.id], status: 'invalid' })
      .expect(400);
  });

  it('filters by non_agent and supports limit/offset pagination', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    await request(appCtx.app).post('/api/tasks').send({ title: 'A', status: 'backlog', non_agent: false }).expect(201);
    await request(appCtx.app).post('/api/tasks').send({ title: 'B', status: 'backlog', non_agent: true }).expect(201);
    await request(appCtx.app).post('/api/tasks').send({ title: 'C', status: 'backlog', non_agent: false }).expect(201);

    const inbox = await request(appCtx.app).get('/api/tasks?non_agent=1').expect(200);
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0].non_agent).toBe(true);

    const paged = await request(appCtx.app).get('/api/tasks?non_agent=0&limit=1&offset=1').expect(200);
    expect(paged.body).toHaveLength(1);
    expect(paged.body[0].title).toBe('C');
  });

  it('returns 400 for invalid pagination or id params', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    await request(appCtx.app).get('/api/tasks?limit=-1').expect(400);
    await request(appCtx.app).get('/api/tasks?offset=1.5').expect(400);
    await request(appCtx.app).get('/api/tasks?non_agent=maybe').expect(400);
    await request(appCtx.app).get('/api/tasks/not-a-number').expect(400);
  });

  it('stores task dependencies and computes dependency-blocked state', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    const blocker = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'Blocker', status: 'backlog' })
      .expect(201);

    const dependent = await request(appCtx.app)
      .post('/api/tasks')
      .send({
        title: 'Dependent',
        status: 'backlog',
        blocked_by_task_ids: [blocker.body.id],
      })
      .expect(201);

    expect(dependent.body.blocked_by_task_ids).toEqual([blocker.body.id]);
    expect(dependent.body.is_dependency_blocked).toBe(true);

    const list = await request(appCtx.app).get('/api/tasks').expect(200);
    const blockerTask = (list.body as TaskLike[]).find((task) => task.id === blocker.body.id);
    const dependentTask = (list.body as TaskLike[]).find((task) => task.id === dependent.body.id);

    expect(blockerTask?.blocks_task_ids).toContain(dependent.body.id);
    expect(dependentTask?.blocked_by_task_ids).toEqual([blocker.body.id]);
    expect(dependentTask?.is_dependency_blocked).toBe(true);
  });

  it('broadcasts newly unblocked dependents when a prerequisite is completed', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const blocker = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'Blocker', status: 'in_progress' })
      .expect(201);

    const dependent = await request(appCtx.app)
      .post('/api/tasks')
      .send({
        title: 'Dependent',
        status: 'backlog',
        blocked_by_task_ids: [blocker.body.id],
      })
      .expect(201);

    await request(appCtx.app)
      .patch(`/api/tasks/${blocker.body.id}`)
      .send({ status: 'done' })
      .expect(200);

    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tasks_newly_unblocked',
        data: {
          completed_task_id: blocker.body.id,
          dependents: [{ id: dependent.body.id, title: 'Dependent' }],
        },
      }),
    );
  });
});
