import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../utils/testApp';

describe('API key middleware', () => {
  let db: any;

  afterEach(() => {
    if (db) db.close();
    process.env.PAWVY_API_KEY = '';
  });

  it('blocks requests without key when enabled', async () => {
    const testKey = 'test-secret-key-' + Date.now();
    process.env.PAWVY_API_KEY = testKey;
    const appCtx = createTestApp();
    db = appCtx.db;

    await request(appCtx.app).get('/api/tasks').expect(401);

    await request(appCtx.app)
      .get('/api/tasks')
      .set('x-api-key', testKey)
      .expect(200);
  });
});
