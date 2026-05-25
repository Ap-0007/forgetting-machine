import { Worker, Queue, Job } from 'bullmq';
import { query, queryOne } from '../lib/db';
import { generateEmbedding } from '../lib/llm';
import { sendPushToUser } from '../notifications/webpush';
import { getRedis, QUEUE_NAMES } from './queues';
import { TriggerReason, UserReaction } from '../types/index';

const REDIS_KEY_CTX_EMBED = (userId: string) => `ctx_embed:${userId}`;

// Spaced repetition interval in days
function spacedRepetitionInterval(
  surfaceCount: number,
  reaction: UserReaction | null,
  decayRate: number,
): number {
  const base = [3, 7, 14, 30, 60, 120, 240][Math.min(surfaceCount, 6)];
  const modifiers: Record<UserReaction, number> = {
    saved: 0.5, dismissed: 2, expanded: 0.3, ignored: 3,
  };
  const modifier    = reaction ? modifiers[reaction] : 1;
  const decayFactor = Math.max(0.1, 1 - decayRate * surfaceCount);
  return Math.max(1, base * modifier * decayFactor);
}

function vectorToSql(v: number[]): string {
  return `[${v.join(',')}]`;
}

async function getContextEmbedding(userId: string): Promise<number[] | null> {
  const redis = getRedis();
  const cached = await redis.get(REDIS_KEY_CTX_EMBED(userId));
  if (cached) return JSON.parse(cached) as number[];

  // Fetch active context signals
  const signals = await query<{ signal_value: string }>(
    `SELECT signal_value FROM context_signals
      WHERE user_id = $1 AND expires_at > now()
      ORDER BY expires_at DESC LIMIT 20`,
    [userId],
  );
  if (signals.length === 0) return null;

  const combined = signals.map(s => s.signal_value).join(' ');
  try {
    const embedding = await generateEmbedding(combined);
    await redis.setex(REDIS_KEY_CTX_EMBED(userId), 3600, JSON.stringify(embedding));
    return embedding;
  } catch {
    return null;
  }
}

async function runScheduledSurfacing(): Promise<void> {
  // Find distinct users with surfaceable entries
  const users = await query<{ user_id: string }>(
    `SELECT DISTINCT es.user_id
       FROM entry_scores es
       JOIN entries e ON e.id = es.entry_id
      WHERE es.next_surface_at <= now()
        AND es.current_burial_depth < 0.3
        AND NOT EXISTS (
          SELECT 1 FROM burial_overrides bo
           WHERE bo.entry_id = es.entry_id
             AND bo.override_type = 'force_bury'
             AND bo.expires_at > now()
        )
      LIMIT 100`,
  );

  for (const { user_id } of users) {
    await surfaceForUser(user_id);
  }

  // Random Deep Pull — once per day per user
  await randomDeepPull();
}

async function surfaceForUser(userId: string): Promise<void> {
  // Check daily notification cap
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const notifCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM surface_events
      WHERE user_id = $1 AND surfaced_at >= $2`,
    [userId, dayStart],
  );
  if (parseInt(notifCount?.count ?? '0') >= 3) return;

  const candidates = await query<{
    entry_id: string;
    raw_content: string;
    created_at: Date;
    current_burial_depth: number;
    emotional_weight: number;
    decay_rate: number;
    surface_count: number;
    last_reaction: UserReaction | null;
    embedding: string | null;
  }>(
    `SELECT e.id as entry_id, e.raw_content, e.embedding, e.created_at,
            es.current_burial_depth, es.emotional_weight, es.decay_rate,
            es.surface_count, es.last_reaction
       FROM entry_scores es
       JOIN entries e ON e.id = es.entry_id
      WHERE es.user_id = $1
        AND es.next_surface_at <= now()
        AND es.current_burial_depth < 0.3
        AND NOT EXISTS (
          SELECT 1 FROM burial_overrides bo
           WHERE bo.entry_id = es.entry_id
             AND bo.override_type = 'force_bury'
             AND bo.expires_at > now()
        )
      LIMIT 20`,
    [userId],
  );

  if (candidates.length === 0) return;

  const contextEmbed = await getContextEmbedding(userId);

  // Score each candidate
  const scored = candidates.map(c => {
    let similarity = 0;
    if (contextEmbed && c.embedding) {
      const vec = JSON.parse(c.embedding) as number[];
      similarity = cosineSimilarity(contextEmbed, vec);
    }
    const finalScore =
      similarity * 0.4 +
      (1 - c.current_burial_depth) * 0.3 +
      c.emotional_weight * 0.3;
    return { ...c, finalScore };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);
  const top3 = scored.slice(0, 3);

  for (const entry of top3) {
    // Insert surface event
    const event = await queryOne<{ id: string }>(
      `INSERT INTO surface_events (entry_id, user_id, trigger_reason)
       VALUES ($1, $2, $3) RETURNING id`,
      [entry.entry_id, userId, contextEmbed ? 'CONTEXT_MATCH' : 'SCHEDULED'],
    );

    // Re-bury
    const newDepth = Math.min(1, entry.current_burial_depth + 0.1);
    const days = spacedRepetitionInterval(
      entry.surface_count,
      entry.last_reaction,
      entry.decay_rate,
    );
    const nextSurface = new Date(Date.now() + days * 86_400_000);

    await query(
      `UPDATE entry_scores
          SET current_burial_depth = $1,
              next_surface_at      = $2,
              last_surfaced_at     = now(),
              surface_count        = surface_count + 1
        WHERE entry_id = $3`,
      [newDepth, nextSurface, entry.entry_id],
    );

    // Send push notification
    const triggerReason: TriggerReason = contextEmbed ? 'CONTEXT_MATCH' : 'SCHEDULED';
    const ageDays = Math.floor((Date.now() - new Date(entry.created_at).getTime()) / 86_400_000);
    const title = notificationTitle(triggerReason, ageDays);
    const body  = truncateAtWord(entry.raw_content, 120);

    await sendPushToUser(userId, { title, body, data: { surface_event_id: event?.id } }).catch(
      err => console.error('[scheduler] push failed:', err),
    );
  }
}

async function randomDeepPull(): Promise<void> {
  // Find users who haven't received a random deep pull today
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const users = await query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM entry_scores
      WHERE current_burial_depth > 0.8
        AND user_id NOT IN (
          SELECT DISTINCT user_id FROM surface_events
           WHERE trigger_reason = 'RANDOM_DEEP_PULL'
             AND surfaced_at >= $1
        )`,
    [dayStart],
  );

  for (const { user_id } of users) {
    // Weight by emotional_weight — higher emotional weight is more likely to surface
    const entry = await queryOne<{ entry_id: string; raw_content: string }>(
      `SELECT es.entry_id, e.raw_content
         FROM entry_scores es
         JOIN entries e ON e.id = es.entry_id
        WHERE es.user_id = $1
          AND es.current_burial_depth > 0.8
        ORDER BY es.emotional_weight * random() DESC
        LIMIT 1`,
      [user_id],
    );
    if (!entry) continue;

    await queryOne<{ id: string }>(
      `INSERT INTO surface_events (entry_id, user_id, trigger_reason)
       VALUES ($1, $2, 'RANDOM_DEEP_PULL') RETURNING id`,
      [entry.entry_id, user_id],
    );

    const title = 'Pulled from the deep';
    const body  = truncateAtWord(entry.raw_content, 120);
    await sendPushToUser(user_id, { title, body, data: { surface_event_id: entry.entry_id } }).catch(
      err => console.error('[deep-pull] push failed:', err),
    );
  }
}

function notificationTitle(reason: TriggerReason, days: number): string {
  switch (reason) {
    case 'SCHEDULED':       return `Something you wrote ${days} day${days === 1 ? '' : 's'} ago`;
    case 'CONTEXT_MATCH':   return 'This connects to what you\'re thinking about';
    case 'CONFLICT_DETECTED': return 'You used to believe something different';
    case 'RANDOM_DEEP_PULL': return 'Pulled from the deep';
  }
}

function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > 0 ? truncated.slice(0, lastSpace) + '…' : truncated + '…';
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Worker & repeatable job setup ────────────────────────────────────────────

export function createSchedulerWorker(): Worker {
  return new Worker(
    QUEUE_NAMES.SCHEDULER,
    async (_job: Job) => {
      await runScheduledSurfacing();
    },
    { connection: getRedis(), concurrency: 1 },
  );
}

export async function setupRepeatableJob(): Promise<void> {
  const schedulerQueue = new Queue(QUEUE_NAMES.SCHEDULER, { connection: getRedis() });
  await schedulerQueue.add(
    'tick',
    {},
    { repeat: { every: 15 * 60 * 1000 }, jobId: 'scheduler-tick' },
  );
  console.log('[scheduler] repeatable job registered (every 15 min)');
}
