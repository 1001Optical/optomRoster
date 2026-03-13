# [DB] deletePastDataForAllBranches 트랜잭션 적용

> 상태: **완료**
> 우선순위: 즉시 적용 (Critical)

---

## 문제

`syncRoster.ts`의 `deletePastDataForAllBranches` 함수가 트랜잭션 없이 3개의 독립 DB 작업을 순차 실행했다.

```
1. disableRosterChangeTriggers(db)      ← DROP TRIGGER (DDL)
2. SELECT id FROM ROSTER ...             ← id 목록 조회
3. DELETE FROM ROSTER ...                ← 실제 삭제
4. DELETE FROM CHANGE_LOG ...            ← 로그 정리
5. enableRosterChangeTriggers(db)        ← CREATE TRIGGER (DDL)
```

**문제 1 (데이터 불일치):**
2번(SELECT)과 3번(DELETE) 사이에 새 roster가 삽입될 경우, 그 항목도 3번에서 삭제되지만 4번의 ID 목록에는 없어 CHANGE_LOG가 남는다. 이로 인해 의도치 않은 Optomate 전송이 발생할 수 있다.

**문제 2 (silent failure):**
`enableRosterChangeTriggers`가 `finally` 블록에서 실패해도 에러가 내부 catch로 흡수되어 로그만 남기고 넘어간다. 트리거가 영구 비활성화 상태가 되어 이후 모든 근무표 변경이 CHANGE_LOG에 기록되지 않는다.

> 참고: `syncRoster` 함수는 이미 `db.transaction("write")`로 완전히 감싸져 있어 수정 불필요.

---

## 변경 내용

**파일:** `src/lib/syncRoster.ts`
**함수:** `deletePastDataForAllBranches`

### 핵심 변경

1. **SELECT + DELETE ROSTER + DELETE CHANGE_LOG를 `db.transaction("write")`로 원자적으로 묶음**
2. **`enableRosterChangeTriggers` 실패 시 에러를 호출자에게 전파** (silent failure 제거)
3. DDL(`DROP TRIGGER`, `CREATE TRIGGER`)은 SQLite 특성상 트랜잭션 밖에서 유지

### 변경 전/후 구조

```diff
- // 트랜잭션 없이 순차 실행
- await disableRosterChangeTriggers(db);
- const rosterIdsToDelete = await dbAll(db, `SELECT id FROM ROSTER...`);
- const deleteResult = await dbExecute(db, `DELETE FROM ROSTER...`);
- await dbExecute(db, `DELETE FROM CHANGE_LOG...`);
- // enableRosterChangeTriggers 실패해도 에러 흡수

+ // SELECT + DELETE 를 트랜잭션으로 묶음
+ await disableRosterChangeTriggers(db);  // DDL - 트랜잭션 밖 유지
+ const tx = await db.transaction("write");
+ try {
+     // SELECT → DELETE ROSTER → DELETE CHANGE_LOG (원자적)
+     await tx.commit();
+ } catch {
+     await tx.rollback();
+     throw error;
+ } finally {
+     if (!tx.closed) tx.close();
+     // 실패 시 throw로 호출자에게 전파
+     await enableRosterChangeTriggers(db);
+ }
```

---

## 검증 방법

1. `/api/roster/cleanup-past-data` 직접 호출 → 200 정상 응답
2. 로컬 DB에서 `SELECT * FROM sqlite_master WHERE type='trigger'` → 3개 트리거 존재 확인
3. CHANGE_LOG에 cleanup으로 인한 `roster_deleted` 항목이 없는지 확인
