import { Router, Request, Response } from 'express';
import { contactCleanupQueue } from './queue';

const router = Router();

// Health check endpoint
router.get('/health', (_req: Request, res: Response) => {
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'freshdesk-contact-cleanup',
  });
});

// Trigger BullMQ background job to delete all contacts
router.post('/delete-all-contacts', async (_req: Request, res: Response) => {
  try {
    const job = await contactCleanupQueue.add('START_CLEANUP', {
      createdAt: new Date().toISOString(),
    }, {
      removeOnComplete: true,
      removeOnFail: false,
    });

    console.log(`📩 Queued Master Cleanup Job ID: ${job.id}`);

    return res.status(202).json({
      success: true,
      message: 'Contact cleanup job started in background (batched processing)',
      jobId: job.id,
      queueStatusUrl: '/queue-status',
    });
  } catch (error: any) {
    console.error('❌ Failed to enqueue BullMQ job:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to enqueue cleanup job',
      error: error.message,
    });
  }
});

// Check overall queue status (active, completed, failed, waiting batches)
router.get('/queue-status', async (_req: Request, res: Response) => {
  try {
    const counts = await contactCleanupQueue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed'
    );

    return res.status(200).json({
      success: true,
      queue: 'freshdesk-contact-cleanup',
      counts,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve queue status',
      error: error.message,
    });
  }
});

// Check status of an individual BullMQ job
router.get('/job-status/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const job = await contactCleanupQueue.getJob(id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: `Job ${id} not found`,
      });
    }

    const state = await job.getState();
    const returnValues = job.returnvalue;
    const failedReason = job.failedReason;

    return res.status(200).json({
      success: true,
      jobId: job.id,
      name: job.name,
      state,
      result: returnValues || null,
      failedReason: failedReason || null,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve job status',
      error: error.message,
    });
  }
});

// Drain/clear the queue if needed
router.post('/clean-queue', async (_req: Request, res: Response) => {
  try {
    await contactCleanupQueue.obliterate({ force: true });
    return res.status(200).json({
      success: true,
      message: 'Queue obliterated and cleaned successfully',
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to clean queue',
      error: error.message,
    });
  }
});

export default router;
