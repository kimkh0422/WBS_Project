import { Fragment } from 'react';
import { X, ShieldCheck, Check, Minus } from 'lucide-react';
import { cn } from '../lib/utils';

interface PermissionGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Cell = 'yes' | 'no' | 'partial';

interface Row {
  label: string;
  cells: [Cell, Cell, Cell, Cell]; // 관리자 / 소유자 / 편집자 / 보기자
  /** partial 셀에 대한 설명. 표 하단 각주로 묶어 보여줄 때 사용. */
  note?: string;
}

interface Section {
  title: string;
  desc?: string;
  rows: Row[];
}

/** 한 표에 담기 위해 동일 권한 패턴 행은 한 줄로 묶음 */
const SECTIONS: Section[] = [
  {
    title: '프로젝트 관리',
    rows: [
      {
        label: '프로젝트 생성',
        cells: ['yes', 'yes', 'yes', 'yes'],
        note: '누구나 생성 가능 — 만든 사람이 그 프로젝트의 소유자가 됩니다.',
      },
      { label: '프로젝트 편집(이름·기간)', cells: ['yes', 'yes', 'yes', 'no'] },
      { label: '프로젝트 삭제', cells: ['yes', 'yes', 'no', 'no'] },
      { label: '프로젝트 공개/비공개 설정', cells: ['yes', 'yes', 'no', 'no'] },
      { label: '프로젝트 구성원 관리(공유)', cells: ['yes', 'yes', 'no', 'no'] },
      {
        label: '프로젝트 변경 이력 보기',
        cells: ['yes', 'yes', 'partial', 'partial'],
        note: '편집자·보기자는 본인이 속한 프로젝트의 이력만.',
      },
    ],
  },
  {
    title: '업무(WBS) 관리',
    rows: [
      {
        label: '업무 추가·편집·삭제·베이스라인·엑셀/JSON 가져오기',
        cells: ['yes', 'yes', 'yes', 'no'],
      },
    ],
  },
  {
    title: '조회 ·보내기',
    rows: [
      {
        label: '대시보드·표·간트·달력·마인드맵·문서·보고서·검색·엑셀/JSON/Markdown보내기',
        cells: ['yes', 'yes', 'yes', 'yes'],
        note: '접근 권한이 있는 프로젝트·데이터 범위 안에서 이용합니다.',
      },
    ],
  },
  {
    title: '관리자 전용',
    desc: '회원 가입 승인, 조직 데이터, 시스템 전반에 영향을 주는 기능',
    rows: [
      { label: '회원 관리(가입 승인·권한 부여)', cells: ['yes', 'no', 'no', 'no'] },
      { label: '전체 변경 이력(모든 프로젝트)', cells: ['yes', 'no', 'no', 'no'] },
      {
        label: '조직 현황 보기',
        cells: ['yes', 'partial', 'partial', 'partial'],
        note: '관리자가 아닌 구성원도 가입 승인된 경우에 한해 보기 가능.',
      },
      { label: '환경설정 · 단축키', cells: ['yes', 'yes', 'yes', 'yes'] },
    ],
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

export function PermissionGuideModal({ isOpen, onClose }: PermissionGuideModalProps) {
  if (!isOpen) return null;

  const footnotes = SECTIONS.flatMap((s) => s.rows.filter((r) => r.note).map((r) => ({ label: r.label, note: r.note! })));

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60] animate-in fade-in duration-150" onClick={onClose} />
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[min(96vw,720px)] max-h-[88vh] overflow-hidden bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col animate-in zoom-in-95 fade-in duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-guide-title"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white shrink-0">
          <h2 id="permission-guide-title" className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <ShieldCheck size={17} className="text-blue-600 shrink-0" />
            권한 안내 — 역할별 주요 기능
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
            한 사람이 여러 역할을 동시에 가질 수 있습니다. 예: 본인이 만든 프로젝트에서는 <b>소유자</b>, 타인이 공유한 프로젝트에서는{' '}
            <b>편집자</b> 또는 <b>보기자</b>.
          </p>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-[13px] border-collapse">
              <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-slate-600 border-b border-slate-200 w-[min(42%,280px)]">
                    기능
                  </th>
                  {COL_HEADERS.map((h) => (
                    <th key={h.label} className="px-1.5 py-2 text-center border-b border-slate-200 w-[14.5%] min-w-[3rem]">
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
                {SECTIONS.map((section) => (
                  <Fragment key={section.title}>
                    <tr className="bg-slate-100/90">
                      <td colSpan={5} className="px-3 py-1.5 text-[11px] font-bold text-slate-700 border-b border-slate-200">
                        {section.title}
                        {section.desc ? <span className="font-normal text-slate-500"> — {section.desc}</span> : null}
                      </td>
                    </tr>
                    {section.rows.map((row, idx) => (
                      <tr
                        key={`${section.title}-${row.label}`}
                        className={cn('border-b border-slate-100 last:border-b-0', idx % 2 === 1 && 'bg-slate-50/50')}
                      >
                        <td className="px-3 py-1.5 text-slate-700 align-middle leading-snug">
                          {row.label}
                          {row.note ? (
                            <span className="text-amber-600 ml-0.5" title={row.note}>
                              *
                            </span>
                          ) : null}
                        </td>
                        {row.cells.map((c, i) => (
                          <td key={i} className="px-1 py-1.5 text-center align-middle">
                            <div className="flex justify-center">
                              <CellIcon value={c} />
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {footnotes.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {footnotes.map((f) => (
                <li key={f.label} className="text-[10px] text-slate-500 leading-relaxed pl-0.5">
                  <span className="text-amber-600 mr-0.5">*</span>
                  <b className="text-slate-600">{f.label}</b> — {f.note}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-slate-600 border-t border-slate-100 pt-3">
            <span className="inline-flex items-center gap-1">
              <CellIcon value="yes" /> 가능
            </span>
            <span className="inline-flex items-center gap-1">
              <CellIcon value="partial" /> 조건부
            </span>
            <span className="inline-flex items-center gap-1">
              <CellIcon value="no" /> 불가
            </span>
            <span className="text-slate-400">열 머리글에 마우스를 올리면 역할 전체 이름이 표시됩니다.</span>
          </div>
        </div>

        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50/60 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </>
  );
}
