import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../utils/testApp';

describe('Claude Tasks API', () => {
  let db: ReturnType<typeof createTestApp>['db'] | null = null;
  let previousHome: string | undefined;

  beforeEach(() => {
    process.env.PAWVY_API_KEY = '';
    previousHome = process.env.HOME;
  });

  afterEach(() => {
    if (db) db.close();
    db = null;
    process.env.HOME = previousHome;
  });

  it('reads native Claude tasks and maps to Pawvy tasks when possible', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pawvy-claude-tasks-'));
    const workspaceDir = path.join(tempHome, '.claude', 'tasks', 'workspace-a');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, '.highwatermark'), '42', 'utf8');
    fs.writeFileSync(
      path.join(workspaceDir, 'tasks.json'),
      JSON.stringify([
        {
          id: 'native-1',
          subject: 'Sync task #1',
          status: 'in_progress',
          blockedBy: ['native-0'],
          blocks: ['native-2'],
          updated_at: new Date().toISOString(),
          pawvy_task_id: 1,
        },
      ]),
      'utf8',
    );

    process.env.HOME = tempHome;

    const appCtx = createTestApp();
    db = appCtx.db;

    await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'Mapped task', status: 'backlog' })
      .expect(201);

    const res = await request(appCtx.app).get('/api/claude/tasks').expect(200);
    expect(res.body.workspaces).toEqual(
      expect.arrayContaining([expect.objectContaining({ workspace_id: 'workspace-a', highwatermark: 42 })]),
    );
    expect(res.body.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'native-1',
          title: 'Sync task #1',
          status: 'in_progress',
          dependencies: ['native-0'],
          mapped_task_id: 1,
          mapped_task_title: 'Mapped task',
        }),
      ]),
    );
  });

  it('chunks mapped task lookups to avoid sqlite variable overflow', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pawvy-claude-tasks-'));
    const workspaceDir = path.join(tempHome, '.claude', 'tasks', 'workspace-many');
    fs.mkdirSync(workspaceDir, { recursive: true });

    const mappedCount = 1200;
    const mappedRows: Array<{ id: string; subject: string; status: string; blockedBy: string[]; pawvy_task_id: number }> = [];
    process.env.HOME = tempHome;

    const appCtx = createTestApp();
    db = appCtx.db;

    const insertTask = db.prepare('INSERT INTO tasks (title, status) VALUES (?, ?)');
    for (let i = 1; i <= mappedCount; i += 1) {
      insertTask.run(`Mapped task ${i}`, 'backlog');
      mappedRows.push({
        id: `native-${i}`,
        subject: `Native task ${i}`,
        status: 'pending',
        blockedBy: [],
        pawvy_task_id: i,
      });
    }

    fs.writeFileSync(path.join(workspaceDir, 'tasks.json'), JSON.stringify(mappedRows), 'utf8');

    const res = await request(appCtx.app).get('/api/claude/tasks').expect(200);
    expect(res.body.tasks).toHaveLength(mappedCount);
    expect(res.body.tasks[0]).toEqual(
      expect.objectContaining({
        id: 'native-1',
        title: 'Native task 1',
        mapped_task_id: 1,
        mapped_task_title: 'Mapped task 1',
        mapped_task_status: 'backlog',
      }),
    );
    expect(res.body.tasks[mappedCount - 1]).toEqual(
      expect.objectContaining({
        id: `native-${mappedCount}`,
        title: `Native task ${mappedCount}`,
        mapped_task_id: mappedCount,
        mapped_task_title: `Mapped task ${mappedCount}`,
        mapped_task_status: 'backlog',
      }),
    );
  });
});
