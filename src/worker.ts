import 'dotenv/config';
import { createScoreWorker } from './workers/scoreEntry';
import { createSchedulerWorker, setupRepeatableJob } from './workers/scheduler';
import { createExpansionWorker } from './workers/generateExpansion';

async function main(): Promise<void> {
  const scoreWorker     = createScoreWorker();
  const schedulerWorker = createSchedulerWorker();
  const expansionWorker = createExpansionWorker();

  // Register the 15-minute repeatable scheduler tick
  await setupRepeatableJob();

  console.log('[worker] all workers started');

  const shutdown = async () => {
    console.log('[worker] shutting down…');
    await Promise.all([
      scoreWorker.close(),
      schedulerWorker.close(),
      expansionWorker.close(),
    ]);
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);
}

main().catch(err => {
  console.error('[worker] fatal startup error:', err);
  process.exit(1);
});
