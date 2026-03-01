import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnchorService } from './anchorService';
import { resetConfigCacheForTests } from '../config';
import type { Task } from '../domain/task';

function taskFixture(overrides: Partial<Task>): Task {
  return {
    id: 1,
    title: 'Task',
    description: null,
    status: 'backlog',
    priority: null,
    due_date: null,
    tags: [],
    blocked_reason: null,
    assigned_to_type: null,
    assigned_to_id: null,
    non_agent: false,
    anchor: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    archived_at: null,
    project_id: null,
    context_key: null,
    context_type: null,
    is_someday: false,
    blocked_by_task_ids: [],
    blocks_task_ids: [],
    is_dependency_blocked: false,
    resolved_anchor: null,
    anchor_source: null,
    ...overrides,
  };
}

describe('AnchorService', () => {
  const originalConfigEnv = process.env.CLAWBOARD_CONFIG;
  let configPath: string;

  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawboard-anchor-test-'));
    configPath = path.join(dir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          category_defaults: {
            infra: '/tmp/category-infra',
          },
          scratch_root: '/tmp/clawboard-scratch',
          allow_scratch_fallback: true,
          scratch_per_task: false,
        },
        null,
        2,
      ),
    );
    process.env.CLAWBOARD_CONFIG = configPath;
    resetConfigCacheForTests();
  });

  afterEach(() => {
    process.env.CLAWBOARD_CONFIG = originalConfigEnv;
    resetConfigCacheForTests();
  });

  it('resolves explicit task anchor first', () => {
    const service = new AnchorService({ getById: () => null });
    const task = taskFixture({ anchor: '/tmp/task-anchor' });

    const resolved = service.resolve(task);
    expect(resolved.resolved_anchor).toBe('/tmp/task-anchor');
    expect(resolved.anchor_source).toBe('task');
  });

  it('resolves project path when task anchor is absent', () => {
    const service = new AnchorService({
      getById: () => ({ id: 12, name: 'Test', slug: 'test', path: '/tmp/project-root' } as any),
    });

    const task = taskFixture({ project_id: 12 });
    const resolved = service.resolve(task);

    expect(resolved.resolved_anchor).toBe('/tmp/project-root');
    expect(resolved.anchor_source).toBe('project');
  });

  it('resolves category default from tags', () => {
    const service = new AnchorService({ getById: () => null });
    const task = taskFixture({ tags: ['infra'] });

    const resolved = service.resolve(task);
    expect(resolved.resolved_anchor).toBe('/tmp/category-infra');
    expect(resolved.anchor_source).toBe('category');
  });

  it('falls back to scratch root when no other source resolves', () => {
    const service = new AnchorService({ getById: () => null });
    const task = taskFixture({ tags: ['none'] });

    const resolved = service.resolve(task);
    expect(resolved.resolved_anchor).toBe('/tmp/clawboard-scratch');
    expect(resolved.anchor_source).toBe('scratch');
  });

  it('returns null anchor for non_agent tasks', () => {
    const service = new AnchorService({ getById: () => null });
    const task = taskFixture({ non_agent: true, anchor: '/tmp/ignored' });

    const resolved = service.resolve(task);
    expect(resolved.resolved_anchor).toBeNull();
    expect(resolved.anchor_source).toBeNull();
  });

  it('prioritizes task.anchor over project.path', () => {
    const service = new AnchorService({
      getById: () => ({ id: 5, name: 'Test', slug: 'test', path: '/tmp/project-root' } as any),
    });

    const task = taskFixture({
      project_id: 5,
      anchor: '/tmp/task-wins',
    });

    const resolved = service.resolve(task);
    expect(resolved.resolved_anchor).toBe('/tmp/task-wins');
    expect(resolved.anchor_source).toBe('task');
  });

  it('ignores unresolved env vars in task anchor and falls back', () => {
    const service = new AnchorService({ getById: () => null });
    const task = taskFixture({ anchor: '$MISSING_ENV/path' });

    const resolved = service.resolve(task);
    expect(resolved.resolved_anchor).toBe('/tmp/clawboard-scratch');
    expect(resolved.anchor_source).toBe('scratch');
  });
});
