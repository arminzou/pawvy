# Roadmap

Pawvy is in active development. This document tracks what is shipped, what is being implemented now, and what comes next.

---

## v0.1.0 — Current (Shipped)

The foundation for human-agent workflow.

- **Kanban + table view** — switch views without losing filters
- **Multi-project support** — auto-discovery + manual registration
- **My Queue** — one-click list of work needing your attention
- **Inbox** — personal reminders (v0 model)
- **Context anchors** — filesystem-grounded task context
- **Agent API** — create/update/list task operations
- **OpenClaw integration** — real-time agent presence

---

## v1.0.0 — Thread-First Collaboration (In Implementation)

v1.0 replaces task-first intake with a **thread-first collaboration model**:

- Thread = source of truth for context and collaboration
- Tasks = execution slices spawned from approved threads
- Human stays high-level (Answer / Decide / Approve-Reject)

### Implementation Specs (Internal Drafts)

- [Overview](docs/internal/specs/thread-first-v1/overview.md)
- [State machine](docs/internal/specs/thread-first-v1/state-machine.md)
- [API contract](docs/internal/specs/thread-first-v1/api-contract.md)
- [Decisions log](docs/internal/specs/thread-first-v1/decisions.md)

### Confirmed v1.0 Policies

- Archived threads are terminal; resume via **clone** only
- Clone keeps backlink to archived source thread
- Promotion requires human approval and must spawn **at least 1 task**
- Mention payloads are validated to reduce notification noise

### Delivery Phases

1. **Backend foundation**
   - schema + enums + indexes
   - transition validation
   - mention/promotion gates
2. **API + workflow execution**
   - thread/events/promotion endpoints
   - atomic promote + clone transactions
   - human attention endpoint
3. **UI integration**
   - thread detail + event timeline
   - My Attention List as default human view
   - clone + promote UX flows

---

## Backlog (Post v1.0)

- Session linking (live task ↔ active agent session)
- Active docs (attachments, generated summaries, stale alerts)
- Advanced search operators (`assignee:fay status:review` style)
- Expanded test coverage (Playwright + backend units)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
