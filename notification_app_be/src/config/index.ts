import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface AppConfig {
  port: number;
  environment: string;
  logger: {
    apiUrl: string;
    apiToken: string;
    timeout: number;
  };
  database?: {
    url: string;
    pool: number;
  };
}

/**
 * Centralized configuration management
 * All values come from environment variables, no hardcoding
 */
export const getConfig = (): AppConfig => {
  const port = Number(process.env.PORT || 4000);
  const environment = process.env.NODE_ENV || 'development';
  
  const loggerApiUrl = process.env.LOG_API_URL || 'http://20.244.56.144/evaluation-service/logs';
  const loggerApiToken = process.env.ACCESS_TOKEN || process.env.API_TOKEN || '';
  const loggerTimeout = Number(process.env.LOGGER_TIMEOUT || 15000);

  const databaseUrl = process.env.DATABASE_URL;
  const databasePool = Number(process.env.DATABASE_POOL || 10);

  return {
    port,
    environment,
    logger: {
      apiUrl: loggerApiUrl,
      apiToken: loggerApiToken,
      timeout: loggerTimeout
    },
    ...(databaseUrl && {
      database: {
        url: databaseUrl,
        pool: databasePool
      }
    })
  };
};

// Validate critical config at startup
export const validateConfig = (): void => {
  const config = getConfig();
  
  if (!config.logger.apiToken) {
    console.warn('⚠️  Warning: Logger API token not configured (ACCESS_TOKEN or API_TOKEN)');
  }
  
  console.log(`✓ Configuration loaded (env: ${config.environment}, port: ${config.port})`);
};
