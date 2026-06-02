import { useMemo } from 'react';
import type { Task, Project } from '../../types';
import { formatPercent1, round1 } from '../../lib/utils';
import { normalizeWorkEffortUnit, workEffortToManDays, workEffortUnitSuffixKo } from '../../lib/workEffortUnits';
import { computePlannedProgressMap } from '../../lib/plannedProgress';

export interface SummaryStats {
  totalEffort: number;
  /** 총 공수 표시 (프로젝트 혼합 시 M/D 환산) */
  effortDisplayAmount: number;
  effortDisplayLabel: string;
  avgProgress: number;
  /** 요약 바「전체 진척율」계산 방식 설명 (title 툴팁) */
  avgProgressTooltip: string;
  /** 전체 계획율(%): 전체 진척율과 동일 가중·집계 방식으로 계산한 "오늘 일정상 기대 진척" */
  avgPlanned: number;
  /** 계획 대비 진척 차이(%p) = avgProgress − avgPlanned. 양수=앞섬, 음수=지연 */
  progressVariance: number;
  startDate: string;
  endDate: string;
  taskCount: number;
  leafCount: number;
  isSelection: boolean;
}

/**
 * 전체 진척율: 1레벨 WBS의 (progress×weight) 가중평균(Σw가 100이 아니어도 동일)을 우선 사용.
 * (weight 없으면 공수로 대체) 1레벨이 없으면 폴백으로 단말(리프) 단순 평균. 결과는 0~100%로 클램프.
 */
export function useWbsSummaryStats(baseTasks: Task[], projects: Project[] = []): SummaryStats | null {
  return useMemo(() => {
    const source = baseTasks;
    if (source.length === 0) return null;

    const projectById = new Map(projects.map((p) => [p.id, p]));
    const plannedById = computePlannedProgressMap(source);

    const leafTasks = source.filter((t) => !source.some((other) => other.parentId === t.id));
    const forAggregate = leafTasks.length > 0 ? leafTasks : source;

    const unitsInView = new Set(forAggregate.map((t) => normalizeWorkEffortUnit(projectById.get(t.projectId)?.workEffortUnit)));
    let effortDisplayAmount: number;
    let effortDisplayLabel: string;
    let totalEffort: number;
    if (unitsInView.size <= 1) {
      const u = [...unitsInView][0] ?? 'day';
      const sum = forAggregate.reduce((s, t) => s + (t.workEffort || 0), 0);
      effortDisplayAmount = sum;
      effortDisplayLabel = workEffortUnitSuffixKo(u);
      totalEffort = sum;
    } else {
      const mdSum = forAggregate.reduce((s, t) => {
        const u = normalizeWorkEffortUnit(projectById.get(t.projectId)?.workEffortUnit);
        return s + workEffortToManDays(t.workEffort || 0, u);
      }, 0);
      effortDisplayAmount = Math.round(mdSum * 10) / 10;
      effortDisplayLabel = 'M/D';
      totalEffort = effortDisplayAmount;
    }

    const taskById = new Map<string, Task>(source.map((t) => [t.id, t]));
    const depthMemo = new Map<string, number>();
    const getDepth = (id: string): number => {
      const cached = depthMemo.get(id);
      if (cached !== undefined) return cached;
      const t = taskById.get(id);
      if (!t || !t.parentId || !taskById.has(t.parentId)) {
        depthMemo.set(id, 0);
        return 0;
      }
      const d = getDepth(t.parentId) + 1;
      depthMemo.set(id, d);
      return d;
    };
    const level1 = source.filter((t) => getDepth(t.id) === 1);
    const computeWeighted = (items: Task[]) => {
      let totalWeight = 0;
      let acc = 0;
      for (const t of items) {
        const p = typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0;
        const w =
          typeof t.weight === 'number' && Number.isFinite(t.weight)
            ? t.weight
            : typeof t.workEffort === 'number' && Number.isFinite(t.workEffort) && t.workEffort > 0
              ? workEffortToManDays(t.workEffort, normalizeWorkEffortUnit(projectById.get(t.projectId)?.workEffortUnit))
              : 0;
        totalWeight += w;
        acc += p * w;
      }
      if (totalWeight > 0) return Math.min(100, Math.max(0, round1(acc / totalWeight)));
      if (items.length > 0)
        return Math.min(
          100,
          Math.max(0, round1(items.reduce((s, t) => s + (typeof t.progress === 'number' ? t.progress : 0), 0) / items.length)),
        );
      return 0;
    };
    const avgProgress =
      level1.length > 0
        ? computeWeighted(level1)
        : forAggregate.length > 0
          ? Math.min(100, Math.max(0, round1(forAggregate.reduce((sum, t) => sum + (t.progress || 0), 0) / forAggregate.length)))
          : 0;

    // 전체 계획율: 전체 진척율과 동일한 집계 대상(level1 우선)·동일 가중(가중치→없으면 공수 M/D)으로 계산
    const plannedOf = (t: Task) => plannedById.get(t.id) ?? 0;
    const weightForAgg = (t: Task) =>
      typeof t.weight === 'number' && Number.isFinite(t.weight)
        ? t.weight
        : typeof t.workEffort === 'number' && Number.isFinite(t.workEffort) && t.workEffort > 0
          ? workEffortToManDays(t.workEffort, normalizeWorkEffortUnit(projectById.get(t.projectId)?.workEffortUnit))
          : 0;
    const computeWeightedPlanned = (items: Task[]) => {
      let totalWeight = 0;
      let acc = 0;
      for (const t of items) {
        const w = weightForAgg(t);
        totalWeight += w;
        acc += plannedOf(t) * w;
      }
      if (totalWeight > 0) return Math.min(100, Math.max(0, round1(acc / totalWeight)));
      if (items.length > 0) return Math.min(100, Math.max(0, round1(items.reduce((s, t) => s + plannedOf(t), 0) / items.length)));
      return 0;
    };
    const avgPlanned = level1.length > 0 ? computeWeightedPlanned(level1) : computeWeightedPlanned(forAggregate);
    const progressVarianceValue = round1(avgProgress - avgPlanned);

    let avgProgressTooltip: string;
    if (level1.length > 0) {
      const parts: string[] = [
        '요약 바「전체 진척율」은 WBS 깊이 1인 작업만 집계합니다.',
        '각 1레벨 작업의 진척률에 가중치를 곱한 합을, 가중치 합으로 나눈 뒤 0~100% 범위로 소수 첫째 자리까지 반올림합니다.',
        '가중치는 작업에 입력한 진척 가중치가 있으면 그 값을 쓰고, 없으면 공수를 해당 프로젝트 단위에서 M/D로 환산한 값을 씁니다.',
        `현재 표시: ${formatPercent1(avgProgress)}%`,
      ];
      const maxShow = 8;
      if (level1.length <= maxShow) {
        parts.push('1레벨 작업별 기여(진척×가중):');
        for (const t of level1) {
          const p = typeof t.progress === 'number' && Number.isFinite(t.progress) ? t.progress : 0;
          const w =
            typeof t.weight === 'number' && Number.isFinite(t.weight)
              ? t.weight
              : typeof t.workEffort === 'number' && Number.isFinite(t.workEffort) && t.workEffort > 0
                ? workEffortToManDays(t.workEffort, normalizeWorkEffortUnit(projectById.get(t.projectId)?.workEffortUnit))
                : 0;
          const nm = (t.name ?? '').trim() || t.id;
          const short = nm.length > 26 ? `${nm.slice(0, 26)}…` : nm;
          parts.push(`· ${short}: ${formatPercent1(p)}% × ${w} → ${Math.round(p * w * 100) / 100}`);
        }
      } else {
        parts.push(`1레벨 작업 ${level1.length}개(일부만 표시하려면 작업 수를 줄이거나 필터를 사용하세요).`);
      }
      avgProgressTooltip = parts.join('\n');
    } else {
      avgProgressTooltip = [
        '깊이 1 작업이 없어, 단말(리프) 작업들의 진척률 산술평균을 사용합니다.',
        `현재 표시: ${formatPercent1(avgProgress)}%`,
      ].join('\n');
    }

    // 기간 표시: 단일 프로젝트 뷰에서는 그 프로젝트의 startDate/endDate를 우선 표시한다.
    // 프로젝트 일정이 비어 있거나 다중 프로젝트가 섞여 있으면 작업의 min/max 합산으로 폴백.
    const projectIdsInView = Array.from(new Set(source.map((t) => t.projectId).filter(Boolean)));
    const taskMinStart = source.reduce((min, t) => (t.startDate < min ? t.startDate : min), source[0].startDate);
    const taskMaxEnd = source.reduce((max, t) => (t.endDate > max ? t.endDate : max), source[0].endDate);
    let startDate = taskMinStart;
    let endDate = taskMaxEnd;
    if (projectIdsInView.length === 1) {
      const proj = projectById.get(projectIdsInView[0]!);
      if (proj?.startDate) startDate = proj.startDate;
      if (proj?.endDate) endDate = proj.endDate;
    }

    return {
      totalEffort,
      effortDisplayAmount,
      effortDisplayLabel,
      avgProgress,
      avgProgressTooltip,
      avgPlanned,
      progressVariance: progressVarianceValue,
      startDate,
      endDate,
      taskCount: source.length,
      leafCount: leafTasks.length,
      isSelection: false,
    };
  }, [baseTasks, projects]);
}

export function formatSummaryDate(d: string): string {
  if (!d) return '-';
  const dt = new Date(d);
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`;
}
