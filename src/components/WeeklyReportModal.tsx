import React, { useEffect, useMemo, useState } from 'react';
import { X, Copy, AlertCircle, User, Briefcase, Layers, FolderOpen, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  differenceInCalendarDays,
  parseISO,
  isBefore,
  isAfter,
  isValid,
} from 'date-fns';
import { Task, Project } from '../types';
import { TaskModal } from './TaskModal';
import { useWBS } from '../context/WBSContext';
import { cn, formatNum2 } from '../lib/utils';

interface WeeklyReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  projects: Project[];
  currentProjectId: string;
  currentUserDisplay?: string;
}

type Scope = 'all' | 'me';
/** 프로젝트 범위: 전체 | 다중 선택 */
type ProjectScope = 'all' | 'multiple';

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const d = parseISO(value);
  return isValid(d) ? d : null;
}

function isInRange(date: Date | null, from: Date, to: Date): boolean {
  if (!date) return false;
  return !isBefore(date, from) && !isAfter(date, to);
}

export function WeeklyReportModal({
  isOpen,
  onClose,
  tasks,
  projects,
  currentProjectId,
  currentUserDisplay,
}: WeeklyReportModalProps) {
  const { updateTask, addTask } = useWBS();
  const [baseStartStr, setBaseStartStr] = useState(() =>
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
  );
  const [baseEndStr, setBaseEndStr] = useState(() =>
    format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
  );
  const [scope, setScope] = useState<Scope>('me');
  const [projectScope, setProjectScope] = useState<ProjectScope>('all');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  // 수정창에는 모달에 전달된 전체 tasks 사용(다른 프로젝트 작업도 편집 가능)
  const editingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : undefined;
  // 다중 선택에서 프로젝트 1개일 때 프로젝트 요약 테이블용
  const currentProject =
    projectScope === 'multiple' && selectedProjectIds.length === 1
      ? projects.find((p) => p.id === selectedProjectIds[0]) || null
      : null;

  useEffect(() => {
    if (!isOpen) return;
    setCopied(false);
  }, [isOpen, baseStartStr, baseEndStr, scope]);

  // 모달 열릴 때 현재 화면 기준으로 프로젝트 범위 초기화
  useEffect(() => {
    if (!isOpen) return;
    if (currentProjectId && currentProjectId !== 'all') {
      setProjectScope('multiple');
      setSelectedProjectIds([currentProjectId]);
    } else {
      setProjectScope('all');
      setSelectedProjectIds([]);
    }
  }, [isOpen, currentProjectId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handler);
    }
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const { reportText, summary, sections } = useMemo(() => {
    if (!isOpen) {
      return { reportText: '', summary: { thisWeekCount: 0, nextWeekCount: 0, issueCount: 0, overallProgress: 0, overallEffort: 0 }, sections: { thisWeek: [], nextWeek: [], issues: [] } };
    }

    const today = new Date();
    const thisWeekStart = parseISO(baseStartStr);
    const thisWeekEnd = parseISO(baseEndStr);

    const spanDays = Math.max(1, differenceInCalendarDays(thisWeekEnd, thisWeekStart) + 1);
    const nextWeekStart = addDays(thisWeekStart, spanDays);
    const nextWeekEnd = addDays(nextWeekStart, spanDays - 1);

    // 프로젝트 범위에 따른 허용 projectId 집합 (null = 전체)
    const allowedProjectIds: Set<string> | null =
      projectScope === 'all' || selectedProjectIds.length === 0
        ? null
        : new Set(selectedProjectIds);

    const projectName =
      projectScope === 'multiple' && selectedProjectIds.length > 0
        ? selectedProjectIds.length === 1
          ? (projects.find((p) => p.id === selectedProjectIds[0])?.name ?? '선택한 프로젝트')
          : `선택한 프로젝트 (${selectedProjectIds.length}개)`
        : '전체 프로젝트';

    const normalizedMe = (currentUserDisplay || '').trim().toLowerCase();

    const filteredTasks = tasks.filter((t) => {
      if (allowedProjectIds !== null && !allowedProjectIds.has(t.projectId)) return false;
      if (scope === 'me' && normalizedMe) {
        const assignee = (t.assignee || '').trim().toLowerCase();
        if (!assignee || !assignee.includes(normalizedMe)) return false;
      }
      return true;
    });

    const taskIndex = new Map<string, Task>(tasks.map((t) => [t.id, t]));

    // 부모 → 직속 하위 작업 목록
    const childrenByParent = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.parentId) continue;
      const arr = childrenByParent.get(t.parentId) ?? [];
      arr.push(t);
      childrenByParent.set(t.parentId, arr);
    }

    const buildPath = (task: Task): string => {
      const names: string[] = [];
      let current: Task | undefined = task;
      const guard = new Set<string>();
      while (current) {
        if (guard.has(current.id)) break;
        guard.add(current.id);
        names.unshift(current.name);
        if (!current.parentId) break;
        const parent = taskIndex.get(current.parentId);
        if (!parent) break;
        current = parent;
      }
      return names.join(' > ');
    };

    /** 완료된 체크리스트 항목을 수행업무 내용 문자열로 반환
     *  - 체크리스트가 없으면 하위 작업 중 완료된 항목을 대신 사용
     */
    const getCompletedChecklistDetail = (task: Task): string => {
      const completed = task.checklist?.filter((c) => c.completed).map((c) => c.text.trim()).filter(Boolean) ?? [];
      if (completed.length > 0) return completed.map((t) => `• ${t}`).join('\n');

      // 체크리스트가 없으면 하위 작업의 완료 항목을 사용
      const children = childrenByParent.get(task.id) ?? [];
      const doneChildren = children.filter((child) => {
        const progress = typeof child.progress === 'number' ? child.progress : 0;
        return child.status === 'done' || progress >= 100;
      });
      if (doneChildren.length > 0) {
        return doneChildren.map((c) => `• ${c.name}`).join('\n');
      }

      return task.description || task.deliverables || '';
    };

    /** 미완료 체크리스트 항목을 차주수행업무 내용 문자열로 반환
     *  - 체크리스트가 없으면 하위 작업 중 미완료 항목을 대신 사용
     */
    const getIncompleteChecklistDetail = (task: Task): string => {
      const incomplete = task.checklist?.filter((c) => !c.completed).map((c) => c.text.trim()).filter(Boolean) ?? [];
      if (incomplete.length > 0) return incomplete.map((t) => `• ${t}`).join('\n');

      // 체크리스트가 없으면 하위 작업의 미완료 항목을 사용
      const children = childrenByParent.get(task.id) ?? [];
      const notDoneChildren = children.filter((child) => {
        const progress = typeof child.progress === 'number' ? child.progress : 0;
        const isDone = child.status === 'done' || progress >= 100;
        return !isDone;
      });
      if (notDoneChildren.length > 0) {
        return notDoneChildren.map((c) => `• ${c.name}`).join('\n');
      }

      return task.description || task.deliverables || '';
    };

    const computeOverallProgress = (items: Task[]): { avgProgress: number; totalEffort: number } => {
      if (!items.length) return { avgProgress: 0, totalEffort: 0 };
      let totalWeight = 0;
      let acc = 0;
      for (const t of items) {
        const p = typeof t.progress === 'number' ? t.progress : 0;
        const w =
          typeof t.weight === 'number' && Number.isFinite(t.weight)
            ? t.weight
            : (typeof t.workEffort === 'number' && t.workEffort > 0 ? t.workEffort : 0);
        totalWeight += w;
        acc += p * w;
      }
      const avg = totalWeight > 0 ? Math.round(acc / totalWeight) : 0;
      return { avgProgress: avg, totalEffort: totalWeight };
    };

    const thisWeekDone: Task[] = [];
    const nextWeekPlan: Task[] = [];
    const issues: Task[] = [];

    for (const t of filteredTasks) {
      const start = parseDate(t.startDate);
      const end = parseDate(t.endDate);
      const progress = typeof t.progress === 'number' ? t.progress : 0;
      const isDone = (t.status === 'done') || progress >= 100;

      // 금주 완료
      if (isDone && isInRange(end, thisWeekStart, thisWeekEnd)) {
        thisWeekDone.push(t);
      }

      // 차주 계획: 미완료 + 종료일이 차주 범위에 있는 경우
      if (!isDone && isInRange(end, nextWeekStart, nextWeekEnd)) {
        nextWeekPlan.push(t);
      }

      // 이슈: 명시적 이슈 또는 지연/Blocked
      const endBeforeToday = isBefore(end ?? today, today);
      const isDelayed = endBeforeToday && !isDone;
      const isBlocked = t.status === 'blocked';
      const explicitIssue = !!t.isIssue;

      if (explicitIssue || isDelayed || isBlocked) {
        issues.push(t);
      }
    }

    const byProject = (items: Task[]) => {
      const map = new Map<string, Task[]>();
      for (const t of items) {
        const p = projects.find((prj) => prj.id === t.projectId);
        const name = p?.name || '기타';
        if (!map.has(name)) map.set(name, []);
        map.get(name)!.push(t);
      }
      return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'ko'));
    };

    const { avgProgress: overallProgress, totalEffort: overallEffort } = computeOverallProgress(filteredTasks);

    type Row = {
      category: '금주한일' | '차주계획' | '이슈사항';
      taskId: string;
      projectName: string;
      name: string;
      detail: string;
      assignee: string;
      progress: number;
      workEffort: number;
      note?: string;
    };

    const thisWeekRows: Row[] = [];
    const nextWeekRows: Row[] = [];
    const issueRows: Row[] = [];

    for (const [pname, items] of byProject(thisWeekDone)) {
      for (const t of items) {
        thisWeekRows.push({
          category: '금주한일',
          taskId: t.id,
          projectName: pname,
          name: t.name,
          detail: getCompletedChecklistDetail(t),
          assignee: t.assignee || '',
          progress: typeof t.progress === 'number' ? t.progress : 0,
          workEffort: typeof t.workEffort === 'number' ? t.workEffort : 0,
        });
      }
    }

    for (const [pname, items] of byProject(nextWeekPlan)) {
      for (const t of items) {
        nextWeekRows.push({
          category: '차주계획',
          taskId: t.id,
          projectName: pname,
          name: t.name,
          detail: getIncompleteChecklistDetail(t),
          assignee: t.assignee || '',
          progress: typeof t.progress === 'number' ? t.progress : 0,
          workEffort: typeof t.workEffort === 'number' ? t.workEffort : 0,
        });
      }
    }

    for (const [pname, items] of byProject(issues)) {
      for (const t of items) {
        const end = parseDate(t.endDate);
        const overdue =
          end && isBefore(end, today) && (typeof t.progress === 'number' ? t.progress : 0) < 100;
        const tags: string[] = [];
        if (t.isIssue) tags.push('이슈');
        if (t.status === 'blocked') tags.push('지연됨');
        if (overdue) tags.push('기한 초과');
        const note = tags.join(', ');
        issueRows.push({
          category: '이슈사항',
          taskId: t.id,
          projectName: pname,
          name: t.name,
          detail: t.description || t.deliverables || '',
          assignee: t.assignee || '',
          progress: typeof t.progress === 'number' ? t.progress : 0,
          workEffort: typeof t.workEffort === 'number' ? t.workEffort : 0,
          note,
        });
      }
    }

    const allRows: Row[] = [...thisWeekRows, ...nextWeekRows, ...issueRows];

    const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

    const lines: string[] = [];

    lines.push(
      `[주간보고] ${projectName} / 담당자: ${
        currentUserDisplay || '작성자'
      } / 기간: ${format(thisWeekStart, 'yyyy-MM-dd')} ~ ${format(thisWeekEnd, 'yyyy-MM-dd')}`,
      `전체 진척율: ${overallProgress}% (현재 선택한 범위 기준)`,
      '',
    );

    if (currentProject && (currentProject.reportCategory || currentProject.reportAgency || currentProject.reportBudgetThisYear || currentProject.reportTotalPeriod || currentProject.reportNameShort || currentProject.reportNameFull)) {
      const taskNameShort = currentProject.reportNameShort || currentProject.name;
      const taskNameFull = currentProject.reportNameFull || (currentProject.reportNameShort ? '' : currentProject.name);
      lines.push(
        '[프로젝트 요약]',
        `- 구분: ${currentProject.reportCategory || '-'}`,
        `- 주관기관: ${currentProject.reportAgency || '-'}`,
        `- 과제명(약어): ${taskNameShort}`,
        ...(taskNameFull ? [`- 전체과제명: ${taskNameFull}`] : []),
        `- 금년도 정부출연금/예산: ${currentProject.reportBudgetThisYear || '-'}`,
        `- 전체기간: ${currentProject.reportTotalPeriod || currentProject.startDate || '-'}`,
        '',
      );
    }

    lines.push(
      [
        '구분',
        '프로젝트',
        '업무명',
        '업무 내용',
        '담당자',
        '투입공수(일)',
        '진척율(%)',
        '비고',
      ].join(' | '),
    );
    lines.push(['---', '---', '---', '---', '---', '---', '---', '---'].join(' | '));

    if (allRows.length === 0) {
      lines.push(esc('금주/차주/이슈에 해당하는 업무가 없습니다.') + ' |  |  |  |  |  |  |  ');
    } else {
      for (const row of allRows) {
        lines.push(
          [
            esc(row.category),
            esc(row.projectName),
            esc(row.name),
            esc(row.detail || ''),
            esc(row.assignee || ''),
            String(row.workEffort),
            String(row.progress),
            esc(row.note || ''),
          ].join(' | '),
        );
      }
    }

    const reportText = lines.join('\n');
    return {
      reportText,
      summary: {
        thisWeekCount: thisWeekDone.length,
        nextWeekCount: nextWeekPlan.length,
        issueCount: issues.length,
        overallProgress,
        overallEffort,
      },
      sections: {
        thisWeek: thisWeekRows,
        nextWeek: nextWeekRows,
        issues: issueRows,
      },
    };
  }, [isOpen, tasks, projects, projectScope, selectedProjectIds, currentUserDisplay, scope, baseStartStr, baseEndStr]);

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    const aoa: (string | number)[][] = [];

    const pName =
      projectScope === 'multiple' && selectedProjectIds.length > 0
        ? selectedProjectIds.length === 1
          ? (projects.find((p) => p.id === selectedProjectIds[0])?.name ?? '선택한 프로젝트')
          : `선택한 프로젝트 (${selectedProjectIds.length}개)`
        : '전체 프로젝트';

    // 제목 행
    aoa.push([`[주간보고] ${pName} / 담당자: ${currentUserDisplay || '작성자'} / 기간: ${baseStartStr} ~ ${baseEndStr}`]);
    aoa.push([`전체 진척율: ${summary.overallProgress}%  |  금주한일: ${summary.thisWeekCount}건  |  차주계획: ${summary.nextWeekCount}건  |  이슈: ${summary.issueCount}건  |  총 투입공수: ${summary.overallEffort}일`]);
    aoa.push([]);

    // 프로젝트 요약 (단일 프로젝트 선택 시)
    if (
      currentProject &&
      (currentProject.reportCategory || currentProject.reportAgency || currentProject.reportBudgetThisYear ||
        currentProject.reportTotalPeriod || currentProject.reportNameShort || currentProject.reportNameFull)
    ) {
      aoa.push(['[프로젝트 요약]', '']);
      aoa.push(['구분', currentProject.reportCategory || '-']);
      aoa.push(['주관기관', currentProject.reportAgency || '-']);
      aoa.push(['과제명(약어)', currentProject.reportNameShort || currentProject.name]);
      if (currentProject.reportNameFull) aoa.push(['전체과제명', currentProject.reportNameFull]);
      aoa.push(['금년도 정부출연금/예산', currentProject.reportBudgetThisYear || '-']);
      aoa.push(['전체기간', currentProject.reportTotalPeriod || currentProject.startDate || '-']);
      aoa.push([]);
    }

    // 헤더
    aoa.push(['구분', '프로젝트', '업무명', '업무 내용', '담당자', '투입공수(일)', '진척율(%)', '비고']);

    // 데이터 행
    const allRows = [...sections.thisWeek, ...sections.nextWeek, ...sections.issues];
    if (allRows.length === 0) {
      aoa.push(['금주/차주/이슈에 해당하는 업무가 없습니다.', '', '', '', '', '', '', '']);
    } else {
      for (const row of allRows) {
        aoa.push([
          row.category,
          row.projectName,
          row.name,
          row.detail,
          row.assignee,
          row.workEffort,
          row.progress,
          row.note || '',
        ]);
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // 열 너비 설정
    ws['!cols'] = [
      { wch: 10 },
      { wch: 22 },
      { wch: 32 },
      { wch: 48 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 18 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, '주간보고');
    XLSX.writeFile(wb, `주간보고_${baseStartStr}_${baseEndStr}.xlsx`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-2 md:p-4">
      <div className="bg-white w-full max-w-5xl md:max-w-6xl rounded-2xl shadow-2xl border border-slate-200/80 flex flex-col h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/80">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
              <FileTextIcon />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base md:text-lg font-bold text-slate-900">주간보고 자동 생성</h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                금주 완료·차주 계획·이슈를 현재 작업에서 자동으로 추출합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors"
            title="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50/60 flex flex-wrap gap-3 items-center text-xs md:text-sm">
          <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">기준 기간</span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={baseStartStr}
                onChange={(e) => {
                  const next = e.target.value || baseStartStr;
                  setBaseStartStr(next);
                  if (baseEndStr < next) {
                    const start = parseISO(next);
                    const end = endOfWeek(start, { weekStartsOn: 1 });
                    setBaseEndStr(format(end, 'yyyy-MM-dd'));
                  }
                }}
                className="px-2 py-1 rounded-md border border-slate-200 text-xs md:text-sm"
              />
              <span className="text-[11px] text-slate-500">~</span>
              <input
                type="date"
                value={baseEndStr}
                onChange={(e) => {
                  const next = e.target.value || baseEndStr;
                  if (next < baseStartStr) {
                    setBaseEndStr(baseStartStr);
                  } else {
                    setBaseEndStr(next);
                  }
                }}
                className="px-2 py-1 rounded-md border border-slate-200 text-xs md:text-sm"
              />
            </div>
          </div>

          <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">대상</span>
            <button
              type="button"
              onClick={() => setScope('me')}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
                scope === 'me'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              <User size={12} />
              내 업무만
            </button>
            <button
              type="button"
              onClick={() => setScope('all')}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
                scope === 'all'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              <Briefcase size={12} />
              전체 작업
            </button>
          </div>

          <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 flex-wrap">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">프로젝트</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setProjectScope('all');
                  setSelectedProjectIds([]);
                }}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
                  projectScope === 'all'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                <FolderOpen size={12} />
                전체
              </button>
              <button
                type="button"
                onClick={() => {
                  setProjectScope('multiple');
                  if (selectedProjectIds.length === 0 && projects.length > 0) {
                    setSelectedProjectIds(projects.map((p) => p.id));
                  }
                }}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
                  projectScope === 'multiple'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                <Layers size={12} />
                다중
              </button>
            </div>
            {projectScope === 'multiple' && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 max-h-24 overflow-y-auto py-1">
                {projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={selectedProjectIds.includes(p.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedProjectIds((prev) => [...prev, p.id]);
                        } else {
                          setSelectedProjectIds((prev) => prev.filter((id) => id !== p.id));
                        }
                      }}
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    <span className="whitespace-nowrap">{p.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
            <AlertCircle size={14} className="shrink-0" />
            <span className="text-[11px]">
              표 안의 내용을 직접 수정해 웹에서 바로 주간보고를 작성할 수 있습니다. 업무 행을 더블클릭하면 해당 업무 수정창이 열립니다.
            </span>
          </div>
        </div>

        <div className="px-5 py-3 flex-shrink-0 text-xs text-slate-500 flex flex-col gap-2">
          {currentProject && (
            <div className="border border-slate-200 rounded-lg bg-white/70 overflow-hidden text-[11px]">
              <table className="w-full border-collapse">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="px-2 py-1.5 border-b border-slate-200 text-left whitespace-nowrap">구분</th>
                    <th className="px-2 py-1.5 border-b border-slate-200 text-left whitespace-nowrap">주관기관</th>
                    <th className="px-2 py-1.5 border-b border-slate-200 text-left whitespace-nowrap">과제명(약어)</th>
                    <th className="px-2 py-1.5 border-b border-slate-200 text-left whitespace-nowrap">전체과제명</th>
                    <th className="px-2 py-1.5 border-b border-slate-200 text-left whitespace-nowrap">금년도 정부출연금/예산</th>
                    <th className="px-2 py-1.5 border-b border-slate-200 text-left whitespace-nowrap">전체기간</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-2 py-1.5 border-b border-slate-100 align-top whitespace-nowrap">
                      {currentProject.reportCategory || '-'}
                    </td>
                    <td className="px-2 py-1.5 border-b border-slate-100 align-top whitespace-nowrap">
                      {currentProject.reportAgency || '-'}
                    </td>
                    <td className="px-2 py-1.5 border-b border-slate-100 align-top">
                      <div className="font-semibold text-slate-800">{currentProject.reportNameShort || currentProject.name}</div>
                    </td>
                    <td className="px-2 py-1.5 border-b border-slate-100 align-top">
                      <div className="text-slate-700">{currentProject.reportNameFull || '-'}</div>
                      {currentProject.description && !currentProject.reportNameFull && (
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {currentProject.description}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 border-b border-slate-100 align-top whitespace-nowrap">
                      {currentProject.reportBudgetThisYear || '-'}
                    </td>
                    <td className="px-2 py-1.5 border-b border-slate-100 align-top whitespace-nowrap">
                      {currentProject.reportTotalPeriod ||
                        currentProject.startDate ||
                        '-'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap gap-3 items-center">
            <span>
              금주 완료 <strong className="text-slate-800">{summary.thisWeekCount}</strong>건 · 차주 계획{' '}
              <strong className="text-slate-800">{summary.nextWeekCount}</strong>건 · 이슈{' '}
              <strong className="text-slate-800">{summary.issueCount}</strong>건
            </span>
            <span>
              전체 투입공수 합계{' '}
              <strong className="text-slate-800">
                {summary.overallEffort.toFixed(1)}
              </strong>
              일 · 평균 진척율{' '}
              <strong className="text-slate-800">
                {summary.overallProgress}
              </strong>
              %
            </span>
          </div>
        </div>

        <div className="px-5 pb-4 flex-1 min-h-[160px] overflow-hidden">
          <div className="w-full h-full rounded-xl border border-slate-200 bg-slate-50/60 overflow-auto p-3 space-y-6">
            {(['thisWeek', 'nextWeek', 'issues'] as const).map((key) => {
              const rows = sections[key];
              const title =
                key === 'thisWeek' ? '1. 금주한일' : key === 'nextWeek' ? '2. 차주계획' : '3. 이슈사항';

              const projectCounts = new Map<string, number>();
              rows.forEach((r) => {
                projectCounts.set(r.projectName, (projectCounts.get(r.projectName) ?? 0) + 1);
              });

              const projectRendered = new Map<string, number>();

              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs md:text-sm font-semibold text-slate-800">{title}</h3>
                    <span className="text-[11px] text-slate-500">
                      {rows.length}건 · 합계 공수{' '}
                      <strong className="text-slate-700">
                        {rows.reduce((sum, r) => sum + (r.workEffort || 0), 0).toFixed(1)}
                      </strong>
                      일
                    </span>
                  </div>
                  <table className="min-w-full text-xs md:text-sm border-collapse bg-white rounded-lg overflow-hidden">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-2 py-2 border-b border-slate-200 text-left whitespace-nowrap">프로젝트</th>
                        <th className="px-2 py-2 border-b border-slate-200 text-left whitespace-nowrap">업무명</th>
                        <th className="px-2 py-2 border-b border-slate-200 text-left whitespace-nowrap">업무 내용</th>
                        <th className="px-2 py-2 border-b border-slate-200 text-left whitespace-nowrap">담당자</th>
                        <th className="px-2 py-2 border-b border-slate-200 text-right whitespace-nowrap">투입공수(일)</th>
                        <th className="px-2 py-2 border-b border-slate-200 text-right whitespace-nowrap">진척율(%)</th>
                        <th className="px-2 py-2 border-b border-slate-200 text-left whitespace-nowrap">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td
                            className="px-3 py-4 text-center text-slate-400 text-xs"
                            colSpan={7}
                          >
                            해당되는 업무가 없습니다.
                          </td>
                        </tr>
                      ) : (
                        rows.map((row, idx) => {
                          const count = projectCounts.get(row.projectName) ?? 1;
                          const rendered = projectRendered.get(row.projectName) ?? 0;
                          const isFirstForProject = rendered === 0;
                          if (isFirstForProject) {
                            projectRendered.set(row.projectName, 1);
                          } else {
                            projectRendered.set(row.projectName, rendered + 1);
                          }

                          return (
                            <tr
                              key={`${key}-${idx}-${row.name}`}
                              className={cn(
                                idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60',
                                'cursor-pointer hover:bg-indigo-50/70 transition-colors',
                              )}
                              onDoubleClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingTaskId(row.taskId);
                              }}
                            >
                              {isFirstForProject && (
                                <td
                                  className="px-2 py-1.5 border-b border-slate-100 align-top whitespace-nowrap text-slate-700 font-semibold"
                                  rowSpan={count}
                                >
                                  {row.projectName}
                                </td>
                              )}
                              {!isFirstForProject && null}
                              <td className="px-2 py-1.5 border-b border-slate-100 align-top text-slate-900 font-semibold min-w-[140px]">
                                <div
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {row.name}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 border-b border-slate-100 align-top text-slate-700 min-w-[220px]">
                                <div
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {row.detail || '-'}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 border-b border-slate-100 align-top whitespace-nowrap text-slate-700">
                                <div
                                  contentEditable
                                  suppressContentEditableWarning
                                >
                                  {row.assignee || '-'}
                                </div>
                              </td>
                            <td className="px-2 py-1.5 border-b border-slate-100 align-top text-right whitespace-nowrap text-slate-700">
                              <div
                                contentEditable
                                suppressContentEditableWarning
                              >
                                {row.workEffort ? row.workEffort.toFixed(1) : '-'}
                              </div>
                            </td>
                            <td className="px-2 py-1.5 border-b border-slate-100 align-top text-right whitespace-nowrap text-slate-700">
                              <div
                                contentEditable
                                suppressContentEditableWarning
                              >
                                {typeof row.progress === 'number' ? formatNum2(row.progress) : row.progress}
                              </div>
                            </td>
                              <td className="px-2 py-1.5 border-b border-slate-100 align-top text-slate-700 whitespace-nowrap">
                              <div
                                contentEditable
                                suppressContentEditableWarning
                              >
                                {row.note || '-'}
                              </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center gap-3">
          <p className="text-[11px] text-slate-500">
            * 금주한일 업무 내용=체크리스트 완료 항목(없으면 하위 작업 완료 항목), 차주계획 업무 내용=체크리스트 미완료 항목(없으면 하위 작업 미완료 항목, 차주수행업무). 체크리스트·하위 작업 모두 없으면 설명·산출물 표시.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost text-xs md:text-sm"
            >
              닫기
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(reportText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  // ignore
                }
              }}
              className="btn-ghost flex items-center gap-1.5 text-xs md:text-sm"
            >
              <Copy size={14} />
              {copied ? '복사됨' : '텍스트 복사'}
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="btn-primary flex items-center gap-1.5 text-xs md:text-sm"
            >
              <Download size={14} />
              Excel 내보내기
            </button>
          </div>
        </div>
      </div>

      <TaskModal
        isOpen={!!editingTaskId}
        onClose={() => setEditingTaskId(null)}
        onSave={(updates: any) => {
          const task = editingTask;
          if (!task) return;
          if (task.id === '') {
            addTask({
              parentId: task.parentId,
              ...updates,
            });
          } else {
            updateTask(task.id, updates);
          }
          setEditingTaskId(null);
        }}
        initialData={editingTask}
        parentOptions={tasks}
        onOpenTask={(task) => setEditingTaskId(task.id)}
      />
    </div>
  );
}

function FileTextIcon() {
  return <span className="inline-block w-4 h-4 rounded-[4px] bg-indigo-500" />;
}

