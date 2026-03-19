# Infisical + Neon: What’s Hitting the DB and How to Reduce Compute

If Infisical uses **Neon** as its PostgreSQL database, these behaviors can drive constant or frequent DB load and increase Neon compute usage.

---

## “I only need Neon to wake when my apps fetch env” — What actually matters

**Your use case:** TheOverseer backend, FastAPI, overseer-mcp, etc. call Infisical at startup (or when they need secrets). You don’t use the Infisical dashboard live, SSO, Microsoft Teams, or heavy background jobs.

**Why all this is firing:** Infisical is built for teams and product features: live dashboard updates, SSO/OAuth, integrations, audit logs, secret sync, etc. So it runs crons and background tasks **all the time** to keep that stuff up to date. For “just give my apps env when they ask,” most of that is unnecessary and is what keeps Neon awake.

**Effect on you:**

| What’s firing | Why Infisical does it | Why you don’t need it |
|---------------|------------------------|------------------------|
| **Env config sync every 5 min** | So the Infisical UI and API always show the latest server settings (SMTP, signup, etc.). | Your apps only read **secrets** (e.g. via SDK or API). They don’t depend on server config changing every 5 minutes. |
| **Admin integration sync every 5 min** | Keeps “admin” integration config (e.g. SCIM, IdP) in sync for big-org features. | You’re not using those admin integrations. |
| **OAuth config refresh every 5 min** | Keeps SSO/OAuth IdP metadata (e.g. SAML, OIDC) fresh so login keeps working. | You’re not using Infisical’s SSO/OAuth for login. |
| **Microsoft Teams sync every 5 min** | Syncs Teams workflow integration config. | You’re not using Teams integration. |
| **License sync every 10 min** | If you use an **online** license key, it checks with the license server so feature flags stay current. | With self-hosted / offline or no license, this often doesn’t run or matters less. |
| **Rate limit sync every 10 min** | Pushes custom rate limit config from DB into memory (EE feature). | You’re not tuning custom rate limits. |
| **SSE permission refresh every 60s** | So every **open Infisical dashboard/SSE connection** gets up-to-date permissions (e.g. “can this user still see this project?”). | You’re not keeping the Infisical dashboard open 24/7; your apps just call the API for secrets. So no SSE = no per-client DB hit every 60s. |
| **Queue heartbeats every 60s** | So Infisical knows long-running jobs (audit log, secret sync, etc.) are still alive and can recover after a crash. | If you disable queue workers, there are no jobs → no heartbeats → no extra DB writes. |
| **Pool min 2 connections** | Default “always have 2 connections ready” for snappy API response. | That keeps Neon from scaling to zero. For “wake on request,” you want 0 idle connections when nobody is calling. |

**Bottom line:** For “Neon wakes only when my apps call for env,” you want to: **stop the crons from running so often (or at all), stop queue workers, and drop idle DB connections (pool.min = 0).** Then Neon is used only when your apps actually hit Infisical’s API (which then hits the DB to fetch secrets).

---

## 1. Crons that run every 5 minutes

These run **every 5 minutes** and typically touch the DB (and sometimes external APIs):

| Location | Cron pattern | What it does |
|----------|--------------|--------------|
| `backend/src/services/super-admin/super-admin-service.ts` | `*/5 * * * *` | **Env config sync** — `initializeEnvConfigSync()` |
| Same file | `*/5 * * * *` | **Admin integration config sync** — `initializeAdminIntegrationConfigSync()` |
| `backend/src/server/routes/v1/sso-router.ts` | `*/5 * * * *` | **OAuth config refresh** — `refreshOauthConfig()` |
| `backend/src/services/microsoft-teams/microsoft-teams-service.ts` | `*/5 * * * *` | **Microsoft Teams integration sync** (production only) |

So you get **at least 4 cron jobs × 12 runs/hour = 48 runs/hour** from these alone, each doing DB (and possibly external) work.

---

## 2. Crons every 10 minutes

| Location | Cron pattern | Condition |
|----------|--------------|-----------|
| `backend/src/ee/services/license/license-service.ts` | `*/10 * * * *` | Only if **online license** is configured |
| `backend/src/ee/services/rate-limit/rate-limit-service.ts` | `*/10 * * * *` | Only if **custom rate limits** are enabled (EE) |

---

## 3. Project Events SSE — permission refresh every 60 seconds

**File:** `backend/src/ee/services/project-events/project-events-sse-service.ts`

- `PERMISSION_REFRESH_INTERVAL = 60 * 1000` (60 seconds).
- A `setInterval` runs every 60s and, for **each connected SSE client**, calls `$refreshPermission(clientId)`.
- `$refreshPermission` → `fetchPermission()` → **`permissionService.getProjectPermission()`**, which hits the **database** (roles, permissions, etc.).

So: **N connected SSE clients ⇒ N DB permission fetches every 60 seconds.**  
If the frontend or any integration keeps SSE connections open (e.g. dashboard, CLI, or MCP), this can add up quickly.

---

## 4. Queue job heartbeats — every 60 seconds per active job

**File:** `backend/src/queue/queue-service.ts`

- For queues with **persistence** enabled, each **active** job runs a heartbeat every **60 seconds**.
- Heartbeat does: `queueJobsDAL.update({ jobId, queueName }, { lastHeartBeat: new Date() })` → **DB write**.

So: **M active persistent jobs ⇒ M DB updates per minute.**  
Long-running or frequently running persistent jobs (e.g. secret sync, replication, audit log) increase this.

---

## 5. Connection pool — keeps Neon from scaling to zero

**File:** `backend/src/db/knexfile.ts`

- **Pool:** `min: 2`, `max: 10`.
- At least **2 connections** are kept open to Postgres at all times.
- On **Neon serverless**, that can:
  - Prevent the compute from scaling to zero (Neon may consider the instance “in use” while connections are open).
  - Cause keepalives or reconnects that show up as compute time.

---

## 6. Other periodic work

- **Queue reconciliation:** every 6 hours (`0 */6 * * *`) — reads from Postgres.
- **Resource cleanup:**  
  - In production: daily or every 6 hours.  
  - If `NODE_ENV=development` and `DAILY_RESOURCE_CLEAN_UP_DEVELOPMENT_MODE` is set: **every 5 minutes** (dev-only).
- **Health alert / telemetry:** some jobs run every 5 min or every 6 hours depending on config.

---

## Recommended mitigations

1. **Reduce cron frequency for non-critical syncs (self-hosted)**  
   - Increase the interval for env config, admin integration config, and OAuth config from 5 min to 15–30 min (or more) if you don’t need near-real-time updates.  
   - Same for Microsoft Teams sync if you use it.

2. **Increase SSE permission refresh interval**  
   - In `project-events-sse-service.ts`, increase `PERMISSION_REFRESH_INTERVAL` (e.g. from 60s to 5 min) to cut DB calls per SSE client.  
   - Only do this if slightly staler permissions are acceptable for SSE subscribers.

3. **Lower Knex pool size for Neon**  
   - In `knexfile.ts`, set `pool.min` to **0** (and keep `max` small, e.g. 5) so Infisical doesn’t hold idle connections.  
   - This helps Neon scale to zero when there’s no traffic.  
   - Test under load; increase `min` only if you see connection thrashing.

4. **Disable or limit queue workers**  
   - Set `QUEUE_WORKERS_ENABLED=false` if you don’t need background jobs (no heartbeats, no recovery, no reconciliation).  
   - Or use `QUEUE_WORKER_PROFILE` to run only the queues you need, so fewer persistent jobs and fewer heartbeats.

5. **Confirm what’s actually using Neon**  
   - In **Neon dashboard**: check **Metrics** (connections, compute time, queries).  
   - Correlate spikes with Infisical deploys, cron schedules, and SSE usage to confirm these are the main contributors.

6. **Use a dedicated Postgres instance for Infisical**  
   - If Infisical and TheOverseer share the same Neon project, consider giving Infisical its own Neon DB (or a separate Postgres) so Infisical’s crons, SSE, and pool don’t compete with your app’s workload and so you can tune pool/crons for Infisical alone.

---

## Quick reference: files to adjust

| Goal | File | What to change |
|------|------|----------------|
| Less frequent env/admin/OAuth sync | `backend/src/services/super-admin/super-admin-service.ts` | Cron from `*/5 * * * *` to e.g. `*/15 * * * *` or `*/30 * * * *` |
| Less frequent OAuth refresh | `backend/src/server/routes/v1/sso-router.ts` | Same cron pattern change |
| Less frequent SSE permission refresh | `backend/src/ee/services/project-events/project-events-sse-service.ts` | Increase `PERMISSION_REFRESH_INTERVAL` (e.g. to `5 * 60 * 1000`) |
| Fewer idle DB connections | `backend/src/db/knexfile.ts` | Set `pool.min` to `0`, consider lower `max` |
| Fewer queue-related DB writes | Env / Railway | `QUEUE_WORKERS_ENABLED=false` or restrict `QUEUE_WORKER_PROFILE` |

These changes are **optional** and depend on your security and freshness requirements; test in a non-production environment first.

---

## Minimal setup: “Only wake Neon when my apps ask for env”

If your only goal is **apps pull secrets from Infisical when they start (or on demand)** and you want Neon to sleep the rest of the time:

1. **Env var (no code change)**  
   - Set **`QUEUE_WORKERS_ENABLED=false`** in Infisical’s environment (e.g. Railway).  
   - Stops: queue heartbeats, reconciliation, recovery, and all background job DB traffic.  
   - Your secret fetches are HTTP requests to the API; they don’t need queue workers.

2. **Pool: allow Neon to scale to zero**  
   - In **`backend/src/db/knexfile.ts`**, set **`pool.min` to `0`** (in both `development` and `production`).  
   - Infisical will open DB connections when handling requests and can release them when idle, so Neon can scale down when no one is calling.

3. **Slower crons (optional but recommended)**  
   - In **`backend/src/services/super-admin/super-admin-service.ts`**, change the two cron patterns from **`*/5 * * * *`** to **`0 */6 * * *`** (every 6 hours) for env config sync and admin integration sync.  
   - In **`backend/src/server/routes/v1/sso-router.ts`**, change the OAuth refresh cron from **`*/5 * * * *`** to **`0 */6 * * *`** if you’re not using SSO.  
   - Result: way fewer cron-driven DB hits; Neon still wakes when your apps call for secrets.

4. **Don’t leave Infisical dashboard open**  
   - Each open dashboard tab can hold an SSE connection → permission refresh every 60s.  
   - Closing the tab when you’re done avoids that extra load.

After this, Neon should mainly see traffic when your apps (backend, FastAPI, overseer-mcp) request env/secrets from Infisical; the rest of the “fancy” background behavior is reduced or off.
