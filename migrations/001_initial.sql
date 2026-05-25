-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
CREATE TYPE source_type   AS ENUM ('NOTE','PASTE','BOOK_HIGHLIGHT','VOICE_TRANSCRIPT','URL_IMPORT');
CREATE TYPE trigger_reason AS ENUM ('SCHEDULED','CONTEXT_MATCH','CONFLICT_DETECTED','RANDOM_DEEP_PULL');
CREATE TYPE user_reaction  AS ENUM ('dismissed','saved','expanded','ignored');
CREATE TYPE signal_type    AS ENUM ('RECENT_ENTRY','RECENT_SEARCH','TIME_OF_DAY');
CREATE TYPE override_type  AS ENUM ('force_bury','force_surface');

-- ── entries ──────────────────────────────────────────────────────────────────
-- nomic-embed-text produces 768-dim vectors; change to 1536 if swapping models
CREATE TABLE entries (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     TEXT         NOT NULL,
  raw_content TEXT         NOT NULL,
  source_type source_type  NOT NULL DEFAULT 'NOTE',
  embedding   vector(768),
  word_count  INT          NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX entries_user_id_idx   ON entries (user_id);
CREATE INDEX entries_created_at_idx ON entries (created_at);
-- HNSW index for approximate nearest-neighbour cosine search
CREATE INDEX entries_embedding_hnsw_idx
  ON entries USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── entry_scores ─────────────────────────────────────────────────────────────
CREATE TABLE entry_scores (
  entry_id             UUID         PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  user_id              TEXT         NOT NULL,
  emotional_weight     FLOAT        NOT NULL DEFAULT 0.5
                         CHECK (emotional_weight  BETWEEN 0 AND 1),
  conceptual_density   FLOAT        NOT NULL DEFAULT 0.5
                         CHECK (conceptual_density BETWEEN 0 AND 1),
  decay_rate           FLOAT        NOT NULL DEFAULT 0.05
                         CHECK (decay_rate BETWEEN 0.01 AND 0.20),
  current_burial_depth FLOAT        NOT NULL DEFAULT 0.8
                         CHECK (current_burial_depth BETWEEN 0 AND 1),
  next_surface_at      TIMESTAMPTZ  NOT NULL,
  last_surfaced_at     TIMESTAMPTZ,
  surface_count        INT          NOT NULL DEFAULT 0,
  last_reaction        user_reaction,
  last_reaction_at     TIMESTAMPTZ
);

CREATE INDEX entry_scores_user_next_surface_idx ON entry_scores (user_id, next_surface_at);
CREATE INDEX entry_scores_burial_depth_idx      ON entry_scores (current_burial_depth);

-- ── surface_events (immutable log) ───────────────────────────────────────────
CREATE TABLE surface_events (
  id                UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id          UUID           NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id           TEXT           NOT NULL,
  surfaced_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  trigger_reason    trigger_reason NOT NULL,
  user_reaction     user_reaction,
  time_to_react_ms  BIGINT
);

CREATE INDEX surface_events_entry_id_idx   ON surface_events (entry_id);
CREATE INDEX surface_events_user_id_idx    ON surface_events (user_id);
CREATE INDEX surface_events_surfaced_at_idx ON surface_events (surfaced_at);

-- ── context_signals (rolling 24 h window) ────────────────────────────────────
CREATE TABLE context_signals (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      TEXT        NOT NULL,
  signal_type  signal_type NOT NULL,
  signal_value TEXT        NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX context_signals_user_expires_idx ON context_signals (user_id, expires_at);

-- ── burial_overrides ──────────────────────────────────────────────────────────
CREATE TABLE burial_overrides (
  entry_id      UUID          PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  override_type override_type NOT NULL,
  expires_at    TIMESTAMPTZ   NOT NULL
);

CREATE INDEX burial_overrides_expires_idx ON burial_overrides (expires_at);

-- ── entry_expansions ─────────────────────────────────────────────────────────
CREATE TABLE entry_expansions (
  id                           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id                     UUID        NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  probing_question             TEXT        NOT NULL,
  unexpected_connection_domain TEXT        NOT NULL,
  unexpected_connection_text   TEXT        NOT NULL,
  stress_test                  TEXT        NOT NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX entry_expansions_entry_id_idx ON entry_expansions (entry_id);

-- ── push_subscriptions ───────────────────────────────────────────────────────
CREATE TABLE push_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    TEXT        NOT NULL,
  endpoint   TEXT        NOT NULL UNIQUE,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  timezone   TEXT        NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions (user_id);

-- ── bulk_jobs ────────────────────────────────────────────────────────────────
CREATE TABLE bulk_jobs (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','processing','completed','failed')),
  total      INT         NOT NULL DEFAULT 0,
  processed  INT         NOT NULL DEFAULT 0,
  errors     JSONB       NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bulk_jobs_user_id_idx ON bulk_jobs (user_id);
