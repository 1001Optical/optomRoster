import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,

    enabled: process.env.NODE_ENV === "production",

    // 서버 사이드는 트레이스 낮게 (비용 절감)
    tracesSampleRate: 0.05,
});
