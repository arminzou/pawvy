# Inbox + Context Anchor Guide

This guide explains the new Inbox and context-anchor behavior in practical terms.

## Key Concepts (First-Time User)

- **Anchor**: the folder Pawvy treats as the task's working context.
  - For agent tasks, this is the directory used for files/history/context.
  - For Inbox reminders (`non_agent: true`), an anchor is not required.

- **Category default folder**: a configured fallback folder for a category/tag.
  - Example: tasks tagged `openclaw` can map to `~/.openclaw/workspace-fay`.
  - Set in config under `category_defaults`.

- **Scratch folder**: the final fallback workspace when no task/project/category anchor resolves.
  - Default: `~/.local/share/pawvy/_misc`
  - Controlled by `scratch_root`, `allow_scratch_fallback`, and `scratch_per_task`.

## What This Feature Does

Pawvy now supports two kinds of tasks:

- **Agent work tasks**: tasks intended for agents, tied to a filesystem context.
- **Inbox reminders**: personal checklist items for humans (`non_agent: true`), not for agent execution.

You can keep lightweight reminders in Inbox without forcing them into a project, while still giving agent tasks a clear working directory.

## How To Use Inbox (`/inbox`)

Open **Inbox** from the left icon rail or go to `/inbox`.

Inbox is a flat checklist view:

- Add quick reminders from the top input (`Add` button or `Enter`).
- Check/uncheck items to toggle `done` vs `backlog`.
- Click an item to open full edit modal (title, tags, due date, assignee, anchor, etc.).
- Filter by `All`, `Open only`, `Done only`.
- Sort by `Newest first` or `Due date`.

Inbox-created tasks default to:

- `non_agent: true`
- `status: backlog`

These tasks are excluded from Kanban’s default board feed.

## How Anchor Resolution Works

For agent-eligible tasks (`non_agent: false`), Pawvy computes a `resolved_anchor` with this priority:

1. `task.anchor` (explicit task override)
2. `project.path` (if task has a project)
3. `category_defaults` from config (matched by task tag key)
4. scratch fallback (`scratch_root`, optionally per-task subdir) when `allow_scratch_fallback: true`
5. `null` when nothing resolves

Returned metadata:

- `resolved_anchor`: normalized absolute path or `null`
- `anchor_source`: `task | project | category | scratch | null`

Path handling rules:

- `~` is expanded.
- Environment variables are expanded only if defined.
- Paths with unresolved env vars are treated as invalid and skipped.

## Manual Project Registration

You can register directories outside auto-discovery roots:

- `POST /api/projects` with `name` + `path`
- Path is normalized to absolute path
- Duplicate path registration is rejected

Discovery now skips folders whose absolute path is already registered manually, so manual entries keep precedence.

## API Changes You Should Know

### Task model

Old:

- `assigned_to`

New:

- `assigned_to_type`: `agent | human | null`
- `assigned_to_id`: string or `null`
- `non_agent`: boolean
- `anchor`: string or `null`
- `resolved_anchor`: computed (response field)
- `anchor_source`: computed (response field)

### Task endpoints

- `GET /api/tasks`
  - supports filters: `assigned_to_type`, `assigned_to_id`, `non_agent`, plus existing filters
  - responses are anchor-enriched (`resolved_anchor`, `anchor_source`)
- `POST /api/tasks` and `PATCH /api/tasks/:id`
  - accept typed assignee fields + `non_agent` + `anchor`
  - validation blocks agent assignment on `non_agent` tasks
- `POST /api/tasks/bulk/assignee`
  - now takes `assigned_to_type` and `assigned_to_id`

### Project endpoint

- `POST /api/projects`
  - manual project registration with explicit `path`

## Config Keys (Pawvy Config)

- `category_defaults`
- `scratch_root`
- `allow_scratch_fallback`
- `scratch_per_task`
- `scratch_cleanup_mode`
- `scratch_ttl_days`

You can override config file location with `PAWVY_CONFIG`.

## How To Set `category_defaults` (Step-by-Step)

Use this when you want tasks with specific tags/categories to automatically resolve to a folder.

1. Decide where your config file is.
   - Default preferred path: `~/.config/pawvy/config.json`
   - Legacy fallback path: `~/.pawvy/config.json`
   - Optional override: set `PAWVY_CONFIG=/absolute/path/to/config.json`

2. Create the config directory/file if needed.
   - Example:
   ```bash
   mkdir -p ~/.config/pawvy
   touch ~/.config/pawvy/config.json
   ```

3. Add a `category_defaults` section.
   - Keys should match your task tags (case-insensitive in resolution).
   - Values must be valid filesystem paths.
   - Example:
   ```json
   {
     "category_defaults": {
       "openclaw": "~/.openclaw/workspace-fay",
       "infra": "~/projects/infrastructure",
       "docs": "~/notes/product-docs"
     },
     "scratch_root": "~/.local/share/pawvy/_misc",
     "allow_scratch_fallback": true,
     "scratch_per_task": false
   }
   ```

4. Save the file and restart Pawvy backend.
   - Config is read and cached; restart ensures new values are loaded.

5. Tag tasks with one of the mapped keys.
   - Example: add tag `infra` on a task with no explicit `anchor` and no `project`.

6. Verify resolution.
   - In API response (`GET /api/tasks` or `GET /api/tasks/:id`), check:
     - `anchor_source` should be `category`
     - `resolved_anchor` should be your mapped folder
   - In Kanban task card, the anchor chip should reflect the resolved path/source.

### Troubleshooting

- If `anchor_source` is not `category`, check priority order:
  - `task.anchor` and `project.path` always win over `category_defaults`.
- If mapping is ignored, verify the tag text and config key match.
- If path has unresolved env vars (for example `$MISSING_VAR/path`), it is treated as invalid and skipped.
