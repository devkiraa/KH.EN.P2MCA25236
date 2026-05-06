import { NextFunction, Request, Response } from 'express';

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = error instanceof Error ? error.message : 'Internal server error';
  res.status(500).json({ success: false, message });
}