# Stage 1

## Core Actions

- Get all notifications
- Get unread notifications
- Mark one notification as read
- Mark all notifications as read
- Create a notification
- Delete a notification
- Send real-time updates

## Simple REST API Design

### Get all notifications

- **GET** `/api/notifications`
- **Header:** `Authorization: Bearer <token>`

### Get unread notifications

- **GET** `/api/notifications/unread`

### Mark one as read

- **PATCH** `/api/notifications/{id}/read`

### Create notification

- **POST** `/api/notifications`

**Request body**
```json
{
  "studentIds": ["student-001"],
  "type": "Placement",
  "message": "Company X hiring"
}
```

**Response**
```json
{
  "success": true,
  "message": "Notification created"
}
```

## Real-Time Notifications

- Use **WebSocket** for live updates.
- The server sends a notification instantly when it is created.

**Example event**
```json
{
  "event": "notification.created",
  "data": {
    "id": "uuid",
    "type": "Result",
    "message": "Results published"
  }
}
```