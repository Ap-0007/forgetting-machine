export type SourceType    = 'NOTE' | 'PASTE' | 'BOOK_HIGHLIGHT' | 'VOICE_TRANSCRIPT' | 'URL_IMPORT';
export type TriggerReason = 'SCHEDULED' | 'CONTEXT_MATCH' | 'CONFLICT_DETECTED' | 'RANDOM_DEEP_PULL';
export type UserReaction  = 'dismissed' | 'saved' | 'expanded' | 'ignored';

export interface IngestResponse {
  entry_id: string;
  chunk_count: number;
  estimated_first_surface: string;
}

export interface SurfaceEntry {
  id: string;
  content: string;
  created_at: string;
  days_since_written: number;
  source_type: SourceType;
}

export interface SurfaceNextResponse {
  surface_event_id: string;
  entry: SurfaceEntry;
  trigger_reason: TriggerReason;
  conflicting_entry?: { id: string; content: string };
}

export interface ReactionResponse {
  next_surface_at: string;
  burial_depth: number;
  full_content?: string;
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
