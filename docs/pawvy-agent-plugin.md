# Pawvy Agent Plugin

## Overview

A native OpenClaw plugin that tracks agent lifecycle events and reports real-time status to Pawvy for the Agent display.

## Architecture

The plugin uses `api.on()` — the typed hook system inside plugins — to subscribe to agent lifecycle events directly. No external hook scripts needed.

```
before_agent_start  ──► webhook: agent:thinking
agent_end           ──► [timer: idleTimeoutMs]
  └── timeout fires ──► webhook: agent:idle

session_start       ──► webhook: agent:idle  (if not already thinking)

gateway_start       ──► webhook: agent:idle  (agentId="*" on first start)
gateway_stop        ──► webhook: agent:offline
```

## File Locations

| File | Purpose |
|------|---------|
| `extensions/pawvy-agent/index.ts` | Plugin source (loaded directly by OpenClaw) |
| `extensions/pawvy-agent/openclaw.plugin.json` | Plugin manifest |
| `backend/src/presentation/http/routes/webhookRouter.ts` | Receives webhook POSTs |

OpenClaw loads the plugin directly from this repo via `plugins.load.paths` in `openclaw.json`. No copy step — edits here are live after a gateway restart:

```bash
openclaw gateway restart
```

## States

| State | Trigger | agentId |
|-------|---------|---------|
| `thinking` | `before_agent_start` hook | specific agent (e.g. `tee`) |
| `idle` | idle timeout after `agent_end` | specific agent |
| `idle` | `session_start` (if not thinking) | specific agent |
| `idle` | `gateway_start` (first boot, no prior activity) | `*` (all) |
| `offline` | `gateway_stop` (if no prior activity) | `*` (all) |
| `offline` | `gateway_stop` (after activity) | each agent individually |

The idle timeout prevents rapid thinking→idle flickering for multi-turn interactions. Default: 30s. Configured to 5s in `openclaw.json` for snappy UI feedback.

## Configuration (`openclaw.json`)

```json
{
  "plugins": {
    "load": {
      "paths": ["/home/armin/projects/pawvy/extensions"]
    },
    "entries": {
      "pawvy-agent": {
        "enabled": true,
        "config": {
          "webhookUrl": "http://127.0.0.1:3001/api/webhook/pawvy",
          "idleTimeoutMs": 5000
        }
      }
    }
  }
}
```

`plugins.load.paths` tells OpenClaw to scan the pawvy extensions directory. Without it, the plugin won't be discovered and the entry in `plugins.entries` will fail validation with `plugin not found: pawvy-agent`.

Config is validated against `openclaw.plugin.json`'s `configSchema` at load time. A schema validation error will show the plugin as `error` in `openclaw plugins list`.

**Optional:** suppress the non-bundled plugin warning by adding it to `plugins.allow`:

```bash
openclaw config set plugins.allow '["discord","telegram","minimax-portal-auth","pawvy-agent"]'
```

## Webhook Payload

All events are POSTed to `webhookUrl`:

```json
{
  "event": "agent:thinking" | "agent:idle" | "agent:offline",
  "agentId": "tee" | "fay" | "*",
  "status": "thinking" | "idle" | "offline",
  "thought": "I am thinking..." | "Gateway offline" | undefined,
  "timestamp": "2026-02-19T21:25:19.960Z"
}
```

The backend `webhookRouter.ts` maps event names to status:

| `event` | broadcast `status` |
|---------|--------------------|
| `agent:thinking` | `thinking` |
| `agent:idle` | `idle` |
| `agent:offline` | `offline` |
| `gateway:online` | `idle` |
| `gateway:offline` | `offline` |

## Deployment

The plugin is discovered via `plugins.load.paths` pointing at this repo. To set it up from scratch on a new machine:

```bash
# 1. Add the load path and enable the plugin
node -e "
const fs = require('fs');
const p = require('os').homedir() + '/.openclaw/openclaw.json';
const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
cfg.plugins ??= {};
cfg.plugins.load = { paths: ['/home/armin/projects/pawvy/extensions'] };
cfg.plugins.entries ??= {};
cfg.plugins.entries['pawvy-agent'] = {
  enabled: true,
  config: { webhookUrl: 'http://127.0.0.1:3001/api/webhook/pawvy', idleTimeoutMs: 5000 }
};
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
"

# 2. Restart the gateway
openclaw gateway restart
```

> The reason to edit `openclaw.json` directly (rather than `openclaw config set`) is that the CLI validator checks plugin discoverability before writing — if the load path isn't set yet, setting the entry fails with `plugin not found`.

---

## Debugging

### 1. Check the plugin is loaded

```bash
openclaw plugins list | grep -A3 pawvy
```

Expected: `Status: loaded`. If `disabled`, the entry is missing from `openclaw.json`. If `error`, check the config schema or the error message in the list.

### 2. Check plugin logs

The plugin uses `api.logger`, which routes through OpenClaw's logging subsystem. Logs appear in both `openclaw logs` and journald.

```bash
# Live stream (preferred)
openclaw logs --follow 2>&1 | grep pawvy-agent

# Or via journald if the gateway is unresponsive
journalctl _PID=$(pgrep -f "openclaw-gateway$") -f | grep pawvy-agent
```

On a working gateway you should see at startup:
```
[gateway] [pawvy-agent] registered · webhookUrl=(set) · idleTimeoutMs=5000
[gateway] [pawvy-agent] gateway online
```

On an agent turn:
```
[gateway] [pawvy-agent] fay → thinking
[gateway] [pawvy-agent] fay → idle
```

If you see `registered · webhookUrl=(not set)` — the config wasn't applied. Edit `openclaw.json` and restart the gateway.

### 3. Test the webhook endpoint directly

```bash
# Simulate thinking event
curl -s -X POST http://127.0.0.1:3001/api/webhook/pawvy \
  -H "Content-Type: application/json" \
  -d '{"event":"agent:thinking","agentId":"tee","status":"thinking","thought":"I am thinking...","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"}'

# Simulate idle event
curl -s -X POST http://127.0.0.1:3001/api/webhook/pawvy \
  -H "Content-Type: application/json" \
  -d '{"event":"agent:idle","agentId":"tee","status":"idle","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"}'
```

Both should return `{"success":true}`. If not, the backend isn't running or the route isn't registered.

### 4. Trigger a real agent turn

```bash
openclaw agent --agent fay --message "say hello"
```

Then check journald (step 2). Fay responds quickly with a single turn, so you'll see the full `thinking → finished → idle (timeout)` cycle within `idleTimeoutMs` seconds.

Avoid using Tee for quick tests — Tee's agentic style tends to use multiple tool calls which extends the run and delays `agent_end`.

### 5. Check openclaw.json config applied

```bash
openclaw config get plugins.entries.pawvy-agent
```

Expected output:
```json
{
  "enabled": true,
  "config": {
    "webhookUrl": "http://127.0.0.1:3001/api/webhook/pawvy",
    "idleTimeoutMs": 5000
  }
}
```

### Common failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `plugin not found: pawvy-agent` on gateway start | `plugins.load.paths` missing from `openclaw.json` | Edit `openclaw.json` directly to add `plugins.load.paths` (see Deployment) |
| Plugin shows `disabled` | Entry missing from `openclaw.json` | Add `plugins.entries.pawvy-agent` with `enabled: true` |
| Plugin shows `error` | Config schema validation failed | Check `openclaw plugins list` error detail; fix the config JSON |
| `registered · webhookUrl=(not set)` in logs | `webhookUrl` not in config | Set it in `plugins.entries.pawvy-agent.config`, restart gateway |
| Thinking fires, idle never fires | `agent_end` not reached — long agentic run still in progress | Normal — idle fires after the run completes + timeout |
| `gateway_start` sends `agentId: "*"` | Expected on fresh boot before any agent has run | Pawvy should treat `*` as "all agents are idle" |
| Webhook returns non-200 | Pawvy backend not running | `cd backend && pnpm dev` |
| Warning: `plugins.allow is empty` | Non-bundled plugin loaded without explicit allowlist | Safe to ignore, or add `pawvy-agent` to `plugins.allow` |
