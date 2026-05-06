import { Router } from 'express';
import { Log, setAuthToken } from '../../../logging_middleware';
import { createNotifications, getNotifications, getUnreadNotifications, markAsRead } from '../services/notification.service';

const router = Router();

router.get('/notifications', async (req, res) => {
  await Log('backend', 'info', 'route', 'GET /notifications called');

  const studentId = typeof req.query.studentId === 'string' ? req.query.studentId : undefined;
  const data = getNotifications(studentId);

  res.json({ success: true, data });
});

router.get('/notifications/unread', async (req, res) => {
  await Log('backend', 'info', 'route', 'GET /notifications/unread called');

  const studentId = typeof req.query.studentId === 'string' ? req.query.studentId : 'student-001';
  const data = getUnreadNotifications(studentId);

  res.json({ success: true, data });
});

router.post('/notifications', async (req, res) => {
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
  await Log('backend', 'warn', 'controller', 'PATCH /notifications/:id/read called');

  const updated = markAsRead(req.params.id);
  if (!updated) {
    res.status(404).json({ success: false, message: 'Notification not found' });
    return;
  }

  res.json({ success: true, message: 'Notification marked as read' });
});

router.post('/logging-token', (_req, res) => {
  setAuthToken(process.env.ACCESS_TOKEN || process.env.API_TOKEN || '');
  res.json({ success: true, message: 'Logger token refreshed' });
});

export default router;