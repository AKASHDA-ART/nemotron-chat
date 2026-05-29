# Nemotron Chat

React + Vite frontend, Express API, Drizzle ORM, SQLite. pnpm workspace monorepo.

## Development (GitHub Codespaces)

1. Pull latest (if `git pull` fails on `pnpm-lock.yaml`, use the sync script below).
2. Install and run:

```bash
cd /workspaces/nemotron-chat
pnpm install
pnpm typecheck
pnpm dev:web    # port 5173
pnpm dev:api    # port 8080 — second terminal
```

Set `NVIDIA_API_KEY` in `.env` at the repo root.

### `git pull` blocked by untracked `pnpm-lock.yaml`

If you see:

```text
error: The following untracked working tree files would be overwritten by merge: pnpm-lock.yaml
```

Run:

```bash
chmod +x scripts/pull-and-install.sh
./scripts/pull-and-install.sh
```

Or manually:

```bash
rm -f pnpm-lock.yaml
git pull
pnpm install
```

Always **`git pull` before `pnpm install`** in Codespaces so you do not create a conflicting local lockfile.

## Development (Windows + Cursor)

Edit in Cursor, commit and push, then pull in Codespaces. Commit `pnpm-lock.yaml` whenever you change `package.json`.

```bash
pnpm install
pnpm typecheck
pnpm dev:web
pnpm dev:api
```

## Scripts (repo root)

| Script | Description |
|--------|-------------|
| `pnpm dev:web` | Vite frontend (5173) |
| `pnpm dev:api` | Express API (8080) |
| `pnpm typecheck` | Typecheck frontend |
| `pnpm build:web` | Production frontend build |
| `pnpm build:api` | Bundle API server |
