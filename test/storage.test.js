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
