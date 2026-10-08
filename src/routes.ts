import { Router, Request, Response } from 'express';
import { FreshdeskService } from './freshdesk';

const router = Router();
const freshdeskService = new FreshdeskService();

router.get('/health', (_req: Request, res: Response) => {
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'freshdesk-contact-cleanup',
  });
});

router.post('/delete-all-contacts', async (_req: Request, res: Response) => {
  try {
    const result = await freshdeskService.deleteAllContacts();
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to complete contact deletion process',
      error: error.message,
    });
  }
});

export default router;
