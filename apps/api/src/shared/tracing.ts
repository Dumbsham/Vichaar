import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

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
