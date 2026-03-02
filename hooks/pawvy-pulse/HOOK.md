---
name: pawvy-pulse
description: "Sends heartbeat events to Pawvy for real-time agent presence tracking"
homepage: https://github.com/zoulogic/pawvy
metadata:
  openclaw:
    emoji: "💓"
    events:
      - "command:new"
      - "command:reset"
      - "command:stop"
      - "gateway:startup"
      - "message:received"
      - "message:sent"
---

# Pawvy Pulse

Reports agent events to Pawvy for real-time presence tracking and activity display.

## What It Does

- Sends webhook notifications to Pawvy when agent events occur
- Enables the agent presence display in Pawvy
- Tracks agent status (active, thinking, idle, offline)

## Requirements

- Pawvy must be running and accessible
- `PAWVY_WEBHOOK_URL` environment variable must be set

## Configuration

Set the webhook URL via environment variable:

```bash
# In your shell profile
export PAWVY_WEBHOOK_URL=http://localhost:3001/api/webhook/pawvy
```

Or configure in OpenClaw config:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "pawvy-pulse": {
          "enabled": true,
          "env": {
            "PAWVY_WEBHOOK_URL": "http://localhost:3001/api/webhook/pawvy"
          }
        }
      }
    }
  }
}
```

## Events Reported

| Event | Description |
|-------|-------------|
| `command:new` | Agent started a new session |
| `command:reset` | Agent reset (new session) |
| `command:stop` | Agent stopped |
| `gateway:startup` | Gateway started |

## Webhook Payload

```json
{
  "event": "command:new",
  "agentId": "tee",
  "sessionKey": "agent:tee:main",
  "timestamp": "2026-02-19T12:00:00Z"
}
```
