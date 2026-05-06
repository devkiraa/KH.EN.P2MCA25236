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

# Stage 3

## Is the Query Correct?

The query works, but it is not optimal.

```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt ASC;
```

## Why It Is Slow

- It uses `SELECT *`, so it reads extra columns
- It has no good index for `studentID` and `isRead`
- It sorts records with `ORDER BY`, which takes time
- With 5,000,000 rows, a table scan becomes expensive

## What I Would Change

Use only the needed columns and add a composite index.

```sql
SELECT id, type, message, createdAt
FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC
LIMIT 20;
```

## Likely Computation Cost

- Without index: close to `O(n)` because many rows may be scanned
- With index: much faster, closer to `O(log n + k)`

This can help keep the response under **500ms** for normal load.

## Should We Add Indexes on Every Column?

No.

That is not a good idea because:

- It slows down `INSERT` and `UPDATE`
- It uses extra storage
- It makes the database heavier to maintain

Add indexes only on columns used in `WHERE`, `ORDER BY`, and joins.

## Best Index for This Case

```sql
CREATE INDEX idx_notifications_student_read_created
ON notifications (studentID, isRead, createdAt DESC);
```

## Query for Placement Notifications in Last 7 Days

```sql
SELECT DISTINCT studentID
FROM notifications
WHERE notificationType = 'Placement'
  AND createdAt >= NOW() - INTERVAL '7 days';
```

## Simple Final Answer

The query is correct, but slow. Use a composite index, avoid `SELECT *`, and return only the needed rows so the response stays fast, ideally under **500ms**.

# Stage 4

## Problem Statement

Notifications are being fetched on each page load for every student. The database is getting overwhelmed, causing poor user experience. Database load increases exponentially with concurrent students, and response times degrade rapidly after peak concurrent users.

## Performance Issue Analysis

### Current Bottlenecks

1. **Database Hit on Every Page Load**: Each student's page load triggers a full database query
2. **Repeated Queries for Same Data**: Multiple students refreshing simultaneously query the same data
3. **No Data Caching**: Every request goes directly to PostgreSQL
4. **Full Table Scans**: Even with indexes, high concurrency causes database contention
5. **Unread Count Computation**: Counting unread notifications requires aggregation

### Estimated Performance Impact

```
100 concurrent students × 1 query per page load = 100 DB hits/second
+ Page refreshes every 30 seconds = 3.3 queries/student/minute
+ Peak hours could reach 500-1000 concurrent = 500-1000 queries/second
= Database CPU exhaustion, connection pool depletion, 500ms+ response times
```

---

## Solution 1: Redis Cache Layer (Recommended)

### Architecture

```
Client Request → Express Backend → Redis Cache → PostgreSQL
                        ↓
                 (Cache hit: return from Redis)
                 (Cache miss: fetch from DB, store in Redis)
```

### Implementation

```typescript
// Backend service with Redis caching
import redis from 'redis';

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});

export async function getUnreadNotificationsCached(studentId: string) {
  const cacheKey = `notifications:unread:${studentId}`;
  const ttl = 300; // 5 minutes

  try {
    // Check cache first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log(`Cache hit: ${cacheKey}`);
      return JSON.parse(cached);
    }
  } catch (error) {
    console.error('Redis read error:', error);
    // Fall back to database if cache fails
  }

  // Cache miss: fetch from database
  const notifications = await getUnreadNotificationsFromDB(studentId);

  try {
    // Store in cache with TTL
    await redisClient.setex(cacheKey, ttl, JSON.stringify(notifications));
  } catch (error) {
    console.error('Redis write error:', error);
    // Still return result even if cache write fails
  }

  return notifications;
}

// When a notification is marked as read, invalidate cache
export async function markAsReadAndInvalidateCache(notificationId: string, studentId: string) {
  await markAsReadInDB(notificationId);
  
  // Invalidate student's notification cache
  const cacheKey = `notifications:unread:${studentId}`;
  await redisClient.del(cacheKey);
}
```

### Tradeoffs

**Advantages:**
- ✅ Dramatically reduces database load (5-10 minute cache hits eliminate 95% of DB queries)
- ✅ Response time: sub-100ms for cache hits
- ✅ Scales horizontally: can add more Redis instances for clustering
- ✅ Automatic TTL expiration: no manual cleanup needed
- ✅ Handles burst traffic: cache absorbs spikes
- ✅ Works with existing database structure

**Disadvantages:**
- ❌ Cache invalidation complexity: must manually invalidate on data changes
- ❌ Stale data: students may see old notifications for up to 5 minutes
- ❌ Memory overhead: Redis requires dedicated infrastructure
- ❌ Cache warming: first requests after server restart are slow
- ❌ Extra complexity: adds another system to monitor and maintain
- ❌ Cost: Additional Redis server infrastructure

**When to Use:**
- High concurrency (100+ students)
- Acceptable stale data window (5-10 minutes)
- Budget for extra infrastructure
- Team comfortable with Redis operations

---

## Solution 2: Client-Side Caching (Browser Cache)

### Architecture

```
Client (Browser Cache) ← Express Backend ← PostgreSQL
     ↓
 (If cache valid: use local data)
 (If cache expired: fetch from server)
```

### Implementation

```typescript
// Backend: Add cache headers
app.get('/api/notifications/unread', (req, res) => {
  const notifications = getUnreadNotifications(req.studentId);

  // Cache for 5 minutes in browser
  res.set('Cache-Control', 'private, max-age=300');
  res.set('ETag', generateETag(notifications));
  
  res.json({ success: true, data: notifications });
});

// Frontend: Request notifications, browser handles caching
async function fetchNotifications() {
  const response = await fetch('/api/notifications/unread', {
    headers: {
      'Cache-Control': 'max-age=300'
    }
  });

  if (response.status === 304) {
    // Not Modified: use local cache
    return getCachedNotifications();
  }

  return response.json();
}

// IndexedDB for larger cache storage
async function cacheNotificationsLocally(notifications) {
  const db = await openDatabase('campus-notifications');
  const store = db.transaction(['notifications'], 'readwrite').objectStore('notifications');
  
  await store.clear();
  await store.put({
    id: 'latest',
    data: notifications,
    timestamp: Date.now()
  });
}
```

### Tradeoffs

**Advantages:**
- ✅ Zero server/database load for cached requests
- ✅ Works offline: user sees previous notifications without internet
- ✅ Fastest possible response: local memory access (< 10ms)
- ✅ No infrastructure cost: uses client's own device
- ✅ No cache invalidation complexity: simple TTL expiration
- ✅ Easy to implement: built-in browser features

**Disadvantages:**
- ❌ No real-time updates: must wait for cache expiration
- ❌ Cache inconsistency: different browsers show different data
- ❌ Users can't see new notifications until cache expires
- ❌ Limited storage (5-50MB depending on browser)
- ❌ Users may delete browser cache and lose data
- ❌ No way to force update across all browsers
- ❌ Version mismatches: multiple versions of same data

**When to Use:**
- Acceptable 5-10 minute notification delay
- Read-heavy workload (more reads than writes)
- Limited budget
- Offline access important
- Small number of notifications per student

---

## Solution 3: Hybrid Approach (Redis + Client Cache)

### Architecture

```
Client (Browser) → Redis Cache → PostgreSQL
     ↓                  ↓
(Browser cache)   (Server cache)
(5 mins)         (5-10 mins)
```

### Implementation

```typescript
// Backend with both cache layers
app.get('/api/notifications/unread', async (req, res) => {
  const studentId = req.studentId;
  const cacheKey = `notifications:unread:${studentId}`;

  // Try Redis first
  let notifications = await redis.get(cacheKey);
  
  if (!notifications) {
    // Redis miss: fetch from database
    notifications = await db.query(
      'SELECT id, type, message, created_at FROM notifications WHERE student_id = ? AND is_read = false',
      [studentId]
    );
    
    // Store in Redis for 10 minutes
    await redis.setex(cacheKey, 600, JSON.stringify(notifications));
  }

  // Set browser cache headers for 5 minutes
  res.set('Cache-Control', 'private, max-age=300');
  res.set('ETag', generateETag(notifications));
  
  res.json({ success: true, data: notifications });
});

// Frontend: Benefits from both caches
async function fetchNotifications() {
  const cached = localStorage.getItem('notifications:unread');
  const cacheTime = localStorage.getItem('notifications:unread:time');
  
  // Use local cache if < 5 minutes old
  if (cached && Date.now() - cacheTime < 300000) {
    return JSON.parse(cached);
  }

  // Fallback to server (which uses Redis)
  const response = await fetch('/api/notifications/unread');
  const data = await response.json();
  
  // Update local cache
  localStorage.setItem('notifications:unread', JSON.stringify(data));
  localStorage.setItem('notifications:unread:time', Date.now().toString());
  
  return data;
}
```

### Tradeoffs

**Advantages:**
- ✅ Multi-level caching: most requests never hit database
- ✅ Offline support: browser cache works without connectivity
- ✅ Fast responses: sub-50ms for browser cache hits
- ✅ Resilient: if Redis fails, browser cache provides fallback
- ✅ Reduced infrastructure: Redis only needs to store short-term cache
- ✅ Best of both worlds: server scalability + client responsiveness

**Disadvantages:**
- ❌ Most complex to implement and debug
- ❌ Cache invalidation at two levels
- ❌ Data consistency issues: multiple versions of truth
- ❌ Infrastructure cost: Redis + browser storage
- ❌ Monitoring overhead: track cache hits/misses at both levels
- ❌ Learning curve: team must understand both caching strategies

**When to Use:**
- Large user base (1000+ students)
- Mix of read and write operations
- Offline access required
- Budget available for Redis infrastructure
- Maximum performance needed

---

## Solution 4: Database Query Optimization (No Cache)

### Implementation

```sql
-- Use aggressive pagination
SELECT id, type, message, created_at
FROM notifications
WHERE student_id = $1 AND is_read = FALSE
ORDER BY created_at DESC
LIMIT 20;  -- Load only first 20, not all

-- Pre-calculate unread count with materialized view
CREATE MATERIALIZED VIEW unread_count_by_student AS
  SELECT student_id, COUNT(*) as unread_count
  FROM notifications
  WHERE is_read = FALSE
  GROUP BY student_id;

-- Query becomes simple join
SELECT n.id, n.type, n.message, uc.unread_count
FROM notifications n
LEFT JOIN unread_count_by_student uc ON n.student_id = uc.student_id
WHERE n.student_id = $1 AND n.is_read = FALSE
LIMIT 20;

-- Connection pooling
const pool = new Pool({
  max: 20,  // Maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### Tradeoffs

**Advantages:**
- ✅ No cache complexity: simple to understand
- ✅ Always consistent: single source of truth (database)
- ✅ No infrastructure overhead: just PostgreSQL tuning
- ✅ Easy debugging: straightforward data flow
- ✅ Real-time data: users always see latest notifications
- ✅ No cache invalidation issues

**Disadvantages:**
- ❌ Database still gets hammered at scale (doesn't reduce load)
- ❌ Slower responses: 100-500ms typical (all database hits)
- ❌ Poor handling of traffic spikes: connection pool exhaustion
- ❌ Requires expensive database infrastructure (more CPU, more RAM)
- ❌ Doesn't scale linearly: adding more servers doesn't help
- ❌ Can't handle thousands of concurrent users

**When to Use:**
- Small user base (< 100 students)
- Budget very limited
- Data consistency critical
- Real-time updates required
- Only as transition, plan to add caching later

---

## Solution 5: Message Queue + Notification Push (Advanced)

### Architecture

```
Create Notification → Message Queue → Worker Process → Push to Students
                         (Kafka)         (Async)      (WebSocket/Server Sent Events)
```

### Implementation

```typescript
// Producer: When notification is created
import kafka from 'kafkajs';

const producer = kafka.producer();

app.post('/api/notifications', async (req, res) => {
  const { studentIds, type, message } = req.body;

  // Save to database
  const notification = await db.create('notifications', {
    studentIds,
    type,
    message
  });

  // Push to message queue for async processing
  await producer.send({
    topic: 'notifications',
    messages: [
      {
        key: notification.id,
        value: JSON.stringify({
          studentIds,
          notificationId: notification.id,
          type,
          message
        })
      }
    ]
  });

  res.json({ success: true, data: notification });
});

// Consumer: Worker process that handles notifications
const consumer = kafka.consumer({ groupId: 'notification-workers' });

await consumer.subscribe({ topic: 'notifications' });
await consumer.run({
  eachMessage: async ({ message }) => {
    const { studentIds, notificationId, type, message: content } = JSON.parse(message.value);

    // Push to connected WebSocket clients
    for (const studentId of studentIds) {
      const sockets = getConnectedSockets(studentId);
      sockets.forEach(socket => {
        socket.emit('notification:new', {
          id: notificationId,
          type,
          message: content
        });
      });
    }

    // Invalidate cache for all affected students
    for (const studentId of studentIds) {
      await redis.del(`notifications:unread:${studentId}`);
    }
  }
});
```

### Tradeoffs

**Advantages:**
- ✅ Decouples notification creation from delivery
- ✅ Resilient: if worker crashes, messages queue up and retry
- ✅ Real-time push: students see notifications immediately
- ✅ Scales well: workers can process messages in parallel
- ✅ Works with multiple channels: WebSocket, email, SMS
- ✅ Automatic retries: failed deliveries retry automatically

**Disadvantages:**
- ❌ Highly complex architecture: requires Kafka, consumers, monitoring
- ❌ Infrastructure overhead: multiple systems to operate
- ❌ Latency: even "real-time" has 100-500ms delay from queue
- ❌ Debugging difficult: hard to trace messages through system
- ❌ Cost: Kafka cluster, worker infrastructure
- ❌ Team expertise needed: requires deep knowledge of message queues
- ❌ Not suitable for small scale: overkill for < 1000 users

**When to Use:**
- Very large scale (10,000+ students)
- Multiple notification channels (email, SMS, app)
- Critical reliability required
- Team has experience with message queues
- Budget significant

---

## Comparison Matrix

| Strategy | DB Load | Response Time | Complexity | Cost | Real-Time | Consistency |
|----------|---------|---------------|-----------|------|-----------|-------------|
| **No Cache** | ❌ High | 200-500ms | ⭐ Simple | 💰 Low | ✅ Yes | ✅ Perfect |
| **Browser Cache** | ✅ Very Low | 10-50ms | ⭐ Simple | 💰 None | ❌ 5-10m delay | ⚠️ Eventually |
| **Redis Cache** | ✅ Very Low | 50-100ms | ⭐⭐⭐ Medium | 💰💰 Medium | ⚠️ 5-10m delay | ⚠️ Eventually |
| **Hybrid** | ✅ Minimal | 10-50ms | ⭐⭐⭐⭐ High | 💰💰 Medium | ⚠️ 5-10m delay | ⚠️ Eventually |
| **DB Optimization** | ⚠️ Medium | 100-300ms | ⭐⭐ Low | 💰 Low | ✅ Yes | ✅ Perfect |
| **Message Queue** | ✅ Very Low | 100-500ms | ⭐⭐⭐⭐⭐ Very High | 💰💰💰 High | ✅ Near Real-Time | ✅ Perfect |

---

## Recommendation for This Project

### Phase 1 (Current): Database Optimization + Pagination
- Implement composite indexes from Stage 3
- Add pagination: return max 20 notifications per request
- Use connection pooling (PostgreSQL)
- **Expected**: 100-200 concurrent students supported

### Phase 2 (Scale to 500+ students): Add Redis Cache Layer
- Deploy Redis with 5-10 minute TTL
- Cache: `/api/notifications`, `/api/notifications/unread`
- Invalidate on: mark-as-read, new notification
- **Expected**: 500-1000 concurrent students, sub-100ms responses

### Phase 3 (Scale to 5000+ students): Hybrid + Browser Cache
- Add browser cache headers (5 minute max-age)
- Keep Redis for server-side caching
- Implement cache invalidation strategy
- **Expected**: 5000+ concurrent students, mostly sub-50ms responses

### Phase 4 (Enterprise Scale): Message Queue
- Deploy Kafka/RabbitMQ for notification delivery
- Workers push notifications via WebSocket
- Real-time updates with eventual consistency
- **Expected**: 10,000+ students, true real-time notifications

---

## Implementation Checklist for Phase 1

- [ ] Add composite index: `(student_id, is_read, created_at DESC)`
- [ ] Implement pagination: `SELECT ... LIMIT 20 OFFSET ?`
- [ ] Remove `SELECT *`: fetch only needed columns
- [ ] Add database connection pooling (max 20 connections)
- [ ] Monitor query execution time: target < 200ms
- [ ] Load test: simulate 100 concurrent students
- [ ] Add request logging: track response times by endpoint

---

## Conclusion

**Start with database optimization** (Stage 3 + pagination). When database hits become a bottleneck (typically at 300+ concurrent users), **add Redis caching**. Only migrate to message queues if supporting enterprise-scale deployments (10,000+ students). The hybrid approach (Redis + Browser Cache) offers the best balance of performance and complexity for most systems.