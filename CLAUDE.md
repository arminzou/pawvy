# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Project-specific rules and current focus:** see [AGENTS.md](./AGENTS.md).

---

## What Is Pawvy?

A **local-first command center for OpenClaw users** — a real-time Kanban board that tracks what you and your OpenClaw agents are working on.

**Vision:** "Just Works™" — zero-config integration with OpenClaw.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express + SQLite (`better-sqlite3`) + WebSocket (`ws`) |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS 4 |
| Drag-and-drop | @dnd-kit |
| Icons | lucide-react |
| Testing | Vitest (backend unit) + Playwright (E2E) |

---

## Commands

```bash
pnpm run dev              # Backend + Frontend concurrently
pnpm run dev:backend     # Backend only (port 3001)
pnpm run dev:frontend    # Frontend only (port 5173)
pnpm run build           # Build frontend
pnpm run test:e2e        # Playwright E2E tests

# Backend unit tests (Vitest)
pnpm -C backend test:run                              # All unit tests
pnpm -C backend test:run src/services/taskService.test.ts  # Single test file
```

---

## Environment

Copy `.env.example` to `.env` in the project root. Key variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PAWVY_API_KEY` | — | Bearer token for API auth (required) |
| `PAWVY_DB_PATH` | `~/.local/share/pawvy/pawvy.db` | SQLite path |
| `PAWVY_PROJECTS_DIR` | — | Directory to scan for projects |
| `AUTO_SYNC` | `false` | Enable periodic activity/doc sync |
| `PORT` / `HOST` | `3001` / `127.0.0.1` | Server bind |

Frontend reads `VITE_API_BASE` and `VITE_PAWVY_API_KEY` from `frontend/.env.local`.

---

## Backend Architecture

```
backend/
├── server.ts                      # Entry point: wires Express, SQLite, WebSocket
├── src/
│   ├── config.ts                  # DB path, schema path resolution
│   ├── domain/                    # Canonical TypeScript types (Task, Project, Activity, Document)
│   ├── repositories/              # Raw SQLite access (better-sqlite3)
│   ├── services/                  # Business logic; tested with Vitest
│   ├── presentation/http/
│   │   ├── routes/                # Express routers (injected with db + broadcast)
│   │   ├── middleware/            # CORS, JSON, auth, logging, error handler
│   │   └── errors/httpError.ts   # Typed HTTP errors
│   └── infra/
│       ├── database/dbConnection.ts   # Opens/migrates SQLite DB
│       └── realtime/websocketHub.ts  # WebSocket server + broadcast fn
└── db/
    ├── schema.sql                 # Table definitions (source of truth)
    └── migrate.js                 # Migration runner
```

**Data flow:** `Route → Service → Repository → SQLite`

Routes receive `{ db, broadcast }` at startup. After mutations, routes call `broadcast({ type, data })` to push real-time events to WebSocket clients.

**WebSocket event types:** `task_created`, `task_updated`, `task_deleted`, `tasks_reordered`

---

## Frontend Architecture

```
frontend/src/
├── App.tsx                        # Router + WebSocket setup; routes: /, /project/:id, /activity, /docs
├── pages/
│   ├── Kanban/                    # Board view (KanbanPage → KanbanBoard + TaskModals)
│   ├── Activity/ActivityTimeline  # Agent activity feed
│   └── Docs/DocsView              # Workspace document tracker
├── components/
│   ├── layout/                    # AppShell, IconRail, Topbar, Sidebar
│   └── ui/                        # Primitives: Button, Input, Select, Chip, Menu, Toast, Modal
├── hooks/                         # useWebSocket, useProjects, useHealth
└── lib/
    ├── api.ts                     # All API calls + frontend type definitions
    └── toast.ts                   # Imperative toast system
```

**Note:** Frontend has its own type definitions in `lib/api.ts` (not shared with backend `domain/`).

Design tokens are CSS variables in `index.css`. Use `clsx` for conditional classes.

---

## Task Management (API as source of truth)

```bash
# List backlog tasks
curl -s http://127.0.0.1:3001/api/tasks?status=backlog | jq

# Create task
curl -X POST http://127.0.0.1:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "...", "status": "in_progress", "project_id": 1}'

# Update task
curl -X PATCH http://127.0.0.1:3001/api/tasks/ID \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'
```

---

## API Endpoints

- `GET/POST/PATCH/DELETE /api/tasks` — Task CRUD; also `POST /api/tasks/reorder`, `POST /api/tasks/archive_done`
- `GET/POST /api/activities` — Activity timeline; `POST /api/activities/ingest-sessions`
- `GET/POST /api/docs` — Document tracking; `POST /api/docs/resync`, `POST /api/docs/sync`
- `GET/PATCH/DELETE /api/projects` — Project management; `POST /api/projects/discover`
- `GET /api/tags` — All tags in use
- `ws://localhost:3001/ws` — Real-time updates

---

## Schema Changes

All schema changes go through `backend/db/schema.sql` (source of truth) and `backend/db/migrate.js` (migration runner). Never modify the database directly. Run `node backend/db/migrate.js` after schema changes to apply migrations.

## Data Model

| Entity | Key Fields |
|--------|------------|
| Task | id, title, status, priority, tags (JSON string in DB, `string[]` in API), assigned_to, project_id, context_key, context_type, is_someday, blocked_reason |
| Status | `backlog` \| `in_progress` \| `review` \| `done` |
| Priority | `low` \| `medium` \| `high` \| `urgent` \| null |
| Assignee | `tee` \| `fay` \| `armin` \| null |

`context_key` / `context_type` links tasks to git branches or worktrees (OpenClaw integration). `is_someday` marks "someday/maybe" tasks.

---

## See Also

- [AGENTS.md](./AGENTS.md) — Workflow rules, current phase, autopilot mode
- [ROADMAP.md](./ROADMAP.md) — High-level plan
- [README.md](./README.md) — User documentation
