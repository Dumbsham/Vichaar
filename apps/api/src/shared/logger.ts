import pino from 'pino';

/**
 * Structured Pino logger with automated PII redaction.
 * Redacts email addresses, authorization headers, passwords, and sensitive tokens.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.referer',
      'req.headers.referrer',
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
});
