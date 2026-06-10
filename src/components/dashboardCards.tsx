import React, { useId } from 'react';
import { Activity, Briefcase, Building2, CircleHelp, GitBranch, ListChecks, Loader2, User } from 'lucide-react';
import { cn, formatPercent1 } from '../lib/utils';
import { formatProjectDisplayName } from '../lib/projectKind';
import type { Project } from '../types';
import type { ProjectStats } from '../lib/dashboardTypes';
import type { DashboardDetailKind } from './DashboardDetailPage';
import { ProjectPeriodDateText } from './ProjectPeriodDateText';

/**
 * 대시보드 프레젠테이션 카드 모음 (Dashboard.tsx에서 분리).
 * 순수 표시용 컴포넌트로, 상태/데이터는 props로만 받는다.
 */

/** 요약 표「비고」셀: 비어 있으면 —, 있으면 hover/aria로 전체 노출 */
export function DashboardTableHintCell({ text }: { text: string }) {
  const noteId = useId();
  const t = text.trim();
  if (!t) {
    return <td className="px-3 py-2.5 text-xs text-slate-500">—</td>;
  }
  return (
    <td className="px-3 py-2.5 text-xs text-slate-500 cursor-help" title={t} aria-describedby={noteId}>
      <span id={noteId} className="sr-only">
        {t}
      </span>
      <span className="inline-flex items-center justify-center text-slate-500" aria-hidden>
        <CircleHelp className="size-4 shrink-0" strokeWidth={2} />
      </span>
    </td>
  );
}

/**
 * 대시보드 상단 "지휘본부" 히어로 밴드 — 핵심 KPI(프로젝트·작업·회원·접속) 타일.
 */
export function DashboardHeroBand({
  totalProjects,
  totalTasks,
  memberCount,
  loadingMemberCount,
  visitorStats,
  loadingVisitorStats,
  projectCountSubtitle,
  excludedCount,
  mobileReadabilityMode = false,
  onOpenDetail,
}: {
  totalProjects: number;
  totalTasks: number;
  memberCount: number;
  loadingMemberCount: boolean;
  visitorStats: { daily: number; total: number };
  loadingVisitorStats: boolean;
  projectCountSubtitle?: string;
  excludedCount: number;
  mobileReadabilityMode?: boolean;
  onOpenDetail: (kind: DashboardDetailKind) => void;
}) {
  const tasksNote = excludedCount > 0 ? '※ 제외된 프로젝트의 작업은 합계에 포함되지 않음' : undefined;

  const kpis: Array<{
    key: DashboardDetailKind;
    label: string;
    icon: React.ComponentType<{ size?: number | string; className?: string }>;
    iconClass: string;
    title?: string;
    node: React.ReactNode;
  }> = [
    {
      key: 'projects',
      label: '프로젝트',
      icon: Briefcase,
      iconClass: 'text-indigo-500',
      title: projectCountSubtitle || undefined,
      node: <span className="text-2xl md:text-3xl font-bold tabular-nums leading-none">{totalProjects}</span>,
    },
    {
      key: 'tasks',
      label: '작업',
      icon: ListChecks,
      iconClass: 'text-violet-500',
      title: tasksNote,
      node: <span className="text-2xl md:text-3xl font-bold tabular-nums leading-none">{totalTasks}</span>,
    },
    {
      key: 'members',
      label: '회원',
      icon: User,
      iconClass: 'text-sky-500',
      node: loadingMemberCount ? (
        <Loader2 size={20} className="animate-spin text-slate-400" />
      ) : (
        <span className="text-2xl md:text-3xl font-bold tabular-nums leading-none">{memberCount}</span>
      ),
    },
    {
      key: 'visitors',
      label: '접속 · 금일',
      icon: Activity,
      iconClass: 'text-emerald-500',
      node: loadingVisitorStats ? (
        <Loader2 size={20} className="animate-spin text-slate-400" />
      ) : (
        <span className="flex items-baseline gap-1.5">
          <span className="text-2xl md:text-3xl font-bold tabular-nums leading-none">{visitorStats.daily}</span>
          <span className="text-xs font-medium text-[var(--color-ink-muted)]">누적 {visitorStats.total}</span>
        </span>
      ),
    },
  ];

  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-sm md:p-5">
      <div className={cn('grid gap-2.5 sm:gap-3', mobileReadabilityMode ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-4')}>
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <button
              key={k.key}
              type="button"
              onClick={() => onOpenDetail(k.key)}
              title={k.title}
              className="group/kpi flex flex-col gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] p-3.5 text-left text-[var(--color-ink)] transition-all hover:-translate-y-0.5 hover:bg-[var(--color-surface)] hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                <Icon size={14} aria-hidden className={k.iconClass} />
                {k.label}
              </span>
              {k.node}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 프로젝트별 현황 카드: 제목·소속/PM·계획율/진척율·작업/팀원/기간 요약 */
export function ProjectCard({
  project,
  onClick,
  isSelected,
  mobileReadabilityMode = false,
  divisionName,
  pmName,
  forkSource,
  onOpenForkSource,
}: {
  project: Project & { stats: ProjectStats };
  onClick?: () => void;
  isSelected?: boolean;
  mobileReadabilityMode?: boolean;
  /** 소속 사업부(조직) 이름 — 대시보드 "사업부 현황"과 동일 분류 */
  divisionName?: string;
  /** PM(프로젝트 책임자) 표시명 */
  pmName?: string;
  /** 분기 원본 정보(부모 프로젝트·task 이름). 있으면 카드 상단에 "← 상위" 백링크 표시 */
  forkSource?: { projectId: string; projectName: string; taskName: string };
  /** 백링크 클릭 시 호출 — 보통 부모 프로젝트로 전환 */
  onOpenForkSource?: (sourceProjectId: string) => void;
}) {
  const s = project.stats;

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'card flex h-full flex-col overflow-hidden group p-3 transition-all duration-300',
        onClick && 'cursor-pointer hover:border-indigo-200 hover:-translate-y-0.5 hover:shadow-md',
        isSelected && 'ring-2 ring-indigo-400 border-indigo-300 shadow-md',
      )}
    >
      {forkSource && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenForkSource?.(forkSource.projectId);
          }}
          className="mb-1.5 inline-flex items-center gap-1 self-start rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors max-w-full"
          title={`상위 프로젝트 「${forkSource.projectName}」의 작업 「${forkSource.taskName}」에서 분기됨 — 클릭하면 상위 프로젝트로 이동합니다.`}
        >
          <GitBranch size={11} aria-hidden className="shrink-0" />
          <span className="truncate">
            ← {forkSource.projectName} · {forkSource.taskName}
          </span>
        </button>
      )}
      <h3
        className={cn(
          'font-semibold text-[var(--color-ink)] mb-1.5 break-words line-clamp-2 group-hover:text-indigo-600 transition-colors leading-snug',
          mobileReadabilityMode ? 'text-sm' : 'text-[13px]',
        )}
        title={formatProjectDisplayName(project.name, project.projectKind)}
      >
        {formatProjectDisplayName(project.name, project.projectKind)}
      </h3>
      <div className="flex flex-col gap-1 text-[11px] min-w-0">
        <span
          className="inline-flex items-center gap-1 min-w-0 text-slate-500"
          title={divisionName ? `소속 ${divisionName}` : '사업부 미분류'}
        >
          <Building2 size={11} className="shrink-0 text-sky-500" aria-hidden />
          <span className={cn('truncate', !divisionName && 'text-slate-400')}>{divisionName || '사업부 미분류'}</span>
        </span>
        <span className="inline-flex items-center gap-1 min-w-0" title={pmName ? `PM ${pmName}` : 'PM 미지정'}>
          <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-500">PM</span>
          <span className={cn('truncate', pmName ? 'font-medium text-slate-700' : 'text-slate-400')}>{pmName || '미지정'}</span>
        </span>
      </div>
      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold text-slate-400 shrink-0 cursor-help"
            title="계획율은 시작일·종료일 기준으로 자동 산정됩니다 (직접 입력 아님). 카드를 눌러 작업 표에서 날짜를 수정하면 바뀝니다."
          >
            계획율
          </span>
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-500 transition-all duration-1000 ease-out" style={{ width: `${Math.min(100, s.planned)}%` }} />
          </div>
          <span className="text-sm font-bold text-amber-700 w-14 text-right tabular-nums shrink-0">{formatPercent1(s.planned)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-slate-400 shrink-0">진척율</span>
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-1000 ease-out"
              style={{ width: `${Math.min(100, s.progress)}%` }}
            />
          </div>
          <span className="text-base font-bold text-indigo-700 w-14 text-right tabular-nums shrink-0">{formatPercent1(s.progress)}%</span>
        </div>
      </div>

      <div className="mt-auto pt-2.5 border-t border-slate-100 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-slate-500 tabular-nums">
        <span>
          작업 <strong className="font-semibold text-slate-700">{s.total}</strong>
        </span>
        <span className="text-slate-300">·</span>
        <span>
          팀원 <strong className="font-semibold text-slate-800">{s.assigneeCount}</strong>
        </span>
        <span className="text-slate-300">|</span>
        <span className="text-slate-600">
          {project.startDate || project.endDate ? (
            <>
              <ProjectPeriodDateText date={project.startDate} className="text-slate-600" emptyLabel="?" />
              <span className="text-slate-300 mx-0.5">~</span>
              <ProjectPeriodDateText date={project.endDate} className="text-slate-600" emptyLabel="?" />
            </>
          ) : (
            <span className="text-amber-700/90 font-medium">기간 미정</span>
          )}
        </span>
      </div>
    </div>
  );
}
