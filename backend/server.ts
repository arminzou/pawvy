import express from 'express';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { createDatabase } from './src/infra/database/dbConnection';
import { config } from './src/config';
import { createWebSocketHub } from './src/infra/realtime/websocketHub';
import { applyCommonMiddleware } from './src/presentation/http/middleware/commonMiddleware';
import { registerRoutes } from './src/presentation/http/routes';

// Load environment variables from .env (one directory up from backend/)
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const PORT = Number(process.env.PORT ?? 3001);
const HOST = String(process.env.HOST ?? '127.0.0.1');
const BIND_RETRY_MAX_ATTEMPTS = Number(process.env.PAWVY_BIND_RETRY_ATTEMPTS ?? 3);
const BIND_RETRY_DELAY_MS = Number(process.env.PAWVY_BIND_RETRY_DELAY_MS ?? 400);

// Ensure DB directory exists (container may mount /app/data)
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

// Initialize core dependencies
const app = express();
const db = createDatabase();

// Make db available to routes (legacy pattern, to be removed when all routes migrated)
app.locals.db = db;

// Broadcast placeholder (will be wired up after WebSocket hub is created)
let broadcastImpl: (data: unknown) => void = () => {};
app.locals.broadcast = (data: unknown) => broadcastImpl(data);

// Apply middleware (CORS, JSON parsing, auth, logging)
applyCommonMiddleware(app);

// Register API routes
registerRoutes(app, db, app.locals.broadcast);

// Frontend SPA fallback (production build)
const DEFAULT_FRONTEND_DIST = path.resolve(
    __dirname,
    path.basename(__dirname) === 'dist' ? '../../frontend/dist' : '../frontend/dist',
);
const FRONTEND_DIST = process.env.FRONTEND_DIST
    ? path.resolve(process.env.FRONTEND_DIST)
    : DEFAULT_FRONTEND_DIST;
const FRONTEND_INDEX = path.join(FRONTEND_DIST, 'index.html');
const HAS_FRONTEND = fs.existsSync(FRONTEND_INDEX);

if (HAS_FRONTEND) {
    app.use(express.static(FRONTEND_DIST));
    // History API fallback (avoid intercepting /api/*)
    app.get(/^\/(?!api\/).*/, (req, res) => {
        res.sendFile(FRONTEND_INDEX);
    });
} else {
    app.get('/', (req, res) => {
        res.json({
            name: 'Pawvy Backend',
            status: 'ok',
            api: {
                health: '/api/health',
                tasks: '/api/tasks',
                activities: '/api/activities',
                docs: '/api/docs',
                projects: '/api/projects',
            },
            note: 'Frontend build not found. Run: npm --prefix frontend run build',
        });
    });
}

// Create HTTP server for WebSocket upgrade
const server = http.createServer(app);

// WebSocket hub (real-time updates)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isRequestAuthorized } = require('./utils/auth');
const { wss, broadcast } = createWebSocketHub({
    server,
    path: '/ws',
    isAuthorized: isRequestAuthorized,
    log: console,
});

// Wire up broadcast to routes
broadcastImpl = broadcast;

let bindAttempts = 0;
let startupComplete = false;

function startListening() {
    server.listen(PORT, HOST);
}

// Server error handling
server.on('error', (err: NodeJS.ErrnoException) => {
    if (err?.code === 'EADDRINUSE') {
        const canRetry = !startupComplete && bindAttempts < BIND_RETRY_MAX_ATTEMPTS;

        if (canRetry) {
            bindAttempts += 1;
            console.warn(
                `\n⚠️ Port ${PORT} is busy (attempt ${bindAttempts}/${BIND_RETRY_MAX_ATTEMPTS}). Retrying in ${BIND_RETRY_DELAY_MS}ms...`,
            );
            setTimeout(() => {
                startListening();
            }, BIND_RETRY_DELAY_MS);
            return;
        }

        console.error(`\n❌ Port ${PORT} is already in use.`);
        console.error(`👉 Try: PORT=${PORT + 1} npm run dev\n`);
        process.exit(1);
    }
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
        console.error(`\n❌ Permission denied binding to ${HOST}:${PORT}.`);
        console.error('👉 Try a higher port (e.g. 3002) or set HOST=127.0.0.1\n');
        process.exit(1);
    }
    throw err;
});

// Start server
server.on('listening', () => {
    startupComplete = true;

    const baseUrl = `http://${HOST}:${PORT}`;
    const wsUrl = `ws://${HOST}:${PORT}/ws`;
    console.log(`\n🚀 Pawvy Backend running on ${baseUrl}`);
    console.log(`📊 WebSocket endpoint: ${wsUrl}`);
    console.log(`💾 Database: ${config.dbPath}`);
    console.log(`🔑 API Key: ${config.apiKey}`);
    console.log(`📁 Projects: ${config.projectsDir}`);
    if (config.openclaw.detected) {
        console.log(`🤖 OpenClaw: detected at ${config.openclaw.home}`);
    }

    // Optional: auto-sync for dashboard data freshness
    if (String(process.env.AUTO_SYNC || '').toLowerCase() === '1' || String(process.env.AUTO_SYNC || '').toLowerCase() === 'true') {
        const intervalMs = Number(process.env.SYNC_INTERVAL_MS || 60_000);
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { createAutoSync } = require('./utils/autoSync');
        const auto = createAutoSync({ intervalMs, log: console, db, broadcast: app.locals.broadcast });
        app.locals.autoSync = auto;
        console.log(`🔁 Auto-sync enabled (every ${intervalMs}ms)\n`);
    } else {
        console.log('');
    }
});

startListening();

// Graceful shutdown
const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`);

    if (app.locals.autoSync) app.locals.autoSync.stop();

    wss.clients.forEach((client) => {
        try {
            client.close(1001, 'Server shutting down');
        } catch {
            // ignore
        }
    });

    server.close(() => {
        db.close();
        console.log('Server closed');
        process.exit(0);
    });

    setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
    }, 5000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
