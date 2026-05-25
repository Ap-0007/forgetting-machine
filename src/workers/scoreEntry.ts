import { Worker, Job } from 'bullmq';
import { query, queryOne } from '../lib/db';
import { scoreEntry as scoreLLM, detectConflicts, generateEmbedding } from '../lib/llm';
import { ScoreEntryJobData } from '../types/index';
import { getRedis, QUEUE_NAMES } from './queues';

// Linear interpolation: depth 0.5 → 3 days, depth 0.95 → 180 days
function burialDepthToDays(depth: number): number {
  const clamped = Math.max(0.5, Math.min(0.95, depth));
  return 3 + ((clamped - 0.5) / (0.95 - 0.5)) * (180 - 3);
}

function vectorToSql(v: number[]): string {
  return `[${v.join(',')}]`;
}

export function createScoreWorker(): Worker<ScoreEntryJobData> {
  return new Worker<ScoreEntryJobData>(
    QUEUE_NAMES.SCORE_ENTRY,
    async (job: Job<ScoreEntryJobData>) => {
      const { entry_id, user_id } = job.data;

      const entry = await queryOne<{ raw_content: string }>(
        'SELECT raw_content FROM entries WHERE id = $1',
        [entry_id],
      );
      if (!entry) {
        console.warn(`[score-worker] entry ${entry_id} not found — skipping`);
        return;
      }

      // Generate embedding
      let embedding: number[];
      try {
        embedding = await generateEmbedding(entry.raw_content);
        await query(
          `UPDATE entries SET embedding = $1::vector WHERE id = $2`,
          [vectorToSql(embedding), entry_id],
        );
      } catch (err) {
        console.error(`[score-worker] embedding failed for ${entry_id}:`, (err as Error).message);
        // continue without embedding — scoring still runs
        embedding = [];
      }

      // Call 1 — Scoring
      const scores = await scoreLLM(entry.raw_content, entry_id);

      // Call 2 — Conflict detection (top 5 by cosine similarity, burial_depth < 0.5)
      let similarEntries: Array<{ id: string; content: string }> = [];
      if (embedding.length > 0) {
        const similar = await query<{ id: string; raw_content: string }>(
          `SELECT e.id, e.raw_content
             FROM entries e
             JOIN entry_scores es ON e.id = es.entry_id
            WHERE e.user_id = $1
              AND e.id      != $2
              AND es.current_burial_depth < 0.5
            ORDER BY e.embedding <=> $3::vector
            LIMIT 5`,
          [user_id, entry_id, vectorToSql(embedding)],
        );
        similarEntries = similar.map(r => ({ id: r.id, content: r.raw_content }));
      }

      const conflictResult = await detectConflicts(entry.raw_content, similarEntries, entry_id);

      // Update entry_scores with LLM results
      const days        = burialDepthToDays(scores.initial_burial_depth);
      const nextSurface = new Date(Date.now() + days * 86_400_000);

      await query(
        `UPDATE entry_scores
            SET emotional_weight     = $1,
                conceptual_density   = $2,
                decay_rate           = $3,
                current_burial_depth = $4,
                next_surface_at      = $5
          WHERE entry_id = $6`,
        [
          scores.emotional_weight,
          scores.conceptual_density,
          scores.decay_rate,
          scores.initial_burial_depth,
          nextSurface,
          entry_id,
        ],
      );

      // For each high-severity conflict, create a surface event for the existing entry
      for (const c of conflictResult.conflicts) {
        if (c.severity > 0.7) {
          await query(
            `INSERT INTO surface_events (entry_id, user_id, trigger_reason)
             SELECT $1, $2, 'CONFLICT_DETECTED'
              WHERE EXISTS (SELECT 1 FROM entries WHERE id = $1 AND user_id = $2)`,
            [c.existing_entry_id, user_id],
          );
          // Bring conflicting entry to the surface immediately
          await query(
            `UPDATE entry_scores
                SET next_surface_at      = now(),
                    current_burial_depth = GREATEST(current_burial_depth - 0.3, 0)
              WHERE entry_id = $1`,
            [c.existing_entry_id],
          );
          console.log(`[score-worker] conflict (severity ${c.severity.toFixed(2)}) between ${entry_id} and ${c.existing_entry_id}`);
        }
      }

      console.log(`[score-worker] scored ${entry_id}: depth=${scores.initial_burial_depth.toFixed(2)} next=${nextSurface.toISOString()}`);
    },
    {
      connection: getRedis(),
      concurrency: 5,
    },
  );
}
