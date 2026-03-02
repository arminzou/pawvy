import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../utils/testApp';
import { resetConfigCacheForTests } from '../../src/config';

describe('Settings API', () => {
  let db: ReturnType<typeof createTestApp>['db'] | null = null;
  let previousOpenClawHome: string | undefined;
  let previousAgentProfilesPath: string | undefined;
  let openClawHome: string;
  let profilesPath: string;

  beforeEach(() => {
    process.env.PAWVY_API_KEY = '';
    previousOpenClawHome = process.env.OPENCLAW_HOME;
    previousAgentProfilesPath = process.env.PAWVY_AGENT_PROFILES_PATH;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pawvy-settings-router-'));
    openClawHome = path.join(tempDir, 'openclaw');
    fs.mkdirSync(openClawHome, { recursive: true });
    fs.writeFileSync(
      path.join(openClawHome, 'openclaw.json'),
      JSON.stringify({ agents: { list: [{ id: 'tee' }] } }),
      'utf8',
    );

    profilesPath = path.join(tempDir, 'agent-profiles.json');
    process.env.OPENCLAW_HOME = openClawHome;
    process.env.PAWVY_AGENT_PROFILES_PATH = profilesPath;
    resetConfigCacheForTests();
  });

  afterEach(() => {
    if (db) db.close();
    db = null;
    process.env.OPENCLAW_HOME = previousOpenClawHome;
    process.env.PAWVY_AGENT_PROFILES_PATH = previousAgentProfilesPath;
    resetConfigCacheForTests();
  });

  it('lists and updates agent cosmetic settings', async () => {
    const appCtx = createTestApp();
    db = appCtx.db;

    const list = await request(appCtx.app).get('/api/settings/agents').expect(200);
    expect(list.body.agents).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'tee' })]));

    const updated = await request(appCtx.app)
      .patch('/api/settings/agents/tee')
      .send({
        display_name: 'Tee',
        avatar: '🧠',
        description: 'Methods-first coder',
      })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: 'tee',
      display_name: 'Tee',
      avatar: '🧠',
      description: 'Methods-first coder',
    });

    const persisted = JSON.parse(fs.readFileSync(profilesPath, 'utf8')) as Record<string, unknown>;
    expect(persisted.tee).toEqual(
      expect.objectContaining({
        displayName: 'Tee',
        avatar: '🧠',
        description: 'Methods-first coder',
      }),
    );
  });
});

