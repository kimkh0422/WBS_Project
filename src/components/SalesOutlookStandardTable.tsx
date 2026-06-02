import React from 'react';
import { cn } from '../lib/utils';
import { formatStdCell, type StdColumn, type OutlookPlanRow } from '../lib/salesOutlook';

/**
 * 원본 엑셀(`2026년 수주 및 청구 계획(안)`)과 동일한 공통 표 양식.
 * - 2단 머리글: 엑셀 행3(그룹: 영업 손익·월별·합계 등) + 행4(열 라벨 전체 문자열 그대로)
 * - 본문: 엑셀 열 순서대로 `cells` 표시(날짜·숫자·비율 포맷만 웹에 맞게 정리)
 */

/** 가로 스크롤 시 좌측 고정할 기본 열 라벨과 누적 left(px) */
const STICKY = [
  { label: '사업부', left: 0, width: 92 },
  { label: 'PJ코드', left: 92, width: 64 },
  { label: '사업명', left: 156, width: 240 },
];
const stickyByLabel = new Map(STICKY.map((s) => [s.label, s]));

export function SalesOutlookStandardTable({ columns, rows }: { columns: StdColumn[]; rows: OutlookPlanRow[] }) {
  if (!columns || columns.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--color-line)] bg-white py-10 text-center text-sm text-slate-400">
        표 정의가 없습니다.
      </div>
    );
  }

  // 행3 그룹 머리글 colSpan 묶기
  const groups: { group: string; span: number }[] = [];
  for (const col of columns) {
    const last = groups[groups.length - 1];
    if (last && last.group === col.group) last.span += 1;
    else groups.push({ group: col.group, span: 1 });
  }

  const stickyCss = (label: string, isHeader: boolean): React.CSSProperties | undefined => {
    const s = stickyByLabel.get(label);
    if (!s) return undefined;
    return { position: 'sticky', left: s.left, zIndex: isHeader ? 30 : 20, minWidth: s.width, maxWidth: s.width };
  };

  return (
    <div className="overflow-auto rounded-xl border border-[var(--color-line)] bg-white" style={{ maxHeight: '72vh' }}>
      <table className="border-collapse text-xs">
        <thead className="sticky top-0 z-20">
          {/* 그룹 머리글 (행3) */}
          <tr>
            {groups.map((g, i) => (
              <th
                key={i}
                colSpan={g.span}
                className={cn(
                  'border border-slate-200 px-2 py-1 text-center font-bold whitespace-nowrap',
                  g.group ? 'bg-indigo-50 text-indigo-800' : 'bg-slate-100 text-slate-500',
                )}
              >
                {g.group || '\u00a0'}
              </th>
            ))}
          </tr>
          {/* 라벨 머리글 (행4) */}
          <tr>
            {columns.map((c, i) => {
              const sticky = stickyCss(c.label, true);
              return (
                <th
                  key={i}
                  title={c.label}
                  style={sticky}
                  className={cn(
                    'border border-slate-200 bg-slate-50 px-2 py-1 text-center font-medium text-slate-600 whitespace-nowrap',
                    sticky && 'text-left',
                  )}
                >
                  {c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-10 text-center text-sm text-slate-400">
                조건에 맞는 항목이 없습니다.
              </td>
            </tr>
          ) : (
            rows.map((r, ri) => (
              <tr key={ri} className="hover:bg-indigo-50/40">
                {columns.map((c, ci) => {
                  const v = ci < r.cells.length ? r.cells[ci] : null;
                  const text = formatStdCell(v ?? null, c.kind);
                  const isNum = c.kind === 'num' || c.kind === 'rate';
                  const sticky = stickyCss(c.label, false);
                  return (
                    <td
                      key={ci}
                      title={typeof v === 'string' && v.length > 12 ? v : undefined}
                      style={sticky}
                      className={cn(
                        'border border-slate-100 px-2 py-1 whitespace-nowrap',
                        isNum ? 'text-right tabular-nums text-slate-600' : 'text-slate-600',
                        sticky ? 'truncate bg-white' : '',
                        c.label === '사업명' && 'font-medium text-[var(--color-ink)]',
                      )}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
