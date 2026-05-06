import { Router, Request, Response } from 'express';
import { Log, setAuthToken } from 'logging-middleware';
import { createNotifications, getNotifications, getUnreadNotifications, markAsRead } from '../services/notification.service';
import { getConfigFromRequest } from '../middleware/config.middleware';

const router = Router();

// Helper to ensure token is set from current config
const ensureLoggerToken = (req: Request): void => {
  try {
    const config = getConfigFromRequest(req);
    setAuthToken(config.logger.apiToken);
  } catch (error) {
    console.error('Failed to set logger token:', error);
  }
};

router.get('/notifications', async (req, res) => {
  ensureLoggerToken(req);
  await Log('backend', 'info', 'route', 'GET /notifications called');

  const studentId = typeof req.query.studentId === 'string' ? req.query.studentId : undefined;
  const data = getNotifications(studentId);

  res.json({ success: true, data });
});

router.get('/notifications/unread', async (req, res) => {
  ensureLoggerToken(req);
  await Log('backend', 'info', 'route', 'GET /notifications/unread called');

  const studentId = typeof req.query.studentId === 'string' ? req.query.studentId : 'student-001';
  const data = getUnreadNotifications(studentId);

  res.json({ success: true, data });
});

router.post('/notifications', async (req, res) => {
  ensureLoggerToken(req);
  await Log('backend', 'info', 'controller', 'POST /notifications called');

  const { studentIds, type, message } = req.body as {
    studentIds?: string[];
    type?: 'Placements' | 'Events' | 'Results';
    message?: string;
  };

  if (!Array.isArray(studentIds) || studentIds.length === 0 || !type || !message) {
    res.status(400).json({ success: false, message: 'Invalid request body' });
    return;
  }

  const created = createNotifications({ studentIds, type, message });

  res.status(201).json({ success: true, data: created });
});

router.patch('/notifications/:id/read', async (req, res) => {
  ensureLoggerToken(req);
  await Log('backend', 'warn', 'controller', 'PATCH /notifications/:id/read called');

  const updated = markAsRead(req.params.id);
  if (!updated) {
    res.status(404).json({ success: false, message: 'Notification not found' });
    return;
  }

  res.json({ success: true, message: 'Notification marked as read' });
});

router.get('/config', (req: Request, res: Response) => {
  try {
    const config = getConfigFromRequest(req);
    res.json({
      success: true,
      config: {
        environment: config.environment,
        port: config.port,
        logger: {
          apiUrl: config.logger.apiUrl,
          timeout: config.logger.timeout,
          // Don't expose token in response
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve config' });
  }
});

export default router;