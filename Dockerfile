# --- Stage 1: Build Frontend ---
FROM node:20 AS build-frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
# ensure dev deps (vite types) are installed for the build
RUN npm install --include=dev
COPY frontend/ ./
# Pass frontend env vars during build so they're baked into the static JS
ARG PAWVY_API_KEY
ARG API_BASE
ARG WS_BASE
ENV PAWVY_API_KEY=$PAWVY_API_KEY
ENV API_BASE=$API_BASE
ENV WS_BASE=$WS_BASE
RUN npm run build

# --- Stage 2: Final Image ---
FROM node:20
WORKDIR /app

# Build tooling for native deps (e.g., better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy ONLY package files first
COPY backend/package*.json ./backend/

# Install deps (include devDeps for build)
RUN cd backend && rm -rf node_modules && npm install

# Copy backend source
COPY backend/ ./backend/

# Build backend (TypeScript -> dist)
RUN cd backend && npm run build

# Change to backend directory for runtime
WORKDIR /app/backend

# Remove dev deps for smaller runtime image
RUN npm prune --omit=dev

# Copy frontend build from Stage 1
RUN mkdir -p frontend/dist
COPY --from=build-frontend /app/frontend/dist /app/frontend/dist

# Create data directory for SQLite
RUN mkdir -p /app/data
ENV PAWVY_DB_PATH=/app/data/pawvy.db
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001
CMD ["node", "dist/server.js"]
