import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTestApp } from '../utils/testApp';
import { resetConfigCacheForTests } from '../../src/config';

describe('OpenClaw API', () => {
  let db: any;
  const tempDirs: string[] = [];

  beforeEach(() => {
    process.env.PAWVY_API_KEY = '';
    delete process.env.PAWVY_AGENTS_INCLUDE;
    delete process.env.PAWVY_INCLUDE_AGENTS;
    delete process.env.OPENCLAW_HOME;
    resetConfigCacheForTests();
  });

  afterEach(() => {
    if (db) db.close();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns status with optional profile maps', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    const res = await request(appCtx.app).get('/api/openclaw/status').expect(200);
    expect(typeof res.body.detected).toBe('boolean');
    expect(Array.isArray(res.body.agents)).toBe(true);
    expect(Array.isArray(res.body.discoveredAgents)).toBe(true);
    expect(typeof res.body.pluginAgentProfiles).toBe('object');
    expect(typeof res.body.agentProfiles).toBe('object');
  });

  it('applies agent include filter from env', async () => {
    process.env.PAWVY_AGENTS_INCLUDE = 'tee, fay';
    resetConfigCacheForTests();

    const appCtx = createTestApp();
    db = appCtx.db;

    const res = await request(appCtx.app).get('/api/openclaw/status').expect(200);
    expect(res.body.includedAgents).toEqual(['tee', 'fay']);
    expect(res.body.agents).toEqual(['tee', 'fay']);
  });

  it('prefers agents.list in openclaw.json for discovery', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pawvy-oc-'));
    tempDirs.push(tempHome);
    fs.writeFileSync(
      path.join(tempHome, 'openclaw.json'),
      JSON.stringify({ agents: { list: [{ id: 'alpha' }, { id: 'beta' }] } }),
      'utf8',
    );
    fs.mkdirSync(path.join(tempHome, 'workspace-legacy'));
    process.env.OPENCLAW_HOME = tempHome;
    resetConfigCacheForTests();

    const appCtx = createTestApp();
    db = appCtx.db;

    const res = await request(appCtx.app).get('/api/openclaw/status').expect(200);
    expect(res.body.discoveredAgents).toEqual(['alpha', 'beta']);
    expect(res.body.agents).toEqual(['alpha', 'beta']);
  });

  it('falls back to main when no list/workspace agent dirs are found', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pawvy-oc-'));
    tempDirs.push(tempHome);
    process.env.OPENCLAW_HOME = tempHome;
    resetConfigCacheForTests();

    const appCtx = createTestApp();
    db = appCtx.db;

    const res = await request(appCtx.app).get('/api/openclaw/status').expect(200);
    expect(res.body.discoveredAgents).toEqual(['main']);
    expect(res.body.agents).toEqual(['main']);
  });

  it('uses legacy workspace dir discovery when openclaw.json has no agents.list', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pawvy-oc-'));
    tempDirs.push(tempHome);
    fs.writeFileSync(path.join(tempHome, 'openclaw.json'), JSON.stringify({ plugins: {} }), 'utf8');
    fs.mkdirSync(path.join(tempHome, 'workspace-fay'));
    fs.mkdirSync(path.join(tempHome, 'workspace-main'));
    process.env.OPENCLAW_HOME = tempHome;
    resetConfigCacheForTests();

    const appCtx = createTestApp();
    db = appCtx.db;

    const res = await request(appCtx.app).get('/api/openclaw/status').expect(200);
    expect((res.body.discoveredAgents as string[]).slice().sort()).toEqual(['fay', 'main']);
  });
});
