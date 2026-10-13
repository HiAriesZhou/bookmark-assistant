import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 4 does not consume rejected handler promises. */
export function asyncHandler<RequestType extends Request>(
  handler: (req: RequestType, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req as RequestType, res, next);
    } catch (error) {
      next(error);
    }
  };
}
