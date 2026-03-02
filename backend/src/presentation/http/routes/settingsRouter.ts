import express, { type NextFunction, type Request, type Response } from 'express';
import { config, listKnownAgentIdsForSettings, updatePawvyAgentProfile } from '../../../config';
import { HttpError } from '../errors/httpError';

type AgentSettingsRow = {
  id: string;
  display_name: string;
  avatar: string;
  description: string;
  source: 'config' | 'plugin' | 'generated';
};

function normalizeAgentId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

function toDisplayName(agentId: string): string {
  return agentId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveAgentSetting(agentId: string): AgentSettingsRow {
  const cfg = config.agentProfiles[agentId] ?? {};
  const plugin = config.pluginAgentProfiles[agentId] ?? {};
  const displayName = cfg.displayName ?? plugin.displayName ?? toDisplayName(agentId);
  const avatar = cfg.avatar ?? plugin.avatar ?? '🐱';
  const description = cfg.description ?? '';
  const source: AgentSettingsRow['source'] = cfg.displayName || cfg.avatar || cfg.description
    ? 'config'
    : (plugin.displayName || plugin.avatar ? 'plugin' : 'generated');

  return {
    id: agentId,
    display_name: displayName,
    avatar,
    description,
    source,
  };
}

export function createSettingsRouter() {
  const router = express.Router();

  // GET /api/settings/agents
  router.get('/agents', (req: Request, res: Response, next: NextFunction) => {
    try {
      const agents = listKnownAgentIdsForSettings().map(resolveAgentSetting);
      res.json({ agents });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/settings/agents/:agentId
  router.patch('/agents/:agentId', (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = normalizeAgentId(req.params.agentId);
      if (!agentId) throw new HttpError(400, 'Invalid agent id');

      const body = (req.body ?? {}) as {
        display_name?: unknown;
        avatar?: unknown;
        description?: unknown;
      };

      const patch: {
        displayName?: string | null;
        avatar?: string | null;
        description?: string | null;
      } = {};

      if (Object.prototype.hasOwnProperty.call(body, 'display_name')) {
        patch.displayName = body.display_name == null ? null : String(body.display_name);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'avatar')) {
        patch.avatar = body.avatar == null ? null : String(body.avatar);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'description')) {
        patch.description = body.description == null ? null : String(body.description);
      }

      if (Object.keys(patch).length === 0) {
        throw new HttpError(400, 'No fields to update');
      }

      updatePawvyAgentProfile(agentId, patch);
      res.json(resolveAgentSetting(agentId));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

