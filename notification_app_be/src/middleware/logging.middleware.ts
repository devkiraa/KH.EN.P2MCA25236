import { Request, Response, NextFunction } from 'express';
import { Log, setAuthToken } from 'logging-middleware';
import { getConfigFromRequest } from './config.middleware';

/**
 * Logging middleware that uses config from request context
 * Automatically sets auth token and logs requests to AffordMed evaluation service
 */
export const loggingMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = getConfigFromRequest(req);
    
    // Update token from current config
    setAuthToken(config.logger.apiToken);
    
    // Log the incoming request
    const logResult = await Log(
      'backend',
      'info',
      'middleware',
      `${req.method} ${req.path}`
    );

    // Attach log result to request for later use if needed
    (req as any).logResult = logResult;
    
  } catch (error) {
    console.error('Logging middleware error:', error);
    // Don't block request on logging failure
  }
  
  next();
};

/**
 * Response logging middleware to log completed responses
 */
export const responseLoggingMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const originalJson = res.json;

  res.json = function (data: any) {
    try {
      const config = getConfigFromRequest(req);
      setAuthToken(config.logger.apiToken);
      
      // Log response
      Log(
        'backend',
        'info',
        'middleware',
        `Response for ${req.method} ${req.path}: ${res.statusCode}`
      ).catch((err: Error) => console.error('Response logging error:', err));
    } catch (error) {
      console.error('Response logging middleware error:', error);
    }
    
    return originalJson.call(this, data);
  };

  next();
};
