# Docker Setup

Pawvy ships with a `compose.yaml` for running the full stack (backend + frontend) in a single container.

---

## Quickstart

```bash
# 1. Clone the repo
git clone https://github.com/arminzou/pawvy.git
cd pawvy

# 2. Copy and configure environment
cp .env.example .env
# Edit .env — at minimum, set PAWVY_API_KEY to a strong value

# 3. Start
docker compose up -d --build
```

Dashboard: **http://localhost:3001**

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PAWVY_API_KEY` | *(required)* | Shared API key for frontend/backend auth |
| `PAWVY_PORT` | `3001` | Host port to expose |
| `PAWVY_DATA_DIR` | `./data` | Host path for the SQLite database |
| `PAWVY_PROJECTS_DIR` | `$HOME/.pawvy/projects` | Host projects directory (mounted read-only) |
| `OPENCLAW_HOME` | `$HOME/.openclaw` | OpenClaw home directory (mounted read-only) |
| `PAWVY_AGENTS_INCLUDE` | *(all)* | Comma-separated list of agents to show in UI |

**Mobile / LAN access:** if the dashboard loads on desktop but not on mobile, set `API_BASE` and `WS_BASE` to your machine's LAN IP:

```bash
API_BASE=http://192.168.1.10:3001
WS_BASE=ws://192.168.1.10:3001/ws
```

---

## With Traefik

Use the override file if you already run Traefik as a reverse proxy:

```bash
# Create the external proxy network if it doesn't exist
docker network create proxy

# Start with Traefik labels
docker compose -f compose.yaml -f compose.traefik.yaml up -d --build
```

Set `PAWVY_HOST` in `.env` to your domain:

```bash
PAWVY_HOST=pawvy.yourdomain.com
```

---

## Data Persistence

The SQLite database is stored in `PAWVY_DATA_DIR` (default: `./data/pawvy.db`). Back up this directory to preserve your tasks and projects.

Projects and OpenClaw config are mounted **read-only** — Pawvy never writes to them.
