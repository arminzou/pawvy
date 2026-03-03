# Pawvy

**The task layer for human-agent teams.**

Pawvy is an open-source task and project management tool built for developers who work alongside AI agents. Instead of checking in on your agents constantly, Pawvy gives them the context to start—and brings their work back to you at exactly the right moment.

> Give your agents context. Close the loop together.

![Pawvy](docs/images/pawvy-light.jpg)

## Why Pawvy

Most task tools were built for humans managing humans. Pawvy is built for a different reality: one human, one or more AI agents, and work that flows between them.

Agents don't just execute tasks—they need to know *why* a task exists, *what done looks like*, and *when to surface work for your review*. Pawvy makes that handoff explicit, so nothing gets lost between your intent and the agent's execution.

## ✨What You Can Do

### See Everything at a Glance

A kanban board and table view give you a live picture of what's in progress, what's waiting for review, and what's done. Switch views without losing your filters.

![Kanban Board](docs/images/pawvy-dark.png)

### Know what Needs Your Attention

**My Queue** surfaces tasks that need a human decision right now—work your agents have completed and surfaced for review, plus anything explicitly assigned to you. One click, no hunting.

![My Queue](docs/images/pawvy-table.png)

### Give Agents Real Context

Attach reference docs, acceptance criteria, and scope notes directly to tasks. Your agents read the task and start—no lengthy prompts, no repeated explanations.

## 🛠 Tech Stack

- **Backend:** Node.js + Express + SQLite + WebSocket
- **Frontend:** React + TypeScript + Tailwind CSS + @dnd-kit

## 🚀 Quickstart

**Prerequisites:** Node.js 22+, pnpm

```bash
# Clone and install
git clone https://github.com/arminzou/pawvy.git
cd pawvy
pnpm install

# Start development server
pnpm dev
```

Open `http://localhost:5173`—backend runs on port 3001.

**With Docker:** see [docker-compose setup →](docs/docker.md)

## 🧩 OpenClaw Integration

Pawvy is built to work with [OpenClaw](https://github.com/openclaw/openclaw). Your agents can create tasks, update status, and surface work for review—all through the Pawvy API or the built-in OpenClaw skill.

```bash
# Install the Pawvy skill in your OpenClaw workspace
# Then agents can: create tasks, update status, list their queue
```

See [OpenClaw integration guide →](docs/openclaw-integration.md)

## Common Workflows

- **Agent creates a task** → populates context → surfaces for your review → you approve and close the loop
- **You create a task** → agent picks it up → does the work → moves to review → you approve
- **Check My Queue** → see everything needing your attention in one place → act or send back

[Full workflow guide →](docs/agent-design.md)

## Roadmap

**v0.1.0 (current)**—Kanban board, table view, projects, My Queue, agent API, OpenClaw integration

**v1.0.0 (in design)**—Draft states, context anchors, `pending_approval` flow, review notes with versioning, actor-aware transition enforcement. Full agent-human approval loop.

See [ROADMAP.md](ROADMAP.md) for details.

## 🤝 Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

```bash
git clone https://github.com/arminzou/pawvy.git
cd pawvy
pnpm install
pnpm dev
```

## 📜 License

MIT—see [LICENSE](LICENSE)
