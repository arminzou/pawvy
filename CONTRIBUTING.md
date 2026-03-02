# Contributing to Pawvy

Thanks for your interest! Here's how to get started.

## Quick Start

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/pawvy.git
cd pawvy

# Install deps and init DB
pnpm install
pnpm -C backend init-db

# Run dev
pnpm run dev
```

## Development

- **Frontend:** `pnpm run dev:frontend` (port 5173)
- **Backend:** `pnpm run dev:backend` (port 3001)
- **Tests:** `pnpm run test:e2e`

## Code Style

- Use **TypeScript** for new code
- Run `pnpm run build` before committing to catch type errors
- Keep PRs small and focused

## Submitting Changes

1. Create a branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Test locally
4. Commit with conventional commits: `feat: add new thing`
5. Push and open a PR

## Issues

Found a bug or have a feature idea? [Open an issue](https://github.com/zoulogic/pawvy/issues)!

---

*Last updated: February 2025*
