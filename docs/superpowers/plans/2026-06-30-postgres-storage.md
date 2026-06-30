# Postgres-Backed Storage (Phase 1: Local) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Win Journal entries in PostgreSQL (so the app can later run on Vercel) while keeping `data/entries.json` as a human-readable backup mirror.

**Architecture:** A new `storage.js` exposes a `createStore()` factory backed by `pg`. PostgreSQL is the single source of truth for reads and writes; `data/entries.json` is a one-way, write-only mirror updated after each change, skipped when the filesystem is read-only (Vercel). The entry object is stored verbatim in a `JSONB` column so all downstream logic (`filterEntries`, scoring, summaries, exports) is unchanged. Existing entries are auto-migrated from `data/entries.json` on first boot.

**Tech Stack:** Node.js (built-in `http`), `pg` (node-postgres), Node's built-in test runner (`node --test` + `node:assert`).

## Global Constraints

- Single new runtime dependency: `pg`. No test-framework dependency — use `node --test` / `node:assert`.
- PostgreSQL is the source of truth. `data/entries.json` is a one-way mirror, written only when `process.env.VERCEL` is unset.
- Entry objects are stored verbatim in a `JSONB` `data` column; downstream code keeps receiving arrays of entry objects.
- DB config comes from discrete env vars: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME` (default `postgres`), `DATABASE_USER` (default `postgres`), `DATABASE_PASSWORD`, `DATABASE_SSL` (default false), optional `DATABASE_CA_CERT`.
- SSL, when enabled, **verifies the server certificate** — never `rejectUnauthorized: false`. `ssl: true` for managed providers; `{ ca }` when `DATABASE_CA_CERT` is set.
- `.env` comments stay on their own lines (the minimal reader does not strip inline `#` comments).
- Tests require a running local Postgres reachable via the `.env` `DATABASE_*` values (so `DATABASE_PASSWORD` must be set before running tests). Tests use a separate table (`entries_test`) and disabled mirror, and drop the table on teardown, so real data is never touched.

---

### Task 1: Add `pg`, extract `env.js`, add test script, verify DB connectivity

**Files:**
- Modify: `package.json`
- Create: `env.js`
- Modify: `server.js:19-41` (replace inline `loadDotEnv` with a `require`)

**Interfaces:**
- Produces: `env.js` exporting `loadDotEnv(root)` — reads `<root>/.env` into `process.env` without overriding already-set vars.

- [ ] **Step 1: Install the `pg` dependency**

Run:
```bash
npm install pg
```
Expected: `package.json` gains a `dependencies` block with `pg`, and `node_modules/` + `package-lock.json` are created.

- [ ] **Step 2: Add a `test` script to `package.json`**

Edit `package.json` so `scripts` reads:
```json
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  },
```

- [ ] **Step 3: Create `env.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');

// Minimal .env loader (zero-dependency). Reads KEY=VALUE lines from <root>/.env
// into process.env without overriding variables already set in the environment.
// NOTE: inline "# ..." comments are NOT stripped (a value may legally contain #),
// so .env comments must live on their own lines.
function loadDotEnv(root = process.cwd()) {
  try {
    const envPath = path.join(root, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (!m) continue; // skips blanks and # comment lines
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (err) {
    console.error('Failed to read .env:', err.message);
  }
}

module.exports = { loadDotEnv };
```

- [ ] **Step 4: Wire `env.js` into `server.js`**

In the require block near the top of `server.js` (after `const { URL } = require('url');`), add:
```js
const { loadDotEnv } = require('./env');
```

Then replace this block (currently `server.js:19-41`):
```js
const ROOT = __dirname;

// Minimal .env loader (zero-dependency). Reads KEY=VALUE lines from .env into
// process.env without overriding variables already set in the environment.
function loadDotEnv() {
  try {
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (!m) continue; // skips blanks and # comments
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (err) {
    console.error('Failed to read .env:', err.message);
  }
}
loadDotEnv();
```
with:
```js
const ROOT = __dirname;
loadDotEnv(ROOT);
```

- [ ] **Step 5: Verify DB connectivity**

Run:
```bash
node -e "require('./env').loadDotEnv(process.cwd()); const {Pool}=require('pg'); const p=new Pool({host:process.env.DATABASE_HOST||'localhost',port:+process.env.DATABASE_PORT||5432,database:process.env.DATABASE_NAME||'postgres',user:process.env.DATABASE_USER||'postgres',password:process.env.DATABASE_PASSWORD||''}); p.query('SELECT 1 AS ok').then(r=>{console.log('DB OK',r.rows[0]);return p.end();}).catch(e=>{console.error('DB FAIL:',e.message);process.exit(1);});"
```
Expected: `DB OK { ok: 1 }`.

If it prints `DB FAIL: password authentication failed` (or similar), the user must set `DATABASE_PASSWORD` (and confirm `DATABASE_USER`/`DATABASE_NAME`) in `.env`, then re-run. Do not proceed until this prints `DB OK`.

- [ ] **Step 6: Verify the app still starts (env refactor didn't break it)**

Run:
```bash
node -e "require('./env').loadDotEnv(process.cwd()); console.log('PORT=', process.env.PORT||'(default 4321)'); console.log('DB host=', process.env.DATABASE_HOST);"
```
Expected: prints the port line and `DB host= localhost`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json env.js server.js
git commit -m "Add pg dependency, extract env loader, verify DB connectivity"
```

---

### Task 2: `storage.js` — `createStore`, schema `init`, and reads

**Files:**
- Create: `storage.js`
- Test: `test/storage.test.js`

**Interfaces:**
- Consumes: `pg.Pool`; `env.js` `loadDotEnv` (in tests).
- Produces: `createStore(options)` returning `{ init, getEntries, getEntry, close, pool }`, and `poolConfigFromEnv()`.
  - `options`: `{ root?, dataDir?, entriesFile?, tableName='entries', mirror=!process.env.VERCEL, pool? }`.
  - `init(): Promise<void>` — creates the table + index if missing.
  - `getEntries(): Promise<object[]>` — all entry objects, newest `date` first.
  - `getEntry(id): Promise<object|null>`.
  - `close(): Promise<void>` — `pool.end()`.

- [ ] **Step 1: Write the failing tests**

Create `test/storage.test.js`:
```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { loadDotEnv } = require('../env');

loadDotEnv(path.join(__dirname, '..'));

const { createStore } = require('../storage');

const TABLE = 'entries_test';

async function freshStore(opts = {}) {
  const store = createStore({ tableName: TABLE, mirror: false, ...opts });
  await store.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await store.init();
  return store;
}

async function teardown(store) {
  await store.pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  await store.close();
}

test('init creates the table; getEntries returns []', async () => {
  const store = await freshStore();
  try {
    assert.deepStrictEqual(await store.getEntries(), []);
  } finally {
    await teardown(store);
  }
});

test('init is idempotent', async () => {
  const store = await freshStore();
  try {
    await store.init();
    assert.deepStrictEqual(await store.getEntries(), []);
  } finally {
    await teardown(store);
  }
});

test('getEntry returns null when missing', async () => {
  const store = await freshStore();
  try {
    assert.strictEqual(await store.getEntry('nope'), null);
  } finally {
    await teardown(store);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm test
```
Expected: FAIL — `Cannot find module '../storage'`.

- [ ] **Step 3: Create `storage.js` (factory + init + reads)**

```js
'use strict';

/*
 * Storage layer for Win Journal.
 *
 * PostgreSQL is the source of truth for entries (works locally and on Vercel).
 * data/entries.json is a one-way, write-only backup mirror, refreshed after
 * every change ONLY when the filesystem is writable (skipped on Vercel via
 * $VERCEL). createStore(options) returns an isolated store so tests can target
 * a separate table / temp data dir without touching real data.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function sslConfig() {
  if (String(process.env.DATABASE_SSL).toLowerCase() !== 'true') return false;
  const caPath = process.env.DATABASE_CA_CERT;
  // ssl:true verifies against Node's default CAs; {ca} verifies against a custom
  // CA. We never disable verification (no rejectUnauthorized:false).
  return caPath ? { ca: fs.readFileSync(caPath, 'utf8') } : true;
}

function poolConfigFromEnv() {
  return {
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT) || 5432,
    database: process.env.DATABASE_NAME || 'postgres',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: sslConfig(),
  };
}

function createStore(options = {}) {
  const root = options.root || __dirname;
  const dataDir = options.dataDir || path.join(root, 'data');
  const entriesFile = options.entriesFile || path.join(dataDir, 'entries.json');
  const table = options.tableName || 'entries';
  const mirrorEnabled = options.mirror !== undefined ? options.mirror : !process.env.VERCEL;
  const pool = options.pool || new Pool(poolConfigFromEnv());

  // The table name is a SQL identifier (cannot be a bound parameter). It comes
  // from config/env, never user input, but we still hard-validate it.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }

  function dateOf(entry) {
    return String(entry.date || '').slice(0, 10);
  }

  async function init() {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${table} (
         id   TEXT PRIMARY KEY,
         date TEXT NOT NULL,
         data JSONB NOT NULL
       )`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${table}_date_idx ON ${table} (date DESC)`
    );
  }

  async function getEntries() {
    const { rows } = await pool.query(`SELECT data FROM ${table} ORDER BY date DESC`);
    return rows.map((r) => r.data);
  }

  async function getEntry(id) {
    const { rows } = await pool.query(`SELECT data FROM ${table} WHERE id = $1`, [id]);
    return rows.length ? rows[0].data : null;
  }

  async function close() {
    await pool.end();
  }

  return { init, getEntries, getEntry, close, pool, dateOf };
}

module.exports = { createStore, poolConfigFromEnv };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm test
```
Expected: PASS — 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add storage.js test/storage.test.js
git commit -m "Add storage.js with schema init and read methods"
```

---

### Task 3: `storage.js` — writes (`addEntry`/`updateEntry`/`deleteEntry`) + disk mirror

**Files:**
- Modify: `storage.js`
- Test: `test/storage.test.js`

**Interfaces:**
- Produces (added to the store object): `addEntry(entry)`, `updateEntry(id, entry)`, `deleteEntry(id)`, plus internal `insertRow(entry)` and `mirrorToDisk()`.
  - `addEntry(entry): Promise<entry>` — INSERT (id, date, JSONB data), then mirror.
  - `updateEntry(id, entry): Promise<entry>` — UPDATE date + data by id, then mirror.
  - `deleteEntry(id): Promise<void>` — DELETE by id, then mirror.
  - `mirrorToDisk(): Promise<void>` — dump all entries to `entriesFile` (atomic temp+rename) when `mirrorEnabled`; warns (never throws) on failure.

- [ ] **Step 1: Write the failing tests**

Append to `test/storage.test.js`:
```js
test('addEntry then getEntry round-trips the full object', async () => {
  const store = await freshStore();
  try {
    const entry = {
      id: 'abc123', date: '2026-06-30', title: 'Shipped X', body: 'Did a thing',
      impact: 4, tags: ['work'], attachments: [],
    };
    await store.addEntry(entry);
    assert.deepStrictEqual(await store.getEntry('abc123'), entry);
    assert.strictEqual((await store.getEntries()).length, 1);
  } finally {
    await teardown(store);
  }
});

test('updateEntry changes stored data; deleteEntry removes it', async () => {
  const store = await freshStore();
  try {
    const entry = { id: 'upd1', date: '2026-06-01', title: 'Old', impact: 3 };
    await store.addEntry(entry);
    const updated = { ...entry, title: 'New', impact: 5, date: '2026-06-02' };
    await store.updateEntry('upd1', updated);
    assert.deepStrictEqual(await store.getEntry('upd1'), updated);
    await store.deleteEntry('upd1');
    assert.strictEqual(await store.getEntry('upd1'), null);
  } finally {
    await teardown(store);
  }
});

test('mirror writes entries.json when enabled', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wj-mirror-'));
  const entriesFile = path.join(tmp, 'entries.json');
  const store = await freshStore({ mirror: true, dataDir: tmp, entriesFile });
  try {
    await store.addEntry({ id: 'm1', date: '2026-06-30', title: 'Mirror me' });
    const onDisk = JSON.parse(fs.readFileSync(entriesFile, 'utf8'));
    assert.strictEqual(onDisk.length, 1);
    assert.strictEqual(onDisk[0].id, 'm1');
  } finally {
    await teardown(store);
  }
});

test('mirror does not write when disabled', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wj-nomirror-'));
  const entriesFile = path.join(tmp, 'entries.json');
  const store = await freshStore({ mirror: false, dataDir: tmp, entriesFile });
  try {
    await store.addEntry({ id: 'n1', date: '2026-06-30', title: 'No mirror' });
    assert.strictEqual(fs.existsSync(entriesFile), false);
  } finally {
    await teardown(store);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
npm test
```
Expected: FAIL — `store.addEntry is not a function`.

- [ ] **Step 3: Implement writes + mirror in `storage.js`**

In `storage.js`, inside `createStore`, add these functions after `getEntry` (before `close`):
```js
  async function insertRow(entry) {
    await pool.query(
      `INSERT INTO ${table} (id, date, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [entry.id, dateOf(entry), JSON.stringify(entry)]
    );
  }

  async function addEntry(entry) {
    await insertRow(entry);
    await mirrorToDisk();
    return entry;
  }

  async function updateEntry(id, entry) {
    await pool.query(
      `UPDATE ${table} SET date = $2, data = $3 WHERE id = $1`,
      [id, dateOf(entry), JSON.stringify(entry)]
    );
    await mirrorToDisk();
    return entry;
  }

  async function deleteEntry(id) {
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    await mirrorToDisk();
  }

  async function mirrorToDisk() {
    if (!mirrorEnabled) return;
    try {
      const entries = await getEntries();
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = entriesFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
      fs.renameSync(tmp, entriesFile);
    } catch (err) {
      console.warn('Could not mirror entries to disk:', err.message);
    }
  }
```

Then update the returned object to expose the new write methods:
```js
  return {
    init, getEntries, getEntry, addEntry, updateEntry, deleteEntry, close,
    pool, dateOf,
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm test
```
Expected: PASS — all tests (now 7) pass.

- [ ] **Step 5: Commit**

```bash
git add storage.js test/storage.test.js
git commit -m "Add entry writes and disk mirror to storage.js"
```

---

### Task 4: `storage.js` — one-time migration (seed from `entries.json`)

**Files:**
- Modify: `storage.js` (extend `init`, add `seedFromDisk`)
- Test: `test/storage.test.js`

**Interfaces:**
- Produces: `init()` now seeds from `entriesFile` when the table is empty. Internal `seedFromDisk()` reads the JSON file and inserts each entry via `insertRow` (no mirror during seed).

- [ ] **Step 1: Write the failing test**

Append to `test/storage.test.js`:
```js
test('init seeds from entries.json when table is empty, idempotently', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wj-seed-'));
  const entriesFile = path.join(tmp, 'entries.json');
  fs.writeFileSync(entriesFile, JSON.stringify([
    { id: 'seed1', date: '2026-01-01', title: 'First' },
    { id: 'seed2', date: '2026-02-01', title: 'Second' },
  ]));
  // freshStore drops the table then inits -> should seed 2 rows.
  const store = await freshStore({ mirror: false, dataDir: tmp, entriesFile });
  try {
    assert.strictEqual((await store.getEntries()).length, 2);
    await store.init(); // table not empty -> must NOT double-seed
    assert.strictEqual((await store.getEntries()).length, 2);
  } finally {
    await teardown(store);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npm test
```
Expected: FAIL — `getEntries().length` is `0`, expected `2` (seeding not implemented yet).

- [ ] **Step 3: Implement seeding in `storage.js`**

Replace the existing `init` function body with:
```js
  async function init() {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${table} (
         id   TEXT PRIMARY KEY,
         date TEXT NOT NULL,
         data JSONB NOT NULL
       )`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS ${table}_date_idx ON ${table} (date DESC)`
    );
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    if (rows[0].n === 0) await seedFromDisk();
  }

  async function seedFromDisk() {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(entriesFile, 'utf8'));
    } catch (err) {
      return; // no readable file -> nothing to seed
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    for (const entry of parsed) {
      if (entry && entry.id) await insertRow(entry);
    }
    console.log(`Seeded ${parsed.length} entries from ${entriesFile} into "${table}".`);
  }
```
(`seedFromDisk` uses `insertRow` from Task 3 and does not mirror, so seeding never rewrites the source file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
npm test
```
Expected: PASS — all tests (now 8) pass.

- [ ] **Step 5: Commit**

```bash
git add storage.js test/storage.test.js
git commit -m "Auto-migrate existing entries.json into Postgres on first boot"
```

---

### Task 5: Wire the store into `server.js` and verify end to end

**Files:**
- Modify: `server.js` (requires, store init, all read/write call sites, startup, attachments dir guard)

**Interfaces:**
- Consumes: `createStore` from `storage.js` (Task 2-4).

- [ ] **Step 1: Import the store and instantiate it**

In the require block of `server.js`, add (next to the `./env` require):
```js
const { createStore } = require('./storage');
```

After the constants block (after `const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');`), add:
```js
const store = createStore();
```

- [ ] **Step 2: Remove the filesystem storage helpers**

Delete this block (currently `server.js:59-81` — the `ensureStorage`, `readEntries`, and `writeEntries` functions):
```js
function ensureStorage() {
  fs.mkdirSync(ATTACH_DIR, { recursive: true });
  if (!fs.existsSync(ENTRIES_FILE)) {
    fs.writeFileSync(ENTRIES_FILE, '[]', 'utf8');
  }
}

function readEntries() {
  try {
    const raw = fs.readFileSync(ENTRIES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to read entries.json:', err.message);
    return [];
  }
}

function writeEntries(entries) {
  const tmp = ENTRIES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(tmp, ENTRIES_FILE);
}
```
Replace it with a guarded attachments-dir helper:
```js
// Attachments still live on disk (Phase 1). Guard mkdir so a read-only
// filesystem (e.g. Vercel) never crashes startup.
function ensureAttachmentsDir() {
  if (process.env.VERCEL) return;
  try {
    fs.mkdirSync(ATTACH_DIR, { recursive: true });
  } catch (err) {
    console.warn('Could not create attachments dir:', err.message);
  }
}
```

- [ ] **Step 3: Update the GET `/api/entries` handler**

Replace (in the `/api/entries` GET branch):
```js
      const list = filterEntries(readEntries(), {
```
with:
```js
      const list = filterEntries(await store.getEntries(), {
```

- [ ] **Step 4: Update the POST `/api/entries` handler**

In the `/api/entries` POST branch, remove the line:
```js
      const entries = readEntries();
```
Then replace:
```js
      entries.push(entry);
      writeEntries(entries);
      sendJSON(res, 201, entry);
```
with:
```js
      await store.addEntry(entry);
      sendJSON(res, 201, entry);
```

- [ ] **Step 5: Update the PUT handler**

Replace this block (the start of the `entryMatch && req.method === 'PUT'` branch):
```js
      const id = entryMatch[1];
      const body = await readJSONBody(req);
      const entries = readEntries();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) { sendJSON(res, 404, { error: 'Not found' }); return; }
      const existing = entries[idx];
```
with:
```js
      const id = entryMatch[1];
      const body = await readJSONBody(req);
      const existing = await store.getEntry(id);
      if (!existing) { sendJSON(res, 404, { error: 'Not found' }); return; }
```

Then replace the assignment + write at the end of the PUT branch:
```js
      entries[idx] = {
        ...existing,
        date: (body.date || existing.date).slice(0, 10),
        title: (body.title != null ? body.title : existing.title).trim(),
        body: entryBody,
        mode,
        sections,
        tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : existing.tags,
        impact: Math.max(1, Math.min(5, Number(body.impact) || existing.impact)),
        attachments: saveAttachments(body.attachments),
        updatedAt: new Date().toISOString(),
      };
      writeEntries(entries);
      sendJSON(res, 200, entries[idx]);
```
with:
```js
      const updated = {
        ...existing,
        date: (body.date || existing.date).slice(0, 10),
        title: (body.title != null ? body.title : existing.title).trim(),
        body: entryBody,
        mode,
        sections,
        tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : existing.tags,
        impact: Math.max(1, Math.min(5, Number(body.impact) || existing.impact)),
        attachments: saveAttachments(body.attachments),
        updatedAt: new Date().toISOString(),
      };
      await store.updateEntry(id, updated);
      sendJSON(res, 200, updated);
```

- [ ] **Step 6: Update the DELETE handler**

Replace the `entryMatch && req.method === 'DELETE'` branch body:
```js
      const id = entryMatch[1];
      const entries = readEntries();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx === -1) { sendJSON(res, 404, { error: 'Not found' }); return; }
      deleteAttachmentFiles(entries[idx].attachments);
      entries.splice(idx, 1);
      writeEntries(entries);
      sendJSON(res, 200, { ok: true });
```
with:
```js
      const id = entryMatch[1];
      const existing = await store.getEntry(id);
      if (!existing) { sendJSON(res, 404, { error: 'Not found' }); return; }
      deleteAttachmentFiles(existing.attachments);
      await store.deleteEntry(id);
      sendJSON(res, 200, { ok: true });
```

- [ ] **Step 7: Update the summary, resume, and export read sites**

In the `/api/summary` POST branch, replace:
```js
      const list = filterEntries(readEntries(), { from: body.from || '', to: body.to || '' });
      const label = periodLabel(body.period, body.from, body.to);
```
with:
```js
      const list = filterEntries(await store.getEntries(), { from: body.from || '', to: body.to || '' });
      const label = periodLabel(body.period, body.from, body.to);
```

In the `/api/resume` POST branch, replace:
```js
      const list = filterEntries(readEntries(), { from: body.from || '', to: body.to || '' });
```
with:
```js
      const list = filterEntries(await store.getEntries(), { from: body.from || '', to: body.to || '' });
```

In the `/api/export` GET branch, replace:
```js
        const entry = readEntries().find((e) => e.id === id);
        if (!entry) { sendJSON(res, 404, { error: 'Not found' }); return; }
        list = [entry];
        baseName = 'win-' + slugify(entry.title || entry.id);
      } else {
        list = filterEntries(readEntries(), {
```
with:
```js
        const entry = await store.getEntry(id);
        if (!entry) { sendJSON(res, 404, { error: 'Not found' }); return; }
        list = [entry];
        baseName = 'win-' + slugify(entry.title || entry.id);
      } else {
        list = filterEntries(await store.getEntries(), {
```

- [ ] **Step 8: Update startup to init the store asynchronously**

Replace the final block (currently `server.js:831-836`):
```js
ensureStorage();
server.listen(PORT, () => {
  console.log(`\n  Win Journal running at  http://localhost:${PORT}`);
  console.log(`  Data stored in          ${DATA_DIR}`);
  console.log(`  AI summaries            ${ANTHROPIC_API_KEY ? 'ON (' + ANTHROPIC_MODEL + ')' : 'OFF (set ANTHROPIC_API_KEY to enable)'}\n`);
});
```
with:
```js
store.init()
  .then(() => {
    ensureAttachmentsDir();
    server.listen(PORT, () => {
      console.log(`\n  Win Journal running at  http://localhost:${PORT}`);
      console.log(`  Entries stored in       PostgreSQL (${process.env.DATABASE_NAME || 'postgres'} @ ${process.env.DATABASE_HOST || 'localhost'})`);
      console.log(`  Local backup mirror     ${process.env.VERCEL ? 'OFF (read-only FS)' : ENTRIES_FILE}`);
      console.log(`  AI summaries            ${ANTHROPIC_API_KEY ? 'ON (' + ANTHROPIC_MODEL + ')' : 'OFF (set ANTHROPIC_API_KEY to enable)'}\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize storage:', err.message);
    process.exit(1);
  });
```

- [ ] **Step 9: Confirm the storage helpers are fully removed**

Run:
```bash
grep -nE "readEntries|writeEntries|ensureStorage\(" server.js || echo "clean: no stale storage-helper references"
```
Expected: `clean: no stale storage-helper references`.

- [ ] **Step 10: Verify the full test suite still passes**

Run:
```bash
npm test
```
Expected: PASS — all 8 storage tests pass.

- [ ] **Step 11: End-to-end smoke test against the running app**

Start the server in the background:
```bash
node server.js &
```
Expected startup log includes `Entries stored in PostgreSQL` and `Win Journal running at http://localhost:4321`.

Then exercise the API:
```bash
curl -s http://localhost:4321/api/entries | head -c 400; echo
curl -s -X POST http://localhost:4321/api/entries -H "Content-Type: application/json" -d "{\"title\":\"E2E smoke\",\"body\":\"created via curl\",\"impact\":5,\"tags\":[\"test\"]}"; echo
curl -s http://localhost:4321/api/entries | grep -c "E2E smoke"
```
Expected: the GET returns a JSON array (your migrated entries), the POST returns the created entry with an `id`, and the final command prints `1`.

- [ ] **Step 12: Verify persistence across restart and the disk mirror**

Stop the server (`kill %1` or Ctrl-C in that shell), restart it (`node server.js &`), then:
```bash
curl -s http://localhost:4321/api/entries | grep -c "E2E smoke"
grep -c "E2E smoke" data/entries.json
```
Expected: both print `1` — the entry persisted in Postgres (survives restart) and the `data/entries.json` mirror was updated. Stop the server when done.

- [ ] **Step 13: Commit**

```bash
git add server.js
git commit -m "Store entries in Postgres via storage.js; keep data/entries.json mirror"
```

---

## Self-Review

**Spec coverage:**
- Postgres source of truth + `pg` driver → Tasks 2-3. ✓
- Discrete `DATABASE_*` config + default `postgres` DB → Task 2 (`poolConfigFromEnv`). ✓
- SSL verifies certs, optional `DATABASE_CA_CERT` → Task 2 (`sslConfig`). ✓
- One-way `data/entries.json` mirror, skipped on Vercel → Task 3 (`mirrorToDisk`), Task 5 startup log. ✓
- Schema (hybrid JSONB) → Task 2/4. ✓
- `storage.js` module extraction → Tasks 2-4; `env.js` extraction → Task 1. ✓
- Auto-migration of existing entries → Task 4. ✓
- Attachments unchanged + guarded mkdir → Task 5 Step 2/8. ✓
- Error handling (init failure exits; mirror warns; router try/catch unchanged) → Task 3, Task 5 Step 8. ✓
- Testing (round-trip, migration idempotency, manual E2E) → Tasks 2-5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `createStore` returns `{ init, getEntries, getEntry, addEntry, updateEntry, deleteEntry, close, pool, dateOf }` consistently across Tasks 2-5; `getEntry` returns object-or-null and every caller checks falsy; `getEntries` returns an array used by `filterEntries` exactly as the old `readEntries` was. ✓

## Notes / Risks

- Tests and the E2E steps require local Postgres reachable via `.env` with `DATABASE_PASSWORD` set (Task 1 Step 5 gates this).
- `npm install pg` makes the app no longer zero-dependency — expected and accepted per the spec.
- Phase 2 (serverless function conversion, online DB, Vercel env, attachment blob storage) is intentionally out of scope.
