import { ScoringResult, ConflictResult, ExpansionResult } from '../types/index';

const BASE_URL    = process.env.OLLAMA_BASE_URL   || 'http://localhost:11434';
const LLM_MODEL   = process.env.OLLAMA_LLM_MODEL  || 'llama3.2';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function generate(prompt: string, system: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LLM_MODEL, system, prompt, stream: false, format: 'json' }),
  });
  if (!res.ok) throw new Error(`Ollama /api/generate → ${res.status}`);
  const data = await res.json() as { response: string };
  return data.response;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  label: string,
): Promise<T> {
  let last!: Error;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err as Error;
      console.error(`[llm] ${label} attempt ${i + 1}/${attempts} failed:`, (err as Error).message);
      if (i < attempts - 1) await sleep(1000 * Math.pow(2, i)); // 1s, 2s, 4s
    }
  }
  throw last;
}

// ── Embeddings ────────────────────────────────────────────────────────────────

export async function generateEmbedding(text: string): Promise<number[]> {
  return withRetry(async () => {
    const res = await fetch(`${BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    });
    if (!res.ok) throw new Error(`Ollama /api/embeddings → ${res.status}`);
    const data = await res.json() as { embedding: number[] };
    return data.embedding;
  }, 3, 'embedding');
}

// ── Scoring ───────────────────────────────────────────────────────────────────

const SCORING_SYSTEM = `You are a cognitive scoring engine. Return only valid JSON, no markdown, no commentary. Score these four dimensions: emotional_weight 0–1 (0=purely factual, 1=deeply personal/charged), conceptual_density 0–1 (0=single fact, 1=dense multi-concept framework), decay_rate 0.01–0.20 (0.01=timeless principle, 0.20=tactical todo), initial_burial_depth 0.5–0.95 (high emotional weight=bury deeper 0.85–0.95, pure fact=0.5–0.65). Format: {"emotional_weight": number, "conceptual_density": number, "decay_rate": number, "initial_burial_depth": number}`;

const DEFAULT_SCORES: ScoringResult = {
  emotional_weight: 0.5,
  conceptual_density: 0.5,
  decay_rate: 0.05,
  initial_burial_depth: 0.8,
};

export async function scoreEntry(content: string, entryId: string): Promise<ScoringResult> {
  try {
    return await withRetry(async () => {
      const raw = await generate(content, SCORING_SYSTEM);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('JSON parse failure');
      }
      return {
        emotional_weight:   clamp(Number(parsed.emotional_weight),   0,    1   ),
        conceptual_density: clamp(Number(parsed.conceptual_density), 0,    1   ),
        decay_rate:         clamp(Number(parsed.decay_rate),         0.01, 0.20),
        initial_burial_depth: clamp(Number(parsed.initial_burial_depth), 0.5, 0.95),
      };
    }, 2, `score:${entryId}`);
  } catch (err) {
    console.error(`[llm] score failed after retries for entry ${entryId}:`, (err as Error).message);
    return DEFAULT_SCORES;
  }
}

// ── Conflict detection ────────────────────────────────────────────────────────

const CONFLICT_SYSTEM = `You detect contradictions between a new belief and existing ones. Logical conflicts only — not stylistic differences. Return only JSON: { "conflicts": [{ "existing_entry_id": "string", "conflict_summary": "one sentence", "severity": 0-1 }] }. If none: { "conflicts": [] }`;

export async function detectConflicts(
  newContent: string,
  existing: Array<{ id: string; content: string }>,
  entryId: string,
): Promise<ConflictResult> {
  if (existing.length === 0) return { conflicts: [] };

  const existingBlock = existing
    .map((e) => `ID: ${e.id}\nContent: ${e.content}`)
    .join('\n\n');

  const prompt = `New content:\n${newContent}\n\nExisting entries:\n${existingBlock}`;

  try {
    return await withRetry(async () => {
      const raw = await generate(prompt, CONFLICT_SYSTEM);
      try {
        return JSON.parse(raw) as ConflictResult;
      } catch {
        throw new Error('JSON parse failure');
      }
    }, 3, `conflicts:${entryId}`);
  } catch (err) {
    console.error(`[llm] conflict detection failed for entry ${entryId}:`, (err as Error).message);
    return { conflicts: [] };
  }
}

// ── Expansion ─────────────────────────────────────────────────────────────────

const EXPANSION_SYSTEM = `A user flagged a thought worth exploring. Generate exactly three things: 1) a probing question that pushes the idea further (not a restatement), 2) an unexpected conceptual connection to a domain they may not have considered, 3) a stress test — the strongest possible counterargument. Return only JSON: { "probing_question": "string", "unexpected_connection": { "domain": "string", "connection": "string" }, "stress_test": "string" }`;

export async function generateExpansion(content: string, entryId: string): Promise<ExpansionResult> {
  return withRetry(async () => {
    const raw = await generate(content, EXPANSION_SYSTEM);
    try {
      return JSON.parse(raw) as ExpansionResult;
    } catch {
      throw new Error('JSON parse failure');
    }
  }, 3, `expansion:${entryId}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, isNaN(n) ? min : n));
}
