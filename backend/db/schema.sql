-- Pawvy Database Schema

-- Projects table (workspace discovery + grouping)
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    path TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);

-- Tasks table (for Kanban board)
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK(status IN ('backlog', 'in_progress', 'review', 'done')),
    priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
    due_date TEXT, -- ISO date (YYYY-MM-DD) or ISO datetime; nullable
    tags TEXT, -- JSON array of strings; nullable
    blocked_reason TEXT, -- nullable freeform text (why this task is blocked)
    assigned_to_type TEXT CHECK(assigned_to_type IN ('agent', 'human') OR assigned_to_type IS NULL),
    assigned_to_id TEXT,
    non_agent INTEGER NOT NULL DEFAULT 0 CHECK(non_agent IN (0, 1)),
    anchor TEXT, -- explicit task-level context anchor path
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    archived_at DATETIME,
    project_id INTEGER,
    context_key TEXT, -- e.g., 'projects/pawvy-ui-polish' or 'feature/branch-name'
    context_type TEXT, -- 'worktree' or 'branch'
    is_someday INTEGER DEFAULT 0, -- saved for later / someday/maybe flag
    CHECK (NOT (non_agent = 1 AND assigned_to_type = 'agent')),
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_archived_at ON tasks(archived_at);

-- Tags table (global tag registry)
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

-- Agent activities table (timeline tracking)
CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL CHECK(agent IN ('tee', 'fay')),
    activity_type TEXT NOT NULL, -- 'file_edit', 'tool_call', 'task_complete', 'message', etc.
    description TEXT NOT NULL,
    details TEXT, -- JSON blob for extra data
    session_key TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    related_task_id INTEGER,
    source_id TEXT, -- unique id for ingested events (e.g., session file + line)
    FOREIGN KEY (related_task_id) REFERENCES tasks(id)
);

-- Document tracking table
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT UNIQUE NOT NULL,
    file_type TEXT, -- extension or category
    doc_type_tag TEXT, -- optional semantic type: spec, runbook, reference, decision
    last_modified DATETIME,
    last_modified_by TEXT, -- 'tee', 'fay', 'armin', 'system'
    last_accessed_at DATETIME, -- when an agent/human last opened/read this doc via Pawvy
    size_bytes INTEGER,
    git_status TEXT -- 'modified', 'added', 'deleted', 'untracked', 'clean'
);

-- Document <-> Task links
CREATE TABLE IF NOT EXISTS document_task_links (
    document_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, task_id),
    FOREIGN KEY (document_id) REFERENCES documents(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- Task dependency relationships (task_id depends on depends_on_task_id)
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id INTEGER NOT NULL,
    depends_on_task_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (task_id, depends_on_task_id),
    CHECK (task_id != depends_on_task_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id)
);

-- Prevent dependency cycles (A -> ... -> B and B -> A).
CREATE TRIGGER IF NOT EXISTS trg_task_dependencies_prevent_cycle_insert
BEFORE INSERT ON task_dependencies
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Dependency cycle detected')
  WHERE NEW.task_id = NEW.depends_on_task_id
    OR EXISTS (
      WITH RECURSIVE dependency_path(depends_on_task_id) AS (
        SELECT depends_on_task_id
        FROM task_dependencies
        WHERE task_id = NEW.depends_on_task_id
        UNION
        SELECT td.depends_on_task_id
        FROM task_dependencies td
        JOIN dependency_path dp ON td.task_id = dp.depends_on_task_id
      )
      SELECT 1
      FROM dependency_path
      WHERE depends_on_task_id = NEW.task_id
      LIMIT 1
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_task_dependencies_prevent_cycle_update
BEFORE UPDATE OF task_id, depends_on_task_id ON task_dependencies
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Dependency cycle detected')
  WHERE NEW.task_id = NEW.depends_on_task_id
    OR EXISTS (
      WITH RECURSIVE dependency_path(depends_on_task_id) AS (
        SELECT depends_on_task_id
        FROM task_dependencies
        WHERE task_id = NEW.depends_on_task_id
          AND NOT (task_id = OLD.task_id AND depends_on_task_id = OLD.depends_on_task_id)
        UNION
        SELECT td.depends_on_task_id
        FROM task_dependencies td
        JOIN dependency_path dp ON td.task_id = dp.depends_on_task_id
      )
      SELECT 1
      FROM dependency_path
      WHERE depends_on_task_id = NEW.task_id
      LIMIT 1
    );
END;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_tasks_non_agent ON tasks(non_agent);
CREATE INDEX IF NOT EXISTS idx_activities_agent ON activities(agent);
CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp);
CREATE INDEX IF NOT EXISTS idx_activities_task ON activities(related_task_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_source_id ON activities(source_id);
CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(file_path);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type_tag ON documents(doc_type_tag);
CREATE INDEX IF NOT EXISTS idx_documents_last_accessed_at ON documents(last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_document_task_links_document ON document_task_links(document_id);
CREATE INDEX IF NOT EXISTS idx_document_task_links_task ON document_task_links(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);
