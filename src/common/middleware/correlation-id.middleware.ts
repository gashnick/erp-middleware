import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const correlationId = req.headers['x-correlation-id'] as string || uuidv4();
    const requestId = uuidv4();

    (req as any).correlationId = correlationId;
    (req as any).requestId = requestId;

    res.setHeader('X-Correlation-ID', correlationId);
    res.setHeader('X-Request-ID', requestId);

    next();
  }
}
