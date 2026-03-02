import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from '../../../config';

type AgentStatus = 'thinking' | 'idle' | 'offline';

type WebhookBody = {
  agentId?: unknown;
  agent?: unknown;
  event?: unknown;
  type?: unknown;
  timestamp?: unknown;
  thought?: unknown;
  turnCount?: unknown;
};

const EVENT_STATUS_MAP: Record<string, AgentStatus> = {
  'agent:thinking': 'thinking',
  'agent:idle': 'idle',
  'agent:offline': 'offline',
  'gateway:online': 'idle',
  'gateway:offline': 'offline',
};

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function coerceTimestamp(value: unknown): { value?: string; valid: boolean } {
  if (value == null) return { value: undefined, valid: true };

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { valid: false };
    return { value: value.toISOString(), valid: true };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { valid: false };
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return { valid: false };
    return { value: parsed.toISOString(), valid: true };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return { valid: false };

    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && trimmed === String(asNumber)) {
      const parsed = new Date(asNumber);
      if (Number.isNaN(parsed.getTime())) return { valid: false };
      return { value: parsed.toISOString(), valid: true };
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return { value: parsed.toISOString(), valid: true };
    }
  }

  return { valid: false };
}

function coerceTurnCount(value: unknown): { value?: number; valid: boolean } {
  if (value == null) return { value: undefined, valid: true };

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return { valid: false };
    return { value, valid: true };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) return { valid: false };
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(parsed)) return { valid: false };
    return { value: parsed, valid: true };
  }

  return { valid: false };
}

export function createWebhookRouter({ broadcast }: { broadcast: (data: unknown) => void }) {
  const router = express.Router();

  // POST /api/webhook/pawvy - Receive events from OpenClaw pawvy-agent plugin
  router.post('/pawvy', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as WebhookBody;

      const agentId = asNonEmptyString(body.agentId) ?? asNonEmptyString(body.agent);
      const eventType = asNonEmptyString(body.event) ?? asNonEmptyString(body.type);

      if (!agentId || !eventType) {
        res.status(400).json({ error: 'Missing required fields: agentId, event' });
        return;
      }

      const status = EVENT_STATUS_MAP[eventType];
      if (!status) {
        res.status(400).json({ error: `Unknown event type: ${eventType}` });
        return;
      }

      if (!config.isAgentIncluded(agentId)) {
        res.json({ success: true, ignored: true, reason: 'agent_not_included' });
        return;
      }

      const timestamp = coerceTimestamp(body.timestamp);
      if (!timestamp.valid) {
        res.status(400).json({ error: 'Invalid timestamp' });
        return;
      }

      const turnCount = coerceTurnCount(body.turnCount);
      if (!turnCount.valid) {
        res.status(400).json({ error: 'Invalid turnCount' });
        return;
      }

      const thought = asNonEmptyString(body.thought);

      broadcast({
        type: 'agent_status_updated',
        data: {
          agentId,
          status,
          lastActivity: timestamp.value,
          thought,
          turnCount: turnCount.value,
        },
      });

      console.info('[webhook] agent_status_updated', {
        agentId,
        eventType,
        status,
        hasThought: Boolean(thought),
        hasTimestamp: Boolean(timestamp.value),
        hasTurnCount: typeof turnCount.value === 'number',
      });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/webhook/config - Get webhook configuration info
  router.get('/config', (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({
        enabled: true,
        url: `${req.protocol}://${req.get('host')}/api/webhook/pawvy`,
        events: Object.keys(EVENT_STATUS_MAP),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
