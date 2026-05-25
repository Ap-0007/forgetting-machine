# The Forgetting Machine

Most information is noise until the exact moment your brain is ready for it. Dump notes, highlights, and ideas — the machine decides when to hide them and when to resurface them.

## Setup (5 commands)

```bash
# 1. Clone and copy env
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD, CLERK keys, VAPID keys, then:

# 2. Pull Ollama models (Ollama must be running on the host)
ollama pull llama3.2 && ollama pull nomic-embed-text

# 3. Generate VAPID keys and paste into .env
npx web-push generate-vapid-keys

# 4. Start all services
docker compose up --build -d

# 5. Install and run the frontend
cd frontend && npm install && npm run dev
```

Open http://localhost:5173

---

## Stack

| Layer        | Tech                                      |
|--------------|-------------------------------------------|
| API          | Node.js · TypeScript · Express            |
| Auth         | Clerk                                     |
| Database     | PostgreSQL 16 + pgvector (HNSW index)     |
| Queue        | BullMQ + Redis 7                          |
| LLM          | Ollama — llama3.2 (scoring/expansion)     |
| Embeddings   | Ollama — nomic-embed-text (768-dim)       |
| Notifications | Web Push API (VAPID)                     |
| Frontend     | React 18 · TypeScript · Tailwind CSS      |

---

## Architecture

```
POST /api/ingest
  → strip PII → chunk at sentence boundaries (500 tokens)
  → insert entries + entry_scores (initial next_surface_at: 3–10 days random)
  → enqueue score-entry job (async)
  → return 202 within 200ms

BullMQ worker: score-entry
  → generate embedding (nomic-embed-text)
  → LLM call 1: emotional_weight, conceptual_density, decay_rate, burial_depth
  → LLM call 2: conflict detection (cosine ANN against surfaceable entries)
  → update entry_scores; surface conflicts immediately

BullMQ scheduler (every 15 min)
  → find entries where next_surface_at <= now AND burial_depth < 0.3
  → score by context relevance: similarity×0.4 + (1−depth)×0.3 + emotion×0.3
  → pick top 3; send push notifications; re-bury with spaced repetition
  → random deep pull: 1 entry with depth > 0.8 per user per day

POST /api/surface/:id/react { reaction, time_to_react_ms }
  → update scores; recalculate next_surface_at
  → if expanded: enqueue generate-expansion job; return full content

BullMQ worker: generate-expansion
  → LLM: probing_question + unexpected_connection + stress_test
  → store in entry_expansions; send follow-up push
```

---

## Key endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ingest` | Ingest a note (min 10 words, max 50k chars) |
| POST | `/api/ingest/bulk` | Upload .json or .md file (max 500 entries) |
| GET  | `/api/jobs/:id` | Bulk job status |
| GET  | `/api/surface/next` | Next pending surface event |
| POST | `/api/surface/:id/react` | React to a surface event |
| GET  | `/api/graveyard/stats` | Burial stats |
| POST | `/api/graveyard/excavate` | Surface everything over 30 days |
| POST | `/api/notifications/subscribe` | Register push subscription |
| DELETE | `/api/notifications/unsubscribe` | Remove push subscription |

---

## Environment variables

See [`.env.example`](.env.example) — every variable is documented inline.

**Required before first run:**
- `POSTGRES_PASSWORD` — any strong password
- `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY` — from [dashboard.clerk.com](https://dashboard.clerk.com)
- `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` — run `npx web-push generate-vapid-keys`

---

## Embedding dimensions

`nomic-embed-text` produces **768-dimensional** vectors. The migration uses `vector(768)`. If you switch to a 1536-dim model (e.g. `mxbai-embed-large`), update:
1. `OLLAMA_EMBED_MODEL` in `.env`
2. `vector(768)` → `vector(1536)` in `migrations/001_initial.sql`
3. Re-run migrations on a fresh database

---

## Spaced repetition formula

```
base_days   = [3, 7, 14, 30, 60, 120, 240][min(surface_count, 6)]
modifier    = { saved: 0.5, dismissed: 2, expanded: 0.3, ignored: 3 }[reaction]
decay       = max(0.1, 1 − decay_rate × surface_count)
next_days   = base_days × modifier × decay
```

---

## Notification rules

- Max **3 per user per day**
- Silent between **22:00 – 08:00** user local time (IANA timezone stored per subscription)
- If user inactive **7+ days** → single daily digest instead of content
- Stale subscriptions (HTTP 410) are auto-deleted
