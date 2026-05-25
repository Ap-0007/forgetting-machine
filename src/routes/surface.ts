import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, transaction } from '../lib/db';
import { getExpansionQueue } from '../workers/queues';
import { saveSubscription, deleteSubscription } from '../notifications/webpush';
import { UserReaction, SurfaceNextResponse, GraveyardStats, ReactionRequest } from '../types/index';

export const surfaceRouter = Router();

type AuthReq = Request & { auth?: { userId: string } };

// ── GET /api/surface/next ─────────────────────────────────────────────────────

surfaceRouter.get('/next', async (req: AuthReq, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  const userId    = req.auth?.userId;

  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId } });
    return;
  }

  try {
    const row = await queryOne<{
      surface_event_id: string;
      entry_id: string;
      raw_content: string;
      created_at: Date;
      source_type: string;
      trigger_reason: string;
    }>(
      `SELECT se.id as surface_event_id, e.id as entry_id, e.raw_content,
              e.created_at, e.source_type, se.trigger_reason
         FROM surface_events se
         JOIN entries e ON se.entry_id = e.id
        WHERE se.user_id = $1
          AND se.user_reaction IS NULL
        ORDER BY se.surfaced_at ASC
        LIMIT 1`,
      [userId],
    );

    if (!row) {
      res.status(404).json({ error: { code: 'NO_SURFACE_AVAILABLE', message: 'Nothing to surface right now', request_id: requestId } });
      return;
    }

    const daysSince = Math.floor((Date.now() - new Date(row.created_at).getTime()) / 86_400_000);
    const response: SurfaceNextResponse = {
      surface_event_id: row.surface_event_id,
      entry: {
        id: row.entry_id,
        content: row.raw_content,
        created_at: new Date(row.created_at).toISOString(),
        days_since_written: daysSince,
        source_type: row.source_type as SurfaceNextResponse['entry']['source_type'],
      },
      trigger_reason: row.trigger_reason as SurfaceNextResponse['trigger_reason'],
    };

    // For CONFLICT_DETECTED surface events, find the conflicting entry
    if (row.trigger_reason === 'CONFLICT_DETECTED') {
      const conflict = await queryOne<{ entry_id: string; raw_content: string }>(
        `SELECT se2.entry_id, e2.raw_content
           FROM surface_events se2
           JOIN entries e2 ON se2.entry_id = e2.id
          WHERE se2.user_id = $1
            AND se2.trigger_reason = 'CONFLICT_DETECTED'
            AND se2.entry_id != $2
            AND se2.user_reaction IS NULL
          ORDER BY se2.surfaced_at DESC
          LIMIT 1`,
        [userId, row.entry_id],
      );
      if (conflict) {
        response.conflicting_entry = { id: conflict.entry_id, content: conflict.raw_content };
      }
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/surface/:id/react ───────────────────────────────────────────────

surfaceRouter.post('/:id/react', async (req: AuthReq, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  const userId    = req.auth?.userId;

  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId } });
    return;
  }

  const { reaction, time_to_react_ms } = req.body as ReactionRequest;

  const validReactions: UserReaction[] = ['dismissed', 'saved', 'expanded', 'ignored'];
  if (!validReactions.includes(reaction)) {
    res.status(400).json({ error: { code: 'INVALID_REACTION', message: `reaction must be one of: ${validReactions.join(', ')}`, request_id: requestId } });
    return;
  }

  try {
    const event = await queryOne<{
      id: string;
      entry_id: string;
      user_reaction: UserReaction | null;
    }>(
      `SELECT id, entry_id, user_reaction
         FROM surface_events
        WHERE id = $1`,
      [req.params.id],
    );

    if (!event) {
      res.status(404).json({ error: { code: 'EVENT_NOT_FOUND', message: 'Surface event not found', request_id: requestId } });
      return;
    }

    // Verify ownership via entry
    const entryOwner = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM entries WHERE id = $1',
      [event.entry_id],
    );
    if (entryOwner?.user_id !== userId) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'This event does not belong to you', request_id: requestId } });
      return;
    }

    if (event.user_reaction !== null) {
      res.status(409).json({ error: { code: 'ALREADY_REACTED', message: 'Already reacted to this event', request_id: requestId } });
      return;
    }

    const scores = await queryOne<{
      emotional_weight: number;
      decay_rate: number;
      surface_count: number;
      current_burial_depth: number;
    }>(
      `SELECT emotional_weight, decay_rate, surface_count, current_burial_depth
         FROM entry_scores WHERE entry_id = $1`,
      [event.entry_id],
    );

    if (!scores) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Score record missing', request_id: requestId } });
      return;
    }

    const baseIntervals = [3, 7, 14, 30, 60, 120, 240];
    const modifiers: Record<UserReaction, number> = { saved: 0.5, dismissed: 2, expanded: 0.3, ignored: 3 };
    const idx         = Math.min(scores.surface_count, 6);
    const modifier    = modifiers[reaction];
    const decayFactor = Math.max(0.1, 1 - scores.decay_rate * scores.surface_count);
    const days        = Math.max(1, baseIntervals[idx] * modifier * decayFactor);
    const nextSurface = new Date(Date.now() + days * 86_400_000);

    const newDepth = reaction === 'expanded' || reaction === 'saved'
      ? Math.max(0, scores.current_burial_depth - 0.05)
      : Math.min(1, scores.current_burial_depth + 0.05);

    await transaction(async (client) => {
      await client.query(
        `UPDATE surface_events
            SET user_reaction = $1, time_to_react_ms = $2
          WHERE id = $3`,
        [reaction, time_to_react_ms ?? null, event.id],
      );
      await client.query(
        `UPDATE entry_scores
            SET last_reaction    = $1,
                last_reaction_at = now(),
                next_surface_at  = $2,
                current_burial_depth = $3
          WHERE entry_id = $4`,
        [reaction, nextSurface, newDepth, event.entry_id],
      );
    });

    // If expanded, enqueue expansion job and return full content
    if (reaction === 'expanded') {
      await getExpansionQueue().add('expand', {
        entry_id: event.entry_id,
        user_id: userId,
        surface_event_id: event.id,
      });

      const entry = await queryOne<{ raw_content: string }>(
        'SELECT raw_content FROM entries WHERE id = $1',
        [event.entry_id],
      );

      res.json({
        next_surface_at: nextSurface.toISOString(),
        burial_depth: newDepth,
        full_content: entry?.raw_content,
      });
      return;
    }

    res.json({ next_surface_at: nextSurface.toISOString(), burial_depth: newDepth });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/graveyard/stats ──────────────────────────────────────────────────

surfaceRouter.get('/graveyard/stats', async (req: AuthReq, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  const userId    = req.auth?.userId;

  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId } });
    return;
  }

  try {
    const [totalRow, deepestRow, avgRow] = await Promise.all([
      queryOne<{ count: string }>(
        'SELECT COUNT(*) as count FROM entries WHERE user_id = $1',
        [userId],
      ),
      queryOne<{ id: string; raw_content: string; created_at: Date; burial_depth: number }>(
        `SELECT e.id, e.raw_content, e.created_at, es.current_burial_depth as burial_depth
           FROM entries e
           JOIN entry_scores es ON e.id = es.entry_id
          WHERE e.user_id = $1
          ORDER BY es.current_burial_depth DESC
          LIMIT 1`,
        [userId],
      ),
      queryOne<{ avg: string }>(
        `SELECT AVG(es.current_burial_depth) as avg
           FROM entry_scores es
           JOIN entries e ON es.entry_id = e.id
          WHERE e.user_id = $1`,
        [userId],
      ),
    ]);

    const avgDepth = parseFloat(avgRow?.avg ?? '0') || 0;
    const stats: GraveyardStats = {
      total_buried: parseInt(totalRow?.count ?? '0'),
      deepest_entry: deepestRow
        ? {
            id: deepestRow.id,
            first_words: deepestRow.raw_content.split(/\s+/).slice(0, 6).join(' '),
            age_days: Math.floor((Date.now() - new Date(deepestRow.created_at).getTime()) / 86_400_000),
            burial_depth: deepestRow.burial_depth,
          }
        : null,
      average_burial_depth: avgDepth,
      average_depth_meters: Math.round(avgDepth * 1000),
    };

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/notifications/subscribe ────────────────────────────────────────

surfaceRouter.post('/notifications/subscribe', async (req: AuthReq, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  const userId    = req.auth?.userId;

  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId } });
    return;
  }

  const { endpoint, keys, timezone } = req.body as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    timezone: string;
  };

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: { code: 'INVALID_SUBSCRIPTION', message: 'endpoint and keys.p256dh/auth are required', request_id: requestId } });
    return;
  }

  try {
    await saveSubscription(userId, endpoint, keys.p256dh, keys.auth, timezone || 'UTC');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/notifications/unsubscribe ────────────────────────────────────

surfaceRouter.delete('/notifications/unsubscribe', async (req: AuthReq, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  const userId    = req.auth?.userId;

  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId } });
    return;
  }

  const { endpoint } = req.body as { endpoint: string };
  if (!endpoint) {
    res.status(400).json({ error: { code: 'MISSING_ENDPOINT', message: 'endpoint is required', request_id: requestId } });
    return;
  }

  try {
    await deleteSubscription(userId, endpoint);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/graveyard/excavate ──────────────────────────────────────────────

surfaceRouter.post('/graveyard/excavate', async (req: AuthReq, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  const userId    = req.auth?.userId;

  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId } });
    return;
  }

  const { confirm } = req.body as { confirm: string };
  if (confirm !== 'EXCAVATE') {
    res.status(400).json({ error: { code: 'CONFIRMATION_REQUIRED', message: 'Send { confirm: "EXCAVATE" } to proceed', request_id: requestId } });
    return;
  }

  try {
    // Spread all entries to surface over the next 30 days
    await query(
      `UPDATE entry_scores es
          SET current_burial_depth = 0,
              next_surface_at      = now() + (random() * interval '30 days')
         FROM entries e
        WHERE es.entry_id = e.id
          AND e.user_id   = $1`,
      [userId],
    );

    res.json({ ok: true, message: 'All entries scheduled to surface over the next 30 days' });
  } catch (err) {
    next(err);
  }
});
