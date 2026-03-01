const fs = require('fs');
const path = require('path');

function migrate(db) {
  // Very small migration system using PRAGMA user_version.
  // 0 -> 1: add activities.source_id + unique index
  const v = db.pragma('user_version', { simple: true });
  const hasColumn = (table, name) =>
    Boolean(db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(name));
  if (v < 1) {
    const hasSourceId = db
      .prepare("SELECT 1 FROM pragma_table_info('activities') WHERE name='source_id'")
      .get();

    if (!hasSourceId) {
      db.exec("ALTER TABLE activities ADD COLUMN source_id TEXT");
    }

    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_source_id ON activities(source_id)');

    db.pragma('user_version = 1');
  }

  // 1 -> 2: add tasks.archived_at + index
  if (v < 2) {
    const hasArchivedAt = db
      .prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name='archived_at'")
      .get();

    if (!hasArchivedAt) {
      db.exec('ALTER TABLE tasks ADD COLUMN archived_at DATETIME');
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_archived_at ON tasks(archived_at)');

    db.pragma('user_version = 2');
  }

  // 2 -> 3: add tasks.due_date
  if (v < 3) {
    const hasDueDate = db
      .prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name='due_date'")
      .get();

    if (!hasDueDate) {
      db.exec('ALTER TABLE tasks ADD COLUMN due_date TEXT');
    }

    db.pragma('user_version = 3');
  }


  // 3 -> 4: add tasks.tags (JSON array string)
  if (v < 4) {
    const hasTags = db
      .prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name='tags'")
      .get();

    if (!hasTags) {
      db.exec('ALTER TABLE tasks ADD COLUMN tags TEXT');
    }

    db.pragma('user_version = 4');
  }

  // 4 -> 5: add tasks.blocked_reason
  if (v < 5) {
    const hasBlockedReason = db
      .prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name='blocked_reason'")
      .get();

    if (!hasBlockedReason) {
      db.exec('ALTER TABLE tasks ADD COLUMN blocked_reason TEXT');
    }

    db.pragma('user_version = 5');
  }

  // 5 -> 6: add tasks.context_key and tasks.context_type for worktree/branch support
  if (v < 6) {
    const hasContextKey = db
      .prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name='context_key'")
      .get();
    if (!hasContextKey) {
      db.exec('ALTER TABLE tasks ADD COLUMN context_key TEXT');
    }

    const hasContextType = db
      .prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name='context_type'")
      .get();
    if (!hasContextType) {
      db.exec('ALTER TABLE tasks ADD COLUMN context_type TEXT');
    }

    db.pragma('user_version = 6');
  }

  // 6 -> 7: add tags table
  if (v < 7) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const rows = db.prepare('SELECT tags FROM tasks WHERE tags IS NOT NULL').all();
    const insert = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    const insertMany = db.transaction((names) => {
      for (const name of names) insert.run(name);
    });

    const names = [];
    for (const row of rows) {
      const raw = row.tags;
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            for (const t of parsed) {
              const s = String(t).trim();
              if (s) names.push(s);
            }
          }
        } catch {
          // ignore parse errors
        }
      } else {
        for (const t of trimmed.split(',')) {
          const s = t.trim();
          if (s) names.push(s);
        }
      }
    }

    if (names.length) insertMany(names);

    db.pragma('user_version = 7');
  }

  // 7 -> 8: drop legacy/unused columns
  // - tasks.position
  // - tags.created_at
  // - documents.first_seen
  if (v < 8) {
    const hasTaskPosition = hasColumn('tasks', 'position');
    const hasTaskContextKey = hasColumn('tasks', 'context_key');
    const hasTaskContextType = hasColumn('tasks', 'context_type');
    const hasTaskIsSomeday = hasColumn('tasks', 'is_someday');
    const hasTagCreatedAt = hasColumn('tags', 'created_at');
    const hasDocumentFirstSeen = hasColumn('documents', 'first_seen');

    if (hasTaskPosition || hasTagCreatedAt || hasDocumentFirstSeen) {
      db.pragma('foreign_keys = OFF');
      const tx = db.transaction(() => {
        if (hasTaskPosition) {
          const contextKeyExpr = hasTaskContextKey ? 'context_key' : 'NULL AS context_key';
          const contextTypeExpr = hasTaskContextType ? 'context_type' : 'NULL AS context_type';
          const isSomedayExpr = hasTaskIsSomeday ? 'is_someday' : '0 AS is_someday';

          db.exec(`
            CREATE TABLE tasks_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              description TEXT,
              status TEXT NOT NULL CHECK(status IN ('backlog', 'in_progress', 'review', 'done')),
              priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
              due_date TEXT,
              tags TEXT,
              blocked_reason TEXT,
              assigned_to TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              completed_at DATETIME,
              archived_at DATETIME,
              project_id INTEGER,
              context_key TEXT,
              context_type TEXT,
              is_someday INTEGER DEFAULT 0,
              FOREIGN KEY (project_id) REFERENCES projects(id)
            );
          `);
          db.exec(`
            INSERT INTO tasks_new (
              id, title, description, status, priority, due_date, tags, blocked_reason, assigned_to,
              created_at, updated_at, completed_at, archived_at, project_id, context_key, context_type, is_someday
            )
            SELECT
              id, title, description, status, priority, due_date, tags, blocked_reason, assigned_to,
              created_at, updated_at, completed_at, archived_at, project_id, ${contextKeyExpr}, ${contextTypeExpr}, ${isSomedayExpr}
            FROM tasks;
          `);
          db.exec('DROP TABLE tasks');
          db.exec('ALTER TABLE tasks_new RENAME TO tasks');
          db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_archived_at ON tasks(archived_at)');
          db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
          db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to)');
        }

        if (hasTagCreatedAt) {
          db.exec(`
            CREATE TABLE tags_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL UNIQUE
            );
          `);
          db.exec(`
            INSERT INTO tags_new (id, name)
            SELECT id, name FROM tags;
          `);
          db.exec('DROP TABLE tags');
          db.exec('ALTER TABLE tags_new RENAME TO tags');
        }

        if (hasDocumentFirstSeen) {
          db.exec(`
            CREATE TABLE documents_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              file_path TEXT UNIQUE NOT NULL,
              file_type TEXT,
              last_modified DATETIME,
              last_modified_by TEXT,
              size_bytes INTEGER,
              git_status TEXT
            );
          `);
          db.exec(`
            INSERT INTO documents_new (id, file_path, file_type, last_modified, last_modified_by, size_bytes, git_status)
            SELECT id, file_path, file_type, last_modified, last_modified_by, size_bytes, git_status
            FROM documents;
          `);
          db.exec('DROP TABLE documents');
          db.exec('ALTER TABLE documents_new RENAME TO documents');
          db.exec('CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(file_path)');
        }
      });

      try {
        tx();
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }

    db.pragma('user_version = 8');
  }

  // Keep schema.sql aligned for fresh init

  // 8 -> 9: add inbox/context-anchor task fields and typed assignee columns
  if (v < 9) {
    const hasAssignedToType = hasColumn('tasks', 'assigned_to_type');
    if (!hasAssignedToType) {
      db.exec("ALTER TABLE tasks ADD COLUMN assigned_to_type TEXT CHECK(assigned_to_type IN ('agent', 'human') OR assigned_to_type IS NULL)");
    }

    const hasAssignedToId = hasColumn('tasks', 'assigned_to_id');
    if (!hasAssignedToId) {
      db.exec('ALTER TABLE tasks ADD COLUMN assigned_to_id TEXT');
    }

    const hasNonAgent = hasColumn('tasks', 'non_agent');
    if (!hasNonAgent) {
      db.exec('ALTER TABLE tasks ADD COLUMN non_agent INTEGER NOT NULL DEFAULT 0 CHECK(non_agent IN (0, 1))');
    }

    const hasAnchor = hasColumn('tasks', 'anchor');
    if (!hasAnchor) {
      db.exec('ALTER TABLE tasks ADD COLUMN anchor TEXT');
    }

    const hasLegacyAssignedTo = hasColumn('tasks', 'assigned_to');
    const hasCategory = hasColumn('tasks', 'category');

    if (hasLegacyAssignedTo) {
      // Backfill assignee id from legacy flat assignee column.
      db.exec(`
        UPDATE tasks
        SET assigned_to_id = assigned_to
        WHERE assigned_to IS NOT NULL
          AND TRIM(assigned_to) != ''
          AND (assigned_to_id IS NULL OR TRIM(assigned_to_id) = '')
      `);

      // Promote known agents (seen in activity stream) to agent assignee type.
      const knownAgents = db
        .prepare(`
          SELECT DISTINCT LOWER(TRIM(agent)) AS agent
          FROM activities
          WHERE agent IS NOT NULL
            AND TRIM(agent) != ''
        `)
        .all()
        .map((row) => row.agent)
        .filter(Boolean);

      if (knownAgents.length > 0) {
        const placeholders = knownAgents.map(() => '?').join(', ');
        db.prepare(`
          UPDATE tasks
          SET assigned_to_type = 'agent'
          WHERE assigned_to_id IS NOT NULL
            AND TRIM(assigned_to_id) != ''
            AND LOWER(TRIM(assigned_to_id)) IN (${placeholders})
            AND (assigned_to_type IS NULL OR TRIM(assigned_to_type) = '')
        `).run(...knownAgents);
      }
    }

    // Any remaining assignees are treated as human assignees.
    db.exec(`
      UPDATE tasks
      SET assigned_to_type = 'human'
      WHERE assigned_to_id IS NOT NULL
        AND TRIM(assigned_to_id) != ''
        AND (assigned_to_type IS NULL OR TRIM(assigned_to_type) = '')
    `);

    // Rebuild tasks to drop legacy compatibility columns and enforce final constraints.
    if (hasLegacyAssignedTo || hasCategory) {
      const assignedToIdExpr = hasLegacyAssignedTo
        ? "COALESCE(NULLIF(TRIM(assigned_to_id), ''), NULLIF(TRIM(assigned_to), ''))"
        : "NULLIF(TRIM(assigned_to_id), '')";

      db.pragma('foreign_keys = OFF');
      const tx = db.transaction(() => {
        db.exec(`
          CREATE TABLE tasks_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL CHECK(status IN ('backlog', 'in_progress', 'review', 'done')),
            priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
            due_date TEXT,
            tags TEXT,
            blocked_reason TEXT,
            assigned_to_type TEXT CHECK(assigned_to_type IN ('agent', 'human') OR assigned_to_type IS NULL),
            assigned_to_id TEXT,
            non_agent INTEGER NOT NULL DEFAULT 0 CHECK(non_agent IN (0, 1)),
            anchor TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            archived_at DATETIME,
            project_id INTEGER,
            context_key TEXT,
            context_type TEXT,
            is_someday INTEGER DEFAULT 0,
            CHECK (NOT (non_agent = 1 AND assigned_to_type = 'agent')),
            FOREIGN KEY (project_id) REFERENCES projects(id)
          );
        `);

        db.exec(`
          INSERT INTO tasks_new (
            id, title, description, status, priority, due_date, tags, blocked_reason,
            assigned_to_type, assigned_to_id, non_agent, anchor,
            created_at, updated_at, completed_at, archived_at,
            project_id, context_key, context_type, is_someday
          )
          SELECT
            id, title, description, status, priority, due_date, tags, blocked_reason,
            CASE
              WHEN assigned_to_type IN ('agent', 'human') THEN assigned_to_type
              ELSE NULL
            END,
            ${assignedToIdExpr},
            CASE WHEN non_agent = 1 THEN 1 ELSE 0 END,
            NULLIF(TRIM(anchor), ''),
            created_at, updated_at, completed_at, archived_at,
            project_id, context_key, context_type, is_someday
          FROM tasks
        `);

        db.exec('DROP TABLE tasks');
        db.exec('ALTER TABLE tasks_new RENAME TO tasks');
      });

      try {
        tx();
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }

    db.exec('DROP INDEX IF EXISTS idx_tasks_assigned');
    db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_archived_at ON tasks(archived_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_non_agent ON tasks(non_agent)');
    db.pragma('user_version = 9');
  }

  // 9 -> 10: add task dependency table + document metadata/link table
  if (v < 10) {
    const hasDocTypeTag = hasColumn('documents', 'doc_type_tag');
    if (!hasDocTypeTag) {
      db.exec('ALTER TABLE documents ADD COLUMN doc_type_tag TEXT');
    }

    const hasLastAccessedAt = hasColumn('documents', 'last_accessed_at');
    if (!hasLastAccessedAt) {
      db.exec('ALTER TABLE documents ADD COLUMN last_accessed_at DATETIME');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS document_task_links (
        document_id INTEGER NOT NULL,
        task_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (document_id, task_id),
        FOREIGN KEY (document_id) REFERENCES documents(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id INTEGER NOT NULL,
        depends_on_task_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (task_id, depends_on_task_id),
        CHECK (task_id != depends_on_task_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
      )
    `);

    db.exec('CREATE INDEX IF NOT EXISTS idx_documents_doc_type_tag ON documents(doc_type_tag)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_documents_last_accessed_at ON documents(last_accessed_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_document_task_links_document ON document_task_links(document_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_document_task_links_task ON document_task_links(task_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id)');

    db.pragma('user_version = 10');
  }
}

module.exports = { migrate };
