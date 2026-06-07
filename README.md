<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:161b22,100:1a1b27&height=220&section=header&text=FORGETTING%20MACHINE&fontSize=55&fontColor=e6edf3&fontAlignY=35&desc=AI-Powered%20Spaced%20Resurfacing%20%E2%80%A2%20Remember%20When%20You're%20Ready&descSize=16&descAlignY=55&descColor=8b949e&animation=fadeIn" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/Tailwind-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/Ollama-000000?style=for-the-badge&logo=ollama&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white&labelColor=0d1117&color=0d1117" />
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white&labelColor=0d1117&color=0d1117" />
</p>

---

## 🧠 What is this?

**Forgetting Machine** is a note-taking system that works *against* your instinct to hoard information.

You write notes. Then they disappear.

Not randomly — intelligently. The system uses **pgvector** embeddings to understand the semantic weight of your notes, then schedules them for resurfacing using **BullMQ** job queues timed to when your brain is actually ready to consolidate that memory.

It's spaced repetition, but for *ideas* — not flashcards.

> *The best way to remember is to forget first.*

### How it's different

- 📝 Write a note → it vanishes from your feed
- ⏰ BullMQ schedules resurfacing based on semantic similarity + decay curves
- 🔔 Web Push notification pulls the note back when your brain is primed
- 🧬 pgvector clusters related ideas so they resurface *together*
- 🤖 Ollama runs locally — your thoughts never leave your machine

---

## ⚙️ How It Works

```
┌──────────────────────────────────────────────────────────┐
│                     ✍️  YOU WRITE                        │
│                                                          │
│  "The best interfaces feel like forgetting              │
│   they exist"                                            │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│                 🧬 EMBEDDING ENGINE                      │
│                                                          │
│  Ollama ──▶ Vector Embedding ──▶ pgvector Storage       │
│                                                          │
│  Semantic similarity mapped across all your notes        │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│               ⏰ FORGETTING SCHEDULER                    │
│                                                          │
│  BullMQ Job Queue                                        │
│  ├── Decay curve calculation                             │
│  ├── Semantic cluster grouping                           │
│  └── Optimal resurfacing time ──▶ Schedule job           │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│              🔔 RESURFACING                              │
│                                                          │
│  Web Push Notification                                   │
│  "Remember this? You wrote it 3 days ago..."            │
│                                                          │
│  Related notes surface together as constellations        │
└──────────────────────────────────────────────────────────┘
```

---

## 🧱 Tech Stack

| Layer | Technology | Purpose |
|:------|:-----------|:--------|
| **Frontend** | React + Tailwind CSS | Minimal, distraction-free note interface |
| **Backend** | Node.js + TypeScript | API server & scheduling logic |
| **AI/ML** | Ollama | Local LLM for semantic embeddings |
| **Vector DB** | pgvector (PostgreSQL) | Semantic similarity search & clustering |
| **Queue** | BullMQ + Redis | Scheduled resurfacing jobs |
| **Notifications** | Web Push API | Browser push notifications |
| **Infra** | Docker + docker-compose | One-command deployment |

---

## 🚀 Getting Started

### Prerequisites

```bash
docker >= 20.0
docker-compose >= 2.0
ollama          # Running locally with a model pulled
```

### Quick Start (Docker)

```bash
# Clone the repository
git clone https://github.com/Ap-0007/forgetting-machine.git
cd forgetting-machine

# Start everything — Postgres, Redis, API, Frontend
docker-compose up -d

# Run database migrations
npm run migrate

# Open in browser
open http://localhost:3000
```

### Manual Setup

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Configure your Postgres, Redis, and Ollama URLs

# Run migrations
npm run migrate

# Start the development server
npm run dev
```

---

## 📁 Project Structure

```
forgetting-machine/
├── frontend/               # React + Tailwind UI
├── migrations/             # PostgreSQL + pgvector migrations
├── src/                    # Backend source code
│   ├── routes/             # API endpoints
│   ├── services/           # Embedding, scheduling, push
│   ├── queues/             # BullMQ job definitions
│   └── models/             # Database models
├── Dockerfile              # Container build
├── docker-compose.yml      # Full-stack orchestration
├── package.json            # Dependencies
└── tsconfig.json           # TypeScript configuration
```

---

## 🤝 Contributing

This project sits at the intersection of cognitive science and software — contributions from both worlds are welcome.

```bash
# Fork the repo
# Create your feature branch
git checkout -b feat/your-feature

# Commit your changes
git commit -m "feat: add your feature"

# Push and open a PR
git push origin feat/your-feature
```

---

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-e6edf3?style=flat-square&labelColor=0d1117&color=161b22" />
</p>

<p align="center">
  <sub>Built by <a href="https://github.com/Ap-0007">vanta.nox</a> · your brain knows when it's ready</sub>
</p>

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0d1117,50:161b22,100:1a1b27&height=100&section=footer" width="100%" />
