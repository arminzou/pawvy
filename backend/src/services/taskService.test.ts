import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import { TaskRepository } from '../repositories/taskRepository';
import { TaskService } from './taskService';
import { HttpError } from '../presentation/http/errors/httpError';
import { config } from '../config';

describe('TaskService', () => {
  let db: Database.Database;
  let repo: TaskRepository;
  let service: TaskService;

  beforeEach(() => {
    db = new Database(':memory:');
    const schema = fs.readFileSync(config.dbSchema, 'utf8');
    db.exec(schema);

    repo = new TaskRepository(db);
    service = new TaskService(repo);
  });

  describe('create assignee validation', () => {
    it('creates a task with agent assignee fields', () => {
      const task = service.create({
        title: 'Agent task',
        assigned_to_type: 'agent',
        assigned_to_id: 'tee',
      });

      expect(task.assigned_to_type).toBe('agent');
      expect(task.assigned_to_id).toBe('tee');
    });

    it('creates a task with human assignee fields', () => {
      const task = service.create({
        title: 'Human task',
        assigned_to_type: 'human',
        assigned_to_id: 'armin',
      });

      expect(task.assigned_to_type).toBe('human');
      expect(task.assigned_to_id).toBe('armin');
    });

    it('rejects non_agent tasks with agent assignees', () => {
      expect(() => {
        service.create({
          title: 'Invalid',
          non_agent: true,
          assigned_to_type: 'agent',
          assigned_to_id: 'tee',
        });
      }).toThrow(HttpError);

      try {
        service.create({
          title: 'Invalid',
          non_agent: true,
          assigned_to_type: 'agent',
          assigned_to_id: 'tee',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(HttpError);
        expect((err as HttpError).status).toBe(400);
      }
    });
  });

  describe('update assignee/non_agent validation', () => {
    it('rejects setting non_agent=true on a task assigned to an agent', () => {
      const task = service.create({
        title: 'Existing',
        assigned_to_type: 'agent',
        assigned_to_id: 'tee',
      });

      expect(() => service.update(task.id, { non_agent: true })).toThrow(HttpError);
    });

    it('rejects assigning an agent to a non_agent task', () => {
      const task = service.create({
        title: 'Personal task',
        non_agent: true,
      });

      expect(() => {
        service.update(task.id, {
          assigned_to_type: 'agent',
          assigned_to_id: 'tee',
        });
      }).toThrow(HttpError);
    });

    it('rejects self-referential task dependency', () => {
      const task = service.create({ title: 'Self dependency task' });
      expect(() =>
        service.update(task.id, {
          blocked_by_task_ids: [task.id],
        } as any),
      ).toThrow(HttpError);
    });
  });

  describe('list filters', () => {
    it('filters by non_agent', () => {
      service.create({ title: 'Inbox item', non_agent: true });
      service.create({ title: 'Agent item', non_agent: false });

      const inbox = service.list({ non_agent: true });
      const board = service.list({ non_agent: false });

      expect(inbox).toHaveLength(1);
      expect(inbox[0].non_agent).toBe(true);
      expect(board).toHaveLength(1);
      expect(board[0].non_agent).toBe(false);
    });

    it('filters by assigned_to_type', () => {
      service.create({
        title: 'Agent',
        assigned_to_type: 'agent',
        assigned_to_id: 'tee',
      });
      service.create({
        title: 'Human',
        assigned_to_type: 'human',
        assigned_to_id: 'armin',
      });

      const agents = service.list({ assigned_to_type: 'agent' });
      const humans = service.list({ assigned_to_type: 'human' });

      expect(agents).toHaveLength(1);
      expect(agents[0].assigned_to_type).toBe('agent');
      expect(humans).toHaveLength(1);
      expect(humans[0].assigned_to_type).toBe('human');
    });
  });
});
