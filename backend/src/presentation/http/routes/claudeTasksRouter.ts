import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Database } from 'better-sqlite3';

type ClaudeTaskRow = {
  id: string;
  title: string;
  status: string;
  updated_at: string | null;
  dependencies: string[];
  source_file: string;
  mapped_task_id: number | null;
  mapped_task_title: string | null;
  mapped_task_status: string | null;
};

type WorkspaceSummary = {
  workspace_id: string;
  path: string;
  updated_at: string | null;
  highwatermark: number | null;
};

const SQLITE_IN_MAX_VARIABLES = 900;

function normalizeStatus(raw: unknown): string {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return 'unknown';
  return value;
}

function normalizeIsoDate(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'number') {
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    const d = new Date(text);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return null;
}

function normalizeDependencies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const dep of raw) {
    const id = String(dep ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeTaskTitle(value: Record<string, unknown>): string {
  return String(value.title ?? value.subject ?? value.name ?? value.summary ?? value.activeForm ?? '').trim();
}

function normalizeTaskRecord(raw: unknown, sourceFile: string): ClaudeTaskRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const inferredId = String(value.id ?? value.task_id ?? value.uuid ?? '').trim();
  const inferredTitle = normalizeTaskTitle(value);
  if (!inferredId && !inferredTitle) return null;

  const mappedTaskIdRaw = value.clawboard_task_id ?? value.task_id ?? null;
  const mappedFromBody = mappedTaskIdRaw == null ? null : Number(mappedTaskIdRaw);
  const mappedFromTitle = inferredTitle.match(/#(\d+)/)?.[1];
  const mappedTaskId = Number.isInteger(mappedFromBody)
    ? mappedFromBody
    : (mappedFromTitle ? Number(mappedFromTitle) : null);

  return {
    id: inferredId || `native:${path.basename(sourceFile)}:${inferredTitle}`,
    title: inferredTitle || `Task ${inferredId}`,
    status: normalizeStatus(value.status ?? value.state),
    updated_at: normalizeIsoDate(value.updated_at ?? value.updatedAt ?? value.modified_at ?? value.timestamp),
    dependencies: normalizeDependencies(
      value.blockedBy
      ?? value.blocked_by
      ?? value.dependencies
      ?? value.dependency_ids
      ?? value.depends_on,
    ),
    source_file: sourceFile,
    mapped_task_id: Number.isInteger(mappedTaskId) ? mappedTaskId : null,
    mapped_task_title: null,
    mapped_task_status: null,
  };
}

function walkFiles(root: string, maxDepth = 4): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];

  function visit(current: string, depth: number) {
    if (depth > maxDepth) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(full, depth + 1);
      } else {
        out.push(full);
      }
    }
  }

  visit(root, 0);
  return out;
}

function parseTaskFiles(files: string[], baseDir: string): ClaudeTaskRow[] {
  const out: ClaudeTaskRow[] = [];

  for (const filePath of files) {
    try {
      const rel = path.relative(baseDir, filePath);
      const ext = path.extname(filePath).toLowerCase();
      const content = fs.readFileSync(filePath, 'utf8');

      if (ext === '.json' || !ext) {
        const parsed = JSON.parse(content) as unknown;
        if (Array.isArray(parsed)) {
          for (const row of parsed) {
            const normalized = normalizeTaskRecord(row, rel);
            if (normalized) out.push(normalized);
          }
        } else {
          const normalized = normalizeTaskRecord(parsed, rel);
          if (normalized) out.push(normalized);
        }
        continue;
      }

      if (ext === '.jsonl' || ext === '.ndjson') {
        const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
        for (const line of lines) {
          try {
            const normalized = normalizeTaskRecord(JSON.parse(line), rel);
            if (normalized) out.push(normalized);
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch {
      // isolate parse/read errors to individual files
    }
  }

  return out;
}

function resolveWorkspaceSummaries(root: string): WorkspaceSummary[] {
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  return entries.map((entry) => {
    const workspacePath = path.join(root, entry.name);
    const highwaterPath = path.join(workspacePath, '.highwatermark');
    let highwatermark: number | null = null;
    if (fs.existsSync(highwaterPath)) {
      const raw = fs.readFileSync(highwaterPath, 'utf8').trim();
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) highwatermark = parsed;
    }

    const stat = fs.statSync(workspacePath);
    return {
      workspace_id: entry.name,
      path: workspacePath,
      updated_at: Number.isFinite(stat.mtimeMs) ? new Date(stat.mtimeMs).toISOString() : null,
      highwatermark,
    };
  });
}

export function createClaudeTasksRouter({ db }: { db: Database }) {
  const router = express.Router();

  // GET /api/claude/tasks
  router.get('/tasks', (req: Request, res: Response, next: NextFunction) => {
    try {
      const baseDir = path.join(os.homedir(), '.claude', 'tasks');
      const files = walkFiles(baseDir);
      const parsed = parseTaskFiles(files, baseDir);

      const mappedIds = Array.from(
        new Set(
          parsed
            .map((task) => task.mapped_task_id)
            .filter((id): id is number => Number.isInteger(id)),
        ),
      );

      const mappedTaskLookup = new Map<number, { title: string; status: string }>();
      if (mappedIds.length > 0) {
        for (let i = 0; i < mappedIds.length; i += SQLITE_IN_MAX_VARIABLES) {
          const batch = mappedIds.slice(i, i + SQLITE_IN_MAX_VARIABLES);
          const placeholders = batch.map(() => '?').join(', ');
          const rows = db
            .prepare(`SELECT id, title, status FROM tasks WHERE id IN (${placeholders})`)
            .all(...batch) as Array<{ id: number; title: string; status: string }>;
          for (const row of rows) {
            mappedTaskLookup.set(row.id, { title: row.title, status: row.status });
          }
        }
      }

      const tasks = parsed.map((task) => {
        if (task.mapped_task_id == null) return task;
        const mapped = mappedTaskLookup.get(task.mapped_task_id);
        if (!mapped) return task;
        return {
          ...task,
          mapped_task_title: mapped.title,
          mapped_task_status: mapped.status,
        };
      });

      tasks.sort((a, b) => {
        const at = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bt = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bt - at;
      });

      res.json({
        base_dir: baseDir,
        workspaces: resolveWorkspaceSummaries(baseDir),
        tasks,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
