import React, { useMemo } from 'react';
import { formatKRW, formatKRWCompact, type OutlookPlanRow, type LedgerRow } from '../lib/salesOutlook';

/**
 * 영업 아웃룩 시각화 — 의존성 없는 div 기반 막대차트(코드베이스의 자체 SVG 차트 관례와 동일 취지).
 * 모든 차트는 현재 필터가 적용된 rows를 입력받아 그린다.
 */

const PALETTE = ['#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899', '#8b5cf6', '#22c55e', '#ef4444', '#64748b', '#eab308'];

const ChartCard = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
  <div className="card p-4">
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h3 className="text-sm font-bold text-[var(--color-ink)]">{title}</h3>
      {subtitle && <span className="text-[11px] text-slate-400">{subtitle}</span>}
    </div>
    {children}
  </div>
);

interface Datum {
  label: string;
  value: number;
  count?: number;
  color?: string;
}

/** 가로 막대 목록 (금액·건수 분포에 적합) */
function HBars({ data, valueFmt, emptyText }: { data: Datum[]; valueFmt: (n: number) => string; emptyText?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <div className="py-6 text-center text-xs text-slate-400">{emptyText ?? '데이터 없음'}</div>;
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => (
        <div key={d.label} className="flex items-center gap-2 text-xs">
          <div className="w-24 shrink-0 truncate text-right text-slate-500" title={d.label}>
            {d.label}
          </div>
          <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-100">
            <div
              className="absolute inset-y-0 left-0 rounded transition-all"
              style={{
                width: `${(d.value / max) * 100}%`,
                backgroundColor: d.color ?? PALETTE[i % PALETTE.length],
                minWidth: d.value > 0 ? 2 : 0,
              }}
            />
          </div>
          <div className="w-24 shrink-0 text-right font-medium tabular-nums text-[var(--color-ink)]" title={valueFmt(d.value)}>
            {valueFmt(d.value)}
            {d.count != null && <span className="ml-1 font-normal text-slate-400">({d.count})</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 12개월 세로 막대 (월별 추이) */
function MonthBars({
  data,
  valueFmt,
  color = '#6366f1',
}: {
  data: { month: number; value: number }[];
  valueFmt: (n: number) => string;
  color?: string;
}) {
  const byMonth = new Map(data.map((d) => [d.month, d.value]));
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const max = Math.max(1, ...months.map((m) => byMonth.get(m) ?? 0));
  const hasAny = months.some((m) => (byMonth.get(m) ?? 0) > 0);
  if (!hasAny) return <div className="py-6 text-center text-xs text-slate-400">월별 데이터 없음</div>;
  return (
    <div className="flex h-44 items-end gap-1">
      {months.map((m) => {
        const v = byMonth.get(m) ?? 0;
        return (
          <div key={m} className="group flex flex-1 flex-col items-center justify-end gap-1" title={`${m}월 · ${valueFmt(v)}`}>
            <span className="text-[9px] tabular-nums text-slate-400 opacity-0 group-hover:opacity-100">
              {v > 0 ? formatKRWCompact(v) : ''}
            </span>
            <div
              className="w-full rounded-t transition-all"
              style={{ height: `${v > 0 ? Math.max(2, (v / max) * 100) : 0}%`, backgroundColor: color }}
            />
            <span className="text-[10px] text-slate-400">{m}</span>
          </div>
        );
      })}
    </div>
  );
}

function catColor(category: string): string {
  if (category.startsWith('확정')) return '#22c55e';
  if (category.startsWith('예정')) return '#0ea5e9';
  if (category.startsWith('이월')) return '#94a3b8';
  if (category.startsWith('미정')) return '#f59e0b';
  return '#8b5cf6';
}

function aggregate(rows: OutlookPlanRow[], keyOf: (r: OutlookPlanRow) => string, colorOf?: (k: string) => string): Datum[] {
  const m = new Map<string, { value: number; count: number }>();
  for (const r of rows) {
    const k = keyOf(r) || '(미지정)';
    const cur = m.get(k) ?? { value: 0, count: 0 };
    cur.value += r.expectedAmount ?? 0;
    cur.count += 1;
    m.set(k, cur);
  }
  return [...m.entries()]
    .map(([label, v]) => ({ label, value: v.value, count: v.count, color: colorOf?.(label) }))
    .sort((a, b) => b.value - a.value);
}

function probBand(p: number | undefined): string {
  if (p == null) return '미지정';
  if (p >= 1) return '100%';
  if (p >= 0.8) return '80~99%';
  if (p >= 0.5) return '50~79%';
  return '50% 미만';
}
const PROB_ORDER = ['100%', '80~99%', '50~79%', '50% 미만', '미지정'];

export function PlanCharts({ rows }: { rows: OutlookPlanRow[] }) {
  const byDivision = useMemo(() => aggregate(rows, (r) => r.division), [rows]);
  const byCategory = useMemo(() => aggregate(rows, (r) => r.category, catColor), [rows]);
  const byBizType = useMemo(() => aggregate(rows, (r) => r.bizType), [rows]);
  const byMonth = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) {
      const mm = parseInt(r.orderMonth, 10);
      if (mm >= 1 && mm <= 12) m.set(mm, (m.get(mm) ?? 0) + (r.expectedAmount ?? 0));
    }
    return [...m.entries()].map(([month, value]) => ({ month, value }));
  }, [rows]);
  const byProb = useMemo(() => {
    const m = new Map<string, { value: number; count: number }>();
    for (const r of rows) {
      const k = probBand(r.orderProb);
      const cur = m.get(k) ?? { value: 0, count: 0 };
      cur.value += r.expectedAmount ?? 0;
      cur.count += 1;
      m.set(k, cur);
    }
    return PROB_ORDER.filter((k) => m.has(k)).map((label) => ({ label, value: m.get(label)!.value, count: m.get(label)!.count }));
  }, [rows]);

  const showDivision = byDivision.length > 1;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ChartCard title={showDivision ? '사업부별 예상수주금액' : '구분별 예상수주금액'} subtitle="막대=금액, 괄호=건수">
        <HBars data={showDivision ? byDivision : byCategory} valueFmt={formatKRWCompact} />
      </ChartCard>

      <ChartCard title="수주월별 예상수주금액" subtitle="수주월 기준">
        <MonthBars data={byMonth} valueFmt={formatKRW} />
      </ChartCard>

      <ChartCard title="사업형태별 예상수주금액" subtitle="제품·용역·유지·상품 등">
        <HBars data={byBizType} valueFmt={formatKRWCompact} />
      </ChartCard>

      <ChartCard title="수주확률 구간별" subtitle="막대=예상수주금액, 괄호=건수">
        <HBars data={byProb} valueFmt={formatKRWCompact} />
      </ChartCard>

      {showDivision && (
        <ChartCard title="구분별 예상수주금액" subtitle="이월·확정·예정·미정">
          <HBars data={byCategory} valueFmt={formatKRWCompact} />
        </ChartCard>
      )}
    </div>
  );
}

function taxBucket(taxType: string): string {
  if (taxType.startsWith('과세')) return '과세';
  if (taxType.startsWith('영세')) return '영세';
  if (taxType.startsWith('면세')) return '면세';
  return taxType || '(기타)';
}

export function LedgerCharts({ rows }: { rows: LedgerRow[] }) {
  const byMonth = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) if (typeof r.month === 'number') m.set(r.month, (m.get(r.month) ?? 0) + r.total);
    return [...m.entries()].map(([month, value]) => ({ month, value }));
  }, [rows]);
  const byDivision = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.division || '(미지정)', (m.get(r.division || '(미지정)') ?? 0) + r.total);
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [rows]);
  const byTax = useMemo(() => {
    const m = new Map<string, { value: number; count: number }>();
    for (const r of rows) {
      const k = taxBucket(r.taxType);
      const cur = m.get(k) ?? { value: 0, count: 0 };
      cur.value += r.total;
      cur.count += 1;
      m.set(k, cur);
    }
    return [...m.entries()].map(([label, v]) => ({ label, value: v.value, count: v.count })).sort((a, b) => b.value - a.value);
  }, [rows]);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ChartCard title="월별 매출(합계)" subtitle="발생 월 기준">
        <MonthBars data={byMonth} valueFmt={formatKRW} color="#0ea5e9" />
      </ChartCard>
      <ChartCard title="사업부별 매출" subtitle="합계 기준">
        <HBars data={byDivision} valueFmt={formatKRWCompact} />
      </ChartCard>
      <ChartCard title="세무구분별 매출" subtitle="막대=합계, 괄호=건수">
        <HBars data={byTax} valueFmt={formatKRWCompact} />
      </ChartCard>
    </div>
  );
}
