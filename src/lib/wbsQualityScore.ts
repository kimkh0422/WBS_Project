import type { Project, Task } from '../types';
import type { StatusConfig } from './wbsSettings';
import { buildParentSet } from './taskView';
import { computePlannedProgressMap, progressVariance, todayIso } from './plannedProgress';
import { getHolidaysForTaskDates } from './calendar';
import { getTaskScheduleOutsideProjectMessage } from './projectTaskSchedule';
import { buildDoneStatusIds, isTaskComplete, isUnassignedAssignee, refIsAfterStart } from './wbsImprovementGuide';

/**
 * 프로젝트별 WBS 작성 충실도 점수.
 *
 * 기존 `wbsImprovementGuide.ts`의 7개 점검 기준(담당자·일정 적정성·진척 최신화·계획대비
 * 진척·산출물·선행관계·PM)을 **프로젝트 단위 충족률**로 환산하여 0–100 점수와 등급으로 제공한다.
 * 점검 판정(담당자 미지정/완료 여부/시작 경과)·계획률·기간 적정성 등은 모두 기존 유틸을 재사용해
 * 「보완 가이드」와 동일한 기준을 유지한다.
 */

export type WbsQualityGrade = 'excellent' | 'good' | 'fair' | 'poor';

export type WbsQualityCheckSeverity = 'critical' | 'high' | 'medium' | 'low';

export type WbsQualityCheck = {
  key: string;
  label: string;
  severity: WbsQualityCheckSeverity;
  /** severity에서 파생된 가중치 */
  weight: number;
  /** 이 점검의 적용(모집단) 건수 — 0이면 N/A(점수 산정 제외) */
  applicable: number;
  /** 충족 건수 */
  passed: number;
  /** passed/applicable, 적용 0이면 null(N/A) */
  ratio: number | null;
};

export type WbsQuality = {
  /** 0–100 가중 충족률, 적용 점검이 하나도 없으면 null */
  score: number | null;
  grade: WbsQualityGrade | null;
  checks: WbsQualityCheck[];
  /** 미충족(applicable − passed) 합 — 보완 필요 항목 수 */
  failTotal: number;
};

export const WBS_QUALITY_GRADE_LABEL: Record<WbsQualityGrade, string> = {
  excellent: '우수',
  good: '양호',
  fair: '보통',
  poor: '보완필요',
};

const SEVERITY_WEIGHT: Record<WbsQualityCheckSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** 점수 → 등급 (주간보고 체크리스트와 동일 임계) */
export function wbsQualityGradeOf(score: number): WbsQualityGrade {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'fair';
  return 'poor';
}

function progNum(t: Task): number {
  return typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0;
}

/**
 * 한 프로젝트의 작업 집합에 대해 작성 충실도를 점검·점수화한다.
 * @param tasks 해당 프로젝트의 작업들(상위/말단 혼재 가능)
 * @param project 해당 프로젝트(기간·PM 점검에 사용)
 * @param statusConfigs 완료 상태 판정용
 * @param opts.refDateIso 기준일(기본 오늘) · opts.plannedById 이미 계산된 계획률 맵(있으면 재사용)
 */
export function computeWbsQualityScore(
  tasks: Task[],
  project: Project,
  statusConfigs: StatusConfig[],
  opts?: { refDateIso?: string; plannedById?: Map<string, number> },
): WbsQuality {
  const refDateIso = opts?.refDateIso ?? todayIso();
  const doneIds = buildDoneStatusIds(statusConfigs ?? []);
  const parentSet = buildParentSet(tasks);
  const leaves = tasks.filter((t) => !parentSet.has(t.id));
  const nonMsLeaves = leaves.filter((t) => !t.isMilestone);
  const plannedById = opts?.plannedById ?? computePlannedProgressMap(tasks, refDateIso, getHolidaysForTaskDates(tasks));

  const checks: WbsQualityCheck[] = [];
  const countPass = (pop: Task[], pred: (t: Task) => boolean): number => pop.reduce((n, t) => n + (pred(t) ? 1 : 0), 0);
  const pushCheck = (key: string, label: string, severity: WbsQualityCheckSeverity, applicable: number, passed: number) => {
    checks.push({
      key,
      label,
      severity,
      weight: SEVERITY_WEIGHT[severity],
      applicable,
      passed,
      ratio: applicable > 0 ? passed / applicable : null,
    });
  };

  // 1) 담당자 지정 (말단·비마일스톤)
  pushCheck(
    'assignee',
    '담당자 지정',
    'medium',
    nonMsLeaves.length,
    countPass(nonMsLeaves, (t) => !isUnassignedAssignee(t.assignee)),
  );

  // 2) 일정 적정성(프로젝트 기간 내) — 프로젝트·작업 모두 일정이 있어 평가 가능한 작업만 모집단
  const projDated = !!(project.startDate || project.endDate);
  const schedulePop = projDated ? tasks.filter((t) => !!t.startDate && !!t.endDate) : [];
  pushCheck(
    'schedule',
    '일정 적정성',
    'medium',
    schedulePop.length,
    countPass(schedulePop, (t) => getTaskScheduleOutsideProjectMessage(t, project) === null),
  );

  // 3) 진척 최신화 — 시작일 경과·미완료 말단
  const startedOpen = nonMsLeaves.filter((t) => !isTaskComplete(t, doneIds) && refIsAfterStart(refDateIso, t.startDate));
  pushCheck(
    'progressFresh',
    '진척 최신화',
    'high',
    startedOpen.length,
    countPass(startedOpen, (t) => progNum(t) >= 10),
  );

  // 4) 계획 대비 진척 — 계획률 15% 이상 진행된 말단에서 큰 지연(−20%p 이하) 없음
  const planRelevant = nonMsLeaves.filter((t) => (plannedById.get(t.id) ?? 0) >= 15);
  pushCheck(
    'scheduleAdherence',
    '계획대비 진척',
    'high',
    planRelevant.length,
    countPass(planRelevant, (t) => progressVariance(progNum(t), plannedById.get(t.id)) > -20),
  );

  // 5) 산출물 정의 (말단·비마일스톤)
  pushCheck(
    'deliverables',
    '산출물 정의',
    'low',
    nonMsLeaves.length,
    countPass(nonMsLeaves, (t) => !!(t.deliverables ?? '').trim()),
  );

  // 6) 선행관계 — 말단이 2개 이상일 때만 의미
  const predPop = nonMsLeaves.length >= 2 ? nonMsLeaves : [];
  pushCheck(
    'dependencies',
    '선행관계',
    'low',
    predPop.length,
    countPass(predPop, (t) => !!(t.dependencies && t.dependencies.length > 0)),
  );

  // 7) PM 지정 (프로젝트 단위·이진)
  pushCheck('pm', 'PM 지정', 'medium', 1, (project.pmName ?? '').trim() ? 1 : 0);

  const applicableChecks = checks.filter((c) => c.ratio !== null);
  const wsum = applicableChecks.reduce((a, c) => a + c.weight, 0);
  const score = wsum > 0 ? Math.round((applicableChecks.reduce((a, c) => a + c.weight * (c.ratio as number), 0) / wsum) * 100) : null;
  const failTotal = checks.reduce((a, c) => a + (c.ratio === null ? 0 : c.applicable - c.passed), 0);
  const grade = score === null ? null : wbsQualityGradeOf(score);

  return { score, grade, checks, failTotal };
}

/** 배지 툴팁용: 항목별 충족 내역 한 줄(예: "담당자 8/10 · 산출물 3/10 · 선행관계 해당없음"). */
export function wbsQualityChecksSummary(q: WbsQuality): string {
  return q.checks.map((c) => (c.ratio === null ? `${c.label} 해당없음` : `${c.label} ${c.passed}/${c.applicable}`)).join(' · ');
}
