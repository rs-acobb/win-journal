'use strict';

/*
 * Win Journal — a zero-dependency local web app for tracking what you learn
 * and accomplish over time. Runs with just `node server.js`.
 *
 * Data is stored as human-readable JSON (data/entries.json) and attachments
 * (images / PDFs) live in data/attachments/. Summaries can be generated
 * offline (deterministic impact scoring) or with Claude when an API key is set.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { loadDotEnv } = require('./env');
const { createStore } = require('./storage');

const ROOT = __dirname;
loadDotEnv(ROOT);

const PORT = process.env.PORT || 4321;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const ATTACH_DIR = path.join(DATA_DIR, 'attachments');
const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');
const store = createStore();

const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

// Accept reasonably large uploads (base64-encoded). ~25 MB of raw body.
const MAX_BODY_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Generic HTTP helpers
// ---------------------------------------------------------------------------

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSONBody(req) {
  const buf = await readBody(req);
  if (buf.length === 0) return {};
  return JSON.parse(buf.toString('utf8'));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
};

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(res, 404, 'Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

function newId() {
  return crypto.randomBytes(9).toString('hex');
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'entry';
}

// Guided-template support. The template mirrors the sectioned format used for
// rich entries; we keep the structured fields AND derive the canonical `body`
// text from them so summaries, scoring, and exports work unchanged.
const TEMPLATE_SECTIONS = [
  { key: 'overview', heading: null },
  { key: 'built', heading: 'WHAT I BUILT / DID' },
  { key: 'metrics', heading: 'METRICS / IMPACT' },
  { key: 'learned', heading: 'WHAT I LEARNED' },
  { key: 'didWell', heading: 'WHAT I DID WELL' },
  { key: 'improve', heading: 'WHAT I COULD IMPROVE' },
  { key: 'bullet', heading: 'RESUME / REVIEW BULLET' },
];

function sanitizeSections(sections) {
  const out = {};
  const src = sections && typeof sections === 'object' ? sections : {};
  for (const { key } of TEMPLATE_SECTIONS) {
    out[key] = typeof src[key] === 'string' ? src[key].trim() : '';
  }
  return out;
}

function assembleTemplateBody(sections) {
  const s = sanitizeSections(sections);
  const parts = [];
  for (const { key, heading } of TEMPLATE_SECTIONS) {
    const val = s[key];
    if (!val) continue;
    parts.push(heading ? `${heading}\n${val}` : val);
  }
  return parts.join('\n\n');
}

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Persist any incoming attachments (base64) to disk; return cleaned metadata.
function saveAttachments(incoming) {
  if (!Array.isArray(incoming)) return [];
  const out = [];
  for (const att of incoming) {
    if (att && att.file && !att.dataBase64) {
      // Already-persisted attachment passed back on edit — keep as-is.
      out.push({ id: att.id, name: att.name, type: att.type, size: att.size, file: att.file });
      continue;
    }
    if (!att || !att.dataBase64) continue;
    const id = newId();
    const safeExt = (path.extname(att.name || '') || '').slice(0, 10).replace(/[^.\w]/g, '');
    const fileName = id + safeExt;
    const buf = Buffer.from(att.dataBase64, 'base64');
    fs.writeFileSync(path.join(ATTACH_DIR, fileName), buf);
    out.push({
      id,
      name: att.name || fileName,
      type: att.type || MIME[safeExt.toLowerCase()] || 'application/octet-stream',
      size: buf.length,
      file: fileName,
    });
  }
  return out;
}

function deleteAttachmentFiles(attachments) {
  if (!Array.isArray(attachments)) return;
  for (const att of attachments) {
    if (att && att.file) {
      const p = path.join(ATTACH_DIR, path.basename(att.file));
      fs.unlink(p, () => {});
    }
  }
}

// Deterministic, offline "impact" score for ranking statements.
function scoreEntry(entry) {
  const impact = Math.max(1, Math.min(5, Number(entry.impact) || 3));
  let score = impact * 20;
  const text = `${entry.title || ''} ${entry.body || ''}`;

  // Quantified results are the strongest signal for raises/promotions.
  const numbers = text.match(/\$[\d,]+|\d+%|\b\d[\d,.]*\b/g) || [];
  score += Math.min(numbers.length, 5) * 6;

  // Strong, outcome-oriented action verbs.
  const verbs = [
    'led', 'built', 'launched', 'delivered', 'shipped', 'designed', 'created',
    'improved', 'increased', 'reduced', 'saved', 'automated', 'migrated',
    'resolved', 'mentored', 'drove', 'owned', 'architected', 'optimized',
    'negotiated', 'closed', 'grew', 'scaled', 'eliminated',
  ];
  const lower = text.toLowerCase();
  let verbHits = 0;
  for (const v of verbs) {
    if (lower.includes(v)) verbHits++;
  }
  score += Math.min(verbHits, 4) * 4;

  // A little credit for substance, capped so length alone can't dominate.
  score += Math.min((entry.body || '').length / 80, 8);

  // Tagged wins are usually deliberate highlights.
  if (Array.isArray(entry.tags) && entry.tags.length) score += 3;

  return Math.round(score);
}

function inRange(entry, from, to) {
  const d = (entry.date || '').slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function filterEntries(entries, { from, to, q }) {
  let list = entries.filter((e) => inRange(e, from, to));
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((e) => {
      const hay = `${e.title || ''} ${e.body || ''} ${(e.tags || []).join(' ')}`.toLowerCase();
      return hay.includes(needle);
    });
  }
  // Newest first.
  list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return list;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

function buildOfflineSummary(list, label) {
  const ranked = [...list].map((e) => ({ entry: e, score: scoreEntry(e) }))
    .sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, 8);
  const tagCounts = {};
  for (const e of list) {
    for (const t of (e.tags || [])) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const avgImpact = list.length
    ? (list.reduce((s, e) => s + (Number(e.impact) || 3), 0) / list.length)
    : 0;

  let md = `# ${label} summary\n\n`;
  md += `**${list.length} entries** · average impact ${avgImpact.toFixed(1)}/5\n\n`;

  md += `## Highest-impact achievements\n\n`;
  if (top.length === 0) {
    md += `_No entries in this period yet._\n\n`;
  } else {
    for (const { entry, score } of top) {
      const date = (entry.date || '').slice(0, 10);
      const snippet = (entry.body || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      md += `- **${entry.title || 'Untitled'}** _(impact ${entry.impact || 3}/5, score ${score}, ${date})_`;
      if (snippet) md += `\n  ${snippet}`;
      md += `\n`;
    }
    md += `\n`;
  }

  if (topTags.length) {
    md += `## Themes\n\n`;
    md += topTags.map(([t, n]) => `\`${t}\` ×${n}`).join(' · ');
    md += `\n`;
  }
  return md;
}

// Normalize text so it survives ATS (Applicant Tracking System) parsers:
// plain ASCII only — no smart quotes, em/en dashes, ellipses, or stray glyphs.
function atsClean(s) {
  return String(s || '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/…/g, '...')
    .replace(/[   ]/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '') // drop remaining non-ASCII
    .replace(/\s+/g, ' ')
    .trim();
}

// Past-tense action verbs ATS and recruiters expect resume bullets to lead with.
const ATS_LEAD_VERBS = [
  'led', 'built', 'launched', 'delivered', 'shipped', 'designed', 'created',
  'developed', 'implemented', 'engineered', 'improved', 'increased', 'reduced',
  'saved', 'automated', 'migrated', 'resolved', 'mentored', 'drove', 'owned',
  'architected', 'optimized', 'negotiated', 'closed', 'grew', 'scaled',
  'eliminated', 'managed', 'spearheaded', 'streamlined', 'achieved',
];

// Trim to a max length without cutting a word in half.
function clampWords(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
}

// Turn an entry into a single ATS-safe bullet that opens with an action verb.
function toAtsBullet(entry) {
  const title = atsClean(entry.title);
  const body = atsClean(entry.body);
  // Use only the first sentence of the body so long, multi-section entries
  // don't produce a runaway bullet.
  const firstSentence = body ? (body.match(/^.*?[.!?](?:\s|$)/) || [body])[0].trim() : '';

  let text = title;
  if (firstSentence && firstSentence.toLowerCase() !== title.toLowerCase()) {
    text = title ? `${title}: ${firstSentence}` : firstSentence;
  }
  text = text.replace(/^[\s\-*]+/, '').trim();

  const firstWord = (text.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!ATS_LEAD_VERBS.includes(firstWord)) {
    text = 'Delivered ' + text.charAt(0).toLowerCase() + text.slice(1);
  } else {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  text = clampWords(text, 230).replace(/[,:;\-\s]+$/, '');
  if (!/[.!?]$/.test(text)) text += '.';
  return text;
}

function buildResumeBulletsOffline(list) {
  const ranked = [...list]
    .map((e) => ({ entry: e, score: scoreEntry(e) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  let md = `# Resume bullets (ATS-friendly)\n\n`;
  if (ranked.length === 0) {
    md += `_No entries to draw from yet._\n`;
    return md;
  }
  md += `_Plain text, action-verb-first, no special characters - safe to paste into Workday, Greenhouse, Taleo, iCIMS, and Lever. Tip: paste as plain text and keep one bullet per line._\n\n`;
  for (const { entry } of ranked) {
    md += `- ${toAtsBullet(entry)}\n`;
  }
  return md;
}

// Draft one ATS bullet from a template entry's other sections (offline).
function suggestBulletOffline({ title, sections }) {
  const s = sanitizeSections(sections);
  // Prefer the section most likely to carry quantified impact.
  const source = [s.metrics, s.built, s.overview, s.learned]
    .map((x) => (x || '').trim())
    .find(Boolean) || '';
  if (!title && !source) return '';
  return toAtsBullet({ title: title || '', body: source });
}

// Draft one ATS bullet from a template entry's other sections (Claude).
async function suggestBulletAI({ title, sections }) {
  const s = sanitizeSections(sections);
  const fields = [
    title ? `Title: ${title}` : null,
    s.overview ? `Overview: ${s.overview}` : null,
    s.built ? `What was built/done: ${s.built}` : null,
    s.metrics ? `Metrics/impact: ${s.metrics}` : null,
    s.learned ? `Learned: ${s.learned}` : null,
  ].filter(Boolean).join('\n');
  if (!fields) return '';
  const system =
    'You write a SINGLE resume bullet optimized for Applicant Tracking Systems (ATS). ' +
    'From the provided fields, produce exactly one bullet: start with a strong past-tense ' +
    'action verb; lead with measurable impact, quantifying using ONLY numbers present in ' +
    'the fields (never invent figures); one line, ~12-30 words; plain ASCII with no special ' +
    'characters, emojis, bold, or first-person pronouns; spell out an acronym once with the ' +
    'acronym in parentheses. Output ONLY the bullet text — no leading dash, no quotes, no commentary.';
  const raw = await callClaude(system, fields);
  const firstLine = raw.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
  return atsClean(firstLine.replace(/^[-*•\s]+/, '').replace(/^["']|["']$/g, ''));
}

// Call the Claude Messages API directly (zero-dependency raw HTTPS).
function callClaude(system, userText) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: userText }],
    });

    const reqOptions = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const apiReq = https.request(reqOptions, (apiRes) => {
      const chunks = [];
      apiRes.on('data', (c) => chunks.push(c));
      apiRes.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (apiRes.statusCode < 200 || apiRes.statusCode >= 300) {
          reject(new Error(`Claude API ${apiRes.statusCode}: ${raw.slice(0, 500)}`));
          return;
        }
        try {
          const data = JSON.parse(raw);
          const text = (data.content || [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim();
          resolve(text);
        } catch (err) {
          reject(err);
        }
      });
    });
    apiReq.on('error', reject);
    apiReq.write(payload);
    apiReq.end();
  });
}

function entriesToPromptText(list) {
  return list
    .map((e) => {
      const date = (e.date || '').slice(0, 10);
      const tags = (e.tags || []).join(', ');
      return [
        `Date: ${date}`,
        `Title: ${e.title || ''}`,
        `Self-rated impact: ${e.impact || 3}/5`,
        tags ? `Tags: ${tags}` : null,
        `Details: ${e.body || ''}`,
      ].filter(Boolean).join('\n');
    })
    .join('\n\n---\n\n');
}

async function buildAISummary(list, label) {
  const system =
    'You are a career-advancement assistant. The user keeps a "win journal" of ' +
    'things they accomplished and learned. Write a concise, professional summary ' +
    'they could use to justify a raise or promotion. Use Markdown. Include: a 2-3 ' +
    'sentence executive summary; a "Highest-impact achievements" section ordered by ' +
    'business impact (lead with quantified results — numbers, %, $, time saved); and ' +
    'a short "Skills & themes demonstrated" section. Be specific and grounded only in ' +
    'what the entries say. Do not invent metrics.';
  const user = `Period: ${label}\n\nJournal entries:\n\n${entriesToPromptText(list)}`;
  return callClaude(system, user);
}

async function buildAIResume(list) {
  const system =
    'You are an expert resume writer who optimizes for Applicant Tracking Systems ' +
    '(ATS) such as Workday, Greenhouse, Taleo, iCIMS, and Lever. From the user\'s ' +
    '"win journal" entries, write strong, concise, ATS-parseable resume bullet points.\n\n' +
    'Rules for every bullet:\n' +
    '- Start with a strong past-tense action verb (e.g., Led, Built, Reduced, Automated, Delivered).\n' +
    '- Lead with measurable impact; quantify using ONLY numbers present in the entries (%, $, time, counts). Never invent figures.\n' +
    '- Keep to a single line, roughly 12-30 words.\n' +
    '- Write in plain text/ASCII only: no tables, columns, graphics, emojis, or special bullet glyphs; use a simple hyphen for each bullet. No bold or italics inside bullets.\n' +
    '- Do not use first-person pronouns (no "I", "my").\n' +
    '- Weave in relevant hard-skill and tool keywords using standard industry terminology so keyword-matching ATS can find them. Spell out an acronym once with the acronym in parentheses, e.g., "Application Programming Interface (API)".\n' +
    '- Group related accomplishments and merge duplicates; order strongest first.\n\n' +
    'Output ONLY a flat hyphen-bulleted list. No headings, no preamble, no closing commentary.';
  const user = `Journal entries:\n\n${entriesToPromptText(list)}`;
  const raw = await callClaude(system, user);
  // Belt-and-suspenders: strip any non-ASCII the model may have slipped in,
  // per line, so the bullets paste cleanly into ATS forms.
  return raw.split('\n').map((line) => atsClean(line) || '').join('\n');
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function exportMarkdown(list) {
  let md = `# Win Journal export\n\n_${list.length} ${list.length === 1 ? 'entry' : 'entries'}_\n\n`;
  for (const e of list) {
    const date = (e.date || '').slice(0, 10);
    md += `## ${e.title || 'Untitled'}\n\n`;
    md += `_${date} · impact ${e.impact || 3}/5_`;
    if ((e.tags || []).length) md += ` · ${e.tags.map((t) => `\`${t}\``).join(' ')}`;
    md += `\n\n`;
    if (e.body) md += `${e.body}\n\n`;
    if ((e.attachments || []).length) {
      md += `Attachments: ${e.attachments.map((a) => a.name).join(', ')}\n\n`;
    }
  }
  return md;
}

function exportHTML(list) {
  const rows = list.map((e) => {
    const date = escapeHTML((e.date || '').slice(0, 10));
    const tags = (e.tags || []).map((t) => `<span class="tag">${escapeHTML(t)}</span>`).join(' ');
    const atts = (e.attachments || []).map((a) => escapeHTML(a.name)).join(', ');
    return `<article>
      <h2>${escapeHTML(e.title || 'Untitled')}</h2>
      <p class="meta">${date} · impact ${escapeHTML(e.impact || 3)}/5 ${tags}</p>
      <p>${escapeHTML(e.body || '').replace(/\n/g, '<br>')}</p>
      ${atts ? `<p class="att">Attachments: ${atts}</p>` : ''}
    </article>`;
  }).join('\n');

  return `<!doctype html><html><head><meta charset="utf-8">
<title>Win Journal export</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 820px; margin: 40px auto; color: #1f2330; padding: 0 20px; }
  h1 { border-bottom: 2px solid #4f46e5; padding-bottom: 8px; }
  article { border-bottom: 1px solid #e5e7eb; padding: 16px 0; }
  .meta { color: #6b7280; font-size: 14px; }
  .tag { background: #eef2ff; color: #4f46e5; border-radius: 4px; padding: 1px 6px; font-size: 12px; }
  .att { color: #6b7280; font-size: 13px; }
  @media print { body { margin: 0; } }
</style></head>
<body>
<h1>Win Journal</h1>
<p>${list.length} ${list.length === 1 ? 'entry' : 'entries'}. Use your browser's Print → Save as PDF to export.</p>
${rows}
</body></html>`;
}

// ---------------------------------------------------------------------------
// Period labels
// ---------------------------------------------------------------------------

function periodLabel(period, from, to) {
  if (from && to) return `${from} to ${to}`;
  return period || 'All time';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = u.pathname;

  try {
    // --- API ---
    if (pathname === '/api/config' && req.method === 'GET') {
      sendJSON(res, 200, { aiAvailable: Boolean(ANTHROPIC_API_KEY), model: ANTHROPIC_MODEL });
      return;
    }

    if (pathname === '/api/entries' && req.method === 'GET') {
      const list = filterEntries(await store.getEntries(), {
        from: u.searchParams.get('from') || '',
        to: u.searchParams.get('to') || '',
        q: u.searchParams.get('q') || '',
      });
      sendJSON(res, 200, list);
      return;
    }

    if (pathname === '/api/entries' && req.method === 'POST') {
      const body = await readJSONBody(req);
      const mode = body.mode === 'template' ? 'template' : 'text';
      const sections = mode === 'template' ? sanitizeSections(body.sections) : null;
      const entryBody = mode === 'template'
        ? assembleTemplateBody(sections)
        : (body.body || '').trim();
      const entry = {
        id: newId(),
        date: (body.date || new Date().toISOString().slice(0, 10)).slice(0, 10),
        title: (body.title || '').trim(),
        body: entryBody,
        mode,
        sections,
        tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [],
        impact: Math.max(1, Math.min(5, Number(body.impact) || 3)),
        attachments: saveAttachments(body.attachments),
        createdAt: new Date().toISOString(),
      };
      await store.addEntry(entry);
      sendJSON(res, 201, entry);
      return;
    }

    const entryMatch = pathname.match(/^\/api\/entries\/([a-z0-9]+)$/i);
    if (entryMatch && req.method === 'PUT') {
      const id = entryMatch[1];
      const body = await readJSONBody(req);
      const existing = await store.getEntry(id);
      if (!existing) { sendJSON(res, 404, { error: 'Not found' }); return; }

      // Figure out which previously-saved attachments were removed, delete their files.
      const keptFiles = new Set((body.attachments || []).filter((a) => a.file).map((a) => a.file));
      const removed = (existing.attachments || []).filter((a) => !keptFiles.has(a.file));
      deleteAttachmentFiles(removed);

      const mode = body.mode === 'template' ? 'template'
        : body.mode === 'text' ? 'text'
        : (existing.mode || 'text');
      let entryBody;
      let sections;
      if (mode === 'template') {
        sections = sanitizeSections(body.sections != null ? body.sections : existing.sections);
        entryBody = assembleTemplateBody(sections);
      } else {
        sections = null;
        entryBody = (body.body != null ? body.body : existing.body).trim();
      }
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
      return;
    }

    if (entryMatch && req.method === 'DELETE') {
      const id = entryMatch[1];
      const existing = await store.getEntry(id);
      if (!existing) { sendJSON(res, 404, { error: 'Not found' }); return; }
      deleteAttachmentFiles(existing.attachments);
      await store.deleteEntry(id);
      sendJSON(res, 200, { ok: true });
      return;
    }

    // Serve an attachment file.
    const attMatch = pathname.match(/^\/api\/attachments\/([\w.\-]+)$/);
    if (attMatch && req.method === 'GET') {
      const fileName = path.basename(attMatch[1]);
      const filePath = path.join(ATTACH_DIR, fileName);
      if (!filePath.startsWith(ATTACH_DIR)) { sendText(res, 400, 'Bad request'); return; }
      // Find the original name for a friendlier download.
      serveStatic(res, filePath);
      return;
    }

    if (pathname === '/api/summary' && req.method === 'POST') {
      const body = await readJSONBody(req);
      const list = filterEntries(await store.getEntries(), { from: body.from || '', to: body.to || '' });
      const label = periodLabel(body.period, body.from, body.to);
      if (body.mode === 'ai') {
        if (!ANTHROPIC_API_KEY) { sendJSON(res, 400, { error: 'No ANTHROPIC_API_KEY set on the server.' }); return; }
        if (list.length === 0) { sendJSON(res, 200, { markdown: `_No entries in ${label}._`, mode: 'ai' }); return; }
        const markdown = await buildAISummary(list, label);
        sendJSON(res, 200, { markdown, mode: 'ai' });
        return;
      }
      sendJSON(res, 200, { markdown: buildOfflineSummary(list, label), mode: 'offline' });
      return;
    }

    if (pathname === '/api/resume' && req.method === 'POST') {
      const body = await readJSONBody(req);
      const list = filterEntries(await store.getEntries(), { from: body.from || '', to: body.to || '' });
      if (body.mode === 'ai') {
        if (!ANTHROPIC_API_KEY) { sendJSON(res, 400, { error: 'No ANTHROPIC_API_KEY set on the server.' }); return; }
        if (list.length === 0) { sendJSON(res, 200, { markdown: '_No entries to draw from yet._', mode: 'ai' }); return; }
        const markdown = await buildAIResume(list);
        sendJSON(res, 200, { markdown, mode: 'ai' });
        return;
      }
      sendJSON(res, 200, { markdown: buildResumeBulletsOffline(list), mode: 'offline' });
      return;
    }

    if (pathname === '/api/suggest-bullet' && req.method === 'POST') {
      const body = await readJSONBody(req);
      const useAI = body.mode === 'ai' || (body.mode !== 'offline' && ANTHROPIC_API_KEY);
      if (body.mode === 'ai' && !ANTHROPIC_API_KEY) {
        sendJSON(res, 400, { error: 'No ANTHROPIC_API_KEY set on the server.' });
        return;
      }
      if (useAI) {
        const bullet = await suggestBulletAI(body);
        sendJSON(res, 200, { bullet, mode: 'ai' });
        return;
      }
      sendJSON(res, 200, { bullet: suggestBulletOffline(body), mode: 'offline' });
      return;
    }

    if (pathname === '/api/export' && req.method === 'GET') {
      const type = u.searchParams.get('type') || 'json';
      const id = u.searchParams.get('id') || '';
      let list;
      let baseName = 'win-journal';
      if (id) {
        // Single-entry export.
        const entry = await store.getEntry(id);
        if (!entry) { sendJSON(res, 404, { error: 'Not found' }); return; }
        list = [entry];
        baseName = 'win-' + slugify(entry.title || entry.id);
      } else {
        list = filterEntries(await store.getEntries(), {
          from: u.searchParams.get('from') || '',
          to: u.searchParams.get('to') || '',
        });
      }
      if (type === 'markdown') {
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}.md"`,
        });
        res.end(exportMarkdown(list));
        return;
      }
      if (type === 'html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}.html"`,
        });
        res.end(exportHTML(list));
        return;
      }
      // Default: JSON. Single-entry export returns the object, not an array.
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${baseName}.json"`,
      });
      res.end(JSON.stringify(id ? list[0] : list, null, 2));
      return;
    }

    // --- Static files ---
    if (req.method === 'GET') {
      let rel = pathname === '/' ? '/index.html' : pathname;
      const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
      if (!filePath.startsWith(PUBLIC_DIR)) { sendText(res, 400, 'Bad request'); return; }
      serveStatic(res, filePath);
      return;
    }

    sendText(res, 404, 'Not found');
  } catch (err) {
    console.error('Request error:', err);
    sendJSON(res, 500, { error: err.message || 'Server error' });
  }
});

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
