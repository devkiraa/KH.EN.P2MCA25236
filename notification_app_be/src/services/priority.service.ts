import axios from 'axios';
import { AppConfig } from '../config';

const NOTIFICATION_API = 'http://20.207.122.201/evaluation-service/notifications';

/**
 * Priority weights for notification types
 * Higher weight = higher priority
 */
const PRIORITY_WEIGHTS = {
  'Placement': 3,
  'Result': 2,
  'Event': 1
};

/**
 * Calculate recency score based on timestamp
 * Newer notifications get higher scores
 * Score decays over time (older = lower score)
 */
function getRecencyScore(timestamp: string): number {
  const now = new Date();
  const notificationTime = new Date(timestamp);
  const ageInHours = (now.getTime() - notificationTime.getTime()) / (1000 * 60 * 60);

  // Decay score: fresh = 1.0, older = 0.0
  // After 7 days, score approaches 0
  const decayFactor = Math.exp(-ageInHours / (7 * 24)); // 7 day half-life
  return decayFactor;
}

/**
 * Calculate priority score for a notification
 * Score = (Type Weight) × (Recency Score) × (Read Penalty)
 * 
 * Example:
 * - Placement notification from 1 hour ago, unread = 3 × 0.99 × 1.0 = 2.97
 * - Result notification from 1 day ago, read = 2 × 0.86 × 0.5 = 0.86
 * - Event notification from 3 days ago, unread = 1 × 0.64 × 1.0 = 0.64
 */
export function calculatePriorityScore(
  notification: any
): number {
  const typeWeight = PRIORITY_WEIGHTS[notification.Type as keyof typeof PRIORITY_WEIGHTS] || 0;
  const recencyScore = getRecencyScore(notification.Timestamp);
  const readPenalty = notification.IsRead ? 0.5 : 1.0; // Unread gets higher priority

  return typeWeight * recencyScore * readPenalty;
}

/**
 * Fetch notifications from the real API
 * Requires valid authentication token
 */
export async function fetchNotificationsFromAPI(
  config: AppConfig,
  token: string
): Promise<any[]> {
  try {
    const response = await axios.get(NOTIFICATION_API, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: config.logger.timeout || 15000
    });

    if (Array.isArray(response.data)) {
      return response.data;
    }

    if (response.data?.notifications && Array.isArray(response.data.notifications)) {
      return response.data.notifications;
    }

    console.warn('Unexpected API response format:', response.data);
    return [];
  } catch (error: any) {
    console.error('Failed to fetch notifications from API:', error.message);
    throw error;
  }
}

/**
 * Get top N priority notifications
 * 
 * Algorithm:
 * 1. Fetch all notifications from API
 * 2. Calculate priority score for each
 * 3. Sort by priority (descending)
 * 4. Return top N
 */
export async function getTopPriorityNotifications(
  config: AppConfig,
  token: string,
  limit: number = 10
): Promise<{
  notifications: any[];
  total: number;
  limit: number;
}> {
  try {
    // Step 1: Fetch all notifications
    const allNotifications = await fetchNotificationsFromAPI(config, token);

    // Step 2: Calculate scores and add to each notification
    const notificationsWithScores = allNotifications.map(notification => ({
      ...notification,
      priorityScore: calculatePriorityScore(notification)
    }));

    // Step 3: Sort by priority score (descending)
    const sortedByPriority = notificationsWithScores.sort(
      (a, b) => b.priorityScore - a.priorityScore
    );

    // Step 4: Return top N
    const topNotifications = sortedByPriority.slice(0, limit);

    return {
      notifications: topNotifications,
      total: allNotifications.length,
      limit
    };
  } catch (error) {
    console.error('Failed to get priority notifications:', error);
    throw error;
  }
}

/**
 * Get priority notifications grouped by type
 * Useful for showing breakdowns: "3 placements, 2 results, 1 event"
 */
export async function getPriorityNotificationsByType(
  config: AppConfig,
  token: string,
  limit: number = 10
): Promise<{
  byType: {
    [key: string]: any[];
  };
  priorityInbox: any[];
  total: number;
}> {
  const { notifications } = await getTopPriorityNotifications(config, token, limit);

  // Group by type
  const byType: { [key: string]: any[] } = {};
  notifications.forEach(notification => {
    const type = notification.Type || 'Unknown';
    if (!byType[type]) {
      byType[type] = [];
    }
    byType[type].push(notification);
  });

  return {
    byType,
    priorityInbox: notifications,
    total: notifications.length
  };
}

/**
 * Get notifications for a specific priority level
 * Useful for filtering: show only "high priority" or "low priority"
 */
export async function getNotificationsByPriorityLevel(
  config: AppConfig,
  token: string,
  level: 'high' | 'medium' | 'low' = 'high'
): Promise<any[]> {
  try {
    const { notifications: allNotifications } = await getTopPriorityNotifications(
      config,
      token,
      50 // Get more to filter
    );

    const thresholds = {
      high: 1.5,      // Placement unread within 1 day
      medium: 0.75,   // Mixed types, some read
      low: 0          // Anything else
    };

    const threshold = thresholds[level];
    return allNotifications.filter(n => n.priorityScore >= threshold);
  } catch (error) {
    console.error('Failed to filter by priority level:', error);
    throw error;
  }
}
