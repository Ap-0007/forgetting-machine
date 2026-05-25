export type SourceType    = 'NOTE' | 'PASTE' | 'BOOK_HIGHLIGHT' | 'VOICE_TRANSCRIPT' | 'URL_IMPORT';
export type TriggerReason = 'SCHEDULED' | 'CONTEXT_MATCH' | 'CONFLICT_DETECTED' | 'RANDOM_DEEP_PULL';
export type UserReaction  = 'dismissed' | 'saved' | 'expanded' | 'ignored';
export type SignalType    = 'RECENT_ENTRY' | 'RECENT_SEARCH' | 'TIME_OF_DAY';
export type OverrideType  = 'force_bury' | 'force_surface';

export interface Entry {
  id: string;
  user_id: string;
  raw_content: string;
  source_type: SourceType;
  embedding: number[] | null;
  word_count: number;
  created_at: Date;
}

export interface EntryScore {
  entry_id: string;
  user_id: string;
  emotional_weight: number;
  conceptual_density: number;
  decay_rate: number;
  current_burial_depth: number;
  next_surface_at: Date;
  last_surfaced_at: Date | null;
  surface_count: number;
  last_reaction: UserReaction | null;
  last_reaction_at: Date | null;
}

export interface SurfaceEvent {
  id: string;
  entry_id: string;
  user_id: string;
  surfaced_at: Date;
  trigger_reason: TriggerReason;
  user_reaction: UserReaction | null;
  time_to_react_ms: number | null;
}

export interface ContextSignal {
  id: string;
  user_id: string;
  signal_type: SignalType;
  signal_value: string;
  expires_at: Date;
}

export interface BurialOverride {
  entry_id: string;
  override_type: OverrideType;
  expires_at: Date;
}

export interface EntryExpansion {
  id: string;
  entry_id: string;
  probing_question: string;
  unexpected_connection_domain: string;
  unexpected_connection_text: string;
  stress_test: string;
  created_at: Date;
}

export interface PushSubscriptionRecord {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  timezone: string;
  created_at: Date;
}

export interface BulkJob {
  id: string;
  user_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total: number;
  processed: number;
  errors: Array<{ index: number; error: string }>;
  created_at: Date;
  updated_at: Date;
}

// ── LLM result shapes ────────────────────────────────────────────────────────

export interface ScoringResult {
  emotional_weight: number;
  conceptual_density: number;
  decay_rate: number;
  initial_burial_depth: number;
}

export interface ConflictResult {
  conflicts: Array<{
    existing_entry_id: string;
    conflict_summary: string;
    severity: number;
  }>;
}

export interface ExpansionResult {
  probing_question: string;
  unexpected_connection: {
    domain: string;
    connection: string;
  };
  stress_test: string;
}

// ── API request / response shapes ────────────────────────────────────────────

export interface IngestRequest {
  content: string;
  source_type?: SourceType;
  metadata?: Record<string, unknown>;
}

export interface IngestResponse {
  entry_id: string;
  chunk_count: number;
  estimated_first_surface: string;
}

export interface ReactionRequest {
  reaction: UserReaction;
  time_to_react_ms: number;
}

export interface ReactionResponse {
  next_surface_at: string;
  burial_depth: number;
}

export interface SurfaceNextResponse {
  surface_event_id: string;
  entry: {
    id: string;
    content: string;
    created_at: string;
    days_since_written: number;
    source_type: SourceType;
  };
  trigger_reason: TriggerReason;
  conflicting_entry?: {
    id: string;
    content: string;
  };
}

export interface GraveyardStats {
  total_buried: number;
  deepest_entry: {
    id: string;
    first_words: string;
    age_days: number;
    burial_depth: number;
  } | null;
  average_burial_depth: number;
  average_depth_meters: number;
}

// ── BullMQ job data ───────────────────────────────────────────────────────────

export interface ScoreEntryJobData {
  entry_id: string;
  user_id: string;
}

export interface GenerateExpansionJobData {
  entry_id: string;
  user_id: string;
  surface_event_id: string;
}

// ── Error shape ───────────────────────────────────────────────────────────────

export interface AppErrorBody {
  error: {
    code: string;
    message: string;
    stack?: string;
    request_id: string;
  };
}
