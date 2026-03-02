import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use cwd as backend root - app starts from backend/ in both dev and prod
const BACKEND_ROOT = process.cwd();

// Lazy resolver - called at runtime, not module load
function resolveDbPath(): string {
  const raw = process.env.PAWVY_DB_PATH;
  if (raw) {
    // Relative to backend root, or absolute
    return raw.startsWith('/') ? raw : path.resolve(BACKEND_ROOT, raw);
  }
  // Default: ~/.local/share/pawvy/pawvy.db
  return path.join(os.homedir(), '.local', 'share', 'pawvy', 'pawvy.db');
}

// db/ lives at backend-root/db/
const DB_DIR = path.join(BACKEND_ROOT, 'db');

// OpenClaw detection
function resolveOpenClawDirs(): string[] {
  return [
    process.env.OPENCLAW_HOME,
    path.join(os.homedir(), '.openclaw'),
    path.join(os.homedir(), '.config', 'openclaw'),
  ].filter((dir): dir is string => Boolean(dir));
}

type PersonaFlavor = 'methodical' | 'playful' | 'pragmatic';

export type AgentProfileHint = {
  displayName?: string;
  avatar?: string;
  description?: string;
  accent?: string;
  borderColor?: string;
  insetShadow?: string;
  idleQuotes?: string[];
  persona?: PersonaFlavor;
};

export type AgentProfileMap = Record<string, AgentProfileHint>;
export type AgentIncludeList = string[] | null;

function detectAgentsFromOpenClawConfig(openclawHome: string): string[] {
  const cfgPath = path.join(openclawHome, 'openclaw.json');
  if (!fs.existsSync(cfgPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];

    const agents = (parsed as { agents?: unknown }).agents;
    if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return [];

    const list = (agents as { list?: unknown }).list;
    if (!Array.isArray(list)) return [];

    const ids = list
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        const id = (entry as { id?: unknown }).id;
        return typeof id === 'string' ? id : null;
      })
      .filter((id): id is string => Boolean(id));

    return normalizeAgentIds(ids);
  } catch (err) {
    console.warn(`[config] Failed to parse OpenClaw config ${cfgPath}:`, err);
    return [];
  }
}

function detectAgentsFromWorkspaceDirs(openclawHome: string): string[] {
  const entries = fs.readdirSync(openclawHome, { withFileTypes: true });
  const rawIds = entries
    .filter((e) => e.isDirectory())
    .flatMap((e) => {
      if (e.name === 'workspace') return ['main'];
      if (e.name.startsWith('workspace-')) return [e.name.replace('workspace-', '')];
      return [];
    });
  return normalizeAgentIds(rawIds);
}

function detectOpenClaw(): { detected: boolean; home: string | null; agents: string[] } {
  for (const dir of resolveOpenClawDirs()) {
    if (dir && fs.existsSync(dir)) {
      // Prefer explicit agent IDs from OpenClaw config; fall back to workspace dirs.
      const fromConfig = detectAgentsFromOpenClawConfig(dir);
      const fromWorkspaceDirs = fromConfig.length ? [] : detectAgentsFromWorkspaceDirs(dir);
      const agents = fromConfig.length ? fromConfig : (fromWorkspaceDirs.length ? fromWorkspaceDirs : ['main']);

      console.log(`[config] OpenClaw detected at ${dir}, agents: ${agents.join(', ')}`);
      return { detected: true, home: dir, agents };
    }
  }
  return { detected: false, home: null, agents: [] };
}

function normalizeAgentId(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}

function normalizeAgentIds(rawIds: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawIds) {
    const id = normalizeAgentId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function readAgentProfileFile(filePath: string | null): AgentProfileMap {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const out: AgentProfileMap = {};
    for (const [rawId, rawValue] of Object.entries(parsed)) {
      const id = normalizeAgentId(rawId);
      if (!id || !rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue;

      const value = rawValue as Record<string, unknown>;
      const hint: AgentProfileHint = {};

      if (typeof value.displayName === 'string' && value.displayName.trim()) hint.displayName = value.displayName.trim();
      if (typeof value.avatar === 'string' && value.avatar.trim()) hint.avatar = value.avatar.trim();
      if (typeof value.description === 'string' && value.description.trim()) hint.description = value.description.trim();
      if (typeof value.accent === 'string' && value.accent.trim()) hint.accent = value.accent.trim();
      if (typeof value.borderColor === 'string' && value.borderColor.trim()) hint.borderColor = value.borderColor.trim();
      if (typeof value.insetShadow === 'string' && value.insetShadow.trim()) hint.insetShadow = value.insetShadow.trim();
      if (value.persona === 'methodical' || value.persona === 'playful' || value.persona === 'pragmatic') {
        hint.persona = value.persona;
      }

      if (Array.isArray(value.idleQuotes)) {
        const quotes = value.idleQuotes
          .filter((q): q is string => typeof q === 'string')
          .map((q) => q.trim())
          .filter(Boolean);
        if (quotes.length) hint.idleQuotes = quotes;
      }

      out[id] = hint;
    }

    return out;
  } catch (err) {
    console.warn(`[config] Failed to parse agent profile file ${filePath}:`, err);
    return {};
  }
}

function resolvePawvyAgentProfilesPath(): string {
  const raw = process.env.PAWVY_AGENT_PROFILES_PATH;
  if (raw) return raw.startsWith('/') ? raw : path.resolve(BACKEND_ROOT, raw);
  return path.join(getPawvyDir(), 'agent-profiles.json');
}

function resolvePluginAgentProfilesPath(): string | null {
  if (process.env.OPENCLAW_AGENT_PROFILES_PATH) {
    const raw = process.env.OPENCLAW_AGENT_PROFILES_PATH;
    return raw.startsWith('/') ? raw : path.resolve(BACKEND_ROOT, raw);
  }
  if (!config.openclaw.home) return null;
  return path.join(config.openclaw.home, 'agent-profiles.json');
}

type AgentProfileEditablePatch = {
  displayName?: string | null;
  avatar?: string | null;
  description?: string | null;
};

function normalizeEditableString(input: unknown): string | null {
  if (input == null) return null;
  const value = String(input).trim();
  return value ? value : null;
}

function readJsonObjectFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (err) {
    console.warn(`[config] Failed to parse JSON object file ${filePath}:`, err);
    return {};
  }
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

type PawvyConfigFile = {
  agents?: {
    include?: unknown;
  };
  includeAgents?: unknown;
  category_defaults?: unknown;
  scratch_root?: unknown;
  allow_scratch_fallback?: unknown;
  scratch_per_task?: unknown;
  scratch_cleanup_mode?: unknown;
  scratch_ttl_days?: unknown;
};

function resolvePawvyConfigPath(): string {
  const raw = process.env.PAWVY_CONFIG ?? process.env.PAWVY_CONFIG_PATH;
  if (raw) return raw.startsWith('/') ? raw : path.resolve(BACKEND_ROOT, raw);

  const xdgDefault = path.join(os.homedir(), '.config', 'pawvy', 'config.json');
  if (fs.existsSync(xdgDefault)) return xdgDefault;

  // Backward-compatible fallback for existing installs.
  const legacyDefault = path.join(getPawvyDir(), 'config.json');
  if (fs.existsSync(legacyDefault)) return legacyDefault;

  return xdgDefault;
}

function readPawvyConfigFile(filePath: string): PawvyConfigFile {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as PawvyConfigFile;
  } catch (err) {
    console.warn(`[config] Failed to parse config file ${filePath}:`, err);
    return {};
  }
}

function parseAgentIncludeListFromEnv(): AgentIncludeList {
  const raw = process.env.PAWVY_AGENTS_INCLUDE ?? process.env.PAWVY_INCLUDE_AGENTS;
  if (raw == null) return null;
  const parsed = normalizeAgentIds(String(raw).split(','));
  // Empty env should be treated as "no restriction", not "show none".
  return parsed.length ? parsed : null;
}

function parseAgentIncludeListFromConfigFile(cfg: PawvyConfigFile): AgentIncludeList {
  const candidate = cfg?.agents?.include ?? cfg?.includeAgents;
  if (candidate === undefined) return null;
  if (!Array.isArray(candidate)) return null;
  // Explicit empty array in config is allowed and means "show none".
  return normalizeAgentIds(candidate.filter((v): v is string => typeof v === 'string'));
}

function resolvePathValue(raw: string): string {
  let value = raw.trim();
  if (!value) return '';

  if (value.startsWith('~')) {
    value = path.join(os.homedir(), value.slice(1));
  }

  value = value.replace(/\$\{([A-Z0-9_]+)\}|\$([A-Z0-9_]+)/gi, (match, a, b) => {
    const key = String(a || b || '');
    const resolved = process.env[key];
    return resolved === undefined ? match : resolved;
  });

  if (/\$\{([A-Z0-9_]+)\}|\$([A-Z0-9_]+)/i.test(value)) return '';
  return path.resolve(value);
}

function parseCategoryDefaults(cfg: PawvyConfigFile): Record<string, string> {
  const raw = cfg.category_defaults;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const entries = Object.entries(raw as Record<string, unknown>);
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey).trim().toLowerCase();
    if (!key || typeof rawValue !== 'string') continue;
    const resolved = resolvePathValue(rawValue);
    if (!resolved) continue;
    out[key] = resolved;
  }
  return out;
}

function parseScratchRoot(cfg: PawvyConfigFile): string {
  const raw = cfg.scratch_root;
  if (typeof raw === 'string' && raw.trim()) {
    const resolved = resolvePathValue(raw);
    if (resolved) return resolved;
  }
  return path.join(os.homedir(), '.local', 'share', 'pawvy', '_misc');
}

function parseAllowScratchFallback(cfg: PawvyConfigFile): boolean {
  if (typeof cfg.allow_scratch_fallback === 'boolean') return cfg.allow_scratch_fallback;
  return true;
}

function parseScratchPerTask(cfg: PawvyConfigFile): boolean {
  if (typeof cfg.scratch_per_task === 'boolean') return cfg.scratch_per_task;
  return false;
}

function parseScratchCleanupMode(cfg: PawvyConfigFile): 'manual' | 'ttl' {
  return cfg.scratch_cleanup_mode === 'ttl' ? 'ttl' : 'manual';
}

function parseScratchTtlDays(cfg: PawvyConfigFile): number | null {
  const mode = parseScratchCleanupMode(cfg);
  if (mode !== 'ttl') return null;
  const raw = cfg.scratch_ttl_days;
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  return null;
}

let _pawvyConfigFile: PawvyConfigFile | null = null;

function getPawvyConfigFile(): PawvyConfigFile {
  if (_pawvyConfigFile == null) {
    _pawvyConfigFile = readPawvyConfigFile(resolvePawvyConfigPath());
  }
  return _pawvyConfigFile;
}

function resolveAgentIncludeList(): AgentIncludeList {
  const fromEnv = parseAgentIncludeListFromEnv();
  if (fromEnv !== null) return fromEnv;

  const cfg = getPawvyConfigFile();
  return parseAgentIncludeListFromConfigFile(cfg);
}

function isAgentIncluded(agentId: string, includeList: AgentIncludeList): boolean {
  if (agentId === '*') return true;
  if (includeList == null) return true;
  return includeList.includes(normalizeAgentId(agentId));
}

// Default projects directory: ~/.pawvy/projects
function resolveProjectsDir(): string {
  const raw = process.env.PAWVY_PROJECTS_DIR;
  if (raw) {
    return raw.startsWith('/') ? raw : path.resolve(BACKEND_ROOT, raw);
  }
  return path.join(os.homedir(), '.pawvy', 'projects');
}

// Pawvy data directory
function getPawvyDir(): string {
  return path.join(os.homedir(), '.pawvy');
}

// Ensure pawvy directory exists
function ensurePawvyDir(): string {
  const dir = getPawvyDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// API key: generate if not provided, store in ~/.pawvy/api-key
function resolveApiKey(): string {
  // 1. Use env var if set
  if (process.env.PAWVY_API_KEY) {
    return process.env.PAWVY_API_KEY;
  }

  // 2. Check file
  const keyFile = path.join(getPawvyDir(), 'api-key');
  if (fs.existsSync(keyFile)) {
    return fs.readFileSync(keyFile, 'utf8').trim();
  }

  // 3. Generate new key
  const newKey = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(keyFile, newKey, { mode: 0o600 });
  console.log(`[config] Generated new API key, saved to ${keyFile}`);
  return newKey;
}

// Lazy-init OpenClaw detection (run once at startup)
let _openclaw: ReturnType<typeof detectOpenClaw> | null = null;
let _agentProfiles: AgentProfileMap | null = null;
let _pluginAgentProfiles: AgentProfileMap | null = null;
let _includedAgents: AgentIncludeList | undefined;
let _categoryDefaults: Record<string, string> | null = null;
let _scratchRoot: string | null = null;
let _allowScratchFallback: boolean | undefined;
let _scratchPerTask: boolean | undefined;
let _scratchCleanupMode: 'manual' | 'ttl' | undefined;
let _scratchTtlDays: number | null | undefined;

export function resetConfigCacheForTests() {
  _openclaw = null;
  _agentProfiles = null;
  _pluginAgentProfiles = null;
  _includedAgents = undefined;
  _pawvyConfigFile = null;
  _categoryDefaults = null;
  _scratchRoot = null;
  _allowScratchFallback = undefined;
  _scratchPerTask = undefined;
  _scratchCleanupMode = undefined;
  _scratchTtlDays = undefined;
}

export const config = {
  get dbPath(): string {
    return resolveDbPath();
  },
  dbSchema: path.join(DB_DIR, 'schema.sql'),
  dbMigrate: path.join(DB_DIR, 'migrate.js'),

  get projectsDir(): string {
    return resolveProjectsDir();
  },

  get apiKey(): string {
    return resolveApiKey();
  },

  get pawvyDir(): string {
    return ensurePawvyDir();
  },

  get openclaw(): ReturnType<typeof detectOpenClaw> {
    if (!_openclaw) {
      _openclaw = detectOpenClaw();
    }
    return _openclaw;
  },

  get agentProfiles(): AgentProfileMap {
    if (_agentProfiles == null) {
      _agentProfiles = readAgentProfileFile(resolvePawvyAgentProfilesPath());
    }
    return _agentProfiles;
  },

  get pluginAgentProfiles(): AgentProfileMap {
    if (_pluginAgentProfiles == null) {
      _pluginAgentProfiles = readAgentProfileFile(resolvePluginAgentProfilesPath());
    }
    return _pluginAgentProfiles;
  },

  get includedAgents(): AgentIncludeList {
    if (_includedAgents === undefined) {
      _includedAgents = resolveAgentIncludeList();
    }
    return _includedAgents;
  },

  get categoryDefaults(): Record<string, string> {
    if (_categoryDefaults == null) {
      _categoryDefaults = parseCategoryDefaults(getPawvyConfigFile());
    }
    return _categoryDefaults;
  },

  get scratchRoot(): string {
    if (_scratchRoot == null) {
      _scratchRoot = parseScratchRoot(getPawvyConfigFile());
    }
    return _scratchRoot;
  },

  get allowScratchFallback(): boolean {
    if (_allowScratchFallback === undefined) {
      _allowScratchFallback = parseAllowScratchFallback(getPawvyConfigFile());
    }
    return _allowScratchFallback;
  },

  get scratchPerTask(): boolean {
    if (_scratchPerTask === undefined) {
      _scratchPerTask = parseScratchPerTask(getPawvyConfigFile());
    }
    return _scratchPerTask;
  },

  get scratchCleanupMode(): 'manual' | 'ttl' {
    if (_scratchCleanupMode === undefined) {
      _scratchCleanupMode = parseScratchCleanupMode(getPawvyConfigFile());
    }
    return _scratchCleanupMode;
  },

  get scratchTtlDays(): number | null {
    if (_scratchTtlDays === undefined) {
      _scratchTtlDays = parseScratchTtlDays(getPawvyConfigFile());
    }
    return _scratchTtlDays;
  },

  isAgentIncluded(agentId: string): boolean {
    return isAgentIncluded(agentId, config.includedAgents);
  },
};

export function listKnownAgentIdsForSettings(): string[] {
  const ids = new Set<string>();
  for (const id of config.openclaw.agents) ids.add(normalizeAgentId(id));
  for (const id of Object.keys(config.pluginAgentProfiles)) ids.add(normalizeAgentId(id));
  for (const id of Object.keys(config.agentProfiles)) ids.add(normalizeAgentId(id));

  const filtered = Array.from(ids).filter(Boolean);
  const include = config.includedAgents;
  if (include == null) return filtered.sort();

  const includeSet = new Set(include.map((id) => normalizeAgentId(id)));
  return filtered.filter((id) => includeSet.has(id)).sort();
}

export function updatePawvyAgentProfile(agentIdRaw: string, patch: AgentProfileEditablePatch): AgentProfileHint {
  const agentId = normalizeAgentId(agentIdRaw);
  if (!agentId) throw new Error('Invalid agent id');

  const filePath = resolvePawvyAgentProfilesPath();
  const existingRaw = readJsonObjectFile(filePath);
  const current = (
    existingRaw[agentId] && typeof existingRaw[agentId] === 'object' && !Array.isArray(existingRaw[agentId])
      ? (existingRaw[agentId] as Record<string, unknown>)
      : {}
  );

  const next = { ...current } as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
    const displayName = normalizeEditableString(patch.displayName);
    if (displayName === null) delete next.displayName;
    else next.displayName = displayName;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'avatar')) {
    const avatar = normalizeEditableString(patch.avatar);
    if (avatar === null) delete next.avatar;
    else next.avatar = avatar;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
    const description = normalizeEditableString(patch.description);
    if (description === null) delete next.description;
    else next.description = description;
  }

  const hasAnyValue = Object.keys(next).length > 0;
  if (hasAnyValue) {
    existingRaw[agentId] = next;
  } else {
    delete existingRaw[agentId];
  }

  writeJsonFile(filePath, existingRaw);
  _agentProfiles = null;

  return config.agentProfiles[agentId] ?? {};
}
