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

// BullMQ Queue instance to dispatch cleanup jobs
export const contactCleanupQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
});

const freshdeskService = new FreshdeskService();

// BullMQ Worker to process contact cleanup in the background
export const initCleanupWorker = () => {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      console.log(`\n⚙️ [Worker] Processing Job ID: ${job.id} (${job.name})`);

      const result = await freshdeskService.deleteAllContacts(async (progress) => {
        await job.updateProgress(progress.percentage);
        console.log(`📊 [Worker Progress] Job ${job.id}: ${progress.percentage}% (${progress.current}/${progress.total})`);
      });

      return result;
    },
    {
      connection: redisConnection,
      concurrency: 1, // Process one cleanup batch at a time to respect Freshdesk rate limits
      lockDuration: 300000, // 5 minutes lock duration to allow long deletion loops & rate limit cooldowns
      stalledInterval: 60000, // Check for stalled jobs every 60s
      maxStalledCount: 3,
    }
  );

  worker.on('ready', () => {
    console.log(`👷 [Worker] BullMQ Worker is ready on queue: "${QUEUE_NAME}"`);
  });

  worker.on('completed', (job: Job, result: any) => {
    console.log(`✅ [Worker] Job ${job.id} COMPLETED! Summary:`, result);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`❌ [Worker] Job ${job?.id} FAILED:`, err.message);
  });

  worker.on('error', (err: Error) => {
    console.error(`⚠️ [Worker] Worker error:`, err.message);
  });

  return worker;
};
