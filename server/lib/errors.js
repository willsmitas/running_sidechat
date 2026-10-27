export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (msg, extra) => new HttpError(400, msg, extra);
export const unauthorized = (msg = 'Log in to continue.') => new HttpError(401, msg);
export const forbidden = (msg = 'You do not have access to this.', extra) => new HttpError(403, msg, extra);
export const notFound = (msg = 'Not found.') => new HttpError(404, msg);
export const tooMany = (msg = 'Slow down — try again in a bit.') => new HttpError(429, msg);
