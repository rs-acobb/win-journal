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
