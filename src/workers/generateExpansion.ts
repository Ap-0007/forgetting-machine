import { Worker, Job } from 'bullmq';
import { query, queryOne } from '../lib/db';
import { generateExpansion as expandLLM } from '../lib/llm';
import { sendPushToUser } from '../notifications/webpush';
import { GenerateExpansionJobData } from '../types/index';
import { getRedis, QUEUE_NAMES } from './queues';

export function createExpansionWorker(): Worker<GenerateExpansionJobData> {
  return new Worker<GenerateExpansionJobData>(
    QUEUE_NAMES.GENERATE_EXPANSION,
    async (job: Job<GenerateExpansionJobData>) => {
      const { entry_id, user_id, surface_event_id } = job.data;

      const entry = await queryOne<{ raw_content: string }>(
        'SELECT raw_content FROM entries WHERE id = $1 AND user_id = $2',
        [entry_id, user_id],
      );
      if (!entry) {
        console.warn(`[expansion-worker] entry ${entry_id} not found`);
        return;
      }

      let expansion;
      try {
        expansion = await expandLLM(entry.raw_content, entry_id);
      } catch (err) {
        console.error(`[expansion-worker] LLM failed for ${entry_id}:`, (err as Error).message);
        throw err; // BullMQ will retry per defaultJobOptions
      }

      await query(
        `INSERT INTO entry_expansions
           (entry_id, probing_question, unexpected_connection_domain,
            unexpected_connection_text, stress_test)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [
          entry_id,
          expansion.probing_question,
          expansion.unexpected_connection.domain,
          expansion.unexpected_connection.connection,
          expansion.stress_test,
        ],
      );

      // Follow-up push notification
      await sendPushToUser(user_id, {
        title: 'Your thought just got deeper',
        body: expansion.probing_question.length > 120
          ? expansion.probing_question.slice(0, 117) + '…'
          : expansion.probing_question,
        data: { surface_event_id, entry_id, type: 'expansion' },
      }).catch(err => console.error('[expansion-worker] push failed:', err));

      console.log(`[expansion-worker] expansion stored for entry ${entry_id}`);
    },
    {
      connection: getRedis(),
      concurrency: 3,
    },
  );
}
