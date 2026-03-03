# Roadmap

Pawvy is in active development. This document tracks what's shipped and what's next.

---

## v0.1.0 — Current

The foundation. Everything you need to run a human-agent workflow.

- **Kanban + table view** — see all work at a glance, switch views without losing filters
- **Multi-project support** — auto-discovery from your workspace, manual registration for external directories
- **My Queue** — one-click view of everything needing your attention right now
- **Inbox** — separate space for personal reminders that agents never touch
- **Context anchors** — every agent task resolves to a filesystem path; agents always have grounded context
- **Agent API** — agents can create tasks, update status, and list their queue
- **OpenClaw integration** — real-time agent presence (thinking / idle / offline) via native plugin

---

## v1.0.0 — In Design

The human-approval loop. Making every handoff between human and agent explicit.

### New Status Lifecycle

```
draft → pending_approval → backlog → in_progress → review → done
             ↓ (rejected)                  ↑_____________↓ (rework)
           draft                        in_progress
```

| Status | Owned by | Meaning |
|--------|----------|---------|
| `draft` | Agent | Context being gathered; not ready for work |
| `pending_approval` | Human | Agent surfaced context; human reviews and approves |
| `backlog` | Human | Approved and defined; waiting for human start signal |
| `in_progress` | Agent | Agent actively working |
| `review` | Human | Agent surfaced work; human inspects and decides |
| `done` | Human | Human approved; loop closed |

### Task Creation Flows

**Human-initiated:** Human creates a task with rough intent → agent gathers context → agent surfaces for human approval → human approves → work begins.

**Agent-initiated:** Agent identifies a task need, interviews the human, populates full context upfront → agent surfaces for human approval → human approves → work begins.

Both flows require human approval of context before a task enters `backlog`. Neither side can skip the other.

### Context Fields

Tasks carry structured context so agents can start confidently without needing a separate prompt:

- **`context_anchor`** — link to the primary reference (spec doc, GitHub issue, Obsidian note)
- **`acceptance_criteria`** — concrete definition of done; required before `pending_approval`
- **`context_notes`** — why the task exists, key constraints, scope decisions

### Review Notes

Structured handoff notes between agent and human. Each cycle's note is archived before the next begins — a complete, append-only history of every handoff on the task.

### Actor-Aware Transitions

The backend enforces who can move a task to which status. Agents cannot approve their own work. Humans cannot be skipped. Violations return `403`.

### Updated Board

Five columns. `pending_approval` and `review` are grouped into a single **Awaiting** column — cards carry a badge (`Context` or `Work`) indicating what kind of review is needed and what action to take.

```
Draft  |  Backlog  |  In Progress  |  Awaiting  |  Done
```

### Updated My Queue

Surfaces `pending_approval` (context to approve) and `review` (work to approve) alongside tasks explicitly assigned to you.

---

## Backlog

- **Session linking** — show which task an agent is currently working on, in real time
- **Active docs** — attach reference docs to tasks; agent-generated summaries; stale doc alerts
- **Advanced search** — filter by `assignee:fay status:review` and similar operators
- **Test coverage** — Playwright E2E, expanded backend unit tests

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to get involved.
