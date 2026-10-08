import { Queue, Worker, Job, ConnectionOptions } from 'bullmq';
import { FreshdeskService } from './freshdesk';

export const getRedisConnectionOptions = (): ConnectionOptions => {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    const normalizedUrl = redisUrl.startsWith('redis://') && redisUrl.includes('upstash.io')
      ? redisUrl.replace(/^redis:\/\//, 'rediss://')
      : redisUrl;

    const url = new URL(normalizedUrl);
    const isTls = normalizedUrl.startsWith('rediss://');

    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || 'default',
      password: url.password || undefined,
      tls: isTls ? { rejectUnauthorized: false } : undefined,
      maxRetriesPerRequest: null,
    };
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
  };
};

export const redisConnection = getRedisConnectionOptions();

export const QUEUE_NAME = 'freshdesk-contact-cleanup';

// BullMQ Queue instance
export const contactCleanupQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
});

const freshdeskService = new FreshdeskService();
const BATCH_SIZE = 25; // 25 contacts per job = ~6-8s per job, preventing any timeout issues

// Worker to process fetch & deletion jobs in small batches
export const initCleanupWorker = () => {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      // 1. Master Job: Fetch all contact IDs and split into batch jobs
      if (job.name === 'START_CLEANUP') {
        console.log(`\n🚀 [Worker] Starting Master Job ${job.id}: Fetching all contacts...`);
        const contactIds = await freshdeskService.getAllContactIds();

        if (contactIds.length === 0) {
          console.log('ℹ️ [Worker] No contacts found to delete.');
          return { totalFound: 0, totalBatches: 0 };
        }

        const batches: { name: string; data: { batchIndex: number; totalBatches: number; contactIds: number[] } }[] = [];
        const totalBatches = Math.ceil(contactIds.length / BATCH_SIZE);

        for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
          const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
          const chunk = contactIds.slice(i, i + BATCH_SIZE);
          batches.push({
            name: 'DELETE_BATCH',
            data: {
              batchIndex,
              totalBatches,
              contactIds: chunk,
            },
          });
        }

        console.log(`📦 [Worker] Enqueuing ${batches.length} batch jobs (${BATCH_SIZE} contacts per job)...`);
        await contactCleanupQueue.addBulk(batches);

        console.log(`✅ [Worker] Master Job completed! ${batches.length} batch jobs added to queue.`);
        return { totalFound: contactIds.length, totalBatches };
      }

      // 2. Batch Job: Delete a small chunk of contacts (takes ~5-8s per job)
      if (job.name === 'DELETE_BATCH') {
        const { batchIndex, totalBatches, contactIds } = job.data as {
          batchIndex: number;
          totalBatches: number;
          contactIds: number[];
        };

        console.log(`\n▶️ [Worker] Processing Batch [${batchIndex}/${totalBatches}] with ${contactIds.length} contacts...`);
        let deleted = 0;
        let failed = 0;

        for (let i = 0; i < contactIds.length; i++) {
          const id = contactIds[i];
          const success = await freshdeskService.hardDeleteContact(id);

          if (success) {
            deleted++;
            console.log(`   [Batch ${batchIndex}/${totalBatches}] [${i + 1}/${contactIds.length}] ✅ Deleted ID: ${id}`);
          } else {
            failed++;
            console.log(`   [Batch ${batchIndex}/${totalBatches}] [${i + 1}/${contactIds.length}] ❌ Failed ID: ${id}`);
          }

          // Small delay between deletes
          await new Promise((resolve) => setTimeout(resolve, Number(process.env.DELETE_DELAY_MS || 250)));
        }

        console.log(`🏁 [Worker] Completed Batch [${batchIndex}/${totalBatches}]: ${deleted} deleted, ${failed} failed`);
        return { batchIndex, totalBatches, totalInBatch: contactIds.length, deleted, failed };
      }

      throw new Error(`Unknown job name: ${job.name}`);
    },
    {
      connection: redisConnection,
      concurrency: 1, // Process one batch at a time
      lockDuration: 60000, // 1 minute per batch is more than enough for 25 contacts
      stalledInterval: 30000,
    }
  );

  worker.on('ready', () => {
    console.log(`👷 [Worker] BullMQ Worker is ready on queue: "${QUEUE_NAME}"`);
  });

  worker.on('completed', (job: Job) => {
    if (job.name === 'START_CLEANUP') {
      console.log(`✨ [Worker] Master Job ${job.id} completed successfully.`);
    }
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`❌ [Worker] Job ${job?.id} (${job?.name}) FAILED:`, err.message);
  });

  worker.on('error', (err: Error) => {
    console.error(`⚠️ [Worker] Worker error:`, err.message);
  });

  return worker;
};
