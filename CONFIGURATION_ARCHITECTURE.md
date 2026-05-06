# Configuration Management Architecture

## Overview

The notification system now uses a **centralized, environment-based configuration** approach that eliminates hardcoding and provides a clean middleware-based injection pattern.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Express Application                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│             Config Middleware (configMiddleware)             │
│  • Reads all env vars via getConfig()                       │
│  • Injects config into req.config                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│          Logging Middleware (loggingMiddleware)              │
│  • Gets config from req.config                              │
│  • Sets auth token dynamically                              │
│  • Logs requests to AffordMed API                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│            Application Routes & Services                    │
│  • Access config via getConfigFromRequest(req)              │
│  • No hardcoded values anywhere                             │
│  • All config comes from environment                        │
└─────────────────────────────────────────────────────────────┘
```

## Configuration Flow

1. **Application Startup** (`src/app.ts`)
   - Calls `validateConfig()` to verify critical environment variables
   - Applies `configMiddleware` early in the middleware stack
   - Applies `loggingMiddleware` that uses injected config

2. **Request Processing**
   - Every incoming request has `req.config` populated by `configMiddleware`
   - Logging middleware automatically updates auth token from config
   - Routes and services access config via `getConfigFromRequest(req)`

3. **Configuration Source**
   - All values come from `.env` file
   - Environment variables override `.env` defaults
   - `src/config/index.ts` defines the schema and defaults

## Environment Variables

### Backend (.env file)

```
# Server
PORT=4000
NODE_ENV=development

# Logger
LOG_API_URL=http://20.244.56.144/evaluation-service/logs
ACCESS_TOKEN=<your_jwt_token>
LOGGER_TIMEOUT=15000

# Database (optional)
DATABASE_URL=postgresql://user:password@localhost:5432/notifications
DATABASE_POOL=10
```

### Logging Middleware (.env file in logging_middleware/)

```
LOG_API_URL=http://20.244.56.144/evaluation-service/logs
ACCESS_TOKEN=<your_jwt_token>
LOGGER_TIMEOUT=15000
```

## Usage Examples

### In Routes

```typescript
import { getConfigFromRequest } from '../middleware/config.middleware';

router.get('/my-endpoint', (req, res) => {
  const config = getConfigFromRequest(req);
  
  // Access any config value
  console.log(config.port);
  console.log(config.logger.apiUrl);
  console.log(config.environment);
  
  res.json({ success: true });
});
```

### In Services

```typescript
export function myService(req: Request): void {
  const config = getConfigFromRequest(req);
  
  // Use config for service logic
  if (config.environment === 'production') {
    // Production-specific logic
  }
}
```

### In Custom Middleware

```typescript
export const myMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const config = getConfigFromRequest(req);
  
  // Use config in middleware
  if (config.logger.apiToken) {
    // Token is configured
  }
  
  next();
};
```

## Key Files

| File | Purpose |
|------|---------|
| `src/config/index.ts` | Configuration schema and defaults |
| `src/middleware/config.middleware.ts` | Middleware that injects config into requests |
| `src/middleware/logging.middleware.ts` | Logging middleware that uses injected config |
| `.env` | Runtime environment variables |
| `.env.example` | Template for required environment variables |

## Benefits

✅ **No Hardcoding**: All values from environment  
✅ **Type-Safe**: TypeScript interfaces for config  
✅ **Middleware Pattern**: Config injected into request context  
✅ **Centralized**: Single source of truth in `src/config/index.ts`  
✅ **Testable**: Easy to mock config for testing  
✅ **Scalable**: Easy to add new config values  
✅ **Security**: Secrets never exposed in route/service code  

## Adding New Configuration Values

1. Add to `.env` and `.env.example`:
   ```
   MY_NEW_VALUE=some_value
   ```

2. Update `src/config/index.ts`:
   ```typescript
   export interface AppConfig {
     // ... existing fields
     myNewValue: string;
   }

   export const getConfig = (): AppConfig => {
     // ... existing code
     const myNewValue = process.env.MY_NEW_VALUE || 'default_value';
     
     return {
       // ... existing values
       myNewValue,
     };
   };
   ```

3. Use in routes/services:
   ```typescript
   const config = getConfigFromRequest(req);
   console.log(config.myNewValue);
   ```

## Testing Configuration Endpoint

The backend exposes a `/config` endpoint to view non-sensitive configuration:

```bash
curl http://localhost:4000/api/config
```

Response:
```json
{
  "success": true,
  "config": {
    "environment": "development",
    "port": 4000,
    "logger": {
      "apiUrl": "http://20.244.56.144/evaluation-service/logs",
      "timeout": 15000
    }
  }
}
```

Note: Sensitive values like `ACCESS_TOKEN` are never exposed in this endpoint.
