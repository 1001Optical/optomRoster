import { Axiom } from "@axiomhq/js";
import { Logger, AxiomJSTransport, LogLevel } from "@axiomhq/logging";
import { nextJsFormatters } from "@axiomhq/nextjs";

const AXIOM_TOKEN =
  process.env.AXIOM_TOKEN ?? process.env.NEXT_PUBLIC_AXIOM_TOKEN;
const AXIOM_DATASET =
  process.env.AXIOM_DATASET ?? process.env.NEXT_PUBLIC_AXIOM_DATASET;

function getAxiomLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL as LogLevel | undefined;
  if (level && level in LogLevel) {
    return level;
  }

  return process.env.NODE_ENV === "production" ? "warn" : "debug";
}

export const isAxiomConfigured = Boolean(AXIOM_TOKEN && AXIOM_DATASET);

export const axiomLogger = isAxiomConfigured
  ? new Logger({
      logLevel: getAxiomLogLevel(),
      transports: [
        new AxiomJSTransport({
          axiom: new Axiom({ token: AXIOM_TOKEN! }),
          dataset: AXIOM_DATASET!,
        }),
      ],
      formatters: nextJsFormatters,
      args: {
        app: "optomRoster",
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      },
    })
  : null;

export async function flushAxiomLogs(): Promise<void> {
  if (!axiomLogger) return;
  await axiomLogger.flush();
}
