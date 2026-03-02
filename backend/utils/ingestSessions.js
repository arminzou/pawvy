const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const DEFAULT_AGENTS = ['tee', 'fay'];

function parseJsonlLines(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  return lines.map((l, idx) => ({ idx: idx + 1, obj: JSON.parse(l) }));
}

function extractTextParts(message) {
  const parts = message?.content ?? [];
  const texts = [];
  for (const p of parts) {
    if (p?.type === 'text' && typeof p.text === 'string') texts.push(p.text);
  }
  return texts.join('\n');
}

function inferAgentFromPath(p) {
  const seg = p.split(path.sep);
  const i = seg.lastIndexOf('agents');
  if (i >= 0 && seg[i + 1]) return seg[i + 1];
  return null;
}

function ingestSessions({ agents = DEFAULT_AGENTS } = {}) {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const defaultDbPath = path.join(dataHome, 'pawvy', 'pawvy.db');
  const dbPath = process.env.PAWVY_DB_PATH || defaultDbPath;

  // Ensure DB directory exists
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // Ensure schema migrations applied
  const { migrate } = require('../db/migrate');
  migrate(db);

  const agentList = (process.env.AGENTS ? process.env.AGENTS.split(',') : agents)
    .map((s) => s.trim())
    .filter(Boolean);

  const base = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');

  const insert = db.prepare(`
    INSERT OR IGNORE INTO activities (agent, activity_type, description, details, session_key, timestamp, source_id)
    VALUES (@agent, @activity_type, @description, @details, @session_key, @timestamp, @source_id)
  `);

  let inserted = 0;
  let scanned = 0;

  for (const agent of agentList) {
    const sessionsDir = path.join(base, 'agents', agent, 'sessions');
    if (!fs.existsSync(sessionsDir)) continue;

    const files = fs
      .readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(sessionsDir, f));

    for (const file of files) {
      const rows = parseJsonlLines(file);
      for (const { idx, obj } of rows) {
        if (obj?.type !== 'message') continue;
        const role = obj?.message?.role;
        if (role !== 'assistant') continue;

        // tool calls become activities
        const contents = obj?.message?.content ?? [];
        for (let cIdx = 0; cIdx < contents.length; cIdx++) {
          const c = contents[cIdx];
          if (c?.type !== 'toolCall') continue;

          const ts = obj?.timestamp || obj?.message?.timestamp || null;
          const iso = typeof ts === 'string' ? ts : new Date(ts || Date.now()).toISOString();
          const name = c?.name || 'tool';

          const sourceId = `${path.basename(file)}:${idx}:${cIdx}`;
          const res = insert.run({
            agent,
            activity_type: 'tool_call',
            description: `Tool call: ${name}`,
            details: JSON.stringify({ tool: name, arguments: c?.arguments ?? null }),
            session_key: null,
            timestamp: iso,
            source_id: sourceId,
          });
          if (res.changes) inserted += 1;
          scanned += 1;
        }

        // assistant text messages (optional)
        const text = extractTextParts(obj?.message);
        if (text) {
          const ts = obj?.timestamp || obj?.message?.timestamp || null;
          const iso = typeof ts === 'string' ? ts : new Date(ts || Date.now()).toISOString();
          const sourceId = `${path.basename(file)}:${idx}:text`;
          const res = insert.run({
            agent,
            activity_type: 'message',
            description: text.slice(0, 240),
            details: null,
            session_key: null,
            timestamp: iso,
            source_id: sourceId,
          });
          if (res.changes) inserted += 1;
          scanned += 1;
        }
      }
    }
  }

  db.close();
  return { scanned, inserted, agents: agentList };
}

function main() {
  try {
    const r = ingestSessions();
    console.log(`✓ Ingest complete. scanned=${r.scanned} inserted=${r.inserted}`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

module.exports = { ingestSessions };

if (require.main === module) main();
