import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as Request & { requestId?: string }).requestId ?? uuidv4();
  const e = err as Error & { status?: number; code?: string };

  const status  = e.status ?? 500;
  const code    = e.code   ?? 'INTERNAL_ERROR';
  const message = e.message ?? 'An unexpected error occurred';

  console.error(`[error] ${status} ${code}: ${message}`, e.stack);

  res.status(status).json({
    error: {
      code,
      message,
      ...(process.env.NODE_ENV !== 'production' && { stack: e.stack }),
      request_id: requestId,
    },
  });
}
