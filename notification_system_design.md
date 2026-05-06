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

# Stage 2

## Database Choice

Use **PostgreSQL** because this is notification data with clear relations, and SQL is good for filtering, sorting, and indexing.

## Simple Schema

### students

```sql
CREATE TABLE students (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### notifications

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    student_id UUID NOT NULL,
    type VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id)
);
```

## Scaling Problems

- Too many rows can make queries slow
- Inserts can become slower when the table grows
- Fetching unread notifications for one student can take more time

## Solutions

- Add indexes on `student_id`, `is_read`, and `created_at`
- Use pagination with `LIMIT` and `OFFSET`
- Partition very large notification tables by date if needed
- Keep only required columns in the query

## Sample Queries

### Get unread notifications for one student

```sql
SELECT id, type, message, created_at
FROM notifications
WHERE student_id = 'student-001' AND is_read = FALSE
ORDER BY created_at DESC;
```

### Mark notification as read

```sql
UPDATE notifications
SET is_read = TRUE
WHERE id = 'notification-id';
```

### Get placement notifications in last 7 days

```sql
SELECT id, student_id, message, created_at
FROM notifications
WHERE type = 'Placement'
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```