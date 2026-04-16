import { flushAxiomLogs } from "@/lib/axiom/server";

/**
 * 서버리스/Edge 종료 전 Axiom 버퍼를 비웁니다.
 * API 라우트 핸들러 전체를 이 함수로 감싸면 요청 종료 시 로그가 유실되지 않습니다.
 */
export async function withAxiomFlush<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    await flushAxiomLogs().catch(() => {});
  }
}
