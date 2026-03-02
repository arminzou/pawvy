import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';

export function applyCommonMiddleware(app: Express): void {
  // CORS
  app.use(cors());

  // Body parsing
  app.use(express.json());

  // Optional auth (only enforced when PAWVY_API_KEY is set)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { requireApiKey } = require('../../../../utils/auth');
  app.use('/api', requireApiKey({ allowPaths: ['/health', '/webhook'] }));

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}
