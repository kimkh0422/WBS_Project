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
      { label: '업무 추가', cells: ['yes', 'yes', 'yes', 'no'] },
      { label: '업무 편집(이름·기간·담당자 등)', cells: ['yes', 'yes', 'yes', 'no'] },
      { label: '업무 삭제', cells: ['yes', 'yes', 'yes', 'no'] },
      { label: '베이스라인 설정/해제', cells: ['yes', 'yes', 'yes', 'no'] },
      { label: '엑셀/JSON 가져오기', cells: ['yes', 'yes', 'yes', 'no'] },
    ],
  },
  {
    title: '조회 · 내보내기',
    rows: [
      { label: '대시보드 보기', cells: ['yes', 'yes', 'yes', 'yes'] },
      { label: '표 / 간트 / 달력 / 마인드맵 보기', cells: ['yes', 'yes', 'yes', 'yes'] },
      { label: '문서·보고서 보기', cells: ['yes', 'yes', 'yes', 'yes'] },
      { label: '검색', cells: ['yes', 'yes', 'yes', 'yes'] },
      { label: '엑셀/JSON/Markdown 보내기', cells: ['yes', 'yes', 'yes', 'yes'] },
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

const COL_HEADERS: { label: string; sub: string; tone: string }[] = [
  { label: '관리자', sub: '시스템 관리자', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  { label: '소유자', sub: '프로젝트 만든 사람', tone: 'bg-blue-50 text-blue-800 border-blue-200' },
  { label: '편집자', sub: '편집 권한 공유받음', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  { label: '보기자', sub: '보기 권한 공유받음', tone: 'bg-slate-50 text-slate-700 border-slate-200' },
];

function CellIcon({ value }: { value: Cell }) {
  if (value === 'yes') {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
        <Check size={14} strokeWidth={3} />
      </span>
    );
  }
  if (value === 'no') {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-rose-50 text-rose-500 ring-1 ring-rose-200">
        <X size={14} strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-amber-50 text-amber-600 ring-1 ring-amber-200"
      title="제한적 가능"
    >
      <Minus size={14} strokeWidth={3} />
    </span>
  );
}

export function PermissionGuideModal({ isOpen, onClose }: PermissionGuideModalProps) {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[60] animate-in fade-in duration-150" onClick={onClose} />
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[min(92vw,860px)] max-h-[88vh] overflow-hidden bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col animate-in zoom-in-95 fade-in duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-guide-title"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
          <h2 id="permission-guide-title" className="text-base font-bold text-slate-800 flex items-center gap-2">
            <ShieldCheck size={18} className="text-blue-600" />
            권한 안내 — 누가 무엇을 할 수 있나요?
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

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="text-xs text-slate-500 mb-4 leading-relaxed">
            아래 표는 역할별로 사용 가능한 기능을 보여줍니다. 한 사람이 여러 역할을 동시에 가질 수 있습니다 — 예를 들어 본인이 만든
            프로젝트에서는 <b>소유자</b>이지만 다른 사람이 공유한 프로젝트에서는 <b>편집자</b>나 <b>보기자</b>가 됩니다.
          </p>

          {SECTIONS.map((section) => (
            <div key={section.title} className="mb-6 last:mb-0">
              <div className="mb-2">
                <h3 className="text-sm font-bold text-slate-800">{section.title}</h3>
                {section.desc && <p className="text-[11px] text-slate-500 mt-0.5">{section.desc}</p>}
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200">
                      <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600 w-[40%]">기능</th>
                      {COL_HEADERS.map((h) => (
                        <th key={h.label} className="px-2 py-2 text-center">
                          <div
                            className={cn(
                              'inline-flex flex-col items-center gap-0.5 px-2 py-1 rounded-md border text-[11px] font-semibold',
                              h.tone,
                            )}
                          >
                            <span>{h.label}</span>
                            <span className="text-[10px] font-normal opacity-70">{h.sub}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row, idx) => (
                      <tr key={row.label} className={cn(idx % 2 === 1 && 'bg-slate-50/40', 'border-b last:border-b-0 border-slate-100')}>
                        <td className="px-3 py-2 text-slate-700">
                          {row.label}
                          {row.note && (
                            <span className="text-amber-600 ml-1" title={row.note}>
                              *
                            </span>
                          )}
                        </td>
                        {row.cells.map((c, i) => (
                          <td key={i} className="px-2 py-2 text-center">
                            <CellIcon value={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {section.rows.some((r) => r.note) && (
                <ul className="mt-2 ml-1 space-y-0.5">
                  {section.rows
                    .filter((r) => r.note)
                    .map((r) => (
                      <li key={r.label} className="text-[11px] text-slate-500 leading-relaxed">
                        <span className="text-amber-600 mr-1">*</span>
                        <b>{r.label}</b> — {r.note}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ))}

          <div className="mt-4 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
            <div className="flex items-center gap-1.5">
              <CellIcon value="yes" /> 가능
            </div>
            <div className="flex items-center gap-1.5">
              <CellIcon value="partial" /> 조건부 가능
            </div>
            <div className="flex items-center gap-1.5">
              <CellIcon value="no" /> 불가
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/60 flex justify-end">
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
