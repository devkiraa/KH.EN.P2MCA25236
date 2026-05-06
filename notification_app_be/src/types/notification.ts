export type NotificationType = 'Placements' | 'Events' | 'Results';

export interface NotificationItem {
  id: string;
  studentId: string;
  type: NotificationType;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface CreateNotificationInput {
  studentIds: string[];
  type: NotificationType;
  message: string;
}