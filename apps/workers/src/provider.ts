import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { withSpan } from './tracing.js';

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  headers: Record<string, string>;
}
export interface EmailProvider {
  send(message: EmailMessage): Promise<string>;
  close(): Promise<void>;
}
export class EmailRejectedError extends Error {
  constructor(public readonly retryable: boolean) {
    super(
      retryable ? 'Provider temporarily rejected email' : 'Provider permanently rejected email',
    );
  }
}
function smtpRejection(error: unknown): EmailRejectedError | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'responseCode' in error &&
    typeof error.responseCode === 'number'
  ) {
    if (error.responseCode >= 400 && error.responseCode < 500) return new EmailRejectedError(true);
    if (error.responseCode >= 500 && error.responseCode < 600) return new EmailRejectedError(false);
  }
  return null;
}
export function createEmailProvider(config: {
  mode: 'smtp' | 'ses' | 'stub';
  production: boolean;
  smtpHost: string;
  smtpPort: number;
  region: string;
  verifiedAddresses: string[];
}): EmailProvider {
  if (config.production && config.mode === 'smtp')
    throw new Error('SMTP is only for local Mailpit');
  if (config.mode === 'stub')
    return {
      async send() {
        return `stub-${randomUUID()}`;
      },
      async close() {},
    };
  if (config.mode === 'ses') {
    // The SDK must not retry a send after an ambiguous transport failure.
    const ses = new SESv2Client({ region: config.region, maxAttempts: 1 });
    return {
      async send(message) {
        if (!config.production || !config.verifiedAddresses.includes(message.to.toLowerCase()))
          throw new Error('SES recipient is not verified');
        const result = await withSpan('email.ses.send', null, () =>
          ses.send(
            new SendEmailCommand({
              FromEmailAddress: message.from,
              Destination: { ToAddresses: [message.to] },
              Content: {
                Simple: {
                  Subject: { Data: message.subject },
                  Body: { Html: { Data: message.html } },
                  Headers: Object.entries(message.headers).map(([Name, Value]) => ({
                    Name,
                    Value,
                  })),
                },
              },
            }),
            { abortSignal: AbortSignal.timeout(10_000) },
          ),
        );
        if (!result.MessageId) throw new Error('SES returned no message id');
        return result.MessageId;
      },
      async close() {
        ses.destroy();
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: false,
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 10_000,
    pool: true,
    maxConnections: 2,
  });
  return {
    async send(message) {
      try {
        const result = await withSpan('email.smtp.send', null, () => transport.sendMail(message));
        return result.messageId;
      } catch (error) {
        throw smtpRejection(error) ?? error;
      }
    },
    async close() {
      transport.close();
    },
  };
}
