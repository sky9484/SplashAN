# W1 — Backups & restore drill (DigitalOcean Managed PostgreSQL)

Host decision (0xSky, 2026-07-18): **DigitalOcean Managed PostgreSQL** — the
project already runs on DO.

## What the managed cluster gives us

- **Daily automated backups**, retained 7 days, no configuration required.
- **Point-in-time recovery (PITR)** via continuous WAL archiving: restore to
  any second within the retention window.
- Restores always create a **new cluster** (fork) — the original is never
  overwritten, which makes the drill safe to run against production.

## Setup checklist (once the cluster exists)

1. Create the cluster (smallest tier is fine pre-launch; PG 16).
2. Add the app as a **trusted source** (App Platform app or droplet) so the
   DB is not open to the internet.
3. Create a restricted `splash_app` role — the `doadmin` superuser stays out
   of `DATABASE_URL`.
4. Put the connection string (with `sslmode=require`) in `.env.local` /
   the deployment env as `DATABASE_URL`. Never commit it.
5. Run `npm run db:migrate` to apply the checked-in migrations in `drizzle/`.

## Restore drill (run once, record evidence — W1 acceptance)

1. Note the current time T and write a marker row:
   `insert into webhook_events (id, provider, event_id, payload) values ('drill-<date>','DRILL','drill-<date>','{}');`
2. In the DO console: **Databases → cluster → Backups → Restore** — choose
   "point in time", pick T+1 minute, restore to a NEW cluster.
3. Connect to the forked cluster; verify the marker row exists and
   `npm run test:db` invariants hold against it
   (`DATABASE_URL=<fork> node --experimental-strip-types ...`).
4. Record: restore start/end wall-clock, fork cluster name, verification
   output. Commit the notes to `docs/runbooks/db-restore-drill-<date>.md`.
5. Destroy the fork.

## Invariants in CI

`npm run test:db` applies the checked-in migration SQL to an in-memory
Postgres (pglite) and asserts:
- every money column is `bigint` minor units,
- `postJournal` rejects unbalanced postings before any write,
- `findUnbalancedJournals` (Σ postings = 0 per journal/currency) is empty,
- webhook `(provider, event_id)` uniqueness rejects replays at the schema level.
