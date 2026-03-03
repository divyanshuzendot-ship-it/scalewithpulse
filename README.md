# ScaleWithPulse Meta Ads POC

Production-lean monorepo POC for internal Meta Ads analytics at AdBuffs.

## Included in Phase 1

- Monorepo (`pnpm` + Turborepo) with:
  - `apps/api`: NestJS API
  - `apps/web`: Next.js App Router UI
- API endpoints:
  - `GET /v1/meta/ad-accounts`
  - `GET /v1/meta/ad-accounts/:id/hierarchy?since=YYYY-MM-DD&until=YYYY-MM-DD`
- Meta client capabilities:
  - versioned Graph API base URL
  - bearer auth header with central system-user token
  - pagination support
  - retry/backoff on rate-limit conditions
- Web dashboard:
  - protected placeholder login (internal token + `@adbuffs.com` email)
  - ad account dropdown from API
  - campaign -> adset -> ad -> creative hierarchy table
- RBAC contracts scaffolded for next phase (no enforcement yet).

## Repo Structure

- `apps/api` NestJS server
- `apps/web` Next.js app
- `apps/docs` docs app (unused for this POC)
- `packages/*` shared lint/types/ui config

## Prerequisites

- Node.js >= 18
- `pnpm` 9
- (Next phase) PostgreSQL + Redis for persistence/jobs

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy env templates:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

3. Update `apps/api/.env` with a valid `META_ACCESS_TOKEN`.

## Run Locally

Run both apps:

```bash
pnpm dev
```

Run individually:

```bash
pnpm dev:api
pnpm dev:web
```

- API: `http://localhost:4000`
- Web: `http://localhost:3000`

## API Notes

### `GET /v1/meta/ad-accounts`
Returns ad accounts accessible by the central system-user token.

### `GET /v1/meta/ad-accounts/:id/hierarchy`
Returns campaign -> adset -> ad -> creative tree.

- Accepts optional `since` and `until` (`YYYY-MM-DD`).
- When date range is provided, tree is filtered to ads active in the selected range using ad-level insights.

## Placeholder Access Model (Phase 1)

- Web auth is a temporary internal gate.
- Production target is Google OAuth with domain restriction and backend-enforced RBAC.

## RBAC Scaffold (Next Step)

`apps/api/src/access/contracts.ts` includes table contracts for:

- internal users (`InternalUserRecord`)
- ad account access mappings (`AdAccountAccessRecord`)
- role enum (`ADMIN`, `ANALYST`, `VIEWER`)

## What remains

- Google OAuth production setup and session hardening
- RBAC persistence + enforcement at API layer
- Meta data sync jobs and caching (Redis + workers)
- Historical metrics storage in PostgreSQL
