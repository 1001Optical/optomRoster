import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
    /* config options here */
    // basePath: "/roster"
};

export default withSentryConfig(nextConfig, {
    org: "1001-optical",
    project: "optomroster",

    // 소스맵 업로드 비활성화 (SENTRY_AUTH_TOKEN 없이도 동작)
    sourcemaps: {
        disable: true,
    },

    // 빌드 시 Sentry CLI 출력 숨김
    silent: true,

    // 자동 계측 비활성화 (필요 시 켜기)
    webpack: {
        autoInstrumentServerFunctions: false,
        autoInstrumentMiddleware: false,
        autoInstrumentAppDirectory: false,
    },
});
