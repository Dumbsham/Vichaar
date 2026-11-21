import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('vichaar.api.external');
export async function withExternalSpan<T>(name: string, operation: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try { return await operation(); }
    catch (error) {
      span.recordException(new Error('External operation failed'));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally { span.end(); }
  });
}

export function startApiTracing(endpoint: string | undefined) {
  if (!endpoint) return { shutdown: async () => {} };
  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
    timeoutMillis: 3000,
  });
  const provider = new NodeTracerProvider({
    spanProcessors: [
      new BatchSpanProcessor(exporter, { maxQueueSize: 1000, scheduledDelayMillis: 1000 }),
    ],
  });
  provider.register();
  return { shutdown: () => provider.shutdown() };
}
