import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { startOfWeek, addDays, format } from 'date-fns';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import { useToast } from './Toast';
import {
  insertWeeklyReport,
  updateWeeklyReport,
  type WeeklyReportRecord,
  type WeeklyReportInput,
  type WeeklyReportProjectRow,
  type WeeklyReportIssueRow,
} from '../lib/db/weeklyReports';
import { getExistingWeeklyReports, mapExistingReportToForm, type ExistingReport } from '../data/weeklyReportData';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: WeeklyReportRecord | null;
  authorId: string;
  defaultOrg?: string;
  defaultReporter?: string;
};

const emptyProject = (): WeeklyReportProjectRow => ({
  name: '',
  period: '',
  owner: '',
  planPct: '',
  actualPct: '',
  content: '',
  issue: '',
  note: '',
});
const emptyIssue = (): WeeklyReportIssueRow => ({ title: '', content: '', plan: '', result: '', note: '' });

const field =
  'w-full bg-[var(--color-surface)] border border-[var(--color-line)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/25 focus:border-[var(--color-accent)] placeholder:text-[var(--color-ink-muted)]';
const label = 'block text-[11px] font-semibold text-[var(--color-ink-muted)] mb-1';

export function WeeklyReportComposeModal({ isOpen, onClose, onSaved, editing, authorId, defaultOrg, defaultReporter }: Props) {
  const { pushToast } = useToast();
  const [organization, setOrganization] = useState('');
  const [reporter, setReporter] = useState('');
  const [weekStart, setWeekStart] = useState('');
  const [weekEnd, setWeekEnd] = useState('');
  const [title, setTitle] = useState('');
  const [projects, setProjects] = useState<WeeklyReportProjectRow[]>([]);
  const [issues, setIssues] = useState<WeeklyReportIssueRow[]>([]);
  const [nextWeek, setNextWeek] = useState<string[]>([]);
  const [etc, setEtc] = useState('');
  const [saving, setSaving] = useState(false);
  const existingReports = useMemo(() => getExistingWeeklyReports(), []);
  const [baseId, setBaseId] = useState('');

  // 기존 보고 1건을 폼에 채운다(없으면 빈 양식). 이벤트 핸들러/효과에서 공용으로 사용.
  const applyBase = (r: ExistingReport | null) => {
    if (!r) {
      setOrganization(defaultOrg ?? '');
      setReporter(defaultReporter ?? '');
      setProjects([emptyProject()]);
      setIssues([]);
      setNextWeek(['']);
      setEtc('');
      return;
    }
    const m = mapExistingReportToForm(r);
    setOrganization(m.organization || defaultOrg || '');
    setReporter(m.reporter || defaultReporter || '');
    setProjects(m.content.projects.length ? m.content.projects : [emptyProject()]);
    setIssues(m.content.issues);
    setNextWeek(m.content.nextWeek.length ? m.content.nextWeek : ['']);
    setEtc(m.content.etc);
  };

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setBaseId('');
      setOrganization(editing.organization);
      setReporter(editing.reporter);
      setWeekStart(editing.weekStart ?? '');
      setWeekEnd(editing.weekEnd ?? '');
      setTitle(editing.title);
      setProjects(editing.content.projects.length ? editing.content.projects : [emptyProject()]);
      setIssues(editing.content.issues);
      setNextWeek(editing.content.nextWeek.length ? editing.content.nextWeek : ['']);
      setEtc(editing.content.etc);
      return;
    }
    // 신규: 이번 주로 주차 설정 + 로그인 사용자 조직/이름과 일치하는 기존 보고를 자동으로 불러와 초기값으로.
    const now = new Date();
    const ws = startOfWeek(now, { weekStartsOn: 1 });
    setWeekStart(format(ws, 'yyyy-MM-dd'));
    setWeekEnd(format(addDays(ws, 4), 'yyyy-MM-dd'));
    setTitle('');
    const disp = defaultReporter ?? '';
    const match = existingReports.find((r) => (r.org && disp.includes(r.org)) || (r.reporter && disp.includes(r.reporter))) ?? null;
    setBaseId(match?.id ?? '');
    if (match) {
      const m = mapExistingReportToForm(match);
      setOrganization(m.organization || defaultOrg || '');
      setReporter(m.reporter || defaultReporter || '');
      setProjects(m.content.projects.length ? m.content.projects : [emptyProject()]);
      setIssues(m.content.issues);
      setNextWeek(m.content.nextWeek.length ? m.content.nextWeek : ['']);
      setEtc(m.content.etc);
    } else {
      setOrganization(defaultOrg ?? '');
      setReporter(defaultReporter ?? '');
      setProjects([emptyProject()]);
      setIssues([]);
      setNextWeek(['']);
      setEtc('');
    }
  }, [isOpen, editing, defaultOrg, defaultReporter, existingReports]);

  if (!isOpen) return null;

  const setProject = (i: number, patch: Partial<WeeklyReportProjectRow>) =>
    setProjects((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const setIssue = (i: number, patch: Partial<WeeklyReportIssueRow>) =>
    setIssues((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const handleSave = async () => {
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
      if (editing) await updateWeeklyReport(editing.id, input);
      else await insertWeeklyReport(input, authorId);
      pushToast(editing ? '주간보고가 수정되었습니다.' : '주간보고가 등록되었습니다.', { variant: 'success' });
      onSaved();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '저장에 실패했습니다.';
      pushToast(msg, { variant: 'error', durationMs: 6000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={MODAL_BACKDROP_CLASS} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-4xl max-h-[92vh] overflow-hidden flex flex-col')}>
        {/* 헤더 */}
        <div className="flex justify-between items-center px-5 py-3.5 border-b border-[var(--color-line)] bg-[var(--color-line-soft)]/70 shrink-0">
          <h3 className="text-sm md:text-base font-bold text-[var(--color-ink)]">{editing ? '주간보고 수정' : '주간보고 등록'}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-ink-muted)] hover:bg-[var(--color-line)] hover:text-[var(--color-ink)]"
            title="닫기 (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* 본문 */}
        <div className="p-5 flex-1 min-h-0 overflow-y-auto space-y-6">
          {/* 기존 보고에서 불러오기 (신규 작성 시) */}
          {!editing && existingReports.length > 0 && (
            <div className="rounded-xl border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)]/50 p-3">
              <label className={label}>기존 보고에서 불러오기</label>
              <select
                className={field}
                value={baseId}
                onChange={(e) => {
                  setBaseId(e.target.value);
                  applyBase(existingReports.find((x) => x.id === e.target.value) ?? null);
                }}
              >
                <option value="">(빈 양식으로 시작)</option>
                {existingReports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.org || r.id}
                    {r.reporter ? ` · ${r.reporter}` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
                기존 양식·데이터를 불러와 일부만 수정해 등록할 수 있습니다. (조직이 일치하면 자동으로 불러옵니다)
              </p>
            </div>
          )}

          {/* 기본 정보 */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>조직 *</label>
              <input
                className={field}
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                placeholder="예: 운영기술개발실"
              />
            </div>
            <div>
              <label className={label}>보고자</label>
              <input className={field} value={reporter} onChange={(e) => setReporter(e.target.value)} placeholder="예: 김길용 수석" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>주차 시작</label>
                <input type="date" className={field} value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
              </div>
              <div>
                <label className={label}>주차 종료</label>
                <input type="date" className={field} value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} />
              </div>
            </div>
            <div>
              <label className={label}>제목(선택)</label>
              <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 6월 1주차 주간업무보고" />
            </div>
          </section>

          {/* 프로젝트 진척 */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-[var(--color-ink)]">프로젝트 진척</h4>
              <button
                type="button"
                onClick={() => setProjects((p) => [...p, emptyProject()])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent)] hover:underline"
              >
                <Plus size={14} /> 행 추가
              </button>
            </div>
            {projects.length === 0 && <p className="text-xs text-[var(--color-ink-muted)]">＋ 행 추가로 프로젝트 진척을 입력하세요.</p>}
            <div className="space-y-3">
              {projects.map((p, i) => (
                <div key={i} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-line-soft)]/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[var(--color-ink-muted)]">프로젝트 #{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => setProjects((prev) => prev.filter((_, idx) => idx !== i))}
                      className="p-1 rounded text-[var(--color-ink-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                      title="이 행 삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      className={field}
                      value={p.name}
                      onChange={(e) => setProject(i, { name: e.target.value })}
                      placeholder="프로젝트명"
                    />
                    <input
                      className={field}
                      value={p.period}
                      onChange={(e) => setProject(i, { period: e.target.value })}
                      placeholder="기간 (예: 2026.04~12)"
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input
                      className={field}
                      value={p.owner}
                      onChange={(e) => setProject(i, { owner: e.target.value })}
                      placeholder="담당 PM"
                    />
                    <input
                      className={field}
                      value={p.planPct}
                      onChange={(e) => setProject(i, { planPct: e.target.value })}
                      placeholder="계획율 %"
                    />
                    <input
                      className={field}
                      value={p.actualPct}
                      onChange={(e) => setProject(i, { actualPct: e.target.value })}
                      placeholder="실제 진척 %"
                    />
                    <input className={field} value={p.note} onChange={(e) => setProject(i, { note: e.target.value })} placeholder="비고" />
                  </div>
                  <textarea
                    className={cn(field, 'min-h-[56px] resize-y')}
                    value={p.content}
                    onChange={(e) => setProject(i, { content: e.target.value })}
                    placeholder="업무 내용"
                  />
                  <input
                    className={field}
                    value={p.issue}
                    onChange={(e) => setProject(i, { issue: e.target.value })}
                    placeholder="이슈/특이사항(선택)"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* 이슈 사항 */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-[var(--color-ink)]">이슈 사항</h4>
              <button
                type="button"
                onClick={() => setIssues((p) => [...p, emptyIssue()])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent)] hover:underline"
              >
                <Plus size={14} /> 행 추가
              </button>
            </div>
            {issues.length === 0 && <p className="text-xs text-[var(--color-ink-muted)]">이슈가 있으면 ＋ 행 추가로 입력하세요.</p>}
            <div className="space-y-3">
              {issues.map((it, i) => (
                <div key={i} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-line-soft)]/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[var(--color-ink-muted)]">이슈 #{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => setIssues((prev) => prev.filter((_, idx) => idx !== i))}
                      className="p-1 rounded text-[var(--color-ink-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                      title="이 이슈 삭제"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <input
                    className={field}
                    value={it.title}
                    onChange={(e) => setIssue(i, { title: e.target.value })}
                    placeholder="이슈 제목"
                  />
                  <textarea
                    className={cn(field, 'min-h-[48px] resize-y')}
                    value={it.content}
                    onChange={(e) => setIssue(i, { content: e.target.value })}
                    placeholder="이슈 내용"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      className={field}
                      value={it.plan}
                      onChange={(e) => setIssue(i, { plan: e.target.value })}
                      placeholder="조치 계획"
                    />
                    <input
                      className={field}
                      value={it.result}
                      onChange={(e) => setIssue(i, { result: e.target.value })}
                      placeholder="조치 결과"
                    />
                    <input className={field} value={it.note} onChange={(e) => setIssue(i, { note: e.target.value })} placeholder="비고" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 차주 주요 업무계획 */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-[var(--color-ink)]">차주 주요 업무계획</h4>
              <button
                type="button"
                onClick={() => setNextWeek((p) => [...p, ''])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-accent)] hover:underline"
              >
                <Plus size={14} /> 항목 추가
              </button>
            </div>
            <div className="space-y-2">
              {nextWeek.map((line, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[var(--color-ink-muted)] text-sm">•</span>
                  <input
                    className={field}
                    value={line}
                    onChange={(e) => setNextWeek((prev) => prev.map((l, idx) => (idx === i ? e.target.value : l)))}
                    placeholder="차주 업무 계획 항목"
                  />
                  <button
                    type="button"
                    onClick={() => setNextWeek((prev) => prev.filter((_, idx) => idx !== i))}
                    className="p-1 rounded text-[var(--color-ink-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                    title="항목 삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* 기타 */}
          <section>
            <label className={label}>기타(선택)</label>
            <textarea
              className={cn(field, 'min-h-[56px] resize-y')}
              value={etc}
              onChange={(e) => setEtc(e.target.value)}
              placeholder="기타 보고 사항"
            />
          </section>
        </div>

        {/* 푸터 */}
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--color-line)] bg-[var(--color-line-soft)]/50 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-sm font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-line)] rounded-lg"
          >
            취소
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className={cn('btn-primary', saving && 'opacity-70')}>
            {saving ? '저장 중…' : editing ? '수정 저장' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
