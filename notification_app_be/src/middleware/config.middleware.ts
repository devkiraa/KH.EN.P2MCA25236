import { Request, Response, NextFunction } from 'express';
import { getConfig, AppConfig } from '../config';

/**
 * Extend Express Request to include config
 */
declare global {
  namespace Express {
    interface Request {
      config?: AppConfig;
    }
  }
}

/**
 * Middleware to inject centralized configuration into request context
 * Makes config available to all routes and services via req.config
 */
export const configMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  req.config = getConfig();
  next();
};

/**
 * Helper function to get config from request (throws if not available)
 */
export const getConfigFromRequest = (req: Request): AppConfig => {
  if (!req.config) {
    throw new Error('Configuration middleware not initialized');
  }
  return req.config;
};
