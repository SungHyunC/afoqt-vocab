# AFOQT Master

**A mobile study PWA with spaced repetition, timed practice, and cross-device progress synchronization.**

[Live app](https://sunghyunc.github.io/afoqt-vocab/) · [한국어 사용 안내](README.ko.md)

Built around a practical problem: keeping vocabulary review, practice exams, and study history together across a phone and laptop. English study content is paired with Korean explanations. The app runs as a static site without a frontend build step.

## Features

- **Spaced repetition:** SM-2 vocabulary scheduling, review queues, pronunciation, and synonym practice.
- **Practice:** verbal, quantitative, aviation, and spatial exercises, timed exams, and mistake review. Table-reading, instrument, and block-counting exercises include procedural generation.
- **Progress:** daily goals, weak-area summaries, exam history, and backup/restore.
- **Offline and sync:** service-worker caching and browser storage, with optional Supabase synchronization.
- **Exports:** Markdown/JSON analysis exports and printable study reports, with explicit handling of missing historical detail.

## Engineering highlights

| Concern | Implementation |
| --- | --- |
| Multi-device state | Per-device synonym-feed replicas, foreground reconciliation, queued writes, and merge logic in [`app.js`](app.js). |
| Inspectable study history | Per-device SHA-256 event chains, activity-time accounting, and reports in [`evidence.js`](evidence.js). A local hash chain checks consistency; it does not independently certify that an activity occurred. |
| Useful exports | [`study-export.js`](study-export.js) separates detailed answers from aggregate history and omits connection settings and sync codes. |
| Offline delivery | [`sw.js`](sw.js) caches the app shell and assets; [`manifest.webmanifest`](manifest.webmanifest) enables installation. |

## Run locally

Requirements: **Python 3** for the static server; **Node.js 18+** for the checks.

```bash
git clone https://github.com/SungHyunC/afoqt-vocab.git
cd afoqt-vocab
```

For a local-only run, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` to empty strings in [`config.js`](config.js) before opening the app. Use a fresh browser profile or remove saved Supabase overrides in settings, because browser settings take precedence. The checked-in configuration points to the existing demo service.

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://localhost:8000>. Install through **Add to Home Screen / Install app**. Offline use requires an initial asset load.

For sync, use your own Supabase project and review [`supabase/schema.sql`](supabase/schema.sql) before applying it. Set your URL and public client key in `config.js`; never put a service-role key in browser code. See the [Korean guide](README.ko.md) for detailed setup.

## Existing checks

Run from the repository root; these use Node's built-in modules and need no `npm install`.

```bash
node scripts/test_synfeed_sync.mjs
node scripts/test_evidence.mjs
node scripts/test_evidence_sync.mjs
node scripts/test_study_export.mjs
node scripts/test_consolidation.mjs
```

These exercise state merging/restoration, study-log hashing, exports, and navigation/state compatibility. They do not replace browser or live-backend testing.

## Repository map

| Path | Purpose |
| --- | --- |
| `index.html`, `app.css`, `app.js` | App shell, styling, study flows, and synchronization |
| `evidence.js`, `study-export.js` | Study-history processing and exports |
| `*.json` | Vocabulary, passages, questions, and guides |
| `supabase/schema.sql` | Database schema, Realtime setup, and policies |
| `scripts/` | Regression checks and content validators |
| [VERBAL_THEMES.md](VERBAL_THEMES.md) | Vocabulary-theme rules and distribution |

## Scope and limitations

- This is an **unofficial study tool**. Practice scores and percentile estimates are not official conversions or validated predictors.
- Vocabulary priorities are editorial study aids, not measured official exam frequencies. Some source-list provenance is incomplete; the Korean guide documents the history.
- **The supplied Supabase schema is a personal-use prototype:** anonymous policies allow broad access. Sync codes separate records in client queries but do not enforce database authorization. A shared deployment needs authenticated, owner-scoped policies before storing sensitive data.
- Detailed exam records stay locally; sync and exports cannot recreate detail that was never stored or has been removed.
