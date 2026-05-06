import { NotificationItem } from '../types/notification';

export const notifications: NotificationItem[] = [
  {
    id: 'n1',
    studentId: 'student-001',
    type: 'Placements',
    message: 'Company X hiring drive is open',
    isRead: false,
    createdAt: new Date().toISOString()
  },
  {
    id: 'n2',
    studentId: 'student-001',
    type: 'Results',
    message: 'Semester results published',
    isRead: true,
    createdAt: new Date().toISOString()
  }
];