import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../utils/testApp';

describe('Docs API', () => {
  let db: any;

  beforeEach(() => {
    process.env.PAWVY_API_KEY = '';
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('syncs and lists documents', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const sync = await request(appCtx.app)
      .post('/api/docs/sync')
      .send({
        file_path: 'docs/readme.md',
        file_type: 'md',
        last_modified: new Date().toISOString(),
        last_modified_by: 'tee',
        size_bytes: 10,
        git_status: 'modified',
      })
      .expect(200);

    expect(sync.body.file_path).toBe('docs/readme.md');
    expect(broadcast).toHaveBeenCalledWith({ type: 'document_updated', data: sync.body });

    const list = await request(appCtx.app).get('/api/docs?git_status=modified').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].linked_tasks).toEqual([]);

    // Unknown query params should not break listing.
    await request(appCtx.app).get('/api/docs?project_id=1').expect(200);

    const stats = await request(appCtx.app).get('/api/docs/stats').expect(200);
    expect(stats.body.total).toBe(1);
  });

  it('resyncs documents via utility', async () => {
    const broadcast = vi.fn();
    const syncDocs = () => ({ files: 2, workspaceRoot: '/tmp' });
    const appCtx = createTestApp({ broadcast, syncDocs });
    db = appCtx.db;

    const resync = await request(appCtx.app).post('/api/docs/resync').send({ workspace_root: '/tmp' }).expect(200);
    expect(resync.body.files).toBe(2);
    expect(broadcast).toHaveBeenCalledWith({ type: 'document_resynced', data: { files: 2, workspaceRoot: '/tmp' } });
  });

  it('updates doc metadata and attaches docs to tasks', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    const doc = await request(appCtx.app)
      .post('/api/docs/sync')
      .send({ file_path: 'docs/spec.md', file_type: 'md', git_status: 'clean' })
      .expect(200);

    const task = await request(appCtx.app)
      .post('/api/tasks')
      .send({ title: 'Link docs', status: 'backlog' })
      .expect(201);

    const tagged = await request(appCtx.app)
      .patch(`/api/docs/${doc.body.id}`)
      .send({ doc_type_tag: 'spec' })
      .expect(200);
    expect(tagged.body.doc_type_tag).toBe('spec');

    const linked = await request(appCtx.app)
      .post(`/api/docs/${doc.body.id}/attach-task`)
      .send({ task_id: task.body.id })
      .expect(200);
    expect(linked.body.linked_tasks).toEqual([
      expect.objectContaining({ id: task.body.id, title: 'Link docs' }),
    ]);

    const accessed = await request(appCtx.app)
      .post(`/api/docs/${doc.body.id}/accessed`)
      .send({})
      .expect(200);
    expect(accessed.body.last_accessed_at).toBeTruthy();
  });
});
