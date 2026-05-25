import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { clerkMiddleware } from '@clerk/express';
import { v4 as uuidv4 } from 'uuid';
import { ingestRouter } from './routes/ingest';
import { surfaceRouter } from './routes/surface';
import { errorHandler } from './middleware/error';

const app  = express();
const PORT = parseInt(process.env.API_PORT || '3000', 10);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Attach a request ID to every request
app.use((req, res, next) => {
  (req as express.Request & { requestId: string }).requestId = uuidv4();
  next();
});

// Dev-mode auth bypass: inject a fixed userId so routes work without Clerk keys
if (process.env.NODE_ENV === 'development' && process.env.DEV_USER_ID) {
  const devUserId = process.env.DEV_USER_ID;
  app.use((req, _res, next) => {
    (req as express.Request & { auth: { userId: string } }).auth = { userId: devUserId };
    next();
  });
} else {
  // Clerk auth — adds req.auth to all requests; routes decide if auth is required
  app.use(clerkMiddleware());
}

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/ingest', ingestRouter);
app.use('/api',       surfaceRouter);   // handles /api/surface/*, /api/graveyard/*, /api/notifications/*

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `${req.method} ${req.path} not found`,
      request_id: (req as express.Request & { requestId?: string }).requestId ?? uuidv4(),
    },
  });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[api] listening on port ${PORT} (${process.env.NODE_ENV})`);
});

export default app;
