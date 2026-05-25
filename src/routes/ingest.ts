import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, transaction } from '../lib/db';
import { getScoreQueue } from '../workers/queues';
import { SourceType, IngestResponse } from '../types/index';

export const ingestRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── PII stripping ─────────────────────────────────────────────────────────────
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(\+?\d{1,3}[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g;

function stripPII(text: string): string {
  return text.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]');
}

// ── Tokenisation (approx 4 chars/token) ──────────────────────────────────────
const MAX_TOKEN_CHARS = 500 * 4; // 500 tokens × 4 chars

function chunkBySentence(text: string): string[] {
  if (text.length <= MAX_TOKEN_CHARS) return [text];

  const chunks: string[] = [];
  let current = '';

  // Split on sentence-ending punctuation followed by whitespace
  const sentences = text.split(/(?<=[.!?\n])\s+/);

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > MAX_TOKEN_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function randomBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

// ── Rate-limit helpers ────────────────────────────────────────────────────────

async function checkRateLimits(userId: string): Promise<string | null> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const todayCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM entries WHERE user_id = $1 AND created_at >= $2`,
    [userId, dayStart],
  );
  if (parseInt(todayCount?.count ?? '0') >= parseInt(process.env.MAX_INGESTS_PER_DAY || '100')) {
    return 'DAILY_LIMIT_EXCEEDED';
  }

  const totalCount = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM entries WHERE user_id = $1',
    [userId],
  );
  if (parseInt(totalCount?.count ?? '0') >= parseInt(process.env.MAX_ENTRIES_FREE_TIER || '500')) {
    return 'FREE_TIER_LIMIT';
  }

  return null;
}

// ── POST /api/ingest ──────────────────────────────────────────────────────────

ingestRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  const userId    = (req as Request & { auth?: { userId: string } }).auth?.userId;

  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId } });
    return;
  }

  const { content, source_type = 'NOTE', metadata } = req.body as {
    content: string;
    source_type?: SourceType;
    metadata?: Record<string, unknown>;
  };

  // Validation
  if (!content || typeof content !== 'string') {
    res.status(400).json({ error: { code: 'MISSING_CONTENT', message: 'content is required', request_id: requestId } });
    return;
  }
  if (content.length > 50_000) {
    res.status(400).json({ error: { code: 'CONTENT_TOO_LONG', message: 'content must be under 50,000 characters', request_id: requestId } });
    return;
  }
  if (wordCount(content) < 10) {
    res.status(400).json({ error: { code: 'CONTENT_TOO_SHORT', message: 'content must be at least 10 words', request_id: requestId } });
    return;
  }

  const validSources: SourceType[] = ['NOTE','PASTE','BOOK_HIGHLIGHT','VOICE_TRANSCRIPT','URL_IMPORT'];
  if (!validSources.includes(source_type)) {
    res.status(400).json({ error: { code: 'INVALID_SOURCE_TYPE', message: `source_type must be one of: ${validSources.join(', ')}`, request_id: requestId } });
    return;
  }

  const rateLimitError = await checkRateLimits(userId);
  if (rateLimitError) {
    res.status(429).json({ error: { code: rateLimitError, message: 'Rate limit exceeded', request_id: requestId } });
    return;
  }

  const cleaned = stripPII(content);
  const chunks  = chunkBySentence(cleaned);

  const firstEntryId = uuidv4();
  const daysOut      = randomBetween(3, 10);
  const firstSurface = new Date(Date.now() + daysOut * 86_400_000);

  try {
    await transaction(async (client) => {
      for (let i = 0; i < chunks.length; i++) {
        const entryId    = i === 0 ? firstEntryId : uuidv4();
        const chunkDays  = randomBetween(3, 10);
        const surfaceAt  = i === 0 ? firstSurface : new Date(Date.now() + chunkDays * 86_400_000);

        await client.query(
          `INSERT INTO entries (id, user_id, raw_content, source_type, word_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [entryId, userId, chunks[i], source_type, wordCount(chunks[i])],
        );

        await client.query(
          `INSERT INTO entry_scores (entry_id, user_id, next_surface_at)
           VALUES ($1, $2, $3)`,
          [entryId, userId, surfaceAt],
        );

        await getScoreQueue().add('score', { entry_id: entryId, user_id: userId });
      }
    });

    // Add context signal for ingestion
    await query(
      `INSERT INTO context_signals (user_id, signal_type, signal_value, expires_at)
       VALUES ($1, 'RECENT_ENTRY', $2, now() + interval '24 hours')`,
      [userId, cleaned.slice(0, 500)],
    );

    const response: IngestResponse = {
      entry_id: firstEntryId,
      chunk_count: chunks.length,
      estimated_first_surface: firstSurface.toISOString(),
    };
    res.status(202).json(response);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/ingest/bulk ────────────────────────────────────────────────────

ingestRouter.post('/bulk', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  const userId    = (req as Request & { auth?: { userId: string } }).auth?.userId;

  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId } });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: { code: 'NO_FILE', message: 'multipart file required', request_id: requestId } });
    return;
  }

  const fileContent = req.file.buffer.toString('utf8');
  const ext = req.file.originalname.toLowerCase();
  let items: string[] = [];

  if (ext.endsWith('.json')) {
    try {
      const parsed = JSON.parse(fileContent);
      if (!Array.isArray(parsed)) throw new Error('JSON must be an array');
      items = parsed.map((x: unknown) =>
        typeof x === 'string' ? x : (x as Record<string, unknown>).content?.toString() ?? '',
      ).filter(Boolean);
    } catch (err) {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: (err as Error).message, request_id: requestId } });
      return;
    }
  } else if (ext.endsWith('.md')) {
    // Split on --- delimiters or double newlines between H1/H2 sections
    items = fileContent
      .split(/\n---+\n|\n#{1,2} /)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  } else {
    res.status(400).json({ error: { code: 'UNSUPPORTED_FILE_TYPE', message: 'Only .json and .md files supported', request_id: requestId } });
    return;
  }

  if (items.length === 0) {
    res.status(400).json({ error: { code: 'EMPTY_FILE', message: 'No entries found in file', request_id: requestId } });
    return;
  }

  if (items.length > 500) {
    res.status(400).json({ error: { code: 'TOO_MANY_ENTRIES', message: 'Max 500 entries per bulk import', request_id: requestId } });
    return;
  }

  // Create job record
  const jobRow = await queryOne<{ id: string }>(
    `INSERT INTO bulk_jobs (user_id, total) VALUES ($1, $2) RETURNING id`,
    [userId, items.length],
  );
  const jobId = jobRow!.id;

  // Process in background (batches of 50)
  processBulkJob(jobId, userId, items).catch(err =>
    console.error(`[bulk] job ${jobId} failed:`, err),
  );

  res.status(202).json({ job_id: jobId });
});

async function processBulkJob(jobId: string, userId: string, items: string[]): Promise<void> {
  await query(`UPDATE bulk_jobs SET status = 'processing' WHERE id = $1`, [jobId]);

  const errors: Array<{ index: number; error: string }> = [];
  let processed = 0;

  for (let batchStart = 0; batchStart < items.length; batchStart += 50) {
    const batch = items.slice(batchStart, batchStart + 50);

    for (let i = 0; i < batch.length; i++) {
      const globalIdx = batchStart + i;
      const raw = batch[i];

      if (wordCount(raw) < 10) {
        errors.push({ index: globalIdx, error: 'Too short (< 10 words)' });
        continue;
      }

      try {
        const cleaned  = stripPII(raw);
        const chunks   = chunkBySentence(cleaned);
        const entryId  = uuidv4();
        const surfaceAt = new Date(Date.now() + randomBetween(3, 10) * 86_400_000);

        await transaction(async (client) => {
          for (let ci = 0; ci < chunks.length; ci++) {
            const cid = ci === 0 ? entryId : uuidv4();
            await client.query(
              `INSERT INTO entries (id, user_id, raw_content, source_type, word_count)
               VALUES ($1, $2, $3, 'NOTE', $4)`,
              [cid, userId, chunks[ci], wordCount(chunks[ci])],
            );
            await client.query(
              `INSERT INTO entry_scores (entry_id, user_id, next_surface_at)
               VALUES ($1, $2, $3)`,
              [cid, userId, ci === 0 ? surfaceAt : new Date(Date.now() + randomBetween(3, 10) * 86_400_000)],
            );
            await getScoreQueue().add('score', { entry_id: cid, user_id: userId });
          }
        });
        processed++;
      } catch (err) {
        errors.push({ index: globalIdx, error: (err as Error).message });
      }
    }

    await query(
      `UPDATE bulk_jobs SET processed = $1, errors = $2, updated_at = now() WHERE id = $3`,
      [processed, JSON.stringify(errors), jobId],
    );
  }

  const finalStatus = errors.length === items.length ? 'failed' : 'completed';
  await query(
    `UPDATE bulk_jobs SET status = $1, updated_at = now() WHERE id = $2`,
    [finalStatus, jobId],
  );
}

// ── GET /api/jobs/:id ─────────────────────────────────────────────────────────

ingestRouter.get('/jobs/:id', async (req: Request, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  const userId    = (req as Request & { auth?: { userId: string } }).auth?.userId;

  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId } });
    return;
  }

  try {
    const job = await queryOne<{ id: string; status: string; processed: number; total: number; errors: unknown[] }>(
      'SELECT id, status, processed, total, errors FROM bulk_jobs WHERE id = $1 AND user_id = $2',
      [req.params.id, userId],
    );

    if (!job) {
      res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job not found', request_id: requestId } });
      return;
    }

    res.json({ status: job.status, processed: job.processed, total: job.total, errors: job.errors });
  } catch (err) {
    next(err);
  }
});
