import { Axiom } from "@axiomhq/js";
import { Logger, AxiomJSTransport, LogLevel } from "@axiomhq/logging";
import { nextJsFormatters } from "@axiomhq/nextjs";

const AXIOM_TOKEN =
  process.env.AXIOM_TOKEN ?? process.env.NEXT_PUBLIC_AXIOM_TOKEN;
const AXIOM_DATASET =
  process.env.AXIOM_DATASET ?? process.env.NEXT_PUBLIC_AXIOM_DATASET;

/**
 * Axiom JS Logger의 내부 필터입니다.
 * 앱에서는 `logger.ts`의 `AXIOM_LOG_LEVEL`(수집 최소 레벨)로 한 번 더 거릅니다.
 * 여기서는 가능한 한 낮게 두어, 앱에서 보낸 레벨이 SDK에서 잘리지 않게 합니다.
 */
function getAxiomSdkLogLevel(): LogLevel {
  const raw = process.env.AXIOM_SDK_LOG_LEVEL as LogLevel | undefined;
  if (raw && raw in LogLevel) {
    return raw;
  }
  return LogLevel.debug;
}

export const isAxiomConfigured = Boolean(AXIOM_TOKEN && AXIOM_DATASET);

export const axiomLogger = isAxiomConfigured
  ? new Logger({
      logLevel: getAxiomSdkLogLevel(),
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
