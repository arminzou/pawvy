# Design Spec: Inbox & Context Anchor Resolution

## Summary

This specification addresses the limitation of Pawvy's 1:1 project-to-directory model by introducing flexible "Context Anchors" for tasks that fall outside standard software projects (e.g., infrastructure, personal tasks). It establishes a strict invariant that all agent-executable tasks must resolve to a filesystem path. The solution introduces Manual Directory Registration for external paths, a Shared Scratch Workspace for homeless tasks, and a dedicated Inbox for non-agent reminders. This ensures agents always have a grounded environment for reasoning while accommodating miscellaneous human-centric to-dos.

## Problem Statement

Pawvy currently enforces a 1:1 mapping between a task project and a filesystem directory within `PAWVY_PROJECTS_DIR`. While effective for standard software projects, this model fails for:

1.  **Infrastructure/Tooling:** Tasks affecting systems outside the projects directory (e.g., `~/.openclaw/` configuration).
2.  **Miscellaneous/Personal:** Tasks with no natural project home.

Creating virtual projects without directories solves the organizational issue but breaks agent context. Without a directory anchor, agents lack a knowledge base (git history, files) to reference.

**Core Tension:** The directory is the primary mechanism for agent situational awareness. Removing it degrades Pawvy to a simple checklist for these tasks.

## Design Invariant

> **Agent-Executable Task → At Least 1 Context Anchor**

A project or task with zero anchors is strictly a non-agent checklist item. Agent dispatch must be blocked if no valid filesystem anchor can be resolved.

## Proposed Solution

### 1. Manual Registration (External Directory Registration)
Extends the project model to support directories outside `PAWVY_PROJECTS_DIR`.

-   **Mechanism:** `POST /api/projects` accepts an explicit `path` field.
-   **Behavior:** Auto-discovery continues as normal; manual registration supplements it.
-   **Dedup Rule:** If a manually registered path overlaps with an auto-discovered project path, manual registration takes precedence and auto-discovery skips creating a duplicate.
-   **Category Defaults:** Reduces friction by mapping task categories to pre-configured paths automatically (e.g., `openclaw` → `~/.openclaw/workspace-fay`).

### 2. Shared Scratch Workspace
Provides a default home for agent tasks that lack a specific project.

-   **Location:** Defined by `scratch_root` (Default: `~/.local/share/pawvy/_misc/`).
-   **Usage:** Agents use this directory to write `CONTEXT.md`, store notes, and record decisions.
-   **Isolation:** Defaults to a single shared workspace. Per-task subdirectories (`<scratch_root>/tasks/<task-id>/`) are supported via config but disabled by default to keep low-volume tasks clean.
-   **Enablement:** Used only when `allow_scratch_fallback: true`; when false, unresolved agent tasks are blocked.

### 3. Inbox for True Reminders
A designated area for non-agent items (e.g., shopping lists, quick reminders).

-   **Attributes:** Tasks are explicitly marked `non-agent`.
-   **Constraints:** No context anchor required; no agent dispatch allowed.
-   **Data Model:** Task assignees use typed fields: `assigned_to_type` (`agent` | `human` | `null`) and `assigned_to_id` (agent id or user id).
-   **Scope:** `assigned_to_type` and `assigned_to_id` are global task-model fields (all tasks), not Inbox-only fields.
-   **Data Enforcement:** Enforce at schema/API validation level: when `non_agent: true`, `assigned_to_type` cannot be `agent`.
-   **UX:** Purely human-driven; no directory association.

### 4. Anchor Resolution & Dispatch Rule
Enforcement happens at task creation and execution time.

-   **Creation:** Task may include an explicit anchor, selected project, and/or category. `non-agent` is explicit for reminder/checklist tasks.
-   **Execution:** Anchor is resolved at dispatch from the priority chain below. No silent context-free agent tasks are permitted, and tasks marked `non-agent` are rejected for agent dispatch.
-   **Dispatch Snapshot:** Persist `resolved_anchor` and `anchor_source` at dispatch/start so later config changes do not silently shift task context.

### 5. UI Anchor Visibility
Resolved anchor context is visible before agent start and during task review.

-   **Task Card / Detail Chip:** Show a compact chip with source label + normalized path (example: `project: /home/armin/projects/pawvy`).
-   **Source Labels:** `task`, `project`, `category`, `scratch`.

## Anchor Resolution Priority Chain

When an agent attempts to pick up a task, the context anchor is resolved in the following order:

| Priority | Source | Description |
| :--- | :--- | :--- |
| **1** | `task.anchor` | Explicit per-task override. |
| **2** | `project root` | The registered directory of the selected project. |
| **3** | `category_defaults` | Mapping from Pawvy config based on `task.category`. |
| **4** | `scratch_root` | If `allow_scratch_fallback: true`, resolve to `scratch_root` (`scratch_per_task: false`) or `<scratch_root>/tasks/<task-id>/` (`scratch_per_task: true`). |
| **5** | **BLOCK** | If `allow_scratch_fallback: false` and no anchor was resolved from priorities 1-3. |

## Configuration Schema

Configuration for defaults and scratch behavior resides in the **Pawvy config** (not `openclaw.json`) to maintain clean separation of concerns and support non-OpenClaw domains.

-   **Format & Path:** JSON file at `~/.config/pawvy/config.json` by default.
-   **Override:** `PAWVY_CONFIG` may point to an alternate config file path.

**Minimal Schema:**

```json
{
  "category_defaults": {
    "openclaw": "~/.openclaw/workspace-fay",
    "personal": "~/obsidian"
  },
  "scratch_root": "~/.local/share/pawvy/_misc",
  "allow_scratch_fallback": true,
  "scratch_per_task": false,
  "scratch_cleanup_mode": "manual",
  "scratch_ttl_days": null
}
```

### Fields
-   `category_defaults`: User-defined mapping of categories to filesystem paths.
-   `scratch_root`: Path to the shared scratch workspace.
-   `allow_scratch_fallback`: If `true`, unresolved tasks resolve via scratch policy (`scratch_root` or `<scratch_root>/tasks/<task-id>/` depending on `scratch_per_task`). If `false`, they are blocked.
-   `scratch_per_task`: If `false` (default), uses `scratch_root` directly. If `true`, creates `<scratch_root>/tasks/<task-id>/`.
-   `scratch_cleanup_mode`: Scratch retention policy. Allowed values: `manual` (default) or `ttl`.
-   `scratch_ttl_days`: Retention period in days when `scratch_cleanup_mode: ttl`; otherwise must be `null`.
-   **Validation Rule:** If `scratch_cleanup_mode` is `manual`, `scratch_ttl_days` is ignored and persisted as `null`. If `scratch_cleanup_mode` is `ttl`, `scratch_ttl_days` must be a positive integer.

## Path Handling Rules

Path handling is mandatory for all anchor sources (`task.anchor`, manual project `path`, `category_defaults`, and `scratch_root`):

1. Expand `~` and supported environment variables before resolution.
2. Normalize to an absolute path before dispatch.
3. Reject unresolved or invalid paths and continue to the next priority in the chain.
4. If no valid anchor is found, apply rule 5 (BLOCK) from the priority chain.

## Future Evolution

-   **Context Packs:** Scratch workspaces may evolve into "Context Packs"—curated bundles of artifacts (snapshots, transcripts, decisions)—if the pattern scales.
-   **Isolation:** Switching `scratch_per_task: true` can be used later if the shared workspace becomes too noisy.

## Open Questions

None currently.
