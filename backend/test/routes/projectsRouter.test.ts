import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../utils/testApp';

describe('Projects API', () => {
  let db: any;
  let previousProjectsDir: string | undefined;

  beforeEach(() => {
    process.env.PAWVY_API_KEY = '';
    previousProjectsDir = process.env.PAWVY_PROJECTS_DIR;
  });

  afterEach(() => {
    if (db) db.close();
    process.env.PAWVY_PROJECTS_DIR = previousProjectsDir;
  });

  it('lists, gets, updates, and deletes projects', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    db.prepare('INSERT INTO projects (name, slug, path) VALUES (?, ?, ?)').run('Claw', 'claw', '/tmp/claw');
    const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get('claw');

    const list = await request(appCtx.app).get('/api/projects').expect(200);
    expect(list.body).toHaveLength(1);

    const get = await request(appCtx.app).get(`/api/projects/${project.id}`).expect(200);
    expect(get.body.name).toBe('Claw');

    const update = await request(appCtx.app)
      .patch(`/api/projects/${project.id}`)
      .send({ description: 'Updated' })
      .expect(200);
    expect(update.body.description).toBe('Updated');

    // delete without cleanup => tasks set to null
    db.prepare('INSERT INTO tasks (title, status, project_id) VALUES (?, ?, ?)').run('Task', 'backlog', project.id);

    await request(appCtx.app)
      .delete(`/api/projects/${project.id}?cleanupTasks=false`)
      .expect(200);

    const task = db.prepare('SELECT * FROM tasks').get();
    expect(task.project_id).toBeNull();
  });

  it('summary stats and project stats endpoints return data', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    db.prepare('INSERT INTO projects (name, slug, path) VALUES (?, ?, ?)').run('Alpha', 'alpha', '/tmp/alpha');
    const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get('alpha');
    db.prepare('INSERT INTO tasks (title, status, project_id) VALUES (?, ?, ?)').run('Task', 'backlog', project.id);

    const summary = await request(appCtx.app).get('/api/projects/stats/summary').expect(200);
    expect(summary.body.projects.total).toBe(1);

    const stats = await request(appCtx.app).get(`/api/projects/${project.id}/stats`).expect(200);
    expect(stats.body.project_id).toBe(project.id);
  });

  it('creates a manual project via POST /api/projects', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    const created = await request(appCtx.app)
      .post('/api/projects')
      .send({ name: 'Manual Workspace', path: '/tmp/manual-workspace', description: 'manual' })
      .expect(201);

    expect(created.body.name).toBe('Manual Workspace');
    expect(created.body.slug).toBe('manual-workspace');
    expect(created.body.path).toBe('/tmp/manual-workspace');

    const list = await request(appCtx.app).get('/api/projects').expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('discover skips directories already registered manually by path', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pawvy-discover-'));
    const discoveredDir = path.join(root, 'auto-project');
    fs.mkdirSync(discoveredDir, { recursive: true });
    process.env.PAWVY_PROJECTS_DIR = root;

    await request(appCtx.app)
      .post('/api/projects')
      .send({ name: 'Manual Project', path: discoveredDir })
      .expect(201);

    const discover = await request(appCtx.app).post('/api/projects/discover').expect(200);
    expect(discover.body.discovered).toBe(0);

    const list = await request(appCtx.app).get('/api/projects').expect(200);
    expect(list.body).toHaveLength(1);
  });
});
