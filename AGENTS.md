# Repository Guidelines

**More details about this repo:** see [CLAUDE.md](./CLAUDE.md).

## Project Structure & Module Organization
Pawvy is a monorepo with separate backend and frontend apps.

- `backend/`: Express + TypeScript API, SQLite access, WebSocket hub.
  - `src/presentation/http/routes/`: HTTP route handlers.
  - `src/services/`: business logic layer.
  - `src/repositories/`: database access layer.
  - `test/`: Vitest + Supertest backend tests.
- `frontend/`: React + TypeScript + Vite UI.
  - `src/pages/`: page-level features (Kanban, Activity, Docs).
  - `src/components/`: shared UI and layout components.
- `extensions/pawvy-agent/`: OpenClaw plugin integration.
- `docs/`: implementation docs and roadmap context.

## Build, Test, and Development Commands
Use `pnpm` from repo root.

- `pnpm run dev`: run backend (`:3001`) and frontend (`:5173`) together.
- `pnpm run dev:backend`: backend only.
- `pnpm run dev:frontend`: frontend only.
- `pnpm run build`: production frontend build.
- `pnpm run test:backend`: run backend Vitest suite.
- `pnpm run test:frontend`: run frontend Vitest suite.
- `pnpm run test:e2e`: Playwright end-to-end tests.

## Coding Style & Naming Conventions
- Language: TypeScript across backend/frontend.
- Indentation: 2 spaces; keep functions small and single-purpose.
- Backend pattern: Routes -> Services -> Repositories (no direct DB in routes).
- React components: `PascalCase` filenames; hooks as `useX.ts`.
- Prefer explicit types at API boundaries; validate untrusted inputs.
- Run lint/tests before commit; avoid dead code and commented-out blocks.

## Frontend UI Style Guidelines
- Prefer shared primitives for controls:
  - Use `frontend/src/components/ui/Button.tsx` for actions.
  - Use `frontend/src/components/ui/Checkbox.tsx` for checkboxes.
  - Avoid new raw `<button>` / checkbox styles unless there is a clear exception.
- Keep interaction patterns consistent:
  - Use token-based colors (`--cb-*`) for hover/focus/disabled states.
  - Primary actions should keep subtle but visible hover cues (including border contrast in light/dark themes).
  - Preserve focus-visible ring behavior from shared components.
- Dark mode readability:
  - Avoid low-contrast accent text on dark surfaces.
  - Prefer `--cb-accent-text` / `--cb-on-accent` for legible emphasis.
- Icons:
  - Prefer `lucide-react` for UI/action icons.
  - Do not introduce ad-hoc SVG icon implementations when a Lucide icon exists.
- Validation for UI style changes:
  - Run `pnpm -C frontend build` before marking related tasks done.

## Testing Guidelines
- Backend: Vitest + Supertest, located in `backend/test`.
- Frontend: Vitest + Testing Library, colocated under `frontend/src`.
- E2E: Playwright from repo root.
- Test naming: describe behavior, not implementation (e.g., `"returns 400 for invalid bulk assignee payload"`).
- Add regression tests for bug fixes, especially API validation and websocket status flows.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style seen in history, e.g.:
  - `feat(agent): add turn counter to thinking status flow`
  - `fix(tasks): restore assignee validation`
- PRs should include:
  - concise problem/solution summary,
  - linked task/issue IDs,
  - test evidence (commands + results),
  - screenshots/GIFs for UI changes.

## Security & Configuration Tips
- Never commit secrets. Use `.env` and `.env.example`.
- API auth uses `PAWVY_API_KEY`; frontend reads `VITE_PAWVY_API_KEY`.
- For task management, update task state via API endpoints, not direct DB edits.
