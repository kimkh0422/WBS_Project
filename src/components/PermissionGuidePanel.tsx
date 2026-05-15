import { ShieldCheck, Check, Minus, X } from 'lucide-react';
import { cn } from '../lib/utils';

type Cell = 'yes' | 'no' | 'partial';

interface Row {
  label: string;
  cells: [Cell, Cell, Cell, Cell];
  note?: string;
}

const CORE_ROWS: Row[] = [
  {
    label: '프로젝트 생성',
    cells: ['yes', 'yes', 'yes', 'yes'],
    note: '누구나 생성 가능. 만든 사람이 해당 프로젝트 소유자가 됩니다.',
  },
  { label: '프로젝트 편집(이름·기간)', cells: ['yes', 'yes', 'yes', 'no'] },
  { label: '프로젝트 삭제·공개 설정·멤버(공유)', cells: ['yes', 'yes', 'no', 'no'] },
  { label: '업무(WBS) 편집·가져오기', cells: ['yes', 'yes', 'yes', 'no'] },
  {
    label: '대시보드·표·간트 등 조회·보내기',
    cells: ['yes', 'yes', 'yes', 'yes'],
    note: '접근 권한이 있는 프로젝트·데이터 범위 안에서만 이용합니다.',
  },
  {
    label: '변경 이력',
    cells: ['yes', 'yes', 'partial', 'partial'],
    note: '편집자·보기자는 본인이 속한 프로젝트 이력만 조회합니다.',
  },
  { label: '회원 승인·전역 관리·전체 프로젝트 이력', cells: ['yes', 'no', 'no', 'no'] },
  {
    label: '조직 현황',
    cells: ['yes', 'partial', 'partial', 'partial'],
    note: '관리자가 아닌 경우, 가입 승인된 회원에 한해 조회 가능합니다.',
  },
];

const COL_HEADERS: { label: string; sub: string; abbr: string; detail: string; tone: string }[] = [
  { label: '관리자', sub: '시스템', abbr: '관', detail: '시스템 관리자', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  { label: '소유자', sub: '만든 사람', abbr: '소', detail: '프로젝트를 만든 사람', tone: 'bg-blue-50 text-blue-800 border-blue-200' },
  {
    label: '편집자',
    sub: '편집 공유',
    abbr: '편',
    detail: '편집 권한으로 공유받음',
    tone: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  { label: '보기자', sub: '보기 공유', abbr: '보', detail: '보기 권한으로 공유받음', tone: 'bg-slate-50 text-slate-700 border-slate-200' },
];

function CellIcon({ value }: { value: Cell }) {
  if (value === 'yes') {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
        <Check size={12} strokeWidth={3} />
      </span>
    );
  }
  if (value === 'no') {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-rose-50 text-rose-500 ring-1 ring-rose-200">
        <X size={12} strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded bg-amber-50 text-amber-600 ring-1 ring-amber-200"
      title="제한적 가능"
    >
      <Minus size={12} strokeWidth={3} />
    </span>
  );
}

/** 역할별 권한 매트릭스 — 사용 안내 페이지 등에 삽입 */
export function PermissionGuidePanel({ className }: { className?: string }) {
  const footnotes = CORE_ROWS.filter((r) => r.note).map((r) => ({ label: r.label, note: r.note! }));

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2 text-slate-800">
        <ShieldCheck size={18} className="text-blue-600 shrink-0" aria-hidden />
        <h2 className="text-base font-bold tracking-tight">권한 안내</h2>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        한 사람이 역할을 겹쳐 가질 수 있습니다(예: 내 프로젝트는 <b>소유자</b>, 공유받은 프로젝트는 <b>편집자</b>·<b>보기자</b>). 표·단축키
        등 <b>개인 화면 설정</b>은 역할과 무관합니다.
      </p>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-[13px] border-collapse">
          <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
            <tr>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-600 border-b border-slate-200 w-[min(44%,300px)]">
                핵심 기능
              </th>
              {COL_HEADERS.map((h) => (
                <th key={h.label} className="px-1.5 py-2 text-center border-b border-slate-200 w-[14%] min-w-[3rem]">
                  <div
                    className={cn(
                      'mx-auto flex flex-col items-center gap-0.5 px-1 py-1 rounded border text-[10px] font-semibold leading-tight',
                      h.tone,
                    )}
                    title={`${h.label}: ${h.detail}`}
                  >
                    <span className="tracking-tight">{h.abbr}</span>
                    <span className="text-[9px] font-normal opacity-75">{h.sub}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CORE_ROWS.map((row, idx) => (
              <tr key={row.label} className={cn('border-b border-slate-100 last:border-b-0', idx % 2 === 1 && 'bg-slate-50/50')}>
                <td className="px-3 py-2 text-slate-700 align-middle leading-snug">
                  {row.label}
                  {row.note ? (
                    <span className="text-amber-600 ml-0.5" title={row.note}>
                      *
                    </span>
                  ) : null}
                </td>
                {row.cells.map((c, i) => (
                  <td key={i} className="px-1 py-2 text-center align-middle">
                    <div className="flex justify-center">
                      <CellIcon value={c} />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {footnotes.length > 0 ? (
        <ul className="space-y-1">
          {footnotes.map((f) => (
            <li key={f.label} className="text-[10px] text-slate-500 leading-relaxed pl-0.5">
              <span className="text-amber-600 mr-0.5">*</span>
              <b className="text-slate-600">{f.label}</b> — {f.note}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-slate-600 border-t border-slate-100 pt-3">
        <span className="inline-flex items-center gap-1">
          <CellIcon value="yes" /> 가능
        </span>
        <span className="inline-flex items-center gap-1">
          <CellIcon value="partial" /> 조건부
        </span>
        <span className="inline-flex items-center gap-1">
          <CellIcon value="no" /> 불가
        </span>
        <span className="text-slate-400">열 머리글에 마우스를 올리면 역할 설명이 표시됩니다.</span>
      </div>
    </div>
  );
}
