import type { WbsQuality } from './wbsQualityScore';

/**
 * 대시보드 프로젝트 카드·집계용 통계 묶음.
 * (Dashboard.tsx에서 분리한 공유 타입 — Dashboard 집계 로직과 카드 컴포넌트가 함께 사용)
 */
export interface ProjectStats {
  total: number;
  statusCounts: Record<string, number>;
  progress: number;
  /** 계획율(%): 오늘 일정상 기대 진척. 진척률과 동일 가중·집계 방식 */
  planned: number;
  /** 계획 대비 진척 차이(%p) = progress − planned. 양수=앞섬, 음수=지연 */
  variance: number;
  assigneeCount: number;
  /** WBS 작업 공수 합(M/D). 투입 M/M 표시·정렬에 사용 */
  inputManDays: number;
  /** 카드·요약용: 화면 캡처 없이 숫자로 한눈에 보이게 */
  issueCount: number;
  actionCount: number;
  overdueCount: number;
  /** WBS 작성 충실도(체크리스트 기반): 점수·등급·항목별 충족 내역 */
  quality: WbsQuality;
}
