import { OptomMap } from "@/data/stores";

export type BranchInfo = (typeof OptomMap)[number];

/** Optomate OData 슬롯 조회는 제거됨 — 1001 프록시에 대응 엔드포인트 없음. 타입만 유지. */
export interface OptomContext {
  optomId: number;
  isFirst: boolean;
  username?: string;
  branchInfo: BranchInfo;
  date: string;
  adjustStart: string;
  adjustFinish: string;
  workFirst: boolean;
  employmentHeroSlots: number;
}
