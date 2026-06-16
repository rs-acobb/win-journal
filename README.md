# Win Journal

A local **digital win journal** to track what you accomplish and learn — by day, week,
month, or year — and turn it into the case for a raise or promotion.

- 📝 Log entries with **text, tags, an impact rating (1–5), images, and PDFs**
- 🔎 Filter and search by **day / week / month / year / all time**
- 📊 Generate **summaries** that surface your **highest-impact statements**
- 🧰 Draft **resume bullet points** from your wins
- 📤 **Export** everything to JSON, Markdown, or printable HTML (→ PDF)
- 🤖 Summaries work **offline** (deterministic impact scoring) or with **Claude AI** when you add an API key

Zero dependencies — it runs on Node alone. Your data stays on your machine.

## Run it

```bash
cd win-journal
node server.js
```

Then open **http://localhost:4321**.

(Or `npm start` — same thing.)

## Enable AI summaries (optional)

The built-in offline scoring always works. To also get Claude-written summaries,
resume bullets, and bullet suggestions, add your Anthropic API key to the **`.env`**
file in this folder (it's created for you and is git-ignored):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Then restart the server. You can also set `ANTHROPIC_MODEL` (defaults to
`claude-opus-4-8`) or `PORT` (defaults to `4321`) there. A real environment variable
of the same name takes precedence over `.env` if set.

> No `.env`? Copy the template: `cp .env.example .env`, then paste your key.

**Using AI is opt-in.** Even with a key set, AI is **off by default** so you don't spend
tokens unintentionally. Flip the **AI** button in the top bar to turn it on:

- **AI: unavailable** — no key found in `.env` (offline only).
- **AI: off** — key found, but you've chosen not to use it (the default).
- **AI: on** — Claude is used for summaries / resume bullets / suggestions.

When AI is off, the "Claude AI" options are disabled and everything runs offline.

## Where your data lives

| What | Where |
| --- | --- |
| Entries | `data/entries.json` (human-readable) |
| Images / PDFs | `data/attachments/` |

To back up or move your journal, copy the whole `data/` folder. To start fresh, delete it.

## How "highest-impact" is decided (offline mode)

Each entry is scored from its self-rated impact plus signals that matter for reviews:
quantified results (numbers, %, $), outcome-oriented action verbs (led, shipped,
reduced, automated…), substance, and whether it's tagged. The top entries become your
"highest-impact achievements." AI mode hands the same entries to Claude for a polished,
prioritized write-up.

## Notes

- The Claude call uses the Messages API over plain HTTPS to keep the app dependency-free.
- Attachments are sent to the server as base64 and saved to disk (default cap ~25 MB/request).
