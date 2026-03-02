import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../utils/testApp';
import { resetConfigCacheForTests } from '../../src/config';

describe('Webhook API', () => {
  let db: any;

  beforeEach(() => {
    process.env.PAWVY_API_KEY = '';
    delete process.env.PAWVY_AGENTS_INCLUDE;
    delete process.env.PAWVY_INCLUDE_AGENTS;
    resetConfigCacheForTests();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('broadcasts allowed agent status updates', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    await request(appCtx.app)
      .post('/api/webhook/pawvy')
      .send({
        event: 'agent:thinking',
        agentId: 'tee',
        thought: 'working',
        timestamp: '2026-02-20T00:00:00.000Z',
      })
      .expect(200);

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      type: 'agent_status_updated',
      data: {
        agentId: 'tee',
        status: 'thinking',
        lastActivity: '2026-02-20T00:00:00.000Z',
        thought: 'working',
        turnCount: undefined,
      },
    });
  });

  it('coerces timestamp + turnCount and accepts legacy aliases', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    await request(appCtx.app)
      .post('/api/webhook/pawvy')
      .send({
        type: 'agent:idle',
        agent: 'tee',
        thought: '  ',
        timestamp: '1708387200000',
        turnCount: '12',
      })
      .expect(200);

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({
      type: 'agent_status_updated',
      data: {
        agentId: 'tee',
        status: 'idle',
        lastActivity: '2024-02-20T00:00:00.000Z',
        thought: undefined,
        turnCount: 12,
      },
    });
  });

  it('returns 400 for malformed timestamp', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const res = await request(appCtx.app)
      .post('/api/webhook/pawvy')
      .send({
        event: 'agent:thinking',
        agentId: 'tee',
        timestamp: 'not-a-date',
      })
      .expect(400);

    expect(res.body).toEqual({ error: 'Invalid timestamp' });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed turnCount', async () => {
    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const invalidTurnCounts = ['-1', '1.5', '1e2', true];

    for (const turnCount of invalidTurnCounts) {
      const res = await request(appCtx.app)
        .post('/api/webhook/pawvy')
        .send({
          event: 'agent:thinking',
          agentId: 'tee',
          turnCount,
        })
        .expect(400);

      expect(res.body).toEqual({ error: 'Invalid turnCount' });
    }

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('ignores disallowed agents when include filter is configured', async () => {
    process.env.PAWVY_AGENTS_INCLUDE = 'tee';
    resetConfigCacheForTests();

    const broadcast = vi.fn();
    const appCtx = createTestApp({ broadcast });
    db = appCtx.db;

    const res = await request(appCtx.app)
      .post('/api/webhook/pawvy')
      .send({
        event: 'agent:thinking',
        agentId: 'fay',
        thought: 'not allowed',
      })
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      ignored: true,
      reason: 'agent_not_included',
    });
    expect(broadcast).not.toHaveBeenCalled();
  });
});
