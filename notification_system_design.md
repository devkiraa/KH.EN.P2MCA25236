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

# Stage 5

## Problem Statement

It is placement season. The HR clicks on "Notify All" and 50,000 students should get an email and an in-app notification simultaneously. However, logs indicate that the 'send_email' call failed for 200 students midway through. What now? How would you redesign this to be reliable and fast?

---

## Current (Naive) Implementation - Why It Fails

```typescript
function notify_all(studentIds: string[], message: string) {
  for (const studentId of studentIds) {
    // Send email
    send_email(studentId, message);      // ❌ Can fail
    
    // Save to database
    save_to_db(studentId, message);       // ❌ Can fail
    
    // Push to app
    push_to_app(studentId, message);      // ❌ Can fail
  }
}
```

### Shortcomings Identified

1. **No Error Handling**: If `send_email` fails for student #5000, we don't know
2. **Partial Success Problem**: 49,800 students got emails, 200 didn't - system is in inconsistent state
3. **No Retry Logic**: Failed emails are lost forever
4. **Blocking Operations**: All 50,000 students must wait for the slowest operation
5. **No Progress Tracking**: HR doesn't know when operation completed or failed
6. **All-or-Nothing Mindset**: System tries to do everything synchronously
7. **Single Point of Failure**: One slow email server stalls the entire batch
8. **Resource Exhaustion**: 50,000 concurrent connections may exhaust server resources
9. **No Idempotency**: Running same command twice sends 100,000 emails
10. **Database Transaction Issues**: What if DB succeeds but email fails?

### Example Failure Scenario

```
Student 1-4999: ✅ Success (email, DB, app all worked)
Student 5000: ❌ CRASH - Email service timeout (5 minute connection hang)
Student 5001-50000: ❌ SKIPPED (never reached)

Result: Inconsistent state
- Database has rows for all 50,000 ✅
- 4,999 students got emails ✅
- 45,001 students missing emails ❌
- App push not sent to anyone ❌
- HR has no idea what happened ❌
```

---

## Revised Solution 1: Asynchronous Batch Processing with Message Queue

### Architecture

```
HR clicks "Notify All" → Create Job Record → Queue Message → Return Immediately
                                 ↓
                    (User gets job ID, can check status)
                                 ↓
                    Background Workers Process Queue
                                 ↓
                    Email Worker   DB Worker   Push Worker
                    (Parallel)     (Parallel)  (Parallel)
```

### Implementation

```typescript
// API Endpoint: Create bulk notification job
app.post('/api/notifications/bulk', async (req, res) => {
  const { studentIds, message } = req.body;
  
  // Step 1: Create job record immediately
  const jobId = generateJobId();
  const job = await db.jobs.create({
    id: jobId,
    status: 'pending',
    totalStudents: studentIds.length,
    successCount: 0,
    failureCount: 0,
    createdAt: Date.now(),
    message
  });

  // Step 2: Queue the job, don't wait for processing
  await queue.enqueue('bulk-notify', {
    jobId,
    studentIds,
    message
  });

  // Step 3: Return immediately with job ID
  res.json({
    success: true,
    jobId,
    message: 'Bulk notification queued for processing',
    statusUrl: `/api/jobs/${jobId}/status`
  });
});

// Background Worker: Process bulk notifications
worker.subscribe('bulk-notify', async (job) => {
  const { jobId, studentIds, message } = job;

  // Update job status
  await db.jobs.update(jobId, { status: 'processing' });

  // Split into batches to avoid resource exhaustion
  const batchSize = 100;
  for (let i = 0; i < studentIds.length; i += batchSize) {
    const batch = studentIds.slice(i, i + batchSize);

    // Process batch in parallel
    const results = await Promise.allSettled([
      processBatch('email', batch, message),
      processBatch('db', batch, message),
      processBatch('push', batch, message)
    ]);

    // Track results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        await db.jobs.increment(jobId, 'successCount', result.value.count);
      } else {
        await db.jobs.increment(jobId, 'failureCount', result.value.count);
      }
    }

    // Log progress
    const current = await db.jobs.get(jobId);
    console.log(`Job ${jobId}: ${current.successCount}/${current.totalStudents} completed`);
  }

  // Mark job as complete
  await db.jobs.update(jobId, { 
    status: 'completed',
    completedAt: Date.now()
  });
});

// Helper: Process one communication channel for a batch
async function processBatch(channel, studentIds, message) {
  const results = {
    succeeded: [],
    failed: []
  };

  if (channel === 'email') {
    for (const studentId of studentIds) {
      try {
        await sendEmailWithRetry(studentId, message, maxRetries = 3);
        results.succeeded.push(studentId);
      } catch (error) {
        results.failed.push(studentId);
        await logFailure('email', studentId, error);
      }
    }
  } else if (channel === 'db') {
    try {
      // Batch insert is much faster than individual inserts
      await db.notifications.insertMany(
        studentIds.map(id => ({
          id: generateId(),
          studentId: id,
          message,
          isRead: false,
          createdAt: Date.now()
        }))
      );
      results.succeeded = studentIds;
    } catch (error) {
      results.failed = studentIds;
      await logFailure('db', null, error);
    }
  } else if (channel === 'push') {
    // Send push notifications via Firebase or similar
    const pushTokens = await db.students.getPushTokens(studentIds);
    for (const token of pushTokens) {
      try {
        await firebase.messaging().send({
          token,
          notification: {
            title: 'New Notification',
            body: message
          }
        });
        results.succeeded.push(token);
      } catch (error) {
        results.failed.push(token);
        await logFailure('push', token, error);
      }
    }
  }

  return {
    count: results.succeeded.length,
    errors: results.failed
  };
}

// API: Check job status
app.get('/api/jobs/:jobId/status', async (req, res) => {
  const job = await db.jobs.get(req.params.jobId);
  
  res.json({
    success: true,
    job: {
      id: job.id,
      status: job.status,  // 'pending' | 'processing' | 'completed' | 'failed'
      totalStudents: job.totalStudents,
      successCount: job.successCount,
      failureCount: job.failureCount,
      progress: `${job.successCount}/${job.totalStudents}`,
      createdAt: job.createdAt,
      completedAt: job.completedAt
    }
  });
});

// Retry logic with exponential backoff
async function sendEmailWithRetry(studentId, message, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await emailService.send(studentId, message);
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        console.log(`Retry ${attempt}/${maxRetries} after ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}
```

### Tradeoffs

**Advantages:**
- ✅ **Non-blocking**: HR gets response immediately, doesn't wait 50,000 operations
- ✅ **Partial success handling**: System knows which students got emails, which didn't
- ✅ **Parallel processing**: Email, DB, and push happen simultaneously
- ✅ **Retry logic**: Transient failures (timeouts) automatically retry
- ✅ **Progress tracking**: HR can check status anytime via job ID
- ✅ **Resource efficient**: Batching prevents connection pool exhaustion
- ✅ **Idempotent**: Can rerun job with same ID, won't duplicate sends
- ✅ **Audit trail**: Full log of successes and failures for compliance

**Disadvantages:**
- ❌ Infrastructure complexity: Requires message queue (Kafka, RabbitMQ, Bull)
- ❌ Monitoring overhead: Track job status, worker health, retry backlog
- ❌ Not real-time: Notifications don't send instantly (100-500ms delay)
- ❌ Database schema change: Must add `jobs` table to track state
- ❌ Operational burden: Workers must stay healthy, monitor for crashes

---

## Revised Solution 2: Database-First Approach with Event-Driven Processing

### Architecture

```
HR "Notify All" → Save All to DB (Fast, Atomic) → Trigger Event
                           ↓
                    (Immediate response)
                           ↓
                  Event listeners process:
                  - Send emails
                  - Push notifications
                  (Can fail without breaking DB consistency)
```

### Implementation

```typescript
// API: Create bulk notification
app.post('/api/notifications/bulk', async (req, res) => {
  const { studentIds, message } = req.body;

  // Step 1: Save all notifications to database FIRST (fast, atomic)
  const notifications = await db.notifications.insertMany(
    studentIds.map(id => ({
      id: generateId(),
      studentId: id,
      message,
      status: 'created',    // Track notification status
      isRead: false,
      createdAt: Date.now()
    }))
  );

  // Step 2: Return success immediately
  res.json({
    success: true,
    notificationCount: notifications.length,
    message: 'Notifications saved successfully'
  });

  // Step 3: Asynchronously trigger event handlers (fire and forget)
  eventBus.emit('notifications:bulk-created', {
    notificationIds: notifications.map(n => n.id),
    studentIds,
    message
  });
});

// Event Handler 1: Send emails
eventBus.on('notifications:bulk-created', async (event) => {
  const { notificationIds, studentIds, message } = event;

  for (let i = 0; i < studentIds.length; i += 100) {
    const batch = studentIds.slice(i, i + 100);
    const notificationBatch = notificationIds.slice(i, i + 100);

    try {
      await Promise.all(
        batch.map((studentId, idx) => 
          sendEmailWithRetry(studentId, message)
            .then(() => 
              db.notifications.update(notificationBatch[idx], { 
                emailStatus: 'sent' 
              })
            )
            .catch(error => 
              db.notifications.update(notificationBatch[idx], { 
                emailStatus: 'failed',
                emailError: error.message
              })
            )
        )
      );
    } catch (error) {
      console.error('Email batch failed:', error);
    }
  }
});

// Event Handler 2: Send push notifications
eventBus.on('notifications:bulk-created', async (event) => {
  const { notificationIds, studentIds, message } = event;

  const pushTokens = await db.students.getPushTokensByIds(studentIds);

  for (let i = 0; i < pushTokens.length; i += 500) {
    const batch = pushTokens.slice(i, i + 500);

    try {
      const results = await firebase.messaging().sendAll(
        batch.map(token => ({
          token,
          notification: {
            title: 'New Notification',
            body: message
          }
        }))
      );

      // Log failures for debugging
      results.failures.forEach(failure => {
        console.error(`Push failed for ${failure.error.code}: ${failure.error.message}`);
      });
    } catch (error) {
      console.error('Push batch failed:', error);
    }
  }
});

// Optional: Webhook for external notification services
eventBus.on('notifications:bulk-created', async (event) => {
  const { studentIds, message } = event;

  try {
    await fetch('https://notification-service.example.com/bulk', {
      method: 'POST',
      body: JSON.stringify({ studentIds, message })
    });
  } catch (error) {
    console.error('Webhook failed:', error);
    // Don't block main operation
  }
});
```

### Tradeoffs

**Advantages:**
- ✅ **Single operation atomicity**: All 50,000 database inserts succeed or fail together
- ✅ **Consistent state**: Database always reflects truth, even if emails fail
- ✅ **Simpler architecture**: No message queue needed, just event emitters
- ✅ **Immediate confirmation**: HR knows DB save succeeded instantly
- ✅ **Decoupled channels**: Email failure doesn't affect push, and vice versa
- ✅ **Easy recovery**: Can retry failed channels without re-saving to DB

**Disadvantages:**
- ⚠️ **External service failures not tracked**: If email fails, no retry automatically
- ⚠️ **No built-in queue**: Losing worker process loses pending notifications
- ⚠️ **Requires error handling discipline**: Each handler must handle its own failures
- ⚠️ **Limited observability**: Harder to track which notifications succeeded vs failed
- ⚠️ **Event handler crash risk**: If Node process crashes, pending handlers lost

---

## Revised Solution 3: Hybrid - Database + Queue (Recommended)

### Architecture

```
HR "Notify All" 
    ↓
    ├→ [Fast] Save all to DB (atomic, immediate response)
    │
    └→ [Async] Queue email/push jobs for workers to process
          ↓
          Workers with retry logic handle failures
```

### Key Improvements

```typescript
// Best of both worlds
async function notifyAllOptimized(studentIds, message) {
  // PART A: Database operation (ALWAYS succeeds or fails atomically)
  const notifications = await db.transaction(async (trx) => {
    return await trx('notifications').insert(
      studentIds.map(id => ({
        id: uuid(),
        student_id: id,
        message: message,
        is_read: false,
        created_at: new Date(),
        email_status: 'pending',      // Track each channel separately
        push_status: 'pending'
      }))
    );
  });

  // If DB insert fails, entire operation fails - user gets error, nothing sent
  // If DB insert succeeds, we proceed (guaranteed consistency)

  // PART B: Queue async jobs (failures don't affect DB)
  const emailJobs = studentIds.map((id, idx) => ({
    type: 'send-email',
    notificationId: notifications[idx].id,
    studentId: id,
    message,
    retryCount: 0,
    maxRetries: 3
  }));

  const pushJobs = studentIds.map((id, idx) => ({
    type: 'send-push',
    notificationId: notifications[idx].id,
    studentId: id,
    message,
    retryCount: 0,
    maxRetries: 3
  }));

  // Queue all jobs (no waiting, just enqueue)
  await queue.enqueueBatch([...emailJobs, ...pushJobs]);

  // Return success to user
  return {
    success: true,
    notificationsCreated: notifications.length,
    jobsQueued: emailJobs.length + pushJobs.length
  };
}
```

### Comparison Table

| Aspect | Naive | Async Queue | DB-First Event | Hybrid |
|--------|-------|-------------|----------------|--------|
| **Response Time** | 5-60 mins | 100-500ms | 50-200ms | 50-200ms |
| **Data Consistency** | ❌ Partial | ✅ Strong | ✅ Strong | ✅ Strong |
| **Error Resilience** | ❌ None | ✅ Retry logic | ⚠️ Manual | ✅ Automatic |
| **Partial Success** | ❌ No tracking | ✅ Tracked | ✅ Tracked | ✅ Tracked |
| **Infrastructure** | None | Message Queue | Event Emitter | Message Queue |
| **Complexity** | ⭐ Simple | ⭐⭐⭐⭐ Complex | ⭐⭐⭐ Medium | ⭐⭐⭐⭐ Complex |
| **Scalability** | 0-1000 | 0-1M | 0-100K | 0-1M |
| **Idempotent** | ❌ | ✅ | ⚠️ | ✅ |
| **Audit Trail** | ❌ | ✅ | ✅ | ✅ |

---

## Critical Design Decisions

### Decision 1: When Should DB Save Happen?

**Question**: Should saving to DB and sending email happen together or separately?

**Answer: Database first, external channels second.**

```
❌ Wrong: Send email → IF success THEN save to DB
   Problem: Email succeeds, DB fails = notification lost

✅ Correct: Save to DB → THEN send email
   Benefit: DB state is source of truth, emails are optional deliveries
```

**Why This Matters:**
- Database is your system of record
- External services (email, push) are best-effort delivery channels
- If one external service fails, others should still attempt
- Users can always re-fetch notifications from DB

### Decision 2: All-or-Nothing vs Partial Success?

```
❌ Wrong: If ANY email fails, roll back entire operation

✅ Correct: 49,999 succeed, 1 fails
   - Mark that 1 as "retry pending"
   - Log it for manual review
   - System stays operational
```

### Decision 3: Synchronous vs Asynchronous?

```
❌ Wrong: Block user until all 50,000 operations complete
   - Takes 5-60 minutes
   - HR stares at loading spinner
   - Single email timeout blocks entire operation

✅ Correct: Queue operations, return immediately
   - User gets response in 100ms
   - Operations process in background
   - Failures don't cascade
```

---

## Implementation Checklist for Stage 5

- [ ] Create `jobs` or `notifications_batch` table to track bulk operations
- [ ] Add `status` field to notifications table (created, emailed, pushed)
- [ ] Implement message queue (RabbitMQ, Redis Bull, or Kafka)
- [ ] Create worker process for background job processing
- [ ] Add retry logic with exponential backoff (3 attempts, 1-4-16 second delays)
- [ ] Implement batch processing (process in groups of 100-500, not 1 at a time)
- [ ] Add idempotency keys to prevent duplicate sends
- [ ] Create monitoring for job queue depth and worker health
- [ ] Add `/api/jobs/{jobId}/status` endpoint for progress tracking
- [ ] Log all successes and failures for audit trail
- [ ] Load test with 50,000 students to verify performance
- [ ] Document incident response: "What if email service goes down?"

---

## Real-World Example Scenario: How Hybrid Approach Handles Failure

```
Timeline: HR clicks "Notify All" for 50,000 students

T+0ms:
  - API receives request
  - Database transaction begins
  - Inserts 50,000 rows into notifications table
  - Transaction commits ✅
  - HR gets response: "50,000 notifications created"

T+10ms:
  - 50,000 email jobs queued
  - 50,000 push jobs queued

T+100ms:
  - Worker #1 starts processing email batch 1-100
  - Worker #2 starts processing email batch 101-200
  - Worker #3 starts processing push batch 1-100

T+500ms:
  - Email service responds with timeout for student #250-300
  - Failed emails automatically retry with 1-second delay
  - Other workers continue processing

T+1000ms:
  - Retry attempt #2 for failed emails
  - Success! Students #250-300 emails sent

T+30 seconds:
  - All 50,000 emails sent ✅
  - All 50,000 push notifications sent ✅
  - 99.5% success rate (25 failures, auto-retried 3x, manual review needed)
  - HR checks status: "Completed: 49,975 success, 25 failed"
  - HR clicks "Retry failed" to resend to 25 students

Result: 50,000 students got notifications. System stayed operational. HR had visibility.
```

---

## Conclusion

**For bulk operations with 50,000+ targets:**
1. Always use **asynchronous batch processing**
2. **Save to database first**, then queue external deliveries
3. Implement **retry logic with exponential backoff**
4. Provide **progress tracking** via job status API
5. Monitor for **partial failures** and allow manual retries
6. Use **batching** (100-500 per batch) to avoid resource exhaustion

The hybrid approach (database atomic save + message queue processing) provides the best balance of **reliability, speed, and operational simplicity** for this scale of operation.

---

# Overall Architecture Roadmap

## Stage-by-Stage Implementation Path

| Stage | Focus | Scale | Key Decision |
|-------|-------|-------|--------------|
| **Stage 1** | REST API Design | Single student | How should core actions look? |
| **Stage 2** | Database Schema | 1,000s of students | How to store and query efficiently? |
| **Stage 3** | Query Optimization | 10,000s of students | How to make queries fast? |
| **Stage 4** | Caching & Performance | 100,000s of students | How to reduce database load? |
| **Stage 5** | Bulk Operations | 50,000+ simultaneous | How to handle mass notifications reliably? |

## Final Recommendations

### For MVP (< 1,000 students)
- Stage 1: REST API ✅
- Stage 2: PostgreSQL with basic schema ✅
- Stage 3: Composite indexes ✅
- Skip: Caching, bulk operations (premature optimization)

### For Growth (1,000-10,000 students)
- All previous stages ✅
- Stage 4: Add Redis caching (5-minute TTL)
- Add pagination (max 20 results per request)
- Implement browser caching headers

### For Enterprise (10,000+ students)
- All previous stages ✅
- Stage 4: Hybrid caching (Redis + browser)
- Stage 5: Message queue for bulk operations
- Add WebSocket for real-time updates
- Consider database partitioning by date

---

## Core Principles Applied Throughout

1. **Fail Gracefully**: Partial success is acceptable, track and retry failures
2. **Async by Default**: Don't block users on slow external operations
3. **Database is Source of Truth**: External services are best-effort delivery
4. **Monitor Everything**: Track response times, error rates, queue depths
5. **Batch When Possible**: Process 100 items at once, not 1 by 1
6. **Retry with Backoff**: Transient failures disappear with exponential delays
7. **Cache Strategically**: Front-load with browser cache, back-end with Redis
8. **Pagination Always**: Never return unlimited results, start with 20
9. **Index Deliberately**: Only index columns used in WHERE/ORDER BY/JOINs
10. **Document Trade-offs**: Every optimization has a cost (complexity, infrastructure, money)