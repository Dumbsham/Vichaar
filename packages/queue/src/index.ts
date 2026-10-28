import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  CreateQueueCommand,
  DeleteQueueCommand,
} from '@aws-sdk/client-sqs';
import { z } from 'zod';
import { trace, SpanStatusCode } from '@opentelemetry/api';

const uuid = z.string().uuid();
const key = z.object({
  publicationId: uuid,
  postId: uuid,
  subscriptionId: uuid,
  sendMonth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  correlationId: z.string().max(64).optional(),
});
export const eventMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PostPublished'),
    eventId: z.number().int(),
    publicationId: uuid,
    postId: uuid,
    scheduledFor: z.string().datetime().nullable(),
    sendImmediately: z.boolean(),
    correlationId: z.string().max(64),
  }),
  z.object({
    type: z.literal('SubscriptionConfirmationRequested'),
    eventId: z.number().int(),
    publicationId: uuid,
    subscriptionId: uuid,
    exp: z.number().int(),
    correlationId: z.string().max(64),
  }),
  z.object({
    type: z.literal('FanoutPage'),
    publicationId: uuid,
    postId: uuid,
    afterId: uuid.nullable(),
    scheduledFor: z.string().datetime().nullable(),
    sendImmediately: z.boolean(),
    correlationId: z.string().max(64),
  }),
]);
export const sendMessage = z.object({
  type: z.literal('SendBatch'),
  keys: z.array(key).min(1).max(100),
  correlationId: z.string().max(64),
});
export type EventMessage = z.infer<typeof eventMessage>;
export type SendMessage = z.infer<typeof sendMessage>;
export type DeliveryKey = z.infer<typeof key>;
export interface Received<T> {
  body: T;
  receipt: string;
}
export interface Queue<T> {
  send(message: T): Promise<void>;
  receive(): Promise<Received<T>[]>;
  delete(receipt: string): Promise<void>;
  depth(): Promise<number>;
}
const tracer = trace.getTracer('vichaar.queue');
async function traced<T>(name: string, operation: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await operation();
    } catch (error) {
      span.recordException(new Error('Queue call failed'));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
export function createSqsQueues(config: {
  endpoint?: string;
  region: string;
  baseUrl: string;
  eventsName?: string;
  sendsName?: string;
}) {
  const client = new SQSClient({
    region: config.region,
    maxAttempts: 3,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
  });
  const eventsName = config.eventsName ?? 'vichaar-events';
  const sendsName = config.sendsName ?? 'vichaar-sends';
  function makeQueue<T>(name: string, schema: z.ZodType<T>, receiveBatch = 10): Queue<T> {
    const url = `${config.baseUrl.replace(/\/$/, '')}/${name}`;
    return {
      async send(message) {
        await traced('sqs.send', () =>
          client.send(
            new SendMessageCommand({
              QueueUrl: url,
              MessageBody: JSON.stringify(schema.parse(message)),
            }),
            { abortSignal: AbortSignal.timeout(5000) },
          ),
        );
      },
      async receive() {
        const result = await traced('sqs.receive', () =>
          client.send(
            new ReceiveMessageCommand({
              QueueUrl: url,
              MaxNumberOfMessages: receiveBatch,
              WaitTimeSeconds: 10,
            }),
            { abortSignal: AbortSignal.timeout(15000) },
          ),
        );
        return (result.Messages ?? []).flatMap((message) => {
          if (!message.Body || !message.ReceiptHandle) return [];
          return [{ body: schema.parse(JSON.parse(message.Body)), receipt: message.ReceiptHandle }];
        });
      },
      async delete(receipt) {
        await traced('sqs.delete', () =>
          client.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: receipt }), {
            abortSignal: AbortSignal.timeout(5000),
          }),
        );
      },
      async depth() {
        const result = await traced('sqs.depth', () =>
          client.send(
            new GetQueueAttributesCommand({
              QueueUrl: url,
              AttributeNames: ['ApproximateNumberOfMessages'],
            }),
            { abortSignal: AbortSignal.timeout(5000) },
          ),
        );
        return Number(result.Attributes?.ApproximateNumberOfMessages ?? 0);
      },
    };
  }
  const localOnly = () => {
    if (!config.endpoint || !/^http:\/\/(localhost|127\.0\.0\.1):9324$/.test(config.endpoint))
      throw new Error('Local queue lifecycle requires local ElasticMQ');
  };
  return {
    events: makeQueue(eventsName, eventMessage),
    sends: makeQueue(sendsName, sendMessage, 1),
    async createLocalQueues() {
      localOnly();
      for (const name of [eventsName, sendsName])
        await client.send(new CreateQueueCommand({ QueueName: name }));
    },
    async deleteLocalQueues() {
      localOnly();
      for (const name of [eventsName, sendsName])
        await client.send(
          new DeleteQueueCommand({ QueueUrl: `${config.baseUrl.replace(/\/$/, '')}/${name}` }),
        );
    },
    close: () => client.destroy(),
  };
}
