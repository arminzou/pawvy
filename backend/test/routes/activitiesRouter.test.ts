import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../utils/testApp';

describe('Activities API', () => {
  let db: any;

  beforeEach(() => {
    process.env.PAWVY_API_KEY = '';
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('creates and lists activities with filters', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const create = await request(appCtx.app)
      .post('/api/activities')
      .send({ agent: 'tee', activity_type: 'message', description: 'hello' })
      .expect(201);

    expect(broadcast).toHaveBeenCalledWith({ type: 'activity_created', data: create.body });

    const list = await request(appCtx.app).get('/api/activities?agent=tee').expect(200);
    expect(list.body).toHaveLength(1);

    const byAgent = await request(appCtx.app).get('/api/activities/agent/tee?limit=5').expect(200);
    expect(byAgent.body).toHaveLength(1);

    // Unknown query params should not break listing.
    await request(appCtx.app).get('/api/activities?project_id=1').expect(200);
  });

  it('rejects missing required fields', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    await request(appCtx.app).post('/api/activities').send({ agent: 'tee' }).expect(400);
  });

  it('returns stats', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    await request(appCtx.app)
      .post('/api/activities')
      .send({ agent: 'tee', activity_type: 'message', description: 'hello' })
      .expect(201);

    const stats = await request(appCtx.app).get('/api/activities/stats').expect(200);
    expect(stats.body.total).toBeGreaterThan(0);
  });

  it('filters activities by task/project/date range', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    const project = db.prepare('INSERT INTO projects (name, slug, path) VALUES (?, ?, ?)').run(
      'Pawvy',
      'pawvy',
      '/tmp/pawvy',
    );
    const projectId = Number(project.lastInsertRowid);

    const task = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'Activity link', status: 'backlog', project_id: projectId })
      .expect(201);

    const now = new Date().toISOString();
    await request(appCtx.app)
      .post('/api/activities')
      .send({
        agent: 'tee',
        activity_type: 'message',
        description: 'linked activity',
        related_task_id: task.body.id,
      })
      .expect(201);

    await request(appCtx.app)
      .post('/api/activities')
      .send({
        agent: 'tee',
        activity_type: 'message',
        description: 'unlinked activity',
      })
      .expect(201);

    const byTask = await request(appCtx.app).get(`/api/activities?task_id=${task.body.id}`).expect(200);
    expect(byTask.body).toHaveLength(1);

    const byProject = await request(appCtx.app).get(`/api/activities?project_id=${projectId}`).expect(200);
    expect(byProject.body).toHaveLength(1);

    const byDate = await request(appCtx.app).get(`/api/activities?date_from=${encodeURIComponent(now)}`).expect(200);
    expect(byDate.body.length).toBeGreaterThanOrEqual(1);
  });
});
