import pino from 'pino';
import type { Writable } from 'node:stream';

/**
 * Structured Pino logger with automated PII redaction.
 * Redacts email addresses, authorization headers, passwords, and sensitive tokens.
 */
const options = {
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.x-razorpay-signature',
      'req.headers.referer',
      'req.headers.referrer',
      'res.headers.set-cookie',
      'res.headers.authorization',
      'req.url',
      'req.query',
      'req.params',
      'req.body.password',
      'req.body.passwordConfirmation',
      'req.body.token',
      'req.body.email',
      'email',
      'password',
      'token',
      'secret',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
} satisfies pino.LoggerOptions;

export function createLogger(destination?: Writable) {
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();
