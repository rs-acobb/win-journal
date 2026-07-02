'use strict';

// --- tiny helpers ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let pendingAttachments = []; // {name, type, dataBase64} or persisted {file,...}
let aiAvailable = false;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// Minimal, safe-enough Markdown -> HTML for our generated output.
function renderMarkdown(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^#\s+/.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += `<h1>${inline(line.slice(2))}</h1>`; }
    else if (/^##\s+/.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += `<h2>${inline(line.slice(3))}</h2>`; }
    else if (/^###\s+/.test(line)) { if (inList) { html += '</ul>'; inList = false; } html += `<h3>${inline(line.slice(4))}</h3>`; }
    else if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`;
    } else if (line.trim() === '') {
      if (inList) { html += '</ul>'; inList = false; }
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${inline(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

// --- date ranges for period filters ---
function rangeFor(period) {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (period === 'day') return { from: iso(now), to: iso(now) };
  if (period === 'week') {
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7; // Monday-start
    d.setDate(d.getDate() - day);
    return { from: iso(d), to: iso(now) };
  }
  if (period === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  if (period === 'year') return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
  return { from: '', to: '' }; // all
}

// --- tabs (ARIA tablist with roving tabindex + arrow-key navigation) ---
const tabButtons = $$('.tab');

function activateTab(btn, { focus = false } = {}) {
  tabButtons.forEach((b) => {
    const selected = b === btn;
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
  });
  $$('.panel').forEach((p) => { p.classList.remove('active'); p.hidden = true; });
  const panel = $('#tab-' + btn.dataset.tab);
  panel.classList.add('active');
  panel.hidden = false;
  if (focus) btn.focus();
}

tabButtons.forEach((btn, i) => {
  btn.addEventListener('click', () => activateTab(btn));
  btn.addEventListener('keydown', (e) => {
    let target = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') target = tabButtons[(i + 1) % tabButtons.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') target = tabButtons[(i - 1 + tabButtons.length) % tabButtons.length];
    else if (e.key === 'Home') target = tabButtons[0];
    else if (e.key === 'End') target = tabButtons[tabButtons.length - 1];
    if (target) { e.preventDefault(); activateTab(target, { focus: true }); }
  });
});

// --- theme (system default, with a persisted toggle) ---
const themeToggle = $('#themeToggle');
function resolveTheme(pref) {
  // pref: 'light' | 'dark' | null (follow system)
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(pref) {
  const effective = resolveTheme(pref);
  // Always set an explicit theme so cvd/contrast override blocks key off it reliably.
  document.documentElement.setAttribute('data-theme', effective);
  const isDark = effective === 'dark';
  themeToggle.textContent = isDark ? '☀️ Light' : '🌙 Dark';
  themeToggle.setAttribute('aria-pressed', String(isDark));
  themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}
themeToggle.addEventListener('click', () => {
  const current = localStorage.getItem('wj-theme');
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDarkNow = current ? current === 'dark' : sysDark;
  const next = isDarkNow ? 'light' : 'dark';
  localStorage.setItem('wj-theme', next);
  applyTheme(next);
});
// Follow OS changes only while the user hasn't made an explicit choice.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem('wj-theme')) applyTheme(null);
});
applyTheme(localStorage.getItem('wj-theme'));

// --- accessibility toggles: high contrast + colorblind-safe ---
const contrastToggle = $('#contrastToggle');
const cvdToggle = $('#cvdToggle');
function applyContrast(on) {
  if (on) document.documentElement.setAttribute('data-contrast', 'high');
  else document.documentElement.removeAttribute('data-contrast');
  contrastToggle.setAttribute('aria-pressed', String(on));
  localStorage.setItem('wj-contrast', on ? 'high' : '');
}
function applyCvd(on) {
  if (on) document.documentElement.setAttribute('data-cvd', 'safe');
  else document.documentElement.removeAttribute('data-cvd');
  cvdToggle.setAttribute('aria-pressed', String(on));
  localStorage.setItem('wj-cvd', on ? 'safe' : '');
}
contrastToggle.addEventListener('click', () => {
  const on = contrastToggle.getAttribute('aria-pressed') !== 'true';
  applyContrast(on); toast(on ? 'High contrast on' : 'High contrast off');
});
cvdToggle.addEventListener('click', () => {
  const on = cvdToggle.getAttribute('aria-pressed') !== 'true';
  applyCvd(on); toast(on ? 'Colorblind-safe palette on' : 'Colorblind-safe off');
});
applyContrast(localStorage.getItem('wj-contrast') === 'high');
applyCvd(localStorage.getItem('wj-cvd') === 'safe');

// --- display popover ---
const displayBtn = $('#displayBtn');
const displayPanel = $('#displayPanel');
function panelItems() { return Array.from(displayPanel.querySelectorAll('button')); }
function openPanel() {
  displayPanel.hidden = false;
  displayBtn.setAttribute('aria-expanded', 'true');
  const first = panelItems()[0]; if (first) first.focus();
  document.addEventListener('keydown', onPanelKey, true);
  document.addEventListener('click', onOutside, true);
}
function closePanel(returnFocus) {
  displayPanel.hidden = true;
  displayBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', onPanelKey, true);
  document.removeEventListener('click', onOutside, true);
  if (returnFocus) displayBtn.focus();
}
function onPanelKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closePanel(true); return; }
  if (e.key === 'Tab') {
    const items = panelItems(); if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
    else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
  }
}
function onOutside(e) {
  if (!displayPanel.contains(e.target) && !displayBtn.contains(e.target)) closePanel(false);
}
displayBtn.addEventListener('click', () => (displayPanel.hidden ? openPanel() : closePanel(true)));

// --- impact slider ---
$('#impact').addEventListener('input', (e) => { $('#impactVal').textContent = e.target.value; });

// --- entry format: free text vs guided template ---
const TEMPLATE_KEYS = ['overview', 'built', 'metrics', 'learned', 'didWell', 'improve', 'bullet'];
let entryMode = 'text';

function setEntryMode(mode) {
  entryMode = mode === 'template' ? 'template' : 'text';
  $$('.mode-btn').forEach((b) => {
    const on = b.dataset.mode === entryMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('#modeText').hidden = entryMode !== 'text';
  $('#modeTemplate').hidden = entryMode !== 'template';
}

function getSections() {
  const s = {};
  for (const k of TEMPLATE_KEYS) s[k] = $('#t_' + k).value;
  return s;
}

function setSections(sections) {
  const s = sections || {};
  for (const k of TEMPLATE_KEYS) $('#t_' + k).value = s[k] || '';
}

$$('.mode-btn').forEach((b) => b.addEventListener('click', () => setEntryMode(b.dataset.mode)));

// Auto-suggest an ATS bullet from the other template sections.
$('#suggestBullet').addEventListener('click', async () => {
  const btn = $('#suggestBullet');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '… drafting';
  try {
    const res = await fetch('/api/suggest-bullet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: $('#title').value, sections: getSections(), mode: aiEffective() ? 'ai' : 'offline' }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Could not suggest a bullet'); return; }
    if (!data.bullet) { toast('Add a title or some details first'); return; }
    $('#t_bullet').value = data.bullet;
    toast(data.mode === 'ai' ? 'Drafted with Claude — edit as needed' : 'Drafted — edit as needed');
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

// --- file handling ---
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(String(result).split(',')[1]); // strip data: prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

$('#files').addEventListener('change', async (e) => {
  for (const file of e.target.files) {
    const dataBase64 = await fileToBase64(file);
    pendingAttachments.push({ name: file.name, type: file.type, dataBase64 });
  }
  e.target.value = '';
  renderAttachPreview();
});

function renderAttachPreview() {
  const wrap = $('#attachPreview');
  wrap.innerHTML = '';
  pendingAttachments.forEach((a, i) => {
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    chip.innerHTML = `📎 ${a.name} <button data-i="${i}" title="remove">×</button>`;
    wrap.appendChild(chip);
  });
  $$('#attachPreview button').forEach((b) => b.addEventListener('click', () => {
    pendingAttachments.splice(Number(b.dataset.i), 1);
    renderAttachPreview();
  }));
}

// --- entry form ---
function resetForm() {
  $('#entryId').value = '';
  $('#entryForm').reset();
  $('#impactVal').textContent = '3';
  $('#impact').value = 3;
  $('#date').value = new Date().toISOString().slice(0, 10);
  pendingAttachments = [];
  renderAttachPreview();
  setSections({});
  setEntryMode('text');
  $('#formTitle').textContent = 'Add an entry';
  $('#saveBtn').textContent = 'Save entry';
  $('#cancelEdit').hidden = true;
}

$('#cancelEdit').addEventListener('click', resetForm);

$('#entryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#entryId').value;
  const payload = {
    date: $('#date').value,
    title: $('#title').value,
    impact: Number($('#impact').value),
    tags: $('#tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    attachments: pendingAttachments,
    mode: entryMode,
  };
  if (entryMode === 'template') payload.sections = getSections();
  else payload.body = $('#body').value;
  const url = id ? `/api/entries/${id}` : '/api/entries';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { toast('Save failed'); return; }
  toast(id ? 'Entry updated' : 'Entry saved');
  resetForm();
  loadEntries();
});

// --- entry list ---
async function loadEntries() {
  const q = $('#search').value.trim();
  const period = $('#periodFilter').value;
  const { from, to } = rangeFor(period);
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const res = await fetch('/api/entries?' + params.toString());
  const entries = await res.json();
  renderEntries(entries);
}

function attachmentHTML(att) {
  const url = `/api/attachments/${att.file}`;
  if (att.type && att.type.startsWith('image/')) {
    return `<a href="${url}" target="_blank"><img src="${url}" alt="${att.name}"></a>`;
  }
  return `<a href="${url}" target="_blank">📄 ${att.name}</a>`;
}

const PAGE_SIZE = 8;
let currentEntries = [];
let currentPage = 1;

function renderEntries(entries) {
  currentEntries = entries;
  currentPage = 1;
  renderPage();
}

function renderPage() {
  const list = $('#entryList');
  const entries = currentEntries;
  if (!entries.length) {
    list.innerHTML = '<div class="empty">No entries yet. Log your first win on the left →</div>';
    renderPagination(1);
    return;
  }
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  if (currentPage > pages) currentPage = pages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageEntries = entries.slice(start, start + PAGE_SIZE);
  list.innerHTML = '';
  for (const e of pageEntries) {
    const div = document.createElement('div');
    div.className = 'entry';
    const tags = (e.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    const atts = (e.attachments || []).map(attachmentHTML).join('');
    div.innerHTML = `
      <div class="entry-head">
        <span class="entry-title">${escapeHtml(e.title || 'Untitled')}</span>
        <span class="impact-pip">●${e.impact || 3}/5</span>
      </div>
      <div class="entry-meta">${(e.date || '').slice(0, 10)} ${tags}</div>
      <div class="entry-body">${escapeHtml(e.body || '')}</div>
      ${atts ? `<div class="entry-atts">${atts}</div>` : ''}
      <div class="entry-actions">
        <button class="btn ghost" data-edit="${e.id}">Edit</button>
        <button class="btn ghost" data-del="${e.id}">Delete</button>
        <span class="exp-wrap">
          <button class="btn ghost" data-exp-toggle="${e.id}" aria-haspopup="true" aria-expanded="false" aria-label="Export this entry">Export ▾</button>
          <span class="exp-menu" role="menu" data-exp-menu="${e.id}" hidden>
            <a href="/api/export?type=markdown&id=${e.id}">Markdown (.md)</a>
            <a href="/api/export?type=html&id=${e.id}">HTML → PDF (.html)</a>
            <a href="/api/export?type=json&id=${e.id}">JSON (.json)</a>
          </span>
        </span>
      </div>`;
    list.appendChild(div);
  }
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editEntry(b.dataset.edit, currentEntries)));
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => deleteEntry(b.dataset.del)));
  $$('[data-exp-toggle]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const id = b.dataset.expToggle;
    const menu = document.querySelector(`[data-exp-menu="${id}"]`);
    const willOpen = menu.hidden;
    closeExportMenus();
    menu.hidden = !willOpen;
    b.setAttribute('aria-expanded', String(willOpen));
  }));
  renderPagination(pages);
}

function renderPagination(pages) {
  const bar = $('#pagination');
  if (!bar) return;
  if (pages <= 1) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = `
    <button class="btn ghost" id="prevPage" aria-label="Previous page"${currentPage <= 1 ? ' disabled' : ''}>← Prev</button>
    <span class="page-status" aria-live="polite">Page ${currentPage} of ${pages} · ${currentEntries.length} entries</span>
    <button class="btn ghost" id="nextPage" aria-label="Next page"${currentPage >= pages ? ' disabled' : ''}>Next →</button>`;
  $('#prevPage').addEventListener('click', () => goToPage(currentPage - 1));
  $('#nextPage').addEventListener('click', () => goToPage(currentPage + 1));
}

function goToPage(p) {
  const pages = Math.max(1, Math.ceil(currentEntries.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, p), pages);
  renderPage();
  const next = document.getElementById('nextPage'), prev = document.getElementById('prevPage');
  if (next && !next.disabled) next.focus();
  else if (prev && !prev.disabled) prev.focus();
}

function closeExportMenus() {
  $$('.exp-menu').forEach((m) => { m.hidden = true; });
  $$('[data-exp-toggle]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

// Close any open per-entry export menu when clicking elsewhere or pressing Escape.
document.addEventListener('click', closeExportMenus);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeExportMenus(); });

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function editEntry(id, entries) {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  $('#entryId').value = e.id;
  $('#title').value = e.title || '';
  $('#body').value = e.body || '';
  if (e.mode === 'template' && e.sections) {
    setSections(e.sections);
    setEntryMode('template');
  } else {
    setEntryMode('text');
  }
  $('#date').value = (e.date || '').slice(0, 10);
  $('#impact').value = e.impact || 3;
  $('#impactVal').textContent = e.impact || 3;
  $('#tags').value = (e.tags || []).join(', ');
  pendingAttachments = (e.attachments || []).map((a) => ({ ...a })); // already-persisted
  renderAttachPreview();
  $('#formTitle').textContent = 'Edit entry';
  $('#saveBtn').textContent = 'Update entry';
  $('#cancelEdit').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry? This also removes its attachments.')) return;
  await fetch(`/api/entries/${id}`, { method: 'DELETE' });
  toast('Entry deleted');
  loadEntries();
}

$('#search').addEventListener('input', debounce(loadEntries, 250));
$('#periodFilter').addEventListener('change', loadEntries);

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// --- summaries ---
$('#genSummary').addEventListener('click', async () => {
  const period = $('#sumPeriod').value;
  const mode = $('#sumMode').value;
  const { from, to } = rangeFor(period);
  const out = $('#summaryOut');
  out.innerHTML = '<span class="loading">Generating' + (mode === 'ai' ? ' with Claude…' : '…') + '</span>';
  try {
    const res = await fetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period, mode, from, to }),
    });
    const data = await res.json();
    if (!res.ok) { out.innerHTML = '<p>' + escapeHtml(data.error || 'Error') + '</p>'; return; }
    out.dataset.md = data.markdown;
    out.innerHTML = renderMarkdown(data.markdown);
  } catch (err) {
    out.innerHTML = '<p>' + escapeHtml(err.message) + '</p>';
  }
});
$('#copySummary').addEventListener('click', () => copyMd('#summaryOut'));

// --- resume ---
$('#genResume').addEventListener('click', async () => {
  const period = $('#resPeriod').value;
  const mode = $('#resMode').value;
  const { from, to } = rangeFor(period);
  const out = $('#resumeOut');
  out.innerHTML = '<span class="loading">Generating' + (mode === 'ai' ? ' with Claude…' : '…') + '</span>';
  try {
    const res = await fetch('/api/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period, mode, from, to }),
    });
    const data = await res.json();
    if (!res.ok) { out.innerHTML = '<p>' + escapeHtml(data.error || 'Error') + '</p>'; return; }
    out.dataset.md = data.markdown;
    out.innerHTML = renderMarkdown(data.markdown);
  } catch (err) {
    out.innerHTML = '<p>' + escapeHtml(err.message) + '</p>';
  }
});
$('#copyResume').addEventListener('click', () => copyMd('#resumeOut'));

function copyMd(sel) {
  const md = $(sel).dataset.md || '';
  if (!md) { toast('Nothing to copy yet'); return; }
  navigator.clipboard.writeText(md).then(() => toast('Copied as Markdown'));
}

// --- export ---
$$('.export-buttons button').forEach((b) => b.addEventListener('click', () => {
  const type = b.dataset.type;
  const { from, to } = rangeFor($('#expPeriod').value);
  const params = new URLSearchParams({ type });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  window.location.href = '/api/export?' + params.toString();
}));

// --- AI availability + user toggle (default OFF to avoid spending tokens) ---
let aiEnabled = localStorage.getItem('wj-ai') === '1'; // user preference
function aiEffective() { return aiAvailable && aiEnabled; }

function applyAiState() {
  const toggle = $('#aiToggle');
  if (!aiAvailable) {
    aiEnabled = false;
    toggle.textContent = 'AI: unavailable';
    toggle.disabled = true;
    toggle.setAttribute('aria-pressed', 'false');
    toggle.title = 'Set ANTHROPIC_API_KEY in .env to enable Claude AI';
  } else {
    toggle.disabled = false;
    toggle.textContent = aiEnabled ? 'AI: on' : 'AI: off';
    toggle.setAttribute('aria-pressed', String(aiEnabled));
    toggle.title = aiEnabled
      ? 'Claude AI is ON — click to turn off and save tokens'
      : 'Claude AI is OFF — click to turn on';
  }

  // Enable/disable the "Claude AI" option in the summary/resume selects and
  // reset any select currently pointed at a now-disabled AI option.
  const eff = aiEffective();
  $$('#sumMode option[value=ai], #resMode option[value=ai]').forEach((o) => {
    o.disabled = !eff;
    o.textContent = eff ? 'Claude AI (smart)'
      : aiAvailable ? 'Claude AI — turn on AI above'
      : 'Claude AI — set API key in .env';
  });
  ['#sumMode', '#resMode'].forEach((sel) => {
    const el = $(sel);
    if (!eff && el.value === 'ai') el.value = 'offline';
  });
}

$('#aiToggle').addEventListener('click', () => {
  if (!aiAvailable) return;
  aiEnabled = !aiEnabled;
  localStorage.setItem('wj-ai', aiEnabled ? '1' : '0');
  applyAiState();
  toast(aiEnabled ? 'Claude AI enabled' : 'Claude AI off — using offline mode');
});

// --- init ---
async function init() {
  $('#date').value = new Date().toISOString().slice(0, 10);
  try {
    const cfg = await (await fetch('/api/config')).json();
    aiAvailable = cfg.aiAvailable;
  } catch (_) { aiAvailable = false; }
  applyAiState();
  loadEntries();
}
init();
