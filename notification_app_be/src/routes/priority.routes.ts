import { Router, Request, Response } from 'express';
import { getConfigFromRequest } from '../middleware/config.middleware';
import {
  getTopPriorityNotifications,
  getPriorityNotificationsByType,
  getNotificationsByPriorityLevel
} from '../services/priority.service';

const router = Router();

/**
 * GET /api/priority/top
 * Get top N priority notifications sorted by importance
 * 
 * Query params:
 * - limit: number of notifications to return (default: 10, max: 50)
 * 
 * Response: Array of notifications with priority scores
 */
router.get('/priority/top', async (req: Request, res: Response) => {
  try {
    const config = getConfigFromRequest(req);
    const token = config.logger.apiToken;
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication token not configured'
      });
    }

    const limit = Math.min(
      Math.max(parseInt(req.query.limit as string) || 10, 1),
      50 // Max 50
    );

    const result = await getTopPriorityNotifications(config, token, limit);

    res.json({
      success: true,
      data: result.notifications,
      metadata: {
        returned: result.notifications.length,
        total: result.total,
        limit: result.limit
      }
    });
  } catch (error: any) {
    console.error('Priority inbox error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch priority notifications'
    });
  }
});

/**
 * GET /api/priority/grouped
 * Get notifications grouped by type
 * 
 * Response: Object with notifications grouped by type (Placement, Result, Event)
 */
router.get('/priority/grouped', async (req: Request, res: Response) => {
  try {
    const config = getConfigFromRequest(req);
    const token = config.logger.apiToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication token not configured'
      });
    }

    const limit = Math.min(
      Math.max(parseInt(req.query.limit as string) || 10, 1),
      50
    );

    const result = await getPriorityNotificationsByType(config, token, limit);

    res.json({
      success: true,
      data: result,
      metadata: {
        typeBreakdown: Object.entries(result.byType).reduce(
          (acc, [type, notifications]) => {
            acc[type] = notifications.length;
            return acc;
          },
          {} as { [key: string]: number }
        )
      }
    });
  } catch (error: any) {
    console.error('Grouped priority error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch grouped notifications'
    });
  }
});

/**
 * GET /api/priority/level/:level
 * Filter notifications by priority level
 * 
 * Params:
 * - level: 'high' | 'medium' | 'low'
 * 
 * Response: Array of notifications at that priority level
 */
router.get('/priority/level/:level', async (req: Request, res: Response) => {
  try {
    const config = getConfigFromRequest(req);
    const token = config.logger.apiToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication token not configured'
      });
    }

    const level = req.params.level as 'high' | 'medium' | 'low';

    if (!['high', 'medium', 'low'].includes(level)) {
      return res.status(400).json({
        success: false,
        error: 'Priority level must be: high, medium, or low'
      });
    }

    const notifications = await getNotificationsByPriorityLevel(config, token, level);

    res.json({
      success: true,
      data: notifications,
      metadata: {
        level,
        count: notifications.length
      }
    });
  } catch (error: any) {
    console.error('Priority level filter error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch notifications by priority level'
    });
  }
});

export default router;
