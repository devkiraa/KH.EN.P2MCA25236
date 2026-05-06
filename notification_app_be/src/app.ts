import cors from 'cors';
import express from 'express';
import notificationRoutes from './routes/notification.routes';
import { errorMiddleware } from './middleware/error.middleware';
import { configMiddleware } from './middleware/config.middleware';
import { loggingMiddleware, responseLoggingMiddleware } from './middleware/logging.middleware';
import { getConfig, validateConfig } from './config';

const app = express();

// Validate configuration at startup
validateConfig();

const config = getConfig();

// ===== Middleware Stack =====
// 1. Config injection middleware (must be first)
app.use(configMiddleware);

// 2. CORS and JSON parsing
app.use(cors());
app.use(express.json());

// 3. Logging middleware (uses config from request context)
app.use(loggingMiddleware);
app.use(responseLoggingMiddleware);

// ===== Routes =====
app.get('/health', (_req, res) => {
  res.json({ 
    success: true, 
    message: 'Backend is running',
    config: {
      environment: config.environment,
      port: config.port
    }
  });
});

app.use('/api', notificationRoutes);

// ===== Error Handling =====
app.use(errorMiddleware);

// ===== Server Startup =====
app.listen(config.port, () => {
  console.log(`\n✓ Backend running on port ${config.port} (${config.environment})`);
  console.log(`✓ Logger API: ${config.logger.apiUrl}\n`);
});