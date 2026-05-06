import { useEffect, useMemo, useState } from 'react';
import type { NotificationItem, NotificationType } from './types';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

const typeOptions: NotificationType[] = ['Placements', 'Events', 'Results'];

export default function App() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [selectedType, setSelectedType] = useState<'All' | NotificationType>('All');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<NotificationType>('Placements');

  const loadNotifications = async () => {
    const response = await fetch(`${apiBaseUrl}/notifications?studentId=student-001`);
    const data = await response.json();
    setNotifications(data.data || []);
  };

  useEffect(() => {
    loadNotifications().catch(() => setNotifications([]));
  }, []);

  const visibleNotifications = useMemo(() => {
    if (selectedType === 'All') {
      return notifications;
    }

    return notifications.filter((item) => item.type === selectedType);
  }, [notifications, selectedType]);

  const submitNotification = async (event: React.FormEvent) => {
    event.preventDefault();

    await fetch(`${apiBaseUrl}/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        studentIds: ['student-001'],
        type,
        message
      })
    });

    setMessage('');
    await loadNotifications();
  };

  return (
    <main className="page">
      <section className="panel">
        <h1>Campus Notifications</h1>
        <p className="subtitle">Backend and frontend demo for the evaluation.</p>

        <form className="form" onSubmit={submitNotification}>
          <select value={type} onChange={(event) => setType(event.target.value as NotificationType)}>
            {typeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Enter notification message"
          />
          <button type="submit">Create Notification</button>
        </form>

        <div className="filters">
          {(['All', ...typeOptions] as const).map((option) => (
            <button
              key={option}
              className={selectedType === option ? 'active' : ''}
              onClick={() => setSelectedType(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Notifications</h2>
        <ul className="list">
          {visibleNotifications.map((item) => (
            <li key={item.id} className={item.isRead ? 'read' : 'unread'}>
              <strong>{item.type}</strong>
              <span>{item.message}</span>
              <small>{new Date(item.createdAt).toLocaleString()}</small>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}