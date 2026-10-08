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
    const job = await contactCleanupQueue.add('delete-all-contacts-job', {
      createdAt: new Date().toISOString(),
    }, {
      removeOnComplete: false,
      removeOnFail: false,
    });

    console.log(`📩 Queued BullMQ Job ID: ${job.id}`);

    return res.status(202).json({
      success: true,
      message: 'Contact cleanup job started in background',
      jobId: job.id,
      statusUrl: `/job-status/${job.id}`,
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

// Check status of a BullMQ job
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
    const progress = job.progress;
    const returnValues = job.returnvalue;
    const failedReason = job.failedReason;

    return res.status(200).json({
      success: true,
      jobId: job.id,
      state,
      progress,
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

export default router;
