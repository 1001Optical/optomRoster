# [보안] NEXT_PUBLIC_API_TOKENS 서버 전용 환경 변수로 이동

> 상태: **완료**
> 우선순위: 즉시 적용 (Critical)

---

## 문제

`NEXT_PUBLIC_API_TOKENS`는 Optomate API의 Bearer 토큰이다.

Next.js에서 `NEXT_PUBLIC_` 접두사가 붙은 환경 변수는 **빌드 시 클라이언트 번들에 인라인**된다.
즉, 누구든 브라우저 DevTools → Sources 탭에서 토큰 값을 확인할 수 있다.

이 토큰을 사용하는 파일들(`optometrists.ts`, `appointment.ts`, `createOptomAccount.ts`)은 모두 서버 전용 lib 파일이므로, `NEXT_PUBLIC_` 접두사가 불필요하게 위험을 초래하고 있었다.

---

## 변경 내용

### 환경 변수

```diff
# .env.local
- NEXT_PUBLIC_API_TOKENS=<token>
+ API_TOKENS=<token>
```

### 수정된 파일

| 파일 | 변경 |
|------|------|
| `.env.local` | `NEXT_PUBLIC_API_TOKENS` → `API_TOKENS` |
| `src/lib/optometrists.ts:3` | `process.env.NEXT_PUBLIC_API_TOKENS` → `process.env.API_TOKENS` |
| `src/lib/appointment.ts:4` | `process.env.NEXT_PUBLIC_API_TOKENS` → `process.env.API_TOKENS` |
| `src/lib/createOptomAccount.ts:5` | `process.env.NEXT_PUBLIC_API_TOKENS` → `process.env.API_TOKENS` |

### 변경하지 않은 것

- `NEXT_PUBLIC_API_BASE_URL`: `loginModal.tsx` (클라이언트 컴포넌트)에서 사용 중이므로 유지
- `NEXT_PUBLIC_API_TOKENS`가 아닌 다른 `NEXT_PUBLIC_*` 변수들: 별도 검토 필요

---

## 사이드 이펙트 없음

이 세 파일은 `app/api/` 하위 API 라우트에서만 호출된다. 어떤 클라이언트 컴포넌트도 직접 import하지 않는다. `API_TOKENS` (NEXT_PUBLIC 없이)는 서버 런타임에서만 접근되어 클라이언트 번들에서 완전히 제거된다.

---

## 추가 필요 작업

**Vercel 배포 환경에서도 반드시 환경 변수를 업데이트해야 한다:**
1. Vercel 대시보드 → Settings → Environment Variables
2. `NEXT_PUBLIC_API_TOKENS` 삭제
3. `API_TOKENS` 추가 (동일한 토큰 값)

---

## 검증 방법

1. 로컬 서버 실행 후 브라우저 DevTools → Sources → 번들 파일에서 토큰 값이 보이지 않는지 확인
2. UI에서 날짜 선택 후 Refresh → Optomate 동기화 정상 동작 확인
3. `/api/cron/store-sync?store=BKT` 직접 호출 → 200 응답 확인

---

## 추가 발견된 버그

`src/components/modal/loginModal.tsx:107` 연산자 우선순위 버그:

```typescript
// 현재 (잘못됨) - (baseUrl + nextMode) === 'signup' 로 평가됨
const path = process.env.NEXT_PUBLIC_API_BASE_URL + nextMode === 'signup' ? '/auth/register' : '/auth/login';

// 올바른 코드
const path = process.env.NEXT_PUBLIC_API_BASE_URL + (nextMode === 'signup' ? '/auth/register' : '/auth/login');
```

이 버그는 별도 이슈로 처리 권장.
