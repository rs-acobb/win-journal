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
