import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { buildWeeklyReportSrcDoc } from '../data/weeklyReportSrcDoc';
import { cn } from '../lib/utils';
import { useToast } from './Toast';
import { WeeklyReportComposeModal } from './WeeklyReportComposeModal';
import {
  fetchWeeklyReports,
  deleteWeeklyReport,
  updateWeeklyReport,
  type WeeklyReportRecord,
  type WeeklyReportInput,
  type WeeklyReportProjectRow,
  type WeeklyReportIssueRow,
} from '../lib/db/weeklyReports';
import { isSupabaseConfigured } from '../lib/supabase';

type Props = {
  userId?: string;
  currentUserDisplay?: string;
};

function fmtWeek(start: string | null, end: string | null): string {
  if (!start && !end) return '주차 미지정';
  const f = (s: string | null) => (s ? s.replaceAll('-', '.') : '');
  if (start && end) {
    const e = end.slice(5).replaceAll('-', '.'); // MM.DD
    return `${f(start)} ~ ${e}`;
  }
  return f(start || end);
}

/** 등록된 주간보고 1건의 펼친 상세(읽기 전용) */
function ReportDetail({ rec }: { rec: WeeklyReportRecord }) {
  const c = rec.content;
  return (
    <div className="px-4 pb-4 pt-1 space-y-4 text-sm">
      {c.projects.length > 0 && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5">프로젝트 진척</div>
          <div className="space-y-2">
            {c.projects.map((p, i) => (
              <div key={i} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-semibold text-[var(--color-ink)]">{p.name || '(이름 없음)'}</span>
                  {p.owner && <span className="text-xs text-[var(--color-ink-muted)]">담당 {p.owner}</span>}
                  {(p.planPct || p.actualPct) && (
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      진척 {p.actualPct || '-'}% / 계획 {p.planPct || '-'}%
                    </span>
                  )}
                  {p.period && <span className="text-xs text-[var(--color-ink-muted)]">{p.period}</span>}
                </div>
                {p.content && <p className="mt-1 whitespace-pre-wrap text-[var(--color-ink)]">{p.content}</p>}
                {p.issue && <p className="mt-1 text-[var(--color-warning)]">이슈: {p.issue}</p>}
                {p.note && <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">비고: {p.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {c.issues.length > 0 && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5">이슈 사항</div>
          <div className="space-y-2">
            {c.issues.map((it, i) => (
              <div key={i} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5">
                <div className="font-semibold text-[var(--color-ink)]">{it.title || '(제목 없음)'}</div>
                {it.content && <p className="mt-0.5 whitespace-pre-wrap">{it.content}</p>}
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-x-3 text-xs text-[var(--color-ink-muted)]">
                  {it.plan && <span>조치계획: {it.plan}</span>}
                  {it.result && <span>조치결과: {it.result}</span>}
                  {it.note && <span>비고: {it.note}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {c.nextWeek.length > 0 && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5">차주 주요 업무계획</div>
          <ul className="list-disc pl-5 space-y-0.5 text-[var(--color-ink)]">
            {c.nextWeek.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {c.etc && (
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-muted)] mb-1.5">기타</div>
          <p className="whitespace-pre-wrap text-[var(--color-ink)]">{c.etc}</p>
        </div>
      )}

      {c.projects.length === 0 && c.issues.length === 0 && c.nextWeek.length === 0 && !c.etc && (
        <p className="text-[var(--color-ink-muted)]">입력된 본문 내용이 없습니다.</p>
      )}
    </div>
  );
}

const fieldCls =
  'w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-md px-2 py-1 text-sm text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/25 focus:border-[var(--color-accent)] placeholder:text-[var(--color-ink-muted)]';
const lblCls = 'block text-[11px] font-semibold text-[var(--color-ink-muted)] mb-0.5';
const sectionLbl = 'text-[11px] font-bold uppercase tracking-wide text-[var(--color-ink-muted)]';
const emptyProj = (): WeeklyReportProjectRow => ({
  name: '',
  period: '',
  owner: '',
  planPct: '',
  actualPct: '',
  content: '',
  issue: '',
  note: '',
});
const emptyIss = (): WeeklyReportIssueRow => ({ title: '', content: '', plan: '', result: '', note: '' });

/** 등록된 주간보고 1건을 같은 양식 그대로 인라인 편집(모달 없이). 저장 시 서버 반영. */
function EditableReportDetail({ rec, onSaved, onCancel }: { rec: WeeklyReportRecord; onSaved: () => void; onCancel: () => void }) {
  const { pushToast } = useToast();
  const [organization, setOrganization] = useState(rec.organization);
  const [reporter, setReporter] = useState(rec.reporter);
  const [weekStart, setWeekStart] = useState(rec.weekStart ?? '');
  const [weekEnd, setWeekEnd] = useState(rec.weekEnd ?? '');
  const [title, setTitle] = useState(rec.title);
  const [projects, setProjects] = useState<WeeklyReportProjectRow[]>(rec.content.projects);
  const [issues, setIssues] = useState<WeeklyReportIssueRow[]>(rec.content.issues);
  const [nextWeek, setNextWeek] = useState<string[]>(rec.content.nextWeek.length ? rec.content.nextWeek : ['']);
  const [etc, setEtc] = useState(rec.content.etc);
  const [saving, setSaving] = useState(false);

  const setProj = (i: number, patch: Partial<WeeklyReportProjectRow>) =>
    setProjects((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const setIss = (i: number, patch: Partial<WeeklyReportIssueRow>) =>
    setIssues((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const save = async () => {
    if (!organization.trim()) {
      pushToast('조직명을 입력하세요.', { variant: 'warning' });
      return;
    }
    const input: WeeklyReportInput = {
      organization: organization.trim(),
      reporter: reporter.trim(),
      weekStart: weekStart || null,
      weekEnd: weekEnd || null,
      title: title.trim(),
      content: {
        projects: projects.filter((p) => p.name.trim() || p.content.trim() || p.issue.trim()),
        issues: issues.filter((i) => i.title.trim() || i.content.trim()),
        nextWeek: nextWeek.map((s) => s.trim()).filter(Boolean),
        etc: etc.trim(),
      },
    };
    setSaving(true);
    try {
      await updateWeeklyReport(rec.id, input);
      pushToast('수정되었습니다.', { variant: 'success' });
      onSaved();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : '저장에 실패했습니다.', { variant: 'error', durationMs: 6000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 pb-4 pt-3 space-y-4 text-sm">
      {/* 기본 정보 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div>
          <label className={lblCls}>조직 *</label>
          <input className={fieldCls} value={organization} onChange={(e) => setOrganization(e.target.value)} />
        </div>
        <div>
          <label className={lblCls}>보고자</label>
          <input className={fieldCls} value={reporter} onChange={(e) => setReporter(e.target.value)} />
        </div>
        <div>
          <label className={lblCls}>주차 시작</label>
          <input type="date" className={fieldCls} value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
        </div>
        <div>
          <label className={lblCls}>주차 종료</label>
          <input type="date" className={fieldCls} value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} />
        </div>
        <div className="col-span-2 md:col-span-4">
          <label className={lblCls}>제목(선택)</label>
          <input className={fieldCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>

      {/* 프로젝트 진척 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className={sectionLbl}>프로젝트 진척</div>
          <button
            type="button"
            onClick={() => setProjects((p) => [...p, emptyProj()])}
            className="text-xs font-semibold text-[var(--color-accent)] inline-flex items-center gap-1 hover:underline"
          >
            <Plus size={13} /> 행 추가
          </button>
        </div>
        <div className="space-y-2">
          {projects.map((p, i) => (
            <div key={i} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  className={cn(fieldCls, 'font-semibold')}
                  value={p.name}
                  onChange={(e) => setProj(i, { name: e.target.value })}
                  placeholder="프로젝트명"
                />
                <button
                  type="button"
                  onClick={() => setProjects((prev) => prev.filter((_, idx) => idx !== i))}
                  className="p-1 rounded text-[var(--color-ink-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] shrink-0"
                  title="이 행 삭제"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
                <input className={fieldCls} value={p.period} onChange={(e) => setProj(i, { period: e.target.value })} placeholder="기간" />
                <input className={fieldCls} value={p.owner} onChange={(e) => setProj(i, { owner: e.target.value })} placeholder="담당" />
                <input
                  className={fieldCls}
                  value={p.planPct}
                  onChange={(e) => setProj(i, { planPct: e.target.value })}
                  placeholder="계획%"
                />
                <input
                  className={fieldCls}
                  value={p.actualPct}
                  onChange={(e) => setProj(i, { actualPct: e.target.value })}
                  placeholder="진척%"
                />
              </div>
              <textarea
                className={cn(fieldCls, 'min-h-[44px] resize-y')}
                value={p.content}
                onChange={(e) => setProj(i, { content: e.target.value })}
                placeholder="업무 내용"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <input className={fieldCls} value={p.issue} onChange={(e) => setProj(i, { issue: e.target.value })} placeholder="이슈" />
                <input className={fieldCls} value={p.note} onChange={(e) => setProj(i, { note: e.target.value })} placeholder="비고" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 이슈 사항 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className={sectionLbl}>이슈 사항</div>
          <button
            type="button"
            onClick={() => setIssues((p) => [...p, emptyIss()])}
            className="text-xs font-semibold text-[var(--color-accent)] inline-flex items-center gap-1 hover:underline"
          >
            <Plus size={13} /> 행 추가
          </button>
        </div>
        <div className="space-y-2">
          {issues.map((it, i) => (
            <div key={i} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  className={cn(fieldCls, 'font-semibold')}
                  value={it.title}
                  onChange={(e) => setIss(i, { title: e.target.value })}
                  placeholder="이슈 제목"
                />
                <button
                  type="button"
                  onClick={() => setIssues((prev) => prev.filter((_, idx) => idx !== i))}
                  className="p-1 rounded text-[var(--color-ink-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] shrink-0"
                  title="이 이슈 삭제"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <textarea
                className={cn(fieldCls, 'min-h-[40px] resize-y')}
                value={it.content}
                onChange={(e) => setIss(i, { content: e.target.value })}
                placeholder="이슈 내용"
              />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
                <input className={fieldCls} value={it.plan} onChange={(e) => setIss(i, { plan: e.target.value })} placeholder="조치 계획" />
                <input
                  className={fieldCls}
                  value={it.result}
                  onChange={(e) => setIss(i, { result: e.target.value })}
                  placeholder="조치 결과"
                />
                <input className={fieldCls} value={it.note} onChange={(e) => setIss(i, { note: e.target.value })} placeholder="비고" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 차주 주요 업무계획 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className={sectionLbl}>차주 주요 업무계획</div>
          <button
            type="button"
            onClick={() => setNextWeek((p) => [...p, ''])}
            className="text-xs font-semibold text-[var(--color-accent)] inline-flex items-center gap-1 hover:underline"
          >
            <Plus size={13} /> 항목 추가
          </button>
        </div>
        <div className="space-y-1.5">
          {nextWeek.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[var(--color-ink-muted)]">•</span>
              <input
                className={fieldCls}
                value={line}
                onChange={(e) => setNextWeek((prev) => prev.map((l, idx) => (idx === i ? e.target.value : l)))}
                placeholder="차주 업무 계획"
              />
              <button
                type="button"
                onClick={() => setNextWeek((prev) => prev.filter((_, idx) => idx !== i))}
                className="p-1 rounded text-[var(--color-ink-muted)] hover:text-[var(--color-danger)] shrink-0"
                title="삭제"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 기타 */}
      <div>
        <label className={lblCls}>기타</label>
        <textarea className={cn(fieldCls, 'min-h-[44px] resize-y')} value={etc} onChange={(e) => setEtc(e.target.value)} />
      </div>

      {/* 저장/취소 */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-line)] rounded-lg"
        >
          취소
        </button>
        <button type="button" onClick={() => void save()} disabled={saving} className={cn('btn-primary text-sm', saving && 'opacity-70')}>
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  );
}

/**
 * 주간업무보고: (1) 등록한 주간보고 목록(조회·수정·삭제) + (2) 기존 통합 대시보드(iframe).
 * 통합 대시보드는 독립 HTML(바닐라 JS)이라 iframe(srcDoc)으로 임베드한다.
 */
export function WeeklyReportPage({ userId, currentUserDisplay }: Props) {
  const { pushToast } = useToast();
  const ref = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => buildWeeklyReportSrcDoc(), []);

  const [reports, setReports] = useState<WeeklyReportRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editing, setEditing] = useState<WeeklyReportRecord | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);

  const canUse = isSupabaseConfigured && !!userId;

  const refresh = useCallback(async () => {
    if (!canUse) return;
    setLoading(true);
    try {
      setReports(await fetchWeeklyReports());
    } catch (e) {
      pushToast(e instanceof Error ? e.message : '주간보고를 불러오지 못했습니다.', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [canUse, pushToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteWeeklyReport(id);
        setPendingDeleteId(null);
        pushToast('주간보고가 삭제되었습니다.', { variant: 'success' });
        void refresh();
      } catch (e) {
        pushToast(e instanceof Error ? e.message : '삭제하지 못했습니다.', { variant: 'error' });
      }
    },
    [pushToast, refresh],
  );

  // iframe 높이 자동 맞춤(내부 스크롤 없이 본문 높이에 맞춤)
  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    let ro: ResizeObserver | null = null;
    const timers: number[] = [];
    const resize = () => {
      try {
        const doc = iframe.contentDocument;
        const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight || 0;
        if (h) iframe.style.height = `${h + 8}px`;
      } catch {
        /* same-origin srcDoc — 준비 전이면 무시 */
      }
    };
    const onLoad = () => {
      resize();
      timers.push(window.setTimeout(resize, 150), window.setTimeout(resize, 600), window.setTimeout(resize, 1500));
      try {
        const body = iframe.contentDocument?.body;
        if (body && typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => resize());
          ro.observe(body);
        }
      } catch {
        /* ignore */
      }
    };
    iframe.addEventListener('load', onLoad);
    const onWinResize = () => resize();
    window.addEventListener('resize', onWinResize);
    return () => {
      iframe.removeEventListener('load', onLoad);
      window.removeEventListener('resize', onWinResize);
      timers.forEach((t) => clearTimeout(t));
      ro?.disconnect();
    };
  }, []);

  const listEmpty = canUse && reports.length === 0;

  return (
    <div className="w-full flex-1 min-h-0 overflow-y-auto">
      {/* ── 등록한 주간보고 목록 ── */}
      <section className={cn('px-4 md:px-6 max-w-6xl mx-auto', listEmpty ? 'pt-2 pb-2' : 'pt-5 pb-6')}>
        {/* 목록이 있거나(또는 로그인 전)일 때만 전체 헤더 */}
        {(!canUse || reports.length > 0) && (
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base md:text-lg font-bold text-[var(--color-ink)]">등록한 주간보고</h2>
              <span className="badge badge-todo">{reports.length}</span>
              <button
                type="button"
                onClick={() => void refresh()}
                className="p-1.5 rounded-lg text-[var(--color-ink-muted)] hover:bg-[var(--color-line-soft)]"
                title="새로고침"
              >
                <RefreshCw size={15} className={cn(loading && 'animate-spin')} />
              </button>
            </div>
            <button
              type="button"
              disabled={!canUse}
              onClick={() => {
                setEditing(null);
                setComposeOpen(true);
              }}
              className={cn('btn-primary inline-flex items-center gap-1.5', !canUse && 'opacity-50 cursor-not-allowed')}
              title={canUse ? '새 주간보고를 작성해 등록' : '로그인이 필요합니다'}
            >
              <Plus size={16} /> 새 주간보고 등록
            </button>
          </div>
        )}

        {!canUse && (
          <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-line-soft)]/40 p-4 text-sm text-[var(--color-ink-muted)]">
            주간보고 등록은 로그인 후 이용할 수 있습니다.
          </div>
        )}

        {/* 로그인했는데 목록이 비었을 때: 통합 대시보드가 잘 보이도록 등록 버튼만 */}
        {listEmpty && (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setEditing(null);
                setComposeOpen(true);
              }}
              className={cn('btn-primary inline-flex items-center gap-1.5', loading && 'opacity-70 cursor-wait')}
              title={loading ? '불러오는 중…' : '새 주간보고를 작성해 등록'}
            >
              <Plus size={16} /> 새 주간보고 등록
            </button>
          </div>
        )}

        <div className="space-y-2">
          {reports.map((r) => {
            const isOwn = !!userId && r.authorId === userId;
            const expanded = expandedId === r.id;
            return (
              <div key={r.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                    className="p-1 rounded text-[var(--color-ink-muted)] hover:bg-[var(--color-line-soft)] shrink-0"
                    title={expanded ? '접기' : '펼쳐 보기'}
                  >
                    {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <button type="button" onClick={() => setExpandedId(expanded ? null : r.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                      <span className="font-semibold text-[var(--color-ink)] truncate">{r.organization || '(조직 미지정)'}</span>
                      <span className="text-xs font-medium text-[var(--color-accent)]">{fmtWeek(r.weekStart, r.weekEnd)}</span>
                      {r.reporter && <span className="text-xs text-[var(--color-ink-muted)]">{r.reporter}</span>}
                    </div>
                    {r.title && <div className="text-xs text-[var(--color-ink-muted)] truncate">{r.title}</div>}
                  </button>

                  {isOwn ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          // 모달 대신 같은 화면에서 양식 그대로 인라인 편집
                          setExpandedId(r.id);
                          setInlineEditId((cur) => (cur === r.id ? null : r.id));
                        }}
                        className={cn(
                          'p-1.5 rounded-lg hover:bg-[var(--color-line-soft)] hover:text-[var(--color-accent)]',
                          inlineEditId === r.id
                            ? 'text-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                            : 'text-[var(--color-ink-muted)]',
                        )}
                        title={inlineEditId === r.id ? '편집 중' : '수정'}
                      >
                        <Pencil size={15} />
                      </button>
                      {pendingDeleteId === r.id ? (
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleDelete(r.id)}
                            className="px-2 py-1 rounded-md text-xs font-semibold text-white bg-[var(--color-danger)] hover:opacity-90"
                          >
                            삭제 확인
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(null)}
                            className="px-2 py-1 rounded-md text-xs text-[var(--color-ink-muted)] hover:bg-[var(--color-line-soft)]"
                          >
                            취소
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(r.id)}
                          className="p-1.5 rounded-lg text-[var(--color-ink-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
                          title="삭제"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="text-[11px] text-[var(--color-ink-muted)] shrink-0 px-1">다른 작성자</span>
                  )}
                </div>
                {expanded && (
                  <div className="border-t border-[var(--color-line)] bg-[var(--color-line-soft)]/30">
                    {inlineEditId === r.id ? (
                      <EditableReportDetail
                        rec={r}
                        onSaved={() => {
                          setInlineEditId(null);
                          void refresh();
                        }}
                        onCancel={() => setInlineEditId(null)}
                      />
                    ) : (
                      <ReportDetail rec={r} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 통합 대시보드(기존 뷰어) ── */}
      <div className="border-t border-[var(--color-line)]">
        <iframe
          ref={ref}
          title="지엠티 주간업무보고"
          srcDoc={srcDoc}
          className="block w-full border-0 bg-[#eef2f7]"
          style={{ minHeight: 'calc(100vh - 120px)' }}
        />
      </div>

      <WeeklyReportComposeModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSaved={() => void refresh()}
        editing={editing}
        authorId={userId ?? ''}
        defaultReporter={currentUserDisplay}
      />
    </div>
  );
}
