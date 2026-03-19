# NEON Compute functions

This document tracks the "secret-manager-only" changes made to reduce Neon compute usage for this Infisical deployment.

Goal: Neon should mostly wake when your apps request secrets/env values, not because of recurring background feature sync.

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

## Effective behavior now

With defaults from these changes:

- No recurring sync cron jobs.
- No queue worker background jobs.
- No per-minute SSE permission refresh loop.
- No permanently pinned minimum DB connections.

Result: Infisical behaves closer to "request-driven secret manager" mode.

## Railway env recommendations

Set these for your Infisical service:

- `MINIMAL_SECRET_MANAGER_MODE=true`
- `QUEUE_WORKERS_ENABLED=false`

Optional if you ever need original behavior:

- Set `MINIMAL_SECRET_MANAGER_MODE=false` to re-enable recurring cron sync behavior.
- Set `QUEUE_WORKERS_ENABLED=true` to re-enable queue workers.

## Trade-offs

- If you later rely on SSO/OAuth auto-refresh, Teams sync, license/rate-limit sync, or queue-based background processing, you may need to disable minimal mode and/or re-enable workers.
- This setup is optimized for your stated use case: secret storage and on-demand reads by your own apps.
