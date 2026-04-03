import React, { useMemo, useState } from 'react';
import { TrendingDown } from 'lucide-react';
import { cn } from '../lib/utils';
import type { Task, Project } from '../types';
import type { StatusConfig } from '../lib/wbsSettings';
import { parseISO, format, addDays, differenceInCalendarDays, isValid } from 'date-fns';

interface BurndownChartProps {
  tasks: Task[];
  projects: Project[];
  statusConfigs: StatusConfig[];
  /** 선택한 프로젝트 ID. 'all'이면 전체 */
  selectedProjectId?: string;
}

/** 날짜별 남은 작업 수를 계산 */
function computeBurndownData(
  tasks: Task[],
  doneStatusIds: Set<string>,
): { date: string; ideal: number; actual: number }[] {
  // 리프 작업만 (부모 작업 제외)
  const parentIds = new Set(tasks.map(t => t.parentId).filter(Boolean));
  const leafTasks = tasks.filter(t => !parentIds.has(t.id));
  if (leafTasks.length === 0) return [];

  // 프로젝트 시작일/종료일 범위
  const dates = leafTasks.flatMap(t => [t.startDate, t.endDate]).filter(Boolean);
  if (dates.length === 0) return [];
  dates.sort();
  const startStr = dates[0];
  const endStr = dates[dates.length - 1];
  const start = parseISO(startStr);
  const end = parseISO(endStr);
  if (!isValid(start) || !isValid(end)) return [];

  const totalDays = differenceInCalendarDays(end, start);
  if (totalDays <= 0) return [];

  const totalTasks = leafTasks.length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = format(today, 'yyyy-MM-dd');

  const points: { date: string; ideal: number; actual: number }[] = [];

  // 주 단위 또는 날짜 단위 (30일 이하: 일별, 그 이상: 주별)
  const step = totalDays > 60 ? 7 : totalDays > 30 ? 3 : 1;

  for (let d = 0; d <= totalDays; d += step) {
    const current = addDays(start, d);
    const dateStr = format(current, 'yyyy-MM-dd');

    // 이상적(ideal): 선형 감소
    const ideal = Math.max(0, totalTasks - (totalTasks * d / totalDays));

    // 실제(actual): 해당 날짜까지 완료되지 않은 작업 수
    // 미래 날짜는 현재 기준
    let remaining = totalTasks;
    if (dateStr <= todayStr) {
      remaining = leafTasks.filter(t => {
        // 완료 상태이고 종료일이 해당 날짜 이전이면 완료
        const isDone = doneStatusIds.has(t.status) || (typeof t.progress === 'number' && t.progress >= 100);
        if (!isDone) return true; // 아직 안 끝남 → 남은 작업
        // 완료된 작업의 종료일이 해당 날짜 이후면 아직 안 끝난 것
        return (t.endDate ?? '') > dateStr;
      }).length;
    } else {
      // 미래: 데이터 없음 → null 처리 (차트에서 점선으로)
      remaining = -1; // -1 = 미래(표시 안 함)
    }

    points.push({ date: dateStr, ideal: Math.round(ideal * 10) / 10, actual: remaining });
  }

  // 마지막 날 추가
  const lastDate = format(end, 'yyyy-MM-dd');
  if (points.length === 0 || points[points.length - 1].date !== lastDate) {
    const lastActual = lastDate <= todayStr
      ? leafTasks.filter(t => {
          const isDone = doneStatusIds.has(t.status) || (typeof t.progress === 'number' && t.progress >= 100);
          if (!isDone) return true;
          return (t.endDate ?? '') > lastDate;
        }).length
      : -1;
    points.push({ date: lastDate, ideal: 0, actual: lastActual });
  }

  return points;
}

export function BurndownChart({ tasks, projects, statusConfigs, selectedProjectId }: BurndownChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const doneStatusIds = useMemo(
    () => new Set(statusConfigs.filter(c => c.progress === 100).map(c => c.id)),
    [statusConfigs],
  );

  const [projectFilter, setProjectFilter] = useState(selectedProjectId ?? 'all');

  const filteredTasks = useMemo(() => {
    if (projectFilter === 'all') return tasks;
    return tasks.filter(t => t.projectId === projectFilter);
  }, [tasks, projectFilter]);

  const data = useMemo(() => computeBurndownData(filteredTasks, doneStatusIds), [filteredTasks, doneStatusIds]);

  if (data.length < 2) {
    return (
      <div className="card p-6 text-center text-sm text-[var(--color-ink-muted)]">
        번다운 차트를 표시하려면 시작일/종료일이 있는 작업이 필요합니다.
      </div>
    );
  }

  // SVG 크기
  const W = 700;
  const H = 300;
  const PAD = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxY = data[0].ideal;
  const xScale = (i: number) => PAD.left + (i / (data.length - 1)) * chartW;
  const yScale = (v: number) => PAD.top + chartH - (v / maxY) * chartH;

  // 이상적 라인
  const idealPath = data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.ideal)}`).join(' ');

  // 실제 라인 (미래 제외)
  const actualPoints = data.filter(p => p.actual >= 0);
  const actualPath = actualPoints.length > 0
    ? data.map((p, i) => {
        if (p.actual < 0) return '';
        const prevHasData = i === 0 || data[i - 1].actual >= 0;
        return `${prevHasData && i > 0 ? 'L' : 'M'} ${xScale(i)} ${yScale(p.actual)}`;
      }).filter(Boolean).join(' ')
    : '';

  // 오늘 위치
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const todayIdx = data.findIndex(p => p.date >= todayStr);

  // X축 라벨 (최대 8개)
  const labelStep = Math.max(1, Math.floor(data.length / 8));
  const xLabels = data.filter((_, i) => i % labelStep === 0 || i === data.length - 1);

  // Y축 라벨
  const yTicks = [0, Math.round(maxY / 4), Math.round(maxY / 2), Math.round(maxY * 3 / 4), Math.round(maxY)];

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-bold text-[var(--color-ink)] flex items-center gap-2">
          <TrendingDown size={20} className="text-blue-500" />
          번다운 차트
        </h3>
        <select
          value={projectFilter}
          onChange={e => setProjectFilter(e.target.value)}
          className="text-xs border border-[var(--color-line)] rounded-lg px-2 py-1.5 bg-[var(--color-surface)] text-[var(--color-ink)]"
        >
          <option value="all">전체 프로젝트</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        onMouseLeave={() => setHoveredIdx(null)}
      >
        {/* 그리드 */}
        {yTicks.map(v => (
          <line key={v} x1={PAD.left} y1={yScale(v)} x2={W - PAD.right} y2={yScale(v)} stroke="var(--color-line)" strokeWidth={0.5} strokeDasharray={v > 0 ? '4,4' : undefined} />
        ))}

        {/* 오늘 세로선 */}
        {todayIdx >= 0 && (
          <>
            <line x1={xScale(todayIdx)} y1={PAD.top} x2={xScale(todayIdx)} y2={PAD.top + chartH} stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="4,4" opacity={0.5} />
            <text x={xScale(todayIdx)} y={PAD.top - 5} textAnchor="middle" className="text-[9px] fill-[var(--color-accent)]" fontWeight={600}>오늘</text>
          </>
        )}

        {/* 이상적 라인 */}
        <path d={idealPath} fill="none" stroke="var(--color-ink-muted)" strokeWidth={2} strokeDasharray="6,4" opacity={0.5} />

        {/* 실제 라인 */}
        {actualPath && (
          <path d={actualPath} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* 실제 데이터 포인트 */}
        {data.map((p, i) => p.actual >= 0 && (
          <circle
            key={i}
            cx={xScale(i)}
            cy={yScale(p.actual)}
            r={hoveredIdx === i ? 5 : 3}
            fill="#3b82f6"
            stroke="var(--color-surface)"
            strokeWidth={2}
            className="cursor-pointer transition-all"
            onMouseEnter={() => setHoveredIdx(i)}
          />
        ))}

        {/* 호버 툴팁 */}
        {hoveredIdx !== null && data[hoveredIdx] && (
          <g>
            <rect
              x={Math.min(xScale(hoveredIdx) - 55, W - PAD.right - 110)}
              y={Math.max(yScale(data[hoveredIdx].actual >= 0 ? data[hoveredIdx].actual : data[hoveredIdx].ideal) - 45, PAD.top)}
              width={110}
              height={38}
              rx={6}
              fill="var(--color-surface)"
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={Math.min(xScale(hoveredIdx), W - PAD.right - 55)}
              y={Math.max(yScale(data[hoveredIdx].actual >= 0 ? data[hoveredIdx].actual : data[hoveredIdx].ideal) - 30, PAD.top + 15)}
              textAnchor="middle"
              className="text-[10px] fill-[var(--color-ink)]"
              fontWeight={600}
            >
              {data[hoveredIdx].date}
            </text>
            <text
              x={Math.min(xScale(hoveredIdx), W - PAD.right - 55)}
              y={Math.max(yScale(data[hoveredIdx].actual >= 0 ? data[hoveredIdx].actual : data[hoveredIdx].ideal) - 15, PAD.top + 30)}
              textAnchor="middle"
              className="text-[10px] fill-[var(--color-ink-muted)]"
            >
              이상: {Math.round(data[hoveredIdx].ideal)} · {data[hoveredIdx].actual >= 0 ? `남은: ${data[hoveredIdx].actual}` : '미래'}
            </text>
          </g>
        )}

        {/* X축 라벨 */}
        {xLabels.map(p => {
          const i = data.indexOf(p);
          return (
            <text key={p.date} x={xScale(i)} y={H - 5} textAnchor="middle" className="text-[9px] fill-[var(--color-ink-muted)]">
              {p.date.slice(5)} {/* MM-DD */}
            </text>
          );
        })}

        {/* Y축 라벨 */}
        {yTicks.map(v => (
          <text key={v} x={PAD.left - 8} y={yScale(v) + 3} textAnchor="end" className="text-[9px] fill-[var(--color-ink-muted)]">
            {v}
          </text>
        ))}
      </svg>

      {/* 범례 */}
      <div className="flex items-center gap-6 text-xs text-[var(--color-ink-muted)] justify-center">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-[var(--color-ink-muted)] inline-block" style={{ borderTop: '2px dashed var(--color-ink-muted)' }} />
          이상적 (선형)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-blue-500 inline-block rounded" />
          실제 남은 작업
        </span>
        {todayIdx >= 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 inline-block" style={{ borderTop: '2px dashed var(--color-accent)' }} />
            오늘
          </span>
        )}
      </div>
    </div>
  );
}
