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
const BATCH_SIZE = 100; // 25 contacts per job = ~6-8s per job, preventing timeout issues

interface DeleteBatchJobData {
  startIndex: number;
  totalContacts: number;
  batchIndex: number;
  totalBatches: number;
  contactIds: number[];
}

// Worker to process fetch & deletion jobs in small batches
export const initCleanupWorker = () => {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      // 1. Master Job: Fetch all contact IDs and split into batch jobs
      if (job.name === 'START_CLEANUP') {
        console.log(`\n🚀 [Worker] Starting Master Job ${job.id}: Fetching all contacts...`);
        const contactIds = await freshdeskService.getAllContactIds();
        const totalContacts = contactIds.length;

        if (totalContacts === 0) {
          console.log('ℹ️ [Worker] No contacts found to delete.');
          return { totalFound: 0, totalBatches: 0 };
        }

        const batches: { name: string; data: DeleteBatchJobData }[] = [];
        const totalBatches = Math.ceil(totalContacts / BATCH_SIZE);

        for (let i = 0; i < totalContacts; i += BATCH_SIZE) {
          const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
          const chunk = contactIds.slice(i, i + BATCH_SIZE);
          batches.push({
            name: 'DELETE_BATCH',
            data: {
              startIndex: i,
              totalContacts,
              batchIndex,
              totalBatches,
              contactIds: chunk,
            },
          });
        }

        console.log(`📦 [Worker] Enqueuing ${batches.length} batch jobs (${BATCH_SIZE} contacts per job, Total: ${totalContacts})...`);
        await contactCleanupQueue.addBulk(batches);

        console.log(`✅ [Worker] Master Job completed! ${batches.length} batch jobs added to queue.`);
        return { totalFound: totalContacts, totalBatches };
      }

      // 2. Batch Job: Delete a small chunk of contacts (takes ~5-8s per job)
      if (job.name === 'DELETE_BATCH') {
        const { startIndex, totalContacts, batchIndex, totalBatches, contactIds } = job.data as DeleteBatchJobData;
        const startRecord = startIndex + 1;
        const endRecord = startIndex + contactIds.length;

        console.log(`\n▶️ [Worker] Processing Batch [${batchIndex}/${totalBatches}] (Records ${startRecord}-${endRecord} of ${totalContacts})...`);
        let deleted = 0;
        let failed = 0;

        for (let j = 0; j < contactIds.length; j++) {
          const id = contactIds[j];
          const globalRecordNumber = startIndex + j + 1;
          const percentage = ((globalRecordNumber / totalContacts) * 100).toFixed(2);

          const success = await freshdeskService.hardDeleteContact(id);

          if (success) {
            deleted++;
            console.log(`[${globalRecordNumber}/${totalContacts}] (${percentage}%) [Batch ${batchIndex}/${totalBatches}] ✅ Deleted ID: ${id}`);
          } else {
            failed++;
            console.log(`[${globalRecordNumber}/${totalContacts}] (${percentage}%) [Batch ${batchIndex}/${totalBatches}] ❌ Failed ID: ${id}`);
          }

          // Small delay between deletes
          await new Promise((resolve) => setTimeout(resolve, Number(process.env.DELETE_DELAY_MS || 250)));
        }

        const batchProgress = ((endRecord / totalContacts) * 100).toFixed(2);
        console.log(`🏁 [Worker] Completed Batch [${batchIndex}/${totalBatches}]: ${deleted} deleted, ${failed} failed | Total Progress: ${batchProgress}% (${endRecord}/${totalContacts})`);
        return { batchIndex, totalBatches, totalInBatch: contactIds.length, deleted, failed, progress: `${batchProgress}%` };
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
