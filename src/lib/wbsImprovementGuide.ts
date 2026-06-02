import type { Project, Task } from '../types';
import type { StatusConfig } from './wbsSettings';
import { buildParentSet } from './taskView';
import { computePlannedProgressMap, todayIso } from './plannedProgress';
import { getHolidaysForTaskDates } from './calendar';
import { getTaskScheduleOutsideProjectMessage } from './projectTaskSchedule';

export type WbsGuideSeverity = 'critical' | 'high' | 'medium' | 'low';

/** WBS 등록 데이터 기준 보완 단계(우선순위 높은 순) */
export type WbsImprovementGuideStep = {
  severity: WbsGuideSeverity;
  title: string;
  instruction: string;
  affectedCount: number;
  sampleTaskIds: string[];
  /** 표시용 한 줄 요약 (WBS + 작업명 등) */
  sampleLabels: string[];
};

const MAX_SAMPLES = 5;

function isDoneStatus(status: string, doneStatusIds: Set<string>): boolean {
  return doneStatusIds.has(status);
}

function isTaskComplete(task: Task, doneStatusIds: Set<string>): boolean {
  const p = typeof task.progress === 'number' && Number.isFinite(task.progress) ? task.progress : 0;
  if (p >= 100) return true;
  return isDoneStatus(String(task.status ?? ''), doneStatusIds);
}

function isUnassignedAssignee(assignee: string | undefined): boolean {
  const t = (assignee ?? '').trim();
  if (!t) return true;
  if (t === '미지정' || t === '(미지정)') return true;
  return false;
}

function ymdStart(s: string | undefined): string | null {
  if (!s) return null;
  const y = String(s).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(y) ? y : null;
}

function refIsAfterStart(refYmd: string, startRaw: string | undefined): boolean {
  const s = ymdStart(startRaw);
  if (!s) return false;
  return refYmd > s;
}

function buildDoneStatusIds(statusConfigs: StatusConfig[]): Set<string> {
  return new Set((statusConfigs ?? []).filter((c) => c.progress >= 100).map((c) => c.id));
}

function pickSamples(tasks: Task[], labelFor: (t: Task) => string): { ids: string[]; labels: string[] } {
  const slice = tasks.slice(0, MAX_SAMPLES);
  return {
    ids: slice.map((t) => t.id),
    labels: slice.map(labelFor),
  };
}

const SEVERITY_ORDER: Record<WbsGuideSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * 현재 필터/프로젝트에 맞는 작업 집합을 기준으로, 보완이 필요한 항목을 우선순위 순으로 정리합니다.
 * (말단 작업 위주: 담당·산출물·선행·진척 지연 등)
 */
export function buildWbsImprovementGuide(
  tasks: Task[],
  projectsById: Map<string, Project>,
  statusConfigs: StatusConfig[],
  options?: {
    refDateIso?: string;
    /** 샘플 행 표시용: WBS + 작업명 등 */
    labelForTask?: (t: Task) => string;
  },
): WbsImprovementGuideStep[] {
  const refDateIso = options?.refDateIso ?? todayIso();
  const labelForTask = options?.labelForTask ?? ((t: Task) => t.name);

  if (!tasks.length) {
    return [
      {
        severity: 'medium',
        title: '작업이 없습니다',
        instruction: '프로젝트에 WBS 작업을 추가한 뒤, 담당자·일정·산출물을 단계적으로 채워 나가세요.',
        affectedCount: 0,
        sampleTaskIds: [],
        sampleLabels: [],
      },
    ];
  }

  const doneIds = buildDoneStatusIds(statusConfigs);
  const parentSet = buildParentSet(tasks);
  const leaves = tasks.filter((t) => !parentSet.has(t.id));
  const holidays = getHolidaysForTaskDates(tasks);
  const plannedById = computePlannedProgressMap(tasks, refDateIso, holidays);

  const steps: WbsImprovementGuideStep[] = [];

  // 1) 프로젝트 기간 밖 일정
  const outsideProject: Task[] = [];
  for (const t of tasks) {
    const p = projectsById.get(t.projectId);
    if (!p) continue;
    const msg = getTaskScheduleOutsideProjectMessage(t, p);
    if (msg) outsideProject.push(t);
  }
  if (outsideProject.length) {
    const { ids, labels } = pickSamples(outsideProject, labelForTask);
    steps.push({
      severity: 'medium',
      title: '프로젝트 기간과 겹치지 않는 작업',
      instruction: '작업 일정은 입력한 대로 유지됩니다. 대시보드·요약과 맞추려면 프로젝트 기간을 조정하거나 작업 일정을 검토해 보세요.',
      affectedCount: outsideProject.length,
      sampleTaskIds: ids,
      sampleLabels: labels,
    });
  }

  // 2) 계획 대비 큰 지연(말단)
  const severeDelay: Task[] = [];
  for (const t of leaves) {
    if (t.isMilestone) continue;
    const planned = plannedById.get(t.id);
    if (planned === undefined) continue;
    const prog = typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0;
    const variance = prog - planned;
    if (planned >= 15 && variance <= -20) severeDelay.push(t);
  }
  if (severeDelay.length) {
    const { ids, labels } = pickSamples(severeDelay, labelForTask);
    steps.push({
      severity: 'high',
      title: '계획 대비 진척이 크게 뒤처진 말단 작업',
      instruction:
        '오늘 기준 계획 진척률 대비 실제 진척이 20%p 이상 낮습니다. 일정을 현실에 맞게 수정하거나, 상태·진척률·산출물 반영을 진행하세요.',
      affectedCount: severeDelay.length,
      sampleTaskIds: ids,
      sampleLabels: labels,
    });
  }

  // 3) 시작일 경과·미완료·진척 거의 없음
  const staleLeaves: Task[] = [];
  for (const t of leaves) {
    if (t.isMilestone) continue;
    if (isTaskComplete(t, doneIds)) continue;
    if (!refIsAfterStart(refDateIso, t.startDate)) continue;
    const prog = typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0;
    if (prog < 10) staleLeaves.push(t);
  }
  if (staleLeaves.length) {
    const { ids, labels } = pickSamples(staleLeaves, labelForTask);
    steps.push({
      severity: 'high',
      title: '시작일이 지났는데 진척이 거의 없는 작업',
      instruction:
        '이미 시작된 것으로 보이는데 진척이 10% 미만입니다. 실제 착수 여부를 반영해 상태·진척을 갱신하거나, 일정을 미루는 등 계획을 정리하세요.',
      affectedCount: staleLeaves.length,
      sampleTaskIds: ids,
      sampleLabels: labels,
    });
  }

  // 4) 담당자 미지정(말단)
  const unassignedLeaves = leaves.filter((t) => !t.isMilestone && isUnassignedAssignee(t.assignee));
  if (unassignedLeaves.length) {
    const { ids, labels } = pickSamples(unassignedLeaves, labelForTask);
    steps.push({
      severity: 'medium',
      title: '담당자가 비어 있는 말단 작업',
      instruction: '말단 작업에 담당자를 지정하면 추적·투입 현황 집계가 정확해집니다. 프로젝트 투입 인원에서 선택하거나 이름을 입력하세요.',
      affectedCount: unassignedLeaves.length,
      sampleTaskIds: ids,
      sampleLabels: labels,
    });
  }

  // 5) 프로젝트 PM 미기입
  const pmMissingProjectNames: string[] = [];
  const seenPid = new Set<string>();
  for (const t of tasks) {
    if (seenPid.has(t.projectId)) continue;
    seenPid.add(t.projectId);
    const p = projectsById.get(t.projectId);
    if (!p) continue;
    if (!(p.pmName ?? '').trim()) pmMissingProjectNames.push(p.name || t.projectId);
  }
  if (pmMissingProjectNames.length) {
    const show = pmMissingProjectNames.slice(0, MAX_SAMPLES);
    steps.push({
      severity: 'medium',
      title: '프로젝트 PM(표시명)이 비어 있음',
      instruction:
        '프로젝트 설정에서 PM 이름을 채우면 대시보드·보고서에서 식별이 쉬워집니다. (조직도 회원 이름과 같으면 직급 표시에 유리합니다.)',
      affectedCount: pmMissingProjectNames.length,
      sampleTaskIds: [],
      sampleLabels: show.map((n) => `「${n}」`),
    });
  }

  // 6) 산출물 미기입(말단)
  const noDeliverables = leaves.filter((t) => !t.isMilestone && !(t.deliverables ?? '').trim());
  if (noDeliverables.length) {
    const { ids, labels } = pickSamples(noDeliverables, labelForTask);
    steps.push({
      severity: 'low',
      title: '산출물이 비어 있는 말단 작업',
      instruction: '작업 완료 판단·검수를 위해 산출물(문서명·형태)을 한 줄이라도 적어 두세요.',
      affectedCount: noDeliverables.length,
      sampleTaskIds: ids,
      sampleLabels: labels,
    });
  }

  // 7) 선행작업 미연결(말단, 일반 작업만)
  const noPred = leaves.filter((t) => !t.isMilestone && !(t.dependencies && t.dependencies.length > 0));
  if (noPred.length && leaves.length >= 2) {
    const { ids, labels } = pickSamples(noPred, labelForTask);
    steps.push({
      severity: 'low',
      title: '선행작업이 없는 말단 작업',
      instruction: '의존 관계가 없으면 크리티컬 패스·일정 경고 분석이 약해집니다. 실제 선후 관계가 있는 작업부터 선행작업 ID를 연결하세요.',
      affectedCount: noPred.length,
      sampleTaskIds: ids,
      sampleLabels: labels,
    });
  }

  // 정렬: 심각도 → 영향 건수 내림차순
  steps.sort((a, b) => {
    const sd = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sd !== 0) return sd;
    return b.affectedCount - a.affectedCount;
  });

  // 모두 통과
  if (steps.length === 0) {
    return [
      {
        severity: 'low',
        title: '우선 조치할 항목이 없습니다',
        instruction:
          '등록된 말단 작업 기준으로 자주 빠지는 항목(담당 미지정·산출물·선행·진척 지연 등)이 감지되지 않았습니다. 필요 시 주기적으로 이 가이드를 다시 확인하세요.',
        affectedCount: 0,
        sampleTaskIds: [],
        sampleLabels: [],
      },
    ];
  }

  return steps;
}
