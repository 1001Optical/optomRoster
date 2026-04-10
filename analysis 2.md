# OptomRoster 프로젝트 분석 문서

> 작성일: 2026-03-12
> 분석 대상: `/Users/jh_cho/Desktop/1001Project/optomRoster`

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [프로젝트 구조](#2-프로젝트-구조)
3. [기술 스택 및 의존성](#3-기술-스택-및-의존성)
4. [아키텍처 설계](#4-아키텍처-설계)
5. [데이터베이스 스키마](#5-데이터베이스-스키마)
6. [API 라우트 분석](#6-api-라우트-분석)
7. [핵심 라이브러리 함수 분석](#7-핵심-라이브러리-함수-분석)
8. [유틸리티 분석](#8-유틸리티-분석)
9. [React 컴포넌트 분석](#9-react-컴포넌트-분석)
10. [외부 서비스 및 API 연동](#10-외부-서비스-및-api-연동)
11. [환경 변수 및 설정](#11-환경-변수-및-설정)
12. [인증 및 보안](#12-인증-및-보안)
13. [비즈니스 로직 흐름](#13-비즈니스-로직-흐름)
14. [매장 데이터 (stores.ts)](#14-매장-데이터-storets)
15. [잠재적 버그 및 문제점](#15-잠재적-버그-및-문제점)
16. [코드 품질 평가](#16-코드-품질-평가)
17. [개선 제안](#17-개선-제안)
18. [종합 평가](#18-종합-평가)

---

## 1. 프로젝트 개요

**OptomRoster**는 1001 Optical 안경체인의 검안사(Optometrist) 근무표를 자동으로 동기화하고 관리하는 내부 운영 도구다.

### 핵심 기능
- **Employment Hero (HR 시스템)**에서 근무 스케줄을 가져와 SQLite DB에 저장
- DB에 저장된 변경사항을 감지해 **Optomate (예약 시스템)**에 자동으로 반영
- 슬롯 미스매치(예상 예약 슬롯 vs 실제 예약 수 불일치) 감지 및 알림
- 예약 충돌(근무표 삭제 시 예약이 남아 있는 경우) 감지 및 알림
- Make.com 웹훅을 통한 이메일 자동 발송 (신규/기존 검안사 온보딩)
- Vercel Cron을 이용한 매장별 자동 동기화

### 운영 규모
- **매장 수**: 16개 옵토메트리 매장 + 헤드오피스 (NSW 12개, VIC 3개, QLD 1개)
- **대상**: 검안사(정규직 + 로컴) 전원

---

## 2. 프로젝트 구조

```
optomRoster/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── appointments/
│   │   │   │   ├── count/route.ts         # 매장별 예약 카운트 조회
│   │   │   │   └── sync/route.ts          # 예약 캐시 동기화
│   │   │   ├── cron/
│   │   │   │   ├── low-stock/route.ts     # 재고 부족 알림 (매주 수요일)
│   │   │   │   └── store-sync/route.ts    # 매장별 자동 동기화
│   │   │   └── roster/
│   │   │       ├── cleanup-past-data/     # 과거 데이터 삭제
│   │   │       ├── getList/route.ts       # 근무표 목록 조회 (DB 직접)
│   │   │       ├── input/route.ts         # CSV 파싱 (수동 입력)
│   │   │       ├── optom-count/           # 검안사 수 조회
│   │   │       ├── refresh/route.ts       # Employment Hero에서 동기화 (메인)
│   │   │       └── send-conflict-email/   # 충돌 이메일 발송
│   │   ├── layout.tsx                     # 루트 레이아웃
│   │   ├── page.tsx                       # 메인 UI (달력 + 선택기 + 테이블)
│   │   └── optom-count/page.tsx           # 검안사 카운트 페이지
│   ├── components/
│   │   ├── AlertToast.tsx                 # 충돌/슬롯 미스매치 알림
│   │   ├── IooICalendar.tsx               # 날짜 범위 선택기
│   │   ├── IooISelect.tsx                 # 매장/주(State) 선택기
│   │   ├── modal/loginModal.tsx           # 로그인 모달
│   │   └── table.tsx                      # 근무표 테이블
│   ├── lib/
│   │   ├── api-client/EmploymentHeroClient.ts  # Employment Hero API 클라이언트
│   │   ├── appointment.ts                 # Optomate 예약 조정 API
│   │   ├── changeProcessor.ts             # 변경 감지 및 처리 (핵심)
│   │   ├── checkIdentifierCount.ts        # Optomate 식별자 중복 확인
│   │   ├── createOptomAccount.ts          # 신규 검안사 계정 생성
│   │   ├── getAppointmentCount.ts         # 예약 수 조회
│   │   ├── getEmployeeInfo.ts             # 직원 상세 정보 조회
│   │   ├── getEmploymentHeroList.ts       # 메인 동기화 오케스트레이터
│   │   ├── optometrists.ts                # Optomate 검안사 검색/조회
│   │   ├── postEmail.ts                   # Make.com 웹훅 이메일 발송
│   │   ├── syncRoster.ts                  # DB 근무표 Upsert
│   │   └── utils.ts                       # 공통 유틸 (chunk, cn)
│   ├── utils/
│   │   ├── crypto.ts                      # Basic Auth 헤더 생성
│   │   ├── db/db.ts                       # SQLite 연결 및 마이그레이션
│   │   ├── fetch_utils.ts                 # 프론트엔드 API 호출 래퍼
│   │   ├── formatting.ts                  # 포맷팅 유틸
│   │   ├── slots.ts                       # 예약 슬롯 수 계산
│   │   └── time.ts                        # 날짜/시간 헬퍼
│   ├── services/
│   │   └── apiFetch.ts                    # Fetch 래퍼 (에러 처리)
│   ├── types/
│   │   ├── api_response.ts                # API 응답 타입
│   │   ├── employment_hero_response.ts    # Employment Hero API 타입
│   │   ├── server-only.d.ts              # 서버 전용 코드 마커
│   │   └── types.ts                       # 메인 타입 정의
│   ├── data/
│   │   └── stores.ts                      # 매장 매핑 데이터 (18곳)
│   └── globals.css
├── migrations/
│   ├── 001_roster.sql                     # ROSTER, ROSTER_BREAK 테이블 + 트리거
│   ├── 002_changelog.sql                  # CHANGE_LOG, employee_cache 테이블
│   ├── 003_storeinfo.sql                  # STORE_INFO, APPOINTMENT_CACHE 테이블
│   └── 004_appointment_cache.sql          # 예약 캐시 테이블
├── scripts/
│   └── daily-sync.sh                      # 14일 동기화 크론 스크립트
├── public/
│   └── fonts/                             # Aribau Grotesk 폰트
├── .env.local                             # 환경 변수 (민감 정보 포함)
├── package.json
├── tsconfig.json
├── next.config.ts
├── vercel.json                            # Vercel 크론 잡 설정
├── roster.sqlite                          # SQLite DB 파일
└── README.md
```

---

## 3. 기술 스택 및 의존성

### 프레임워크 & 런타임
| 기술 | 버전 | 용도 |
|------|------|------|
| Next.js | 16.1.1 | 풀스택 웹 프레임워크 |
| React | 19.1.0 | UI 렌더링 |
| TypeScript | 5.x | 타입 안전성 |
| Node.js | - | 런타임 |

### 데이터베이스
| 기술 | 버전 | 용도 |
|------|------|------|
| @libsql/client | 0.8.0 | SQLite 클라이언트 (Turso 지원) |
| SQLite | - | 로컬 파일 기반 DB |
| Turso | - | 클라우드 SQLite (선택적) |

### UI / 스타일링
| 기술 | 버전 | 용도 |
|------|------|------|
| Tailwind CSS | 4 | 스타일링 |
| HeroUI (@heroui/react) | 2.8.4 | 컴포넌트 라이브러리 |
| React Day Picker | 9.10.0 | 날짜 범위 선택기 |
| Framer Motion | 12.23.15 | 애니메이션 |
| Lucide React | 0.544.0 | 아이콘 |
| React Icons | 5.5.0 | 아이콘 팩 |

### 이메일 / 커뮤니케이션
| 기술 | 버전 | 용도 |
|------|------|------|
| @emailjs/browser | 4.4.1 | 클라이언트 이메일 |
| @emailjs/nodejs | 5.0.2 | 서버 이메일 |
| Resend | 6.6.0 | 이메일 서비스 |
| googleapis | 169.0.0 | Gmail OAuth |

### 유틸리티
| 기술 | 버전 | 용도 |
|------|------|------|
| Zod | 4.1.11 | 스키마 유효성 검사 |
| date-fns | - | 날짜 조작 |
| date-fns-tz | - | 타임존 지원 |
| dotenv | 17.2.3 | 환경 변수 |

---

## 4. 아키텍처 설계

### 전체 아키텍처 다이어그램

```
┌──────────────────────────────────────────────────────────────────┐
│                        클라이언트 (Browser)                       │
│   IooICalendar (날짜 선택) + IooISelect (매장 선택) + Table (표시) │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTP
┌────────────────────────▼─────────────────────────────────────────┐
│                    Next.js App (서버)                             │
│                                                                  │
│   /api/roster/refresh    ←── 메인 동기화                         │
│   /api/roster/getList    ←── DB 조회                             │
│   /api/roster/input      ←── CSV 파싱                            │
│   /api/cron/store-sync   ←── Vercel Cron 자동 실행               │
│   /api/appointments/*    ←── 예약 관련                           │
└──────┬───────────────────────────────────────┬────────────────────┘
       │                                       │
┌──────▼───────────┐                 ┌─────────▼──────────────────┐
│  Employment Hero │                 │        SQLite DB            │
│  (HR 시스템)     │                 │                             │
│  - 근무 스케줄   │                 │  ROSTER                     │
│  - 직원 정보     │                 │  ROSTER_BREAK               │
└──────────────────┘                 │  CHANGE_LOG (트리거)        │
                                     │  EMPLOYEE_CACHE             │
                                     │  APPOINTMENT_CACHE          │
                                     └─────────────────────────────┘
                                               │ 변경 감지
┌──────────────────────────────────────────────▼────────────────────┐
│                      changeProcessor.ts                           │
│                                                                   │
│   1. CHANGE_LOG 읽기                                              │
│   2. Optomate에서 검안사 검색                                      │
│   3. 없으면 계정 생성                                              │
│   4. 예약 슬롯 업데이트 (PostAppAdjust)                            │
│   5. 슬롯 미스매치 감지                                            │
│   6. 예약 충돌 감지                                                │
│   7. Make.com 웹훅으로 이메일 발송                                 │
└───────┬────────────────────────┬──────────────────────────────────┘
        │                        │
┌───────▼────────┐      ┌────────▼──────────────┐
│   Optomate API │      │  Make.com Webhooks     │
│  (예약 시스템)  │      │  (이메일 자동화)       │
│  - 검안사 검색  │      │  - 신규 검안사 이메일  │
│  - 계정 생성    │      │  - 기존 검안사 이메일  │
│  - 예약 업데이트│      └────────────────────────┘
└────────────────┘
```

### 핵심 설계 패턴

#### 1. 이벤트 드리븐 변경 감지 (SQLite Trigger)
근무표가 INSERT/UPDATE/DELETE 될 때 SQLite 트리거가 자동으로 `CHANGE_LOG` 테이블에 변경 내역을 기록한다. 이를 통해 별도의 diff 로직 없이 변경사항을 추적한다.

```sql
-- 예시: INSERT 트리거
CREATE TRIGGER IF NOT EXISTS roster_after_insert
AFTER INSERT ON ROSTER
BEGIN
  INSERT INTO CHANGE_LOG (rosterId, changeType, whenDetected, ...)
  VALUES (NEW.id, 'roster_inserted', datetime('now'), ...);
END;
```

#### 2. 배치 처리 + 레이트 리미팅
Employment Hero API 호출 시 직원 정보를 5개씩 병렬로 가져오고, 배치 사이에 500ms 딜레이를 둔다. API 레이트 리밋 초과를 방지한다.

#### 3. 하이브리드 캐싱 (메모리 + DB)
직원 정보는 두 레이어로 캐싱된다:
- **메모리 캐시**: 프로세스 생존 기간 동안 빠른 접근
- **DB 캐시** (EMPLOYEE_CACHE): 24시간 TTL, 재시작 후에도 유지

#### 4. Upsert 패턴 (syncRoster.ts)
근무표 동기화 시 INSERT OR REPLACE를 사용해 기존 데이터를 덮어씌운다. 날짜 윈도우 내 삭제된 데이터는 명시적으로 DELETE한다.

---

## 5. 데이터베이스 스키마

### ROSTER 테이블 (근무표 메인)
```sql
CREATE TABLE ROSTER (
  id          INTEGER  PRIMARY KEY,   -- Employment Hero shift ID
  employeeId  INTEGER,                -- Employment Hero 직원 ID
  firstName   TEXT,
  lastName    TEXT,
  locationId  INTEGER,               -- stores.ts의 LocationId와 매핑
  locationName TEXT,
  startTime   TEXT,                  -- ISO 8601 UTC (예: 2026-03-12T01:00:00Z)
  endTime     TEXT,
  email       TEXT,
  isLocum     INTEGER                -- 0: 정규직, 1: 로컴(임시직)
);
```

**인덱스:**
- `idx_roster_employee` (employeeId)
- `idx_roster_location` (locationId)
- `idx_roster_start` (startTime)
- `idx_roster_time_location` (startTime, locationId)
- `idx_roster_employee_time` (employeeId, startTime)
- `idx_roster_end_time` (endTime)

### ROSTER_BREAK 테이블 (휴식 시간)
```sql
CREATE TABLE ROSTER_BREAK (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rosterId    INTEGER REFERENCES ROSTER(id) ON DELETE CASCADE,
  startTime   TEXT,
  endTime     TEXT,
  isPaidBreak INTEGER   -- 0: 무급, 1: 유급
);
```

**인덱스:**
- `idx_break_roster` (rosterId)
- `idx_break_start` (startTime)
- `idx_break_end_time` (endTime)
- `idx_break_roster_time` (rosterId, startTime)

### CHANGE_LOG 테이블 (변경 이력 - 트리거 자동 기록)
```sql
CREATE TABLE CHANGE_LOG (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rosterId     TEXT,
  changeType   TEXT,    -- 'roster_inserted' | 'roster_changed' | 'roster_deleted'
  whenDetected TEXT,    -- ISO 8601 UTC
  windowStart  TEXT,
  windowEnd    TEXT,
  diffSummary  TEXT     -- JSON: {old: {...}, new: {...}}
);
```

**인덱스:**
- `idx_change_log_window` (windowStart, windowEnd)
- `idx_change_log_roster` (rosterId)
- `idx_change_log_type` (changeType)
- `idx_change_log_detected` (whenDetected)

### EMPLOYEE_CACHE 테이블 (직원 정보 캐시)
```sql
CREATE TABLE employee_cache (
  employee_id INTEGER PRIMARY KEY,
  data        TEXT,       -- JSON (직원 상세 정보)
  updated_at  INTEGER     -- Unix timestamp (24h TTL)
);
```

### APPOINTMENT_CACHE 테이블 (예약 캐시)
Employment Hero 예약 카운트를 날짜별로 캐싱.

### SQLite 트리거 (자동 변경 로깅)
ROSTER 테이블에 3개 트리거가 설정되어 있다:

| 트리거명 | 발동 시점 | changeType |
|---------|---------|-----------|
| `roster_after_insert` | INSERT 후 | `roster_inserted` |
| `roster_after_update` | UPDATE 후 | `roster_changed` |
| `roster_after_delete` | DELETE 후 | `roster_deleted` |

---

## 6. API 라우트 분석

### `POST /api/roster/refresh` - 메인 동기화 엔드포인트
**파일:** `src/app/api/roster/refresh/route.ts`

**쿼리 파라미터:**
| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `from` | string | 시작 날짜 (YYYY-MM-DD) |
| `to` | string | 종료 날짜 |
| `range` | `today\|weekly\|monthly` | 미리 정의된 날짜 범위 |
| `branch` | string | 특정 매장 코드 |
| `state` | string | NSW/VIC/QLD |
| `scheduler` | boolean | 크론 실행 여부 |
| `manual` | boolean | 수동 실행 여부 |
| `skipEmail` | boolean | 이메일 발송 건너뜀 |

**처리 흐름:**
1. `getEmploymentHeroList()` 호출
2. Employment Hero API에서 shifts 가져옴
3. workTypeId 필터링 (472663, 536674 제외 - 관리/훈련 시프트)
4. 직원 정보 배치 fetch (5개 동시, 500ms 간격)
5. `syncRoster()` → DB upsert → 트리거 발동 → CHANGE_LOG 기록
6. `sendChangeToOptomateAPI()` → Optomate 업데이트
7. 슬롯 미스매치 및 예약 충돌 반환

**응답:**
```json
{
  "data": [...],
  "slotMismatches": [...],
  "appointmentConflicts": [...]
}
```

---

### `GET /api/roster/getList` - 근무표 조회
**파일:** `src/app/api/roster/getList/route.ts`

**쿼리 파라미터:**
| 파라미터 | 타입 | 설명 |
|---------|------|------|
| `from` | string | 시작 날짜 |
| `to` | string | 종료 날짜 |
| `locationId` | number | 단일 매장 ID |
| `locationIds` | string | 복수 매장 IDs (콤마 구분) |

**응답 컬럼:**
`id, employeeId, firstName, lastName, locationId, locationName, startTime, endTime, email, day, dow, hhmmStart, hhmmEnd`

---

### `POST /api/roster/input` - CSV 파싱
**파일:** `src/app/api/roster/input/route.ts`

수동으로 붙여넣은 CSV 형식의 근무표를 파싱한다.

**입력:** `{csv: "CSV 텍스트"}`

**파싱 로직:**
- Week/Date 헤더 파싱
- Name/Hours 행 파싱
- 반환: `{date, store, name, startTime, endTime}[]`

---

### `GET /api/appointments/count` - 예약 카운트
**파일:** `src/app/api/appointments/count/route.ts`

Optomate API에서 매장별 예약 카운트를 가져온다.

---

### `POST /api/appointments/sync` - 예약 캐시 동기화
**파일:** `src/app/api/appointments/sync/route.ts`

과거 날짜만 동기화한다 (미래 날짜는 제외).

**파라미터:**
- `date`: 단일 날짜
- `from` + `to`: 날짜 범위
- `yesterday=true`: 어제 날짜

---

### `GET /api/cron/store-sync` - 매장별 자동 동기화
**파일:** `src/app/api/cron/store-sync/route.ts`

**파라미터:** `store` (매장 코드, 예: BKT)

**동기화 범위:** 오늘 ~ +56일

Vercel Cron에서 매장별로 5분 간격으로 호출된다.

---

### `DELETE /api/roster/cleanup-past-data` - 과거 데이터 삭제
**파일:** `src/app/api/roster/cleanup-past-data/route.ts`

오늘 이전 모든 근무 데이터를 삭제한다. 매일 17:55 UTC에 자동 실행.

---

### Vercel Cron 스케줄 (`vercel.json`)

| 크론 표현식 | 대상 | 설명 |
|-----------|------|------|
| `18:00-19:15 UTC` (5분 간격) | 16개 매장 | 매장별 56일 동기화 |
| `17:55 UTC` 매일 | cleanup-past-data | 과거 데이터 삭제 |
| `21:00 UTC` 매주 수요일 | low-stock | 재고 부족 체크 |

---

## 7. 핵심 라이브러리 함수 분석

### `lib/getEmploymentHeroList.ts` - 메인 동기화 오케스트레이터

전체 동기화의 핵심 함수다.

**입력:** `{from, to, branch?, state?, scheduler?, skipEmail?}`

**처리 순서:**
```
1. Employment Hero API에서 해당 기간 shifts 조회
2. workTypeId 필터 적용 (472663, 536674 제외)
3. 로컴 판별: 이름에 "_Locum" 접미사 있으면 isLocum=true
4. 배치 처리:
   - shifts를 5개 청크로 분리
   - 각 청크 병렬 fetch (직원 상세 정보)
   - 청크 사이 500ms 딜레이
5. 하이브리드 캐시 확인:
   - 메모리 캐시 → DB 캐시 (24h TTL) → API 호출
6. syncRoster() 호출 → DB upsert
7. sendChangeToOptomateAPI() 호출 → 변경 처리
8. slotMismatches, appointmentConflicts 반환
```

---

### `lib/syncRoster.ts` - DB 근무표 동기화

Employment Hero에서 가져온 데이터를 SQLite에 upsert한다.

**핵심 로직:**
1. `INSERT OR REPLACE INTO ROSTER` (upsert)
2. 날짜 윈도우 내 삭제된 데이터 명시적 DELETE
3. ROSTER_BREAK cascade DELETE/INSERT
4. 트리거가 자동으로 CHANGE_LOG 기록

**`deletePastDataForAllBranches()`**: 오늘 이전 데이터 전체 삭제.

---

### `lib/changeProcessor.ts` - 변경 처리 핵심 (sendChangeToOptomateAPI)

CHANGE_LOG를 읽어 Optomate를 업데이트하는 핵심 함수.

**처리 흐름 (각 변경 건에 대해):**

```
CHANGE_LOG 한 건 읽기
        ↓
changeType 분기
        ├── roster_inserted / roster_changed
        │        ↓
        │   Optomate에서 검안사 검색 (by email/name)
        │        ↓
        │   없으면 → createOptomAccount() 새 계정 생성
        │        ↓
        │   PostAppAdjust() 예약 슬롯 업데이트
        │        ↓
        │   슬롯 미스매치 감지
        │        ↓
        │   postEmail() Make.com 웹훅 발송
        │
        └── roster_deleted
                 ↓
            getAppointmentCount() 예약 수 확인
                 ↓
            예약 있음 → AppointmentConflict 플래그
            예약 없음 → PostAppAdjust(slots=0)
```

**슬롯 미스매치 감지 로직:**
- 예상 슬롯 = `floor(근무분 / 30) - 휴식 수`
- 실제 예약 수 ≠ 예상 슬롯 → SlotMismatch 반환

**반환값:**
```typescript
{
  slotMismatches: SlotMismatch[],
  appointmentConflicts: AppointmentConflict[]
}
```

---

### `lib/optometrists.ts` - Optomate 검안사 관리

**`searchOptomId(name, email)`**:
- Optomate API에서 이름/이메일로 검안사 검색
- 결과 24시간 캐싱

**`addWorkHistory(optomId, locationId)`**:
- 검안사의 근무 이력(매장) 업데이트

---

### `lib/createOptomAccount.ts` - 신규 검안사 계정 생성

신규 검안사가 감지되면 Optomate에 자동으로 계정을 생성한다.

**식별자 생성 규칙:**
- IDENTIFIER: `{성 첫 글자}{이름 첫 글자}{번호}` (예: `YL1`)
- USERNAME: `{성 첫 글자}{이름 첫 글자}{성 마지막 글자}{년도 2자리}` (예: `YLS25`)
- 충돌 시 번호를 증가 (YL1 → YL2 → ...)
- 기본 비밀번호: `"1001"`

---

### `lib/appointment.ts` - 예약 조정 API

**`PostAppAdjust(optomId, locationId, date, slots)`**:
- Optomate API에 검안사의 특정 날짜/매장 예약 슬롯 수 업데이트
- 근무 없으면 slots=0으로 전송

---

### `lib/postEmail.ts` - 이메일 웹훅 발송

Make.com 웹훅으로 이메일 자동 발송.

**두 종류의 웹훅:**
- `MAKE_WEBHOOK_FIRST`: 신규 검안사 온보딩 이메일
- `MAKE_WEBHOOK_EXIST`: 기존 검안사 새 매장 배정 이메일

**검증:**
- 이메일 주소 유효성 확인
- 웹훅 URL 존재 확인

---

## 8. 유틸리티 분석

### `utils/db/db.ts` - 데이터베이스 연결

**연결 우선순위:**
1. `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` 환경변수 → Turso 클라우드 DB
2. `DB_FILE` 환경변수 → 로컬 SQLite 파일
3. 기본값: `./roster.sqlite`

**마이그레이션 실행:**
- 앱 시작 시 `/migrations/` 폴더의 SQL 파일을 순서대로 실행
- SQL 파싱: 주석 제거, 세미콜론으로 분리, 각 문장 개별 실행
- WAL 모드 활성화 (동시 읽기/쓰기 성능 향상)

**헬퍼 함수:**
- `dbExecute(sql, params)`: INSERT/UPDATE/DELETE
- `dbAll(sql, params)`: 여러 행 조회
- `dbGet(sql, params)`: 단일 행 조회

---

### `utils/crypto.ts` - 인증 헬퍼

```typescript
function createSecret(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}
```

Employment Hero API Basic Auth 헤더 생성에 사용.

---

### `utils/time.ts` - 날짜/시간 헬퍼

| 함수 | 설명 |
|------|------|
| `toLocalIsoNoOffset(date)` | Date → `YYYY-MM-DDTHH:MM:SSZ` (UTC) |
| `setTimeZone(date, tz)` | 타임존 적용 (기본: Australia/Sydney) |
| `formatHm(time)` | 12시간제 포맷 (예: `09:00 AM`) |
| `getWeekNumber(date)` | 주차 계산 (기준: 2025-11-30) |
| `getWeekRange(weekNum)` | 주차 → 날짜 범위 |
| `getDateRange(from, to)` | 날짜 배열 생성 |

**주의:** 주차 계산의 기준일이 `2025-11-30`으로 하드코딩되어 있다.

---

### `utils/slots.ts` - 예약 슬롯 계산

```typescript
function calculateSlots(workMinutes: number, breakCount: number): number {
  return Math.floor(workMinutes / 30) - breakCount;
}
```

**휴식 공제 규칙:**
- 근무 시간 < 10시간: 휴식 1회 공제
- 근무 시간 ≥ 10시간: 휴식 2회 공제

슬롯 = `floor(근무분 / 30) - 휴식 수`

---

### `utils/formatting.ts` - 포맷팅

날짜, 이름 등 표시용 포맷팅 유틸리티.

---

### `utils/fetch_utils.ts` - 프론트엔드 API 호출

| 함수 | 엔드포인트 | 용도 |
|------|----------|------|
| `refresh(params)` | `POST /api/roster/refresh` | Employment Hero에서 동기화 |
| `getList(params)` | `GET /api/roster/getList` | DB에서 근무표 조회 |

에러 처리 및 JSON 파싱 포함.

---

## 9. React 컴포넌트 분석

### `app/page.tsx` - 메인 UI

**상태:**
```typescript
const [dateRange, setDateRange] = useState<DateRange>()     // 선택된 날짜 범위
const [location, setLocation] = useState<number[]>([])       // 선택된 매장 IDs
const [rosterData, setRosterData] = useState<I1001TableType>() // 테이블 데이터
const [slotMismatches, setSlotMismatches] = useState([])
const [appointmentConflicts, setAppointmentConflicts] = useState([])
const [isLoading, setIsLoading] = useState(false)
```

**동작:**
1. 마운트 시 `getList()` 자동 호출
2. 날짜/매장 변경 시 `getList()` 재호출
3. Refresh 버튼 → `refresh()` 호출 → Employment Hero 동기화
4. 결과에서 슬롯 미스매치/충돌 추출 → AlertToast 표시

---

### `components/table.tsx` - 근무표 테이블

**레이아웃:** 7일(일~토) × 매장 그리드

**표시 정보:**
- 직원 이름
- 근무 시작/종료 시간
- 빈 슬롯: 빨간색 강조

**최적화:** `React.memo`로 불필요한 리렌더 방지

---

### `components/AlertToast.tsx` - 알림 토스트

**위치:** 화면 우상단 고정 (`fixed`)

**알림 종류:**
1. **슬롯 미스매치** (앰버 색상): 예상 슬롯 ≠ 실제 예약
2. **예약 충돌** (빨간색): 근무 삭제됐지만 예약 남아있음

**기능:**
- 주차 + 매장별 그룹핑
- 카드 확장/축소
- 닫기 시 `localStorage`에 기록 (재방문 시 표시 안 함)
- 복수 항목 시 카운트 표시

---

### `components/IooICalendar.tsx` - 날짜 범위 선택기

React Day Picker 기반. 날짜 범위 선택 UI.

---

### `components/IooISelect.tsx` - 매장/주(State) 선택기

HeroUI Select 컴포넌트 기반. 매장 또는 NSW/VIC/QLD 필터링.

---

### `components/modal/loginModal.tsx` - 로그인 모달

내부 사용 인증 모달 (현재 사용 여부 불명확).

---

## 10. 외부 서비스 및 API 연동

### Employment Hero (HR 시스템)

**역할:** 근무 스케줄 소스

**API 엔드포인트:**
```
GET {EMPLOYMENTHERO_API_URL}/shifts
```

**인증:** Basic Auth (`Authorization: Basic ${base64(secret)}`)

**데이터 형태:**
```typescript
interface Shift {
  id: number;
  employeeId: number;
  startTime: string;      // ISO 8601
  endTime: string;
  workTypeId: number;     // 472663, 536674 제외
  breaks: ShiftBreak[];
}
```

**필터링:**
- workTypeId `472663`: 제외 (관리 시프트 추정)
- workTypeId `536674`: 제외 (훈련 시프트 추정)

---

### Optomate (예약 시스템)

**역할:** 검안사 계정 관리 + 예약 슬롯 관리

**엔드포인트:**
- 검안사 검색: `GET {OPTOMATE_API_URL}/Optometrists?$filter=...`
- 계정 생성: `POST {OPTOMATE_API_URL}/Optometrists`
- 예약 조정: `POST {OPTOMATE_API_URL}/AppAdjust`
- 예약 수 조회: `GET {OPTOMATE_API_URL}/Appointments?$filter=...`

**인증:** Bearer Token (`Authorization: Bearer ${NEXT_PUBLIC_API_TOKENS}`)

---

### Make.com 웹훅 (이메일 자동화)

**역할:** 검안사 온보딩 이메일 자동 발송

**웹훅 종류:**
| 웹훅 | 환경 변수 | 용도 |
|------|---------|------|
| 신규 검안사 | `MAKE_WEBHOOK_FIRST` | 처음 등록되는 검안사 |
| 기존 검안사 | `MAKE_WEBHOOK_EXIST` | 이미 등록된 검안사, 새 매장 |

**Payload:**
```json
{
  "name": "검안사 이름",
  "email": "검안사 이메일",
  "store": "매장명",
  "date": "근무 날짜",
  "username": "Optomate 사용자명",
  "password": "기본 비밀번호"
}
```

---

### Vercel Cron

**역할:** 자동 동기화 스케줄러

`vercel.json`에 정의된 크론 잡:
- 16개 매장 × 5분 간격 (18:00~19:15 UTC) - 근무시간 전 동기화
- 과거 데이터 정리 (17:55 UTC 매일)
- 재고 부족 체크 (21:00 UTC 매주 수요일)

---

### Turso (선택적 클라우드 DB)

로컬 SQLite 파일 대신 Turso 클라우드 DB를 사용할 수 있다. `TURSO_DATABASE_URL`과 `TURSO_AUTH_TOKEN`이 설정되면 자동으로 클라우드 DB를 사용한다.

---

## 11. 환경 변수 및 설정

### 필수 환경 변수

```bash
# Optomate API
NEXT_PUBLIC_API_BASE_URL=https://api.1001optometrist.com
NEXT_PUBLIC_API_TOKENS=<Bearer 토큰>
OPTOMATE_API_URL=https://1001optdb.habitat3.net:12443/OptomateTouch/OData4/
OPTOMATE_USERNAME=1001_HO_JH
OPTOMATE_PASSWORD=10011001
OPTOMATE_DEFAULT_USER_PW=1001

# Employment Hero
EMPLOYMENTHERO_API_URL=https://api.yourpayroll.com.au/api/v2/business/484743/
EMPLOYMENTHERO_SECRET=<base64 인코딩된 시크릿>

# Make.com 웹훅
MAKE_WEBHOOK_FIRST=https://hook.us2.make.com/<webhook-id>
MAKE_WEBHOOK_EXIST=https://hook.us2.make.com/<webhook-id>

# Gmail (선택적)
GMAIL_CLIENT_ID=<Google OAuth Client ID>
GMAIL_CLIENT_SECRET=<Google OAuth Client Secret>
GMAIL_SENDER=intern1001optical@gmail.com

# 데이터베이스 (선택적)
TURSO_AUTH_TOKEN=<Turso JWT>
TURSO_DATABASE_URL=libsql://roster-vercel-...
DB_FILE=./roster.sqlite

# 기타 (로컬 개발)
API_URL=http://localhost:3000
```

### `next.config.ts`
기본 Next.js 설정.

### `tsconfig.json`
TypeScript strict 모드 활성화.

---

## 12. 인증 및 보안

### 인증 방식

| 대상 | 방식 | 저장 위치 |
|------|------|---------|
| Employment Hero API | Basic Auth (base64) | `EMPLOYMENTHERO_SECRET` |
| Optomate API | Bearer Token | `NEXT_PUBLIC_API_TOKENS` |
| Make.com | Public URL (인증 없음) | 웹훅 URL |
| Turso DB | JWT Token | `TURSO_AUTH_TOKEN` |
| Gmail | OAuth 2.0 | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` |

### 보안 문제점

**1. NEXT_PUBLIC_* 변수 노출:**
`NEXT_PUBLIC_API_TOKENS`는 클라이언트 번들에 포함된다. Optomate Bearer 토큰이 브라우저에 노출된다.

**2. 기본 비밀번호:**
신규 검안사 계정이 `"1001"` 비밀번호로 생성된다. 강제 변경 메커니즘이 없다.

**3. 앱 자체 인증 없음:**
내부 도구지만 URL을 아는 누구나 접근 가능하다. 로그인 모달이 있지만 실제 인증이 적용되어 있는지 불명확하다.

---

## 13. 비즈니스 로직 흐름

### 전체 동기화 흐름 (상세)

```
[사용자 또는 Vercel Cron]
         │
         ▼
POST /api/roster/refresh
         │
         ▼
getEmploymentHeroList(from, to, branch?)
         │
         ├─ Employment Hero API 호출
         │   GET /shifts?from={from}&to={to}
         │
         ├─ workTypeId 필터링
         │   제외: 472663 (관리), 536674 (훈련)
         │
         ├─ 로컴 판별
         │   이름 접미사 "_Locum" → isLocum=true
         │
         ├─ 직원 정보 배치 fetch
         │   5개씩 병렬, 500ms 간격
         │   캐시: 메모리 → DB (24h TTL) → API
         │
         ├─ syncRoster(shifts)
         │   INSERT OR REPLACE INTO ROSTER
         │   DELETE stale entries
         │   → 트리거 → CHANGE_LOG 자동 기록
         │
         └─ sendChangeToOptomateAPI(changes)
                  │
                  ├─ CHANGE_LOG 각 건 처리
                  │
                  ├─ Optomate 검안사 검색
                  │   없으면 → createOptomAccount()
                  │     - IDENTIFIER 생성 (예: YL1)
                  │     - USERNAME 생성 (예: YLS25)
                  │     - 기본 pw: "1001"
                  │
                  ├─ PostAppAdjust(slots)
                  │   슬롯 수 = floor(근무분/30) - 휴식
                  │
                  ├─ 슬롯 미스매치 감지
                  │   예상 슬롯 ≠ Optomate 예약 수
                  │
                  ├─ 예약 충돌 감지 (삭제 시)
                  │   예약 있으면 → conflict 플래그
                  │
                  └─ postEmail() Make.com 웹훅
                      신규: MAKE_WEBHOOK_FIRST
                      기존: MAKE_WEBHOOK_EXIST
```

### 슬롯 계산 로직

```
근무 시간 = endTime - startTime (분)
휴식 공제 = (근무 시간 < 10h) ? 1 : 2
슬롯 수   = floor(근무 시간 / 30) - 휴식 공제
```

예시:
- 9시간 근무 → `floor(540/30) - 1 = 17`슬롯
- 10시간 근무 → `floor(600/30) - 2 = 18`슬롯

---

## 14. 매장 데이터 (stores.ts)

### OptomMap (검안사 매장 - 16개 + HeadOffice)

| LocationId | StoreName | State | OptCode |
|-----------|---------|-------|---------|
| 313214 | HeadOffice | NSW | HO |
| 313200 | Blacktown | NSW | BKT |
| 313202 | Bondi | NSW | BON |
| 313204 | Burwood | NSW | BUR |
| 315783 | Chatswood Chase | NSW | CHC |
| 315784 | Chatswood Westfield | NSW | CHW |
| 313216 | Eastgardens | NSW | ETG |
| 313206 | Hornsby | NSW | HOB |
| 313225 | Hurstville | NSW | HUR |
| 315785 | Macquarie | NSW | MQU |
| 313210 | Parramatta | NSW | PA1 |
| 313212 | Penrith | NSW | PEN |
| 315787 | Top Ryde | NSW | TOP |
| 315780 | Box Hill | VIC | BOH |
| 315779 | Doncaster | VIC | DON |
| 313208 | Emporium | VIC | EMP |
| 315778 | Indooroopilly | QLD | IND |

**NSW: 13개, VIC: 3개, QLD: 1개**

### RetailMap (소매 매장 - 별도 ID 체계)

Optomate 예약 시스템과 연동되는 소매 매장 ID. OptCode는 OptomMap과 동일하나 숫자 ID가 다르다.

---

## 15. 잠재적 버그 및 문제점

### 심각도: 높음 (Critical)

#### 1. `NEXT_PUBLIC_*` 환경 변수로 Bearer 토큰 노출
**위치:** `NEXT_PUBLIC_API_TOKENS` 환경 변수

Next.js에서 `NEXT_PUBLIC_` 접두사가 붙은 변수는 클라이언트 번들에 포함되어 브라우저에서 접근 가능하다. Optomate API 인증 토큰이 실질적으로 공개되어 있다.

**해결:** 서버 사이드에서만 사용되는 API 호출이면 `NEXT_PUBLIC_` 접두사를 제거해야 한다.

---

#### 2. 기본 비밀번호 하드코딩
**위치:** `lib/createOptomAccount.ts`

신규 검안사 계정이 `"1001"` 비밀번호로 생성된다. 모든 신규 계정이 동일한 예측 가능한 비밀번호를 가진다.

**해결:** 임시 랜덤 비밀번호 생성 + 첫 로그인 시 강제 변경.

---

#### 3. 레이스 컨디션 in `syncRoster.ts`
**위치:** `lib/syncRoster.ts`

날짜 윈도우 내 기존 데이터를 DELETE한 후 새 데이터를 INSERT한다. 중간에 프로세스가 중단되면 데이터 손실이 발생한다. 트랜잭션이 없다.

**해결:** LibSQL 트랜잭션 사용.

---

### 심각도: 중간 (Medium)

#### 4. 페이지네이션 없는 `getList` 엔드포인트
**위치:** `src/app/api/roster/getList/route.ts`

날짜 범위 제한 없이 호출하면 전체 ROSTER 테이블을 반환할 수 있다. DB에 데이터가 쌓일수록 응답이 느려진다.

**해결:** LIMIT/OFFSET 추가, 최대 날짜 범위 제한.

---

#### 5. 웹훅 실패 시 재시도 없음
**위치:** `lib/postEmail.ts`

Make.com 웹훅 호출이 실패해도 재시도 로직이 없다. 이메일 발송이 묵살된다.

**해결:** 재시도 큐 또는 실패 로그 테이블.

---

#### 6. 직원 캐시 24h TTL이 너무 길 수 있음
**위치:** `lib/getEmploymentHeroList.ts`

직원 정보(이름, 이메일 등)가 24시간 동안 캐싱된다. 직원 정보 변경 시 최대 24시간 지연.

**해결:** 중요 필드 변경 시 캐시 무효화 로직 추가.

---

#### 7. 타임존 처리 불일치
**위치:** `utils/time.ts`

- DB: UTC ISO 8601 저장
- 프론트엔드: 브라우저 로컬 시간 가정
- 주차 계산 기준: 하드코딩 `2025-11-30`
- DST(일광절약시간) 미처리

**해결:** 모든 날짜를 Australia/Sydney 타임존으로 명시 처리.

---

#### 8. 이메일 발송이 동기 처리됨
**위치:** `lib/changeProcessor.ts`

이메일 웹훅 발송이 메인 동기화 흐름에 인라인으로 포함되어 있다. 웹훅이 느리거나 실패하면 전체 동기화 응답이 지연된다.

**해결:** 이메일 발송을 비동기 큐로 분리.

---

### 심각도: 낮음 (Low)

#### 9. 로컴 판별이 이름 파싱에 의존
**위치:** `lib/getEmploymentHeroList.ts`

`_Locum` 접미사로 로컴을 판별한다. 이름 명명 규칙이 변경되면 판별이 실패한다.

**해결:** Employment Hero의 workTypeId나 태그로 판별.

---

#### 10. 수동 새로고침과 크론 날짜 범위 불일치
**위치:** `app/page.tsx` vs `vercel.json`

- UI 수동 새로고침: 최대 14~21일 범위 제한
- 크론 자동 동기화: 56일 범위

일관성이 없다.

---

#### 11. 미사용 파일들
**위치:** 프로젝트 루트

`auth_gmail.js`, `auth_gmail_v2.mjs`, `autoAlertScript.js`가 루트에 있다. 임포트되지 않는 스크립트들로 추정되며 목적 불명확.

**해결:** 삭제하거나 `/scripts/` 폴더로 이동.

---

#### 12. 프로덕션 과도한 `console.log`
**위치:** 전역

개인정보(직원 이름, 이메일)가 포함된 디버그 로그가 프로덕션에 출력된다.

**해결:** 구조화된 로깅 라이브러리 도입, 레벨별 필터링.

---

#### 13. 반응형 UI 없음
**위치:** `app/page.tsx`, `globals.css`

컨테이너 너비가 `1240px` 고정. 모바일/태블릿 지원 없음.

---

## 16. 코드 품질 평가

### 강점

| 항목 | 평가 |
|------|------|
| **TypeScript 사용** | 전체적으로 타입 정의가 잘 되어 있음 |
| **관심사 분리** | API 라우트 / lib 함수 / utils 계층이 명확 |
| **DB 트리거** | 이벤트 소싱 패턴으로 변경 감지를 우아하게 구현 |
| **배치 처리** | 레이트 리밋 방지 로직이 잘 구현됨 |
| **하이브리드 캐싱** | 메모리 + DB 이중 캐싱으로 성능 최적화 |
| **SQL 인덱스** | 자주 사용되는 쿼리 패턴에 맞게 인덱스 최적화 |

### 약점

| 항목 | 평가 |
|------|------|
| **과도한 console.log** | 디버그 로그가 프로덕션에 그대로 노출 |
| **에러 처리** | 일부 API 호출 실패 시 묵살됨 |
| **입력 유효성 검사** | 대부분의 엔드포인트에 Zod 검증 미적용 |
| **트랜잭션 없음** | DB 일관성 보장 어려움 |
| **하드코딩된 값** | 날짜 기준, 기본 비밀번호 등 |
| **타입 안전성 일부 미흡** | `any` 타입 사용 있음 |

---

## 17. 개선 제안

### 단기 (즉시 적용 권장)

1. **`NEXT_PUBLIC_API_TOKENS` 제거**: API 호출을 모두 서버 사이드로 이동하고 `API_TOKENS` (NEXT_PUBLIC 없이)로 변경
2. **DB 트랜잭션 적용**: `syncRoster.ts`의 DELETE + INSERT를 트랜잭션으로 묶기
3. **미사용 파일 정리**: 루트의 `auth_gmail.js`, `auth_gmail_v2.mjs` 등 정리
4. **console.log 정리**: 개인정보 포함 로그 제거 또는 구조화된 로거로 교체

### 중기

5. **웹훅 재시도 로직**: 실패한 Make.com 웹훅을 PENDING 상태로 저장하고 재시도
6. **이메일 발송 비동기화**: 동기화 흐름에서 이메일 발송을 분리해 응답 속도 개선
7. **`getList` 페이지네이션**: 최대 날짜 범위 제한 및 LIMIT/OFFSET 추가
8. **입력 유효성 검사**: 주요 API 엔드포인트에 Zod 스키마 적용
9. **타임존 통일**: 모든 날짜를 `Australia/Sydney` 기준으로 일관 처리

### 장기

10. **앱 인증 시스템**: 현재 인증 없는 상태를 개선 (OAuth, 내부 인증 등)
11. **에러 모니터링**: Sentry 등 도입으로 프로덕션 에러 추적
12. **반응형 UI**: 모바일/태블릿 지원
13. **로컴 판별 개선**: 이름 파싱 대신 Employment Hero API의 공식 필드 사용

---

## 18. 종합 평가

### 프로젝트 성숙도

| 카테고리 | 점수 | 코멘트 |
|---------|------|--------|
| **기능 완성도** | 8/10 | 핵심 비즈니스 기능 작동 |
| **코드 구조** | 7/10 | 계층화 잘 되어 있으나 일부 개선 필요 |
| **보안** | 4/10 | 토큰 노출, 기본 비밀번호 문제 |
| **에러 처리** | 5/10 | 일부 실패 케이스 묵살 |
| **성능** | 7/10 | 캐싱, 인덱스 잘 구현 |
| **유지보수성** | 6/10 | 하드코딩 값, console.log 과다 |
| **테스트** | 1/10 | 테스트 코드 없음 |
| **문서화** | 5/10 | README 있으나 상세 문서 부족 |

### 전체 평가

**OptomRoster**는 1001 Optical의 검안사 근무표와 Optomate 예약 시스템을 연결하는 내부 운영 도구로, 비즈니스 핵심 기능은 잘 구현되어 있다.

**잘 된 점:**
- SQLite 트리거를 활용한 이벤트 드리븐 변경 감지는 우아한 설계다.
- 하이브리드 캐싱과 배치 처리로 외부 API 부하를 효과적으로 관리한다.
- TypeScript 타입 정의가 전반적으로 잘 되어 있다.
- Vercel Cron으로 완전 자동화된 동기화 파이프라인을 구현했다.

**개선이 필요한 점:**
- 보안 취약점 (토큰 노출, 기본 비밀번호)을 즉시 수정해야 한다.
- 트랜잭션 없는 DB 쓰기는 데이터 일관성 리스크가 있다.
- 테스트 코드가 전혀 없어 회귀 버그 발생 시 파악이 어렵다.
- 에러 발생 시 묵살되는 케이스가 있어 운영 가시성이 낮다.

**프로덕션 준비도:** 내부 도구로서 현재 운영에는 사용 가능하지만, 보안 이슈를 해결하고 에러 처리를 강화해야 더 안정적으로 운영할 수 있다.

---

*분석 완료: 2026-03-12*
