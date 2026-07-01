# Win Journal — Postgres-backed storage with local mirror

**Date:** 2026-06-30
**Status:** Approved (design); implementation pending
**Goal:** Store entries in PostgreSQL (so the app can run on Vercel) while keeping a
human-readable copy in the `data/` folder, in two phases: local first, then site.

## Problem

The app is a long-running, zero-dependency Node HTTP server that uses the local
filesystem as its database (`data/entries.json`, `data/attachments/`). This is
fundamentally incompatible with Vercel's serverless model:

1. It writes to disk at startup (`ensureStorage()` → `fs.mkdirSync`/`writeFileSync`),
   but Vercel function filesystems are read-only except `/tmp` → `EROFS` crash →
   `500 FUNCTION_INVOCATION_FAILED`.
2. It calls `server.listen()` (a persistent server) instead of exporting a handler.
3. `/tmp` is ephemeral and per-instance, so there is no durable storage.

## Decision

Move entry persistence to PostgreSQL via the `pg` driver. Postgres becomes the
single source of truth (reads and writes). The `data/entries.json` file becomes a
one-way, write-only backup mirror, written only when the filesystem is writable.

### Phasing

- **Phase 1 (local, this spec):** app stores entries in the user's local Postgres,
  still mirrors to `data/entries.json`, runs with `node server.js`.
- **Phase 2 (site, later):** create an online DB (Neon / Vercel Postgres), set env
  vars in Vercel, convert the server to a serverless function, move attachments to
  Vercel Blob. Out of scope here, but the storage design below is compatible with it.

## Configuration (env)

Discrete `DATABASE_*` variables (not a single `DATABASE_URL`), matching the user's
preferred style. Defaults point at the always-present `postgres` database so no DB
needs to be created first; the app auto-creates its `entries` table there on boot.

```
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=postgres        # switch to win_journal after `createdb win_journal`
DATABASE_USER=postgres
DATABASE_PASSWORD=            # user fills in their local Postgres password
DATABASE_SSL=false           # true for hosted DBs (Neon, Vercel, etc.)
# DATABASE_CA_CERT=          # optional: path to a CA PEM for providers needing one
```

`pg.Pool` config is derived from these. SSL, when enabled, **verifies the server
certificate** — we do NOT disable verification (no `rejectUnauthorized: false`), since
that would allow MITM. Managed providers (Neon, Vercel Postgres) present publicly
trusted certs, so `ssl: true` (Node verifies against its default CA bundle) works.
Providers that require a custom CA can set `DATABASE_CA_CERT`.

```js
function sslConfig() {
  if (String(process.env.DATABASE_SSL).toLowerCase() !== 'true') return false;
  const caPath = process.env.DATABASE_CA_CERT;
  // ssl:true verifies against Node's default CAs; {ca} verifies against a custom CA.
  return caPath ? { ca: fs.readFileSync(caPath, 'utf8') } : true;
}

new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT) || 5432,
  database: process.env.DATABASE_NAME || 'postgres',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || '',
  ssl: sslConfig(),
})
```

**Constraint:** the existing minimal `.env` reader (`server.js:23-40`) does NOT strip
inline `# ...` comments, and `#` is a legal password character. Therefore all `.env`
comments stay on their own lines; values contain only the value. (Already applied to
`.env` and `.env.example`.)

## Schema

Hybrid: scalar `id`/`date` columns for keying/ordering plus the full entry object as
`JSONB`, so downstream logic receives the same entry objects as today.

```sql
CREATE TABLE IF NOT EXISTS entries (
  id   TEXT PRIMARY KEY,   -- entry.id (existing 18-char hex)
  date TEXT NOT NULL,      -- 'YYYY-MM-DD'
  data JSONB NOT NULL      -- the complete entry object, unchanged
);
CREATE INDEX IF NOT EXISTS entries_date_idx ON entries (date DESC);
```

The `data` column stores the whole entry verbatim, so `filterEntries`, `scoreEntry`,
summary/resume/export logic stay unchanged — they still receive arrays of entry
objects. The `data/entries.json` mirror is therefore a trivial dump of all `data`.

## Components

### New: `storage.js`

Extracts persistence out of the 837-line `server.js` into a focused, testable module.

```
init()             -> create table + index if needed; one-time migrate from
                      data/entries.json when the table is empty
getEntries()       -> SELECT data FROM entries ORDER BY date DESC
                      -> returns array of entry objects
addEntry(entry)    -> INSERT one row, then mirrorToDisk()
updateEntry(id, e) -> UPDATE one row, then mirrorToDisk()
deleteEntry(id)    -> DELETE one row, then mirrorToDisk()
close()            -> pool.end() (tests / graceful shutdown)
```

`mirrorToDisk()` writes `data/entries.json` with the full entry array **only when not
running on Vercel** (gated on `process.env.VERCEL`), so the read-only filesystem never
crashes the app. A failed mirror logs a warning; it never throws.

### Changed: `server.js`

- Import `storage`; call `await storage.init()` at startup instead of `ensureStorage()`
  for entries.
- GET handlers: `await storage.getEntries()` in place of `readEntries()`.
- POST/PUT/DELETE handlers: call `addEntry`/`updateEntry`/`deleteEntry` instead of
  read-all + `writeEntries`.
- Guard the attachments `mkdir` so a read-only filesystem does not crash startup
  (attachments remain on disk locally per Phase 1 decision).
- Keep all routing, AI calls, scoring, summaries, exports unchanged.

### Changed: `package.json`

- Add dependency `pg`.
- (Optional) `db:init` script to create a dedicated DB via Node if desired later.

## Migration of existing data

On first run, `init()` creates the table and, if it is empty but `data/entries.json`
contains entries, imports them (idempotent — seeds only when empty). The user's
existing ~8 KB of real entries move into Postgres automatically, with no data loss.

## Attachments (Phase 1)

Unchanged: image/PDF files continue to save to `data/attachments/` on disk and serve
from there. Only the startup `mkdir` is guarded against read-only filesystems. The
cloud attachment story (Vercel Blob or `bytea`) is deferred to Phase 2. No attachments
exist yet, so there is nothing to migrate.

## Error handling

- DB connection/query errors propagate to the existing router try/catch
  (`server.js:825-828`) → `500 { error }`. Startup `init()` failure logs a clear
  message (e.g., bad password / DB unreachable) and exits non-zero locally.
- Mirror write failures log a warning and are non-fatal.
- Environment selection (`VERCEL`) is explicit, not a swallowed exception.

## Testing

- Integration test against local Postgres: round-trip an entry
  (add → getEntries → updateEntry → deleteEntry) and assert shape/values.
- Migration test: empty table + a fixture `entries.json` seeds correctly and is
  idempotent on a second `init()`.
- Manual E2E: `node server.js`, create/edit/delete entries in the browser, confirm
  persistence across a restart and that `data/entries.json` mirrors the DB.

## Out of scope (Phase 2)

Serverless function conversion, online DB provisioning, Vercel env config, attachment
blob storage. Tracked separately when the user is ready to deploy.
