import { createSqsQueues } from '@vichaar/queue';

type QueueConfig = Parameters<typeof createSqsQueues>[0];

export async function ensureLocalDevQueues(config: QueueConfig): Promise<void> {
  const queues = createSqsQueues(config);
  try {
    await queues.createLocalQueues();
  } finally {
    queues.close();
  }
}
