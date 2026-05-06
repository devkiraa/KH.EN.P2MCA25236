import { randomUUID } from 'crypto';
import { CreateNotificationInput, NotificationItem } from '../types/notification';
import { notifications } from '../data/notifications';

export function getNotifications(studentId?: string): NotificationItem[] {
  if (!studentId) {
    return notifications;
  }

  return notifications.filter((item) => item.studentId === studentId);
}

export function getUnreadNotifications(studentId: string): NotificationItem[] {
  return notifications.filter((item) => item.studentId === studentId && !item.isRead);
}

export function createNotifications(input: CreateNotificationInput): NotificationItem[] {
  const createdAt = new Date().toISOString();

  const created = input.studentIds.map((studentId) => ({
    id: randomUUID(),
    studentId,
    type: input.type,
    message: input.message,
    isRead: false,
    createdAt
  }));

  notifications.unshift(...created);
  return created;
}

export function markAsRead(id: string): boolean {
  const item = notifications.find((notification) => notification.id === id);
  if (!item) {
    return false;
  }

  item.isRead = true;
  return true;
}