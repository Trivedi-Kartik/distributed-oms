import { Consumer, Producer } from "kafkajs";
import { DeadLetterEnvelope } from "./index";
import { context, trace } from "@opentelemetry/api";
import { extractTraceContext } from "./tracingContext";

interface ConsumerHandlerOptions {
  consumer: Consumer;
  producer: Producer;
  consumerGroup: string;
  dlqTopic: string;
  maxRetries?: number;
  initialBackoffMs?: number;
  handler: (payload: any, rawMessage: any) => Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runResilientConsumer({
  consumer,
  producer,
  consumerGroup,
  dlqTopic,
  maxRetries = 3,
  initialBackoffMs = 500,
  handler,
}: ConsumerHandlerOptions): Promise<void> {
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      if (!message.value) return;

      const rawValue = message.value.toString();
      let parsedPayload: any;

      try {
        parsedPayload = JSON.parse(rawValue);
      } catch (parseError: any) {
        console.error(
          `[DLQ] Non-parseable JSON on ${topic} [P${partition}@${message.offset}]. Routing to DLQ.`,
        );
        await sendToDLQ(
          producer,
          dlqTopic,
          topic,
          rawValue,
          parseError,
          0,
          consumerGroup,
        );
        return;
      }

      // Check required envelope fields
      if (!parsedPayload.eventId || typeof parsedPayload.eventId !== "string") {
        const validationError = new Error(
          "SchemaViolation: Missing required eventId envelope property",
        );
        console.error(
          `[DLQ] Schema validation failed on ${topic} [P${partition}@${message.offset}]: missing eventId.`,
        );
        await sendToDLQ(
          producer,
          dlqTopic,
          topic,
          parsedPayload,
          validationError,
          0,
          consumerGroup,
        );
        return;
      }

      const parentContext = extractTraceContext(message.headers || {});
      const tracer = trace.getTracer("oms-consumer");

      let attempt = 0;
      while (true) {
        try {
          // Run the service handler inside the extracted trace context
          await context.with(parentContext, async () => {
            const span = tracer.startSpan(`process ${topic} message`);
            try {
              await handler(parsedPayload, message);
            } finally {
              span.end();
            }
          });
          return;
        } catch (err: any) {
          attempt++;
          console.warn(
            `[Consumer Warning] Error processing event from ${topic} (Attempt ${attempt}/${maxRetries}): ${err.message}`,
          );

          if (attempt >= maxRetries) {
            console.error(
              `[DLQ Alert] Max retries exhausted for event on ${topic}. Sending to ${dlqTopic}.`,
            );
            await sendToDLQ(
              producer,
              dlqTopic,
              topic,
              parsedPayload,
              err,
              attempt,
              consumerGroup,
            );
            return;
          }

          const backoff = initialBackoffMs * Math.pow(2, attempt - 1);
          await sleep(backoff);
        }
      }
    },
  });
}

async function sendToDLQ(
  producer: Producer,
  dlqTopic: string,
  originalTopic: string,
  originalMessage: any,
  error: any,
  retryCount: number,
  consumerGroup: string,
): Promise<void> {
  const deadLetterPayload: DeadLetterEnvelope = {
    originalTopic,
    originalMessage,
    error: {
      message: error?.message || "Unknown error",
      stack: error?.stack,
    },
    failedAt: new Date().toISOString(),
    retryCount,
    consumerGroup,
  };

  await producer.send({
    topic: dlqTopic,
    messages: [
      {
        value: JSON.stringify(deadLetterPayload),
        headers: {
          "x-dead-letter-reason": error?.message || "ProcessingFailure",
        },
      },
    ],
  });
}
