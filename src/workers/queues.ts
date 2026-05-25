import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { ScoreEntryJobData, GenerateExpansionJobData } from '../types/index';

export const QUEUE_NAMES = {
  SCORE_ENTRY:        'score-entry',
  GENERATE_EXPANSION: 'generate-expansion',
  SCHEDULER:          'scheduler',
} as const;

let redis: IORedis | null = null;

export function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    redis.on('error', (err) => console.error('[redis] error:', err.message));
  }
  return redis;
}

let scoreQueue: Queue<ScoreEntryJobData> | null = null;
let expansionQueue: Queue<GenerateExpansionJobData> | null = null;

export function getScoreQueue(): Queue<ScoreEntryJobData> {
  if (!scoreQueue) {
    scoreQueue = new Queue<ScoreEntryJobData>(QUEUE_NAMES.SCORE_ENTRY, {
      connection: getRedis(),
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    });
  }
  return scoreQueue;
}

export function getExpansionQueue(): Queue<GenerateExpansionJobData> {
  if (!expansionQueue) {
    expansionQueue = new Queue<GenerateExpansionJobData>(QUEUE_NAMES.GENERATE_EXPANSION, {
      connection: getRedis(),
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    });
  }
  return expansionQueue;
}
