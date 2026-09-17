import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import { localRequestGuard, mutationRequestGuard, noStoreApiResponses, securityHeaders } from './http/security.js';
import apiRouter from './routes/api.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.use(securityHeaders);
  app.use(localRequestGuard({ host: config.host }));
  app.use(noStoreApiResponses);
  app.use('/api', mutationRequestGuard, apiRouter);
  app.use(express.static(config.publicDir, {
    extensions: ['html'],
    etag: false,
    maxAge: 0,
    setHeaders(response) {
      response.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get('*', (_request, response) => response.sendFile(path.join(config.publicDir, 'index.html')));

  app.use((error, _request, response, _next) => {
    console.error('[http]', error?.name || 'error', error?.message || error);
    if (response.headersSent) return response.end();
    return response.status(500).json({ error: 'Unexpected local server error.' });
  });

  return app;
}
