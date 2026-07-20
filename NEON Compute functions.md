# NEON Compute functions

This document tracks the "secret-manager-only" changes made to reduce Neon compute usage for this Infisical deployment.

Goal: Neon should mostly wake when your apps request secrets/env values, not because of recurring background feature sync.

## Polling & cron jobs — what we actually changed

We did **not** slow down intervals (e.g. to every 6 hours). We **turned them off** when minimal mode is on:

| Before | After (minimal mode) |
|--------|----------------------|
| **Cron jobs** (env config, admin integration, OAuth, rate limit, license, Microsoft Teams) ran every 5–10 min | **Not started** — entire cron block is skipped when `MINIMAL_SECRET_MANAGER_MODE=true` |
| **SSE permission refresh** — every 60s per open dashboard client | **Not started** — 60s interval is not created when minimal mode is on |
| **Queue workers** — heartbeats every 60s per job, reconciliation every 6h, recovery on startup | **Not started** — when `QUEUE_WORKERS_ENABLED=false`, no workers or repeatable jobs are registered |

So in code, with defaults (`MINIMAL_SECRET_MANAGER_MODE=true`, `QUEUE_WORKERS_ENABLED=false`), there are **no** recurring polls or crons hitting the DB. The only DB use should be: app requests (e.g. secret fetches), one-time startup (migrations, bootstrap), and the previous healthcheck (we fixed that by using `/healthcheck`).

## What was changed

- **Enabled minimal mode by default**
  - File: `backend/src/lib/config/env.ts`
  - Added env var: `MINIMAL_SECRET_MANAGER_MODE` (default `true`)
  - Purpose: single switch to disable recurring "fancy" background sync behavior.

- **Disabled queue workers by default**
  - File: `backend/src/lib/config/env.ts`
  - Changed default: `QUEUE_WORKERS_ENABLED` from `true` -> `false`
  - Purpose: stop queue heartbeats/recovery/reconciliation DB traffic unless explicitly enabled.

- **Stopped recurring cron sync jobs when in minimal mode**
  - File: `backend/src/server/routes/index.ts`
  - Gated these background jobs behind `!MINIMAL_SECRET_MANAGER_MODE`:
    - rate limit sync
    - license sync
    - Microsoft Teams sync
    - admin integration config sync
    - env config sync
    - OAuth config sync
  - Added log line indicating cron jobs are skipped in minimal mode.

- **Disabled OAuth background refresh job in minimal mode**
  - File: `backend/src/server/routes/v1/sso-router.ts`
  - `initializeOauthConfigSync()` now no-ops when `MINIMAL_SECRET_MANAGER_MODE=true`.
  - Purpose: no 5-minute OAuth refresh loop unless you explicitly want it.

- **Disabled periodic SSE permission refresh polling in minimal mode**
  - File: `backend/src/ee/services/project-events/project-events-sse-service.ts`
  - Permission refresh interval loop is not started in minimal mode.
  - Existing one-time permission check at subscription time still remains.
  - Purpose: remove repeated DB permission reads every 60s per SSE client.

- **Reduced idle database pooling**
  - File: `backend/src/db/knexfile.ts`
  - Changed pool values in dev/prod:
    - `min: 2` -> `min: 0`
    - `max: 10` -> `max: 5`
  - Purpose: avoid holding idle Neon connections so compute can scale down when idle.

- **Railway healthcheck no longer hits a DB-backed route**
  - File: `backend/src/server/routes/index.ts`
  - Added lightweight route: `GET /healthcheck` that returns `{ status: "ok", date }` with no DB access.
  - File: `railway.toml`
  - Changed Railway `healthcheckPath` from `/api/status` to `/healthcheck`.
  - Purpose: prevent constant DB reads caused by infra health probes.

## Latest validated fix

The final high-impact fix was moving Railway health probes away from `/api/status` (which performs DB reads) to a DB-free route:

- New route: `GET /healthcheck` (no Postgres usage)
- Railway probe target: `/healthcheck`

This was validated by user feedback after deploy as the change that stopped the unexpected Neon compute burn pattern.

## Effective behavior now

With defaults from these changes:

- No recurring sync cron jobs.
- No queue worker background jobs.
- No per-minute SSE permission refresh loop.
- No permanently pinned minimum DB connections.
- Infra liveness checks do not query Postgres.

Result: Infisical behaves closer to "request-driven secret manager" mode.

## Railway env recommendations

Set these for your Infisical service (also defaulted in `railway.toml`):

- `MINIMAL_SECRET_MANAGER_MODE=true`
- `QUEUE_WORKERS_ENABLED=false`
- `TELEMETRY_ENABLED=false`
- `DISABLE_AUDIT_LOG_STORAGE=true` (ok if you only fetch secrets and do not need DB audit history)
- `NODE_OPTIONS=--max-old-space-size=768` (or `512` if the service stays healthy)

## Railway RAM cost (why Infisical alone can be ~$7+)

Railway bills **actual memory continuously** while the Infisical container is running. For “call secrets a few times a day,” CPU and network are tiny; **RAM is almost the whole Infisical line item**.

What we saw / fixed in this fork:

| Symptom | Cause | Mitigation |
|---------|--------|------------|
| ~2.0–2.1 GB steady RAM on the Infisical service | Production image used `NODE_OPTIONS=--max-old-space-size=2048` | Cap heap at **768** (Dockerfile + `railway.toml`); try **512** if stable |
| Always-on bill even with almost no traffic | Railway does **not** scale this service to zero | Lower RAM, or move to Infisical Cloud / a scale-to-zero host |
| Extra Neon compute (separate from Railway RAM) | Healthchecks / crons / queue workers | Already addressed via `/healthcheck` + minimal mode |

Rough math: cutting steady RAM from ~2 GB → ~0.75 GB is on the order of a **~60% drop** on the Infisical RAM charge. Other project services (Redis, Postgres if on Railway, etc.) are separate line items.

### Railway checklist (RAM)

1. Redeploy with the lower `NODE_OPTIONS` (768 default in this branch).
2. In Railway → Infisical service → Metrics, confirm RAM baseline falls below ~1 GB after deploy.
3. If the process OOMs, bump only as needed: `512` → `768` → `1024` (do not go back to `2048` unless you must).
4. Keep a **single replica**. Extra replicas multiply RAM cost.
5. Prefer **Neon** (autosuspend) for Postgres rather than an always-on Railway Postgres if DB is still on Railway.
6. Keep Redis as small as Railway allows; Infisical still requires Redis even with queue workers off.
7. Optional escape hatch: use **Infisical Cloud** free/hobby for tiny secret traffic and delete the self-hosted Railway Infisical service.

## Deployment checklist (copy/paste)

1. Deploy code containing:
   - `backend/src/server/routes/index.ts` with `/healthcheck`
   - `railway.toml` with `healthcheckPath = "/healthcheck"` and low-RAM `NODE_OPTIONS`
   - `Dockerfile.standalone-infisical` / `standalone-entrypoint.sh` with heap capped at 768MB
2. In Railway service settings, verify health check path is `/healthcheck`.
3. Confirm env vars (or rely on `railway.toml` defaults):
   - `MINIMAL_SECRET_MANAGER_MODE=true`
   - `QUEUE_WORKERS_ENABLED=false`
   - `NODE_OPTIONS=--max-old-space-size=768`
   - `TELEMETRY_ENABLED=false`
   - `DISABLE_AUDIT_LOG_STORAGE=true`
4. Keep Neon endpoint autosuspend enabled and minimum CU low.
5. Verify after idle period:
   - Neon compute activity drops when no app requests are made.
   - Railway Infisical RAM baseline is well under ~2 GB (target ~0.5–1 GB).

## If you still see overnight compute

Small overnight charges (e.g. ~$0.01) can still happen. Check these:

1. **Env vars in Railway**  
   For the Infisical service, confirm:
   - `MINIMAL_SECRET_MANAGER_MODE=true` (or unset — code default is `true`)
   - `QUEUE_WORKERS_ENABLED=false` (or unset — code default is `false`)  
   If either is overridden the wrong way, crons or queue workers will run again.

2. **Railway healthcheck**  
   Health checks must use **`/healthcheck`**, not `/api/status`.  
   In Railway: Service → Settings → Health check path = `/healthcheck`.

3. **Neon suspend & min CU**  
   In Neon dashboard, for the Infisical project’s compute:
   - **Suspend timeout** should be enabled (e.g. 300 seconds), not 0 (never suspend).
   - **Min compute** should be 0.25 or “scale to zero” if available.  
   If suspend is off or min CU is high, compute can stay on and bill overnight.

4. **Other clients to the same DB**  
   If anything else (e.g. another app or script) uses the same Neon DB connection string, its traffic will also show up as compute.

5. **Logs at startup**  
   After deploy, check Infisical logs for:
   - `MINIMAL_SECRET_MANAGER_MODE enabled; skipping recurring background sync cron jobs`
   - No “Internal queue recovery and reconciliation workers started” (that only appears when queue workers are enabled).  
   That confirms minimal mode and no queue workers.

## Regression guardrails

- Do not point infra health checks back to `/api/status` unless you intentionally want DB-backed status checks.
- Keep `/healthcheck` DB-free (no `getServerCfg`, no DAL calls).
- If future features require background workers, enable them explicitly and document expected Neon impact first.

Optional if you ever need original behavior:

- Set `MINIMAL_SECRET_MANAGER_MODE=false` to re-enable recurring cron sync behavior.
- Set `QUEUE_WORKERS_ENABLED=true` to re-enable queue workers.

## Trade-offs

- If you later rely on SSO/OAuth auto-refresh, Teams sync, license/rate-limit sync, or queue-based background processing, you may need to disable minimal mode and/or re-enable workers.
- This setup is optimized for your stated use case: secret storage and on-demand reads by your own apps.
