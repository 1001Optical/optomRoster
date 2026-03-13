import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,

    // 프로덕션에서만 에러 캡처 (개발 중 노이즈 방지)
    enabled: process.env.NODE_ENV === "production",

    // 샘플링 비율 (1.0 = 100%)
    tracesSampleRate: 0.1,

    // 클라이언트 에러 중 무시할 목록
    ignoreErrors: [
        "ResizeObserver loop limit exceeded",
        "Non-Error promise rejection captured",
    ],
});
