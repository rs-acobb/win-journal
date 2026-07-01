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

  async function getEntries() {
    const { rows } = await pool.query(`SELECT data FROM ${table} ORDER BY date DESC`);
    return rows.map((r) => r.data);
  }

  async function getEntry(id) {
    const { rows } = await pool.query(`SELECT data FROM ${table} WHERE id = $1`, [id]);
    return rows.length ? rows[0].data : null;
  }

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

  async function close() {
    await pool.end();
  }

  return {
    init, getEntries, getEntry, addEntry, updateEntry, deleteEntry, close,
    pool, dateOf,
  };
}

module.exports = { createStore, poolConfigFromEnv };
