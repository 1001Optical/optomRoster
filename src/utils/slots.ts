/**
 * 근무 시간(분)을 기반으로 30분 슬롯 개수 계산
 * - 30분마다 눈검사 슬롯이 있음
 * - 브레이크는 항상 있음 (10시간 미만: break 1개, 10시간 이상: break 2개)
 * @param workMinutes 근무 시간 (분)
 * @returns 슬롯 개수 (break 제외)
 */
export function calculateSlots(workMinutes: number): number {
  // 30분 단위 슬롯 개수 계산
  const totalSlots = Math.floor(workMinutes / 30);
  
  // break time 개수 결정
  const workHours = workMinutes / 60;
  let breakCount = 1; // 기본적으로 브레이크 1개는 항상 있음
  
  if (workHours >= 10) {
    breakCount = 2; // 10시간 이상이면 break 2개
  }
  // 10시간 미만이면 break 1개 (기본값)
  
  // break time을 제외한 실제 슬롯 개수
  // break는 30분씩이므로 breakCount만큼 빼기
  return Math.max(0, totalSlots - breakCount);
}
