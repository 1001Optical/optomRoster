# 04. 구조화된 로거 도입 (console.log 정리)

> 작성일: 2026-03-12

---

## 현황 분석

- **총 파일 수**: 27개 파일에 console.log/warn/error 존재
- **총 호출 수**: ~280건
- **기존 로거 유틸리티**: 없음
- **로깅 라이브러리**: package.json에 없음

### 심각도별 분류

#### 🔴 즉시 제거 (보안 위험)
| 파일 | 내용 |
|------|------|
| `src/lib/createOptomAccount.ts` L85 | `console.log("Token: ", API_TOKEN)` — API 토큰 노출 |
| `src/lib/optometrists.ts` L54 | `console.log('API_TOKEN: ${API_TOKEN}')` — API 토큰 노출 |
| `src/lib/createOptomAccount.ts` L84 | `console.log("BODY: ", body)` — 비밀번호 포함 요청 바디 전체 노출 |

#### 🟠 개인정보 포함 로그 (정리 대상)
| 파일 | 건수 | 포함 데이터 |
|------|------|-------------|
| `changeProcessor.ts` | 44건 | 이름, 이메일, 매장코드, 예약 충돌 정보 |
| `createOptomAccount.ts` | 22건 | 이름, 이메일, username 생성 과정 |
| `postEmail.ts` | 12건 | 이메일 주소, 매장명, 웹훅 URL |
| `optometrists.ts` | 15건 | 이름, 이메일, externalId |
| `getEmploymentHeroList.ts` | 20건 | 직원 이름, employeeId |
| `syncRoster.ts` | 21건 | 이름, locationId, branch |

#### 🟡 디버그 로그 (개발 환경만 허용)
| 파일 | 건수 |
|------|------|
| `src/app/page.tsx` | 12건 |
| `src/components/AlertToast.tsx` | 13건 |
| `src/app/optom-count/page.tsx` | 3건 |
| `src/utils/fetch_utils.ts` | 28건 |

---

## 구현 계획

### Step 1: `src/lib/logger.ts` 생성

외부 라이브러리 없이 경량 구조화 로거 구현:

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// 환경변수로 레벨 제어: LOG_LEVEL=debug|info|warn|error
// 기본값: production → warn, development → debug
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3
};

function getMinLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL as LogLevel;
  if (envLevel && envLevel in LOG_LEVELS) return envLevel;
  return process.env.NODE_ENV === 'production' ? 'warn' : 'debug';
}

// 개인정보 마스킹 유틸
export function maskEmail(email: string): string {
  return email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
}
export function maskName(name: string): string {
  return name.length > 1 ? name[0] + '*'.repeat(name.length - 1) : name;
}

export function createLogger(module: string) {
  const minLevel = LOG_LEVELS[getMinLevel()];

  const log = (level: LogLevel, msg: string, ctx?: Record<string, unknown>) => {
    if (LOG_LEVELS[level] < minLevel) return;
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${module}]`;
    if (level === 'error') {
      console.error(prefix, msg, ctx ?? '');
    } else if (level === 'warn') {
      console.warn(prefix, msg, ctx ?? '');
    } else {
      console.log(prefix, msg, ctx ?? '');
    }
  };

  return {
    debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, ctx),
    info:  (msg: string, ctx?: Record<string, unknown>) => log('info',  msg, ctx),
    warn:  (msg: string, ctx?: Record<string, unknown>) => log('warn',  msg, ctx),
    error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
  };
}
```

`.env` 에 추가:
```
LOG_LEVEL=warn   # production
# LOG_LEVEL=debug  # development
```

---

### Step 2: 즉시 제거 대상 처리 (보안)

`createOptomAccount.ts`, `optometrists.ts`의 토큰/비밀번호 로그 **즉시 삭제**

---

### Step 3: 서버사이드 파일 마이그레이션 (우선순위 높은 순)

각 파일 상단에 `const logger = createLogger('모듈명')` 추가 후 교체:

| 파일 | 모듈명 | 규칙 |
|------|--------|------|
| `changeProcessor.ts` | `ChangeProcessor` | 이름 → `maskName`, 이메일 → `maskEmail` |
| `createOptomAccount.ts` | `CreateOptomAccount` | 토큰/바디 로그 삭제, 나머지 info/debug |
| `postEmail.ts` | `PostEmail` | 이메일 → `maskEmail`, 웹훅 URL info |
| `optometrists.ts` | `Optometrists` | 토큰 로그 삭제, 이름/이메일 마스킹 |
| `syncRoster.ts` | `SyncRoster` | 이름 마스킹, 중요 이벤트 info |
| `getEmploymentHeroList.ts` | `EHList` | 직원명 마스킹 |
| `getAppointmentCount.ts` | `AppointmentCount` | URL info, 상세 debug |

---

### Step 4: 클라이언트사이드 정리

- `src/app/page.tsx`: `process.env.NODE_ENV === 'development'` 조건 추가 또는 불필요 로그 삭제
- `src/components/AlertToast.tsx`: 렌더링마다 찍히는 7개 `console.log` → **모두 삭제** (디버깅용, 이미 완료된 기능)
- `src/utils/fetch_utils.ts`: 응답 전체 로그 → 카운트만 남기기
- `src/app/optom-count/page.tsx`: 기존 `[OPTOM COUNT]` 로그 유지 (info 레벨)

---

## 파일 구조 변경

```
src/
└── lib/
    └── logger.ts   ← 신규 생성
```

---

## 적용 후 기대 효과

| 항목 | 전 | 후 |
|------|----|----|
| API 토큰 노출 | 있음 | 없음 |
| 개인정보(이메일/이름) 노출 | 로그에 평문 | 마스킹 처리 |
| 프로덕션 로그 노이즈 | ~280건 무조건 출력 | warn/error만 출력 |
| 개발 환경 디버깅 | 동일 | debug 레벨로 전체 확인 가능 |
| 로그 추적 | 모듈 구분 없음 | `[ChangeProcessor]`, `[PostEmail]` 등 태그로 추적 |

---

## 작업 순서

1. `src/lib/logger.ts` 생성
2. `.env` / `.env.example`에 `LOG_LEVEL` 추가
3. 🔴 즉시 제거: `createOptomAccount.ts`, `optometrists.ts` 토큰/바디 로그 삭제
4. 서버사이드 파일 순서대로 마이그레이션 (changeProcessor → syncRoster → postEmail → optometrists → getEmploymentHeroList → getAppointmentCount)
5. 클라이언트사이드 정리 (AlertToast 불필요 로그 삭제, page.tsx 조건부 처리)
6. 빌드 + 동작 검증 후 커밋
