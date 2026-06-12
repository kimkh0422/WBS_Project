import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { History, Loader2, RefreshCw, Search, ChevronRight, ChevronDown, X, Download } from 'lucide-react';
import type { Cell as ExcelCell } from 'exceljs';
import { fetchAuditLog, type AuditLogEntry, type AuditAction } from '../lib/db';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { cn } from '../lib/utils';

interface AuditLogPageProps {
  /** 프로젝트 id → 표시명. 삭제된 프로젝트(project_id=null)는 entity_name으로 보조 표시 */
  projectNameMap?: Record<string, string>;
  /** 운영자(전체 이력 열람) 여부 — 안내 문구 표시용 */
  isOperator?: boolean;
}

const ACTION_LABEL: Record<AuditAction, string> = {
  create: '생성',
  update: '수정',
  delete: '삭제',
  bulk_update: '일괄 수정',
};

const ENTITY_LABEL: Record<AuditLogEntry['entity_type'], string> = {
  task: '작업',
  project: '프로젝트',
};

/** DB 컬럼명 → 한글 라벨(프로젝트·작업 공용) */
const FIELD_LABEL: Record<string, string> = {
  name: '이름',
  formal_name: '정식 명칭',
  description: '설명',
  start_date: '시작일',
  end_date: '종료일',
  pm_name: 'PM',
  po_name: 'PO',
  include_in_dashboard: '대시보드 포함',
  progress: '진척률',
  assignee: '담당자',
  status: '상태',
  work_effort: '공수',
  is_milestone: '마일스톤',
  is_issue: '이슈',
  is_action_item: '액션 아이템',
  planned_progress_override: '계획 진척(수동)',
};

const BOOL_FIELDS = new Set(['include_in_dashboard', 'is_milestone', 'is_issue', 'is_action_item']);
const PERCENT_FIELDS = new Set(['progress', 'planned_progress_override']);

const ACTION_BADGE_CLASS: Record<AuditAction, string> = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  bulk_update: 'bg-violet-100 text-violet-700',
};

/** 변경 값 사람이 읽기 좋게 포맷 */
function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(없음)';
  if (BOOL_FIELDS.has(field) || typeof value === 'boolean') return value ? '예' : '아니오';
  if (PERCENT_FIELDS.has(field)) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? `${n}%` : String(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

interface ChangeRow {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/** changes(jsonb) → 필드 diff 배열. 배열형(update)만 행으로 펼치고, 그 외(일괄/생성/삭제)는 null */
function parseChangeRows(changes: unknown): ChangeRow[] | null {
  if (Array.isArray(changes)) {
    return (changes as Array<{ field?: string; old_value?: unknown; new_value?: unknown }>)
      .filter((c) => c && typeof c.field === 'string')
      .map((c) => ({ field: c.field as string, oldValue: c.old_value, newValue: c.new_value }));
  }
  return null;
}

function bulkCount(changes: unknown): number | null {
  if (changes && typeof changes === 'object' && !Array.isArray(changes) && 'count' in changes) {
    const c = (changes as { count?: number }).count;
    return typeof c === 'number' ? c : null;
  }
  return null;
}

type ActionFilter = 'all' | AuditAction;
type EntityFilter = 'all' | 'project' | 'task';

const PAGE_STEP = 200;

/** 한 항목의 변경 내용을 내보내기용 한 셀 텍스트로 평탄화 (필드별 이전→새값, 줄바꿈 구분) */
function buildChangeDetailText(entry: AuditLogEntry): string {
  if (entry.action === 'create') return '신규 항목 생성';
  if (entry.action === 'delete') return '항목 삭제';
  const bulk = bulkCount(entry.changes);
  if (bulk != null) return `${bulk}개 항목 일괄 수정`;
  const rows = parseChangeRows(entry.changes);
  if (rows && rows.length > 0) {
    return rows
      .map((r) => `${FIELD_LABEL[r.field] ?? r.field}: ${formatFieldValue(r.field, r.oldValue)} → ${formatFieldValue(r.field, r.newValue)}`)
      .join('\n');
  }
  return '변경 정보 없음';
}

/** 현재(필터된) 작업 로그를 ExcelJS로 .xlsx 내보내기. 앱의 기존 내보내기와 동일한 Blob 다운로드 방식. */
async function exportAuditLogToExcel(
  entries: AuditLogEntry[],
  projectLabelFor: (entry: AuditLogEntry) => string,
  fileName: string,
): Promise<void> {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as unknown as { default?: typeof ExcelJSMod }).default ?? ExcelJSMod;

  const cols: Array<{ header: string; width: number; align?: 'left' | 'center' }> = [
    { header: '일시', width: 22 },
    { header: '사용자', width: 16 },
    { header: '작업', width: 9, align: 'center' },
    { header: '구분', width: 9, align: 'center' },
    { header: '대상', width: 32 },
    { header: '프로젝트', width: 26 },
    { header: '변경 내용', width: 64 },
  ];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('작업로그');
  ws.columns = cols.map((c) => ({ width: c.width }));

  const headerRow = ws.addRow(cols.map((c) => c.header));
  headerRow.height = 22;
  headerRow.eachCell({ includeEmpty: true }, (cell: ExcelCell, ci: number) => {
    cell.font = { bold: true, size: 10, color: { argb: 'FF334155' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.alignment = { vertical: 'middle', horizontal: cols[ci - 1]?.align ?? 'left' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
  });

  for (const e of entries) {
    const row = ws.addRow([
      format(new Date(e.created_at), 'yyyy.MM.dd (EEE) HH:mm:ss', { locale: ko }),
      e.user_display ?? '',
      ACTION_LABEL[e.action],
      ENTITY_LABEL[e.entity_type],
      e.entity_name ?? '',
      projectLabelFor(e),
      buildChangeDetailText(e),
    ]);
    row.eachCell({ includeEmpty: true }, (cell: ExcelCell, ci: number) => {
      cell.alignment = { vertical: 'top', horizontal: cols[ci - 1]?.align ?? 'left', wrapText: ci === 7 };
    });
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = 'A1:G1';

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditLogPage({ projectNameMap, isOperator }: AuditLogPageProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(PAGE_STEP);
  const [reachedEnd, setReachedEnd] = useState(false);

  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandAll, setExpandAll] = useState(true);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback((nextLimit: number) => {
    setLoading(true);
    fetchAuditLog(null, nextLimit)
      .then((rows) => {
        setEntries(rows);
        setReachedEnd(rows.length < nextLimit);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(limit);
  }, [limit, load]);

  const projectLabelFor = useCallback(
    (entry: AuditLogEntry): string => {
      if (entry.project_id) return projectNameMap?.[entry.project_id] ?? `(${entry.project_id.slice(0, 8)}…)`;
      // 삭제된 프로젝트: project_id가 null. 프로젝트 항목이면 대상명이 곧 프로젝트명.
      if (entry.entity_type === 'project' && entry.entity_name) return entry.entity_name;
      return '—';
    },
    [projectNameMap],
  );

  // 필터 후보(현재 로드된 범위 기준)
  const userOptions = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.user_display) s.add(e.user_display);
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [entries]);

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      if (e.project_id) map.set(e.project_id, projectLabelFor(e));
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  }, [entries, projectLabelFor]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter !== 'all' && e.action !== actionFilter) return false;
      if (entityFilter !== 'all' && e.entity_type !== entityFilter) return false;
      if (userFilter !== 'all' && e.user_display !== userFilter) return false;
      if (projectFilter !== 'all' && e.project_id !== projectFilter) return false;
      if (q) {
        const hay = [e.user_display, e.entity_name, projectLabelFor(e), ACTION_LABEL[e.action], ENTITY_LABEL[e.entity_type]]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, actionFilter, entityFilter, userFilter, projectFilter, search, projectLabelFor]);

  const actionCounts = useMemo(() => {
    const c: Record<AuditAction, number> = { create: 0, update: 0, delete: 0, bulk_update: 0 };
    for (const e of filtered) c[e.action] += 1;
    return c;
  }, [filtered]);

  const isExpanded = useCallback((id: string) => (expandAll ? !expandedIds.has(id) : expandedIds.has(id)), [expandAll, expandedIds]);

  const toggleRow = useCallback((id: string) => {
    // expandAll 모드에서는 expandedIds가 "접은 집합", 아닐 때는 "펼친 집합"으로 동작
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAllExpanded = useCallback((all: boolean) => {
    setExpandAll(all);
    setExpandedIds(new Set());
  }, []);

  const filtersActive =
    actionFilter !== 'all' || entityFilter !== 'all' || userFilter !== 'all' || projectFilter !== 'all' || search.trim() !== '';

  const resetFilters = useCallback(() => {
    setActionFilter('all');
    setEntityFilter('all');
    setUserFilter('all');
    setProjectFilter('all');
    setSearch('');
  }, []);

  const handleExport = useCallback(async () => {
    if (exporting || filtered.length === 0) return;
    setExporting(true);
    setExportError(null);
    try {
      const stamp = format(new Date(), 'yyyyMMdd_HHmm');
      await exportAuditLogToExcel(filtered, projectLabelFor, `작업로그_${stamp}.xlsx`);
    } catch (err) {
      console.error('작업 로그 내보내기 실패', err);
      setExportError('내보내기에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setExporting(false);
    }
  }, [exporting, filtered, projectLabelFor]);

  const selectClass =
    'text-sm rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300';

  return (
    <div className="h-full overflow-auto bg-slate-50/50">
      <div className="max-w-[1600px] mx-auto px-4 py-5 sm:px-6">
        {/* 헤더 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center">
              <History className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">작업 로그</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {isOperator
                  ? '회원들이 언제 무엇을 생성·수정·삭제했는지 전체 변경 이력을 상세히 확인합니다.'
                  : '내 권한 범위의 변경 이력을 확인합니다.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAllExpanded(true)}
              className={cn(
                'px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                expandAll ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              모두 펼치기
            </button>
            <button
              type="button"
              onClick={() => setAllExpanded(false)}
              className={cn(
                'px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                !expandAll
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              모두 접기
            </button>
            <button
              type="button"
              onClick={() => load(limit)}
              disabled={loading}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50"
              title="새로고침"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> 새로고침
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || filtered.length === 0}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center gap-1.5 disabled:opacity-50"
              title={
                filtered.length === 0 ? '내보낼 이력이 없습니다.' : `현재 목록(필터 적용) ${filtered.length}건을 엑셀(.xlsx)로 내보냅니다.`
              }
            >
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} 내보내기
            </button>
          </div>
        </div>

        {/* 요약/카운트 */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <span className="px-2 py-1 rounded-lg bg-slate-200/70 text-slate-700 font-medium">
            조회 {filtered.length}건{filtersActive ? ` / 로드 ${entries.length}건` : ''}
          </span>
          <span className="px-2 py-1 rounded-lg bg-green-100 text-green-700">생성 {actionCounts.create}</span>
          <span className="px-2 py-1 rounded-lg bg-blue-100 text-blue-700">수정 {actionCounts.update}</span>
          <span className="px-2 py-1 rounded-lg bg-red-100 text-red-700">삭제 {actionCounts.delete}</span>
          {actionCounts.bulk_update > 0 && (
            <span className="px-2 py-1 rounded-lg bg-violet-100 text-violet-700">일괄 {actionCounts.bulk_update}</span>
          )}
          {exportError && <span className="px-2 py-1 rounded-lg bg-red-100 text-red-700">{exportError}</span>}
        </div>

        {/* 필터 바 */}
        <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-xl border border-slate-200 bg-white">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="사용자·대상·프로젝트 검색"
              className="text-sm rounded-lg border border-slate-300 bg-white pl-8 pr-2 py-1.5 w-56 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value as ActionFilter)} className={selectClass}>
            <option value="all">작업: 전체</option>
            <option value="create">생성</option>
            <option value="update">수정</option>
            <option value="delete">삭제</option>
            <option value="bulk_update">일괄 수정</option>
          </select>
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value as EntityFilter)} className={selectClass}>
            <option value="all">구분: 전체</option>
            <option value="project">프로젝트</option>
            <option value="task">작업</option>
          </select>
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className={selectClass}>
            <option value="all">사용자: 전체</option>
            {userOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className={selectClass}>
            <option value="all">프로젝트: 전체</option>
            {projectOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button
              type="button"
              onClick={resetFilters}
              className="px-2 py-1.5 text-xs rounded-lg text-slate-500 hover:bg-slate-100 flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" /> 필터 초기화
            </button>
          )}
        </div>

        {/* 목록 */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="w-7 h-7 animate-spin mr-2" />
              <span>이력 불러오는 중…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-sm">
              {entries.length === 0 ? '기록된 변경 이력이 없습니다.' : '조건에 맞는 이력이 없습니다.'}
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-200">
                <tr>
                  <th className="w-8 py-2.5 px-2" />
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">일시</th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">사용자</th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">작업</th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 whitespace-nowrap">구분</th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500">대상</th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500">프로젝트</th>
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500">변경 요약</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const rows = parseChangeRows(entry.changes);
                  const bulk = bulkCount(entry.changes);
                  const expandable = (rows?.length ?? 0) > 0;
                  const open = expandable && isExpanded(entry.id);
                  const createdAt = new Date(entry.created_at);
                  const stamp = format(createdAt, 'yyyy.MM.dd (EEE) HH:mm:ss', { locale: ko });
                  const summary =
                    entry.action === 'create'
                      ? '신규 항목 생성'
                      : entry.action === 'delete'
                        ? '항목 삭제'
                        : bulk != null
                          ? `${bulk}개 항목 일괄 수정`
                          : rows && rows.length > 0
                            ? rows.map((r) => FIELD_LABEL[r.field] ?? r.field).join(', ')
                            : '변경 정보 없음';
                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        className={cn('border-b border-slate-100 hover:bg-slate-50/70', expandable && 'cursor-pointer')}
                        onClick={expandable ? () => toggleRow(entry.id) : undefined}
                      >
                        <td className="py-2 px-2 text-center align-top">
                          {expandable ? (
                            open ? (
                              <ChevronDown className="w-4 h-4 text-slate-400 inline" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400 inline" />
                            )
                          ) : null}
                        </td>
                        <td className="py-2 px-3 text-slate-600 whitespace-nowrap align-top tabular-nums">{stamp}</td>
                        <td className="py-2 px-3 text-slate-800 font-medium whitespace-nowrap align-top">{entry.user_display ?? '—'}</td>
                        <td className="py-2 px-3 align-top">
                          <span
                            className={cn('inline-block px-2 py-0.5 rounded-md text-xs font-semibold', ACTION_BADGE_CLASS[entry.action])}
                          >
                            {ACTION_LABEL[entry.action]}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-600 whitespace-nowrap align-top">{ENTITY_LABEL[entry.entity_type]}</td>
                        <td className="py-2 px-3 text-slate-800 align-top max-w-[260px]">
                          <span className="break-words" title={entry.entity_name ?? undefined}>
                            {entry.entity_name ?? '—'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-600 align-top max-w-[220px]">
                          <span className="break-words">{projectLabelFor(entry)}</span>
                        </td>
                        <td className="py-2 px-3 text-slate-500 text-xs align-top max-w-[280px]">
                          <span className="break-words">{summary}</span>
                        </td>
                      </tr>
                      {open && rows && (
                        <tr className="bg-slate-50/80 border-b border-slate-100">
                          <td />
                          <td colSpan={7} className="py-2 px-3">
                            <div className="overflow-hidden rounded-lg border border-slate-200">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-100/80">
                                  <tr>
                                    <th className="text-left py-1.5 px-3 font-semibold text-slate-500 w-40">필드</th>
                                    <th className="text-left py-1.5 px-3 font-semibold text-slate-500">이전 값</th>
                                    <th className="text-left py-1.5 px-3 font-semibold text-slate-500 w-8" />
                                    <th className="text-left py-1.5 px-3 font-semibold text-slate-500">새 값</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((r, i) => (
                                    <tr key={`${entry.id}-${r.field}-${i}`} className="border-t border-slate-200/70">
                                      <td className="py-1.5 px-3 font-medium text-slate-700 align-top">
                                        {FIELD_LABEL[r.field] ?? r.field}
                                      </td>
                                      <td className="py-1.5 px-3 text-slate-500 align-top break-words line-through decoration-slate-300">
                                        {formatFieldValue(r.field, r.oldValue)}
                                      </td>
                                      <td className="py-1.5 px-1 text-slate-400 align-top">→</td>
                                      <td className="py-1.5 px-3 text-slate-800 font-medium align-top break-words">
                                        {formatFieldValue(r.field, r.newValue)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 더 보기 / 안내 */}
        <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
          <span>일시·사용자·대상·변경 전/후 값을 함께 기록합니다. 행을 클릭하면 변경 상세가 펼쳐집니다.</span>
          {!reachedEnd && !loading && (
            <button
              type="button"
              onClick={() => setLimit((n) => n + PAGE_STEP)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 font-medium"
            >
              더 불러오기 (+{PAGE_STEP})
            </button>
          )}
          {reachedEnd && entries.length > 0 && <span>모든 이력을 불러왔습니다 ({entries.length}건).</span>}
        </div>
      </div>
    </div>
  );
}
