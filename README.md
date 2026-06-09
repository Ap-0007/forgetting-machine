<p align="center">
  <img width="100%" src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:161b22,100:1a1b27&height=220&section=header&text=forgetting-machine&fontSize=55&fontColor=e6edf3&fontAlignY=35&desc=The%20AI%20that%20hides%20information%20until%20your%20brain%20is%20ready&descSize=16&descAlignY=55&descColor=8b949e&animation=fadeIn" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white&labelColor=0d1117&color=0d1117" />
</p>

---

## 🧠 What is this?

**forgetting-machine** is an AI-powered note system built around one principle: *your brain learns better when it forgets.*

Most note apps show you everything, all the time. This one **hides information until your brain is ready to receive it** — surfacing notes at exactly the moment they're most likely to stick, based on semantic similarity, not just timers.

It's spaced repetition, but driven by meaning, not intervals.

> *The best time to see a note is not when you write it. It's when you've almost forgotten it.*

---

## ⚙️ How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    YOU WRITE A NOTE                     │
│  "the observer effect means measurement changes state"  │
└──────────────────────────────┬──────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────┐
│                  🧬 EMBEDDING ENGINE                    │
│  pgvector converts note → semantic vector               │
│  Stored with timestamp + decay metadata                 │
└──────────────────────────────┬──────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────┐
│                  ⏰ BULLMQ SCHEDULER                    │
│  Calculates optimal resurfacing time                    │
│  Queues job: show note when decay score crosses threshold│
└──────────────────────────────┬──────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────┐
│                  🔮 RESURFACING ENGINE                  │
│  Finds semantically RELATED notes you haven't seen      │
│  Surfaces them together as a "memory cluster"           │
└─────────────────────────────────────────────────────────┘
```

---

## 🧱 Tech Stack

| Layer | Technology | Purpose |
|:---|:---|:---|
| **Frontend** | React + TypeScript | Note UI & memory cluster view |
| **Queue** | BullMQ + Redis | Spaced resurfacing scheduler |
| **Embeddings** | pgvector (PostgreSQL) | Semantic note similarity |
| **AI** | LLM Integration | Context-aware resurfacing logic |
| **Infra** | Docker Compose | One-command local deployment |

---

## 🚀 Getting Started

### Prerequisites

```bash
docker
docker-compose
node >= 18.0.0
```

### Installation

```bash
git clone https://github.com/Ap-0007/forgetting-machine.git
cd forgetting-machine

cp .env.example .env

docker compose up --build
# App at http://localhost:3000
```

### Environment Variables

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/forgetting_machine
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=your_key_here   # or OLLAMA_BASE_URL for local
```

---

## 🧪 Decay Function

```typescript
// Notes resurface when their "memory decay score" drops below threshold
const decayScore = (timeSinceLastSeen: number, importanceWeight: number) => {
  return Math.exp(-timeSinceLastSeen / (importanceWeight * BASE_HALF_LIFE));
};
// BullMQ fires when score < RESURFACE_THRESHOLD
// pgvector finds semantically related notes to resurface alongside
```

---

## 🏛️ Philosophy

Most productivity tools optimize for *capturing* information. This one optimizes for *forgetting* it correctly.

If you remember everything immediately, you learned nothing. The machine decides what you're ready to see.

---

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:58a6ff,60:1f6feb,100:0d1117&height=120&section=footer&animation=fadeIn" width="100%" />
</p>
