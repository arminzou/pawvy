# Implementation Plan: Inbox & Context Anchor Resolution

## Context

Pawvy's 1:1 project-to-directory model doesn't support tasks outside standard software projects (infrastructure, personal reminders). This feature introduces:

- **Typed assignees** (`assigned_to_type` + `assigned_to_id`) replacing the flat `assigned_to` string
- **`non_agent` flag** for pure human tasks (inbox/reminders) that blocks agent dispatch
- **`anchor` field** for explicit per-task directory overrides
- **Anchor resolution service** that computes a context anchor from a priority chain
- **Manual project registration** via `POST /api/projects`
- **Inbox page** — a new `/inbox` route with a flat checklist UI for non-agent tasks

---

## 1. Files to Touch

### New files
| File | Purpose |
|------|---------|
| `backend/src/services/anchorService.ts` | Anchor resolution chain logic |
| `backend/src/services/anchorService.test.ts` | Unit tests for anchor resolution |
| `frontend/src/pages/Inbox/InboxPage.tsx` | New Inbox page component |

### Modified files
| File | What changes |
|------|-------------|
| `backend/db/schema.sql` | Replace `assigned_to` with `assigned_to_type` + `assigned_to_id`; add `non_agent`, `anchor` |
| `backend/db/migrate.js` | Migration 9: add columns, migrate data, table rebuild |
| `backend/src/domain/task.ts` | Update Task/TaskRow types for new assignee model + new fields |
| `backend/src/repositories/taskRepository.ts` | CRUD for new fields, update hydration, update bulk ops |
| `backend/src/services/taskService.ts` | Validation: non_agent + agent conflict; assignee type validation |
| `backend/src/services/projectService.ts` | Add `createManual()` method |
| `backend/src/repositories/projectRepository.ts` | Add `create()` method |
| `backend/src/presentation/http/routes/tasksRouter.ts` | Wire new fields, enrich responses with anchor resolution |
| `backend/src/presentation/http/routes/projectsRouter.ts` | Add `POST /` route for manual registration |
| `backend/src/config.ts` | Extend `PawvyConfigFile` with `scratch_root`, `category_defaults`; add getters |
| `frontend/src/lib/api.ts` | Update Task type, API functions, add `createProject()` |
| `frontend/src/components/layout/IconRail.tsx` | Add `'inbox'` to `AppTab`, add Inbox icon |
| `frontend/src/App.tsx` | Add `/inbox` route, update tab detection |
| `frontend/src/pages/Kanban/TaskModals.tsx` | Switch to `assigned_to_type`/`assigned_to_id`, add `non_agent` toggle |
| `frontend/src/pages/Kanban/KanbanBoard.tsx` | Update TaskCard for new assignee fields, show anchor chip |
| `frontend/src/components/layout/Sidebar.tsx` | Update assignee filter for typed model |
| `backend/src/services/taskService.test.ts` | Add tests for new validation rules |
| `backend/test/routes/tasksRouter.test.ts` | Add integration tests for new fields + anchor enrichment |

---

## 2. Schema Changes

### `backend/db/schema.sql` — final state of tasks table

```sql
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK(status IN ('backlog', 'in_progress', 'review', 'done')),
    priority TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
    due_date TEXT,
    tags TEXT,
    blocked_reason TEXT,
    assigned_to_type TEXT CHECK(assigned_to_type IN ('agent', 'human')),  -- NEW (replaces assigned_to)
    assigned_to_id TEXT,                                                   -- NEW (replaces assigned_to)
    non_agent INTEGER DEFAULT 0,                                           -- NEW
    anchor TEXT,                                                           -- NEW
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

-- Update indexes
CREATE INDEX IF NOT EXISTS idx_tasks_archived_at ON tasks(archived_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to_id);  -- changed from assigned_to
CREATE INDEX IF NOT EXISTS idx_tasks_non_agent ON tasks(non_agent);      -- NEW
```

### Migration 9 in `migrate.js`

1. Add new columns: `assigned_to_type`, `assigned_to_id`, `non_agent`, `anchor`
2. Migrate data from `assigned_to`:
   - Query distinct `agent` values from `activities` table to identify known agents
   - Set `assigned_to_type = 'agent'` for matching rows
   - Set `assigned_to_type = 'human'` for all other non-null rows
   - Copy `assigned_to` value to `assigned_to_id` for all non-null rows
3. Table rebuild to drop `assigned_to` column and update CHECK constraints/indexes

---

## 3. API Changes

### Modified endpoints

**GET /api/tasks** — new query params:
- `assigned_to_type` (filter: `agent` | `human`)
- `assigned_to_id` (filter by specific assignee)
- `non_agent` (filter: `1` or `0`)
- Remove old `assigned_to` param
- Response: each task enriched with `resolved_anchor` and `anchor_source` (computed, not stored)

**POST /api/tasks** — body changes:
- Replace `assigned_to` with `assigned_to_type` + `assigned_to_id`
- Accept `non_agent` (boolean)
- Accept `anchor` (string, optional)
- Validation: reject `assigned_to_type: 'agent'` when `non_agent: true`
- Response enriched with anchor resolution

**PATCH /api/tasks/:id** — same field changes as POST
- Validation: reject setting `assigned_to_type` to `'agent'` on a `non_agent` task (and vice versa)

**GET /api/tasks/:id** — response enriched with anchor resolution

**POST /api/tasks/bulk/assignee** — body changes:
- Replace `assigned_to` with `assigned_to_type` + `assigned_to_id`

### New endpoints

**POST /api/projects** — manual project registration
- Body: `{ name: string, path: string, description?: string }`
- `slug` auto-generated from `name`
- Validates `name` and `path` are non-empty strings
- Returns `201` with created project
- Broadcasts `projects_updated`

### Response enrichment (all task endpoints)

Each task in the response includes two computed fields:
```typescript
{
  ...task,
  resolved_anchor: string | null,  // computed filesystem path
  anchor_source: 'task' | 'project' | 'category' | 'scratch' | null
}
```

---

## 4. Frontend Components

### New: `InboxPage.tsx`
- Route: `/inbox`
- Simple flat list layout (not a Kanban board)
- Each item: checkbox (toggle done) + title + optional metadata (due date, tags)
- Quick-add input at top (creates tasks with `non_agent: true` by default, status `backlog`)
- Click task to open EditTaskModal
- Filter/sort: by status, due date
- Real-time updates via existing WebSocket

### Modified: `IconRail.tsx`
- Add `'inbox'` to `AppTab` type
- Add `Inbox` icon from lucide-react between Projects and Activity tabs

### Modified: `App.tsx`
- Add route: `/inbox` → `<InboxPage />`
- Update tab detection: `if (p.startsWith('/inbox')) return 'inbox'`

### Modified: `TaskModals.tsx`
- Replace `assigned` field with `assignedType` + `assignedId` in form values
- Add `nonAgent` boolean field
- "Personal reminder" checkbox near "Save for later" — when checked:
  - Sets `non_agent: true`
  - Clears `assigned_to_type` if it was `'agent'`, or disables agent options in dropdown
- Assignee dropdown: show agents (from `useAgents()`) and human users, with type auto-derived from selection
- Optional: show `anchor` text input in advanced section

### Modified: `KanbanBoard.tsx`
- TaskCard: update assignee chip to use `assigned_to_id` (display name from agent profiles)
- TaskCard: add anchor chip when `resolved_anchor` is present (compact path display)
- Exclude `non_agent` tasks from the default Kanban view (they live in Inbox)

### Modified: `Sidebar.tsx`
- Update assignee filter to work with `assigned_to_id` (same behavior, different field name)

### Modified: `api.ts`
- Update `Task` interface: remove `assigned_to`, add `assigned_to_type`, `assigned_to_id`, `non_agent`, `anchor`, `resolved_anchor`, `anchor_source`
- Update `listTasks()` params
- Update `createTask()` and `updateTask()` body types
- Update `bulkAssignAssignee()` to use typed fields
- Add `createProject(body)` function

---

## 5. Order of Operations

```
Phase 1: Schema + Migration
  backend/db/schema.sql
  backend/db/migrate.js
  │
Phase 2: Backend Domain + Repository
  backend/src/domain/task.ts
  backend/src/repositories/taskRepository.ts
  backend/src/repositories/projectRepository.ts  (add create())
  │
Phase 3: Backend Services
  backend/src/config.ts  (extend with scratch/category config)
  backend/src/services/taskService.ts  (new validation rules)
  backend/src/services/projectService.ts  (add createManual())
  backend/src/services/anchorService.ts  (NEW)
  │
Phase 4: Backend Routes
  backend/src/presentation/http/routes/tasksRouter.ts  (new fields + anchor enrichment)
  backend/src/presentation/http/routes/projectsRouter.ts  (POST / route)
  │
Phase 5: Frontend API Layer
  frontend/src/lib/api.ts
  │
Phase 6: Frontend Components (parallelizable)
  ├── frontend/src/components/layout/IconRail.tsx
  ├── frontend/src/App.tsx
  ├── frontend/src/pages/Inbox/InboxPage.tsx  (NEW)
  ├── frontend/src/pages/Kanban/TaskModals.tsx
  ├── frontend/src/pages/Kanban/KanbanBoard.tsx
  └── frontend/src/components/layout/Sidebar.tsx
  │
Phase 7: Tests
  backend/src/services/taskService.test.ts
  backend/src/services/anchorService.test.ts  (NEW)
  backend/test/routes/tasksRouter.test.ts
```

Dependencies:
- Phase 2 depends on Phase 1 (types reflect new schema)
- Phase 3 depends on Phase 2 (services use repos)
- Phase 4 depends on Phase 3 (routes use services)
- Phase 5 depends on Phase 4 (frontend types match API)
- Phase 6 depends on Phase 5 (components use API types)
- Phase 7 can be written alongside phases 2-4 but should run after Phase 4

---

## 6. Tests Required

### Backend unit tests (taskService.test.ts)
- Create task with `assigned_to_type: 'agent'`, `assigned_to_id: 'tee'` → succeeds
- Create task with `assigned_to_type: 'human'`, `assigned_to_id: 'armin'` → succeeds
- Create task with `non_agent: true`, `assigned_to_type: 'agent'` → 400 error
- Update task: set `non_agent: true` on task with agent assignee → 400 error
- Update task: assign agent to `non_agent` task → 400 error
- List tasks with `non_agent` filter
- List tasks with `assigned_to_type` filter

### Anchor service tests (anchorService.test.ts)
- Task with explicit `anchor` → resolves to that path, source='task'
- Task with `project_id` (project has path) → resolves to project path, source='project'
- Task with tag matching `category_defaults` → resolves to category path, source='category'
- Task with no matches, scratch fallback → resolves to `scratch_root`, source='scratch'
- `non_agent` task → resolves to null (inbox tasks don't need anchors)
- Priority chain: task.anchor wins over project.path

### Backend integration tests (tasksRouter.test.ts)
- POST /api/tasks with new assignee fields
- GET /api/tasks response includes `resolved_anchor` and `anchor_source`
- GET /api/tasks?non_agent=1 filters correctly
- PATCH validates non_agent + agent conflict

### Backend integration tests (projectsRouter.test.ts)
- POST /api/projects creates project with explicit path
- POST /api/projects validates required fields (name, path)
- POST /api/projects returns 201 with created project
- Dedup: POST with path matching existing project → appropriate handling

### Smoke / manual verification
- `pnpm -C backend test:run` — all unit tests pass
- `pnpm run dev` — app starts, no console errors
- Create an inbox task via the new Inbox page
- Verify inbox tasks don't appear on the Kanban board
- Verify Kanban tasks with projects show the anchor chip
- Create a project via API with manual path
- Verify anchor resolution returns correct values in API responses

---

## Key Existing Code to Reuse

| What | Where |
|------|-------|
| `hydrateTask()` pattern (DB row → domain) | `backend/src/repositories/taskRepository.ts` |
| Table rebuild migration pattern | `backend/db/migrate.js` (migration 8) |
| `readPawvyConfigFile()` / `resolvePawvyConfigPath()` | `backend/src/config.ts:181-197` |
| `useAgents()` hook (agent list for assignee dropdown) | `frontend/src/hooks/useAgents.ts` |
| `MenuSelect` component (reuse in Inbox) | `frontend/src/pages/Kanban/TaskModals.tsx` |
| `Chip` component (for anchor display) | `frontend/src/components/ui/Chip.tsx` |
| `Checkbox` component (for inbox checklist) | `frontend/src/components/ui/Checkbox.tsx` |
| `Input` component (for inbox quick-add) | `frontend/src/components/ui/Input.tsx` |
| `AppShell` layout wrapper | `frontend/src/components/layout/AppShell.tsx` |
| `createTestApp()` test utility | `backend/test/utils/testApp.ts` |

---

## Intentionally Deferred

- **Dispatch-time anchor snapshot**: `resolved_anchor`/`anchor_source` are computed at read-time, not persisted. Will be snapshotted when Pawvy gains actual agent dispatch.
- **Scratch workspace directory auto-creation**: Referenced in config but not auto-created on disk.
- **`scratch_per_task` / `scratch_cleanup_mode` / `scratch_ttl_days`**: Config fields from the spec are read but not actively enforced yet.
- **Category defaults UI**: Config is read from `~/.pawvy/config.json`; no UI to edit it.
