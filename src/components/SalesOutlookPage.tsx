import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Search, TrendingUp } from 'lucide-react';
import { cn } from '../lib/utils';
import { summarizePlan, summarizeLedger, formatKRW, formatKRWCompact, type OutlookPlanRow, type LedgerRow } from '../lib/salesOutlook';
import { PlanCharts, LedgerCharts } from './SalesOutlookCharts';
import { SalesOutlookStandardTable } from './SalesOutlookStandardTable';
import { SALES_OUTLOOK_DATA } from '../data/salesOutlookData';

const LEDGER_KEY = '__ledger__';

/** 구분 배지 색상 (예정(A)·미정(C) 등 접두 매칭) */
function catBadgeClass(category: string): string {
  if (category.startsWith('이월')) return 'bg-slate-100 text-slate-600 border-slate-200';
  if (category.startsWith('확정')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (category.startsWith('예정')) return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (category.startsWith('미정')) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function uniqSorted(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
}

const StatCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="card px-4 py-3" title={hint}>
    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
    <div className="mt-1 text-xl font-bold tabular-nums text-[var(--color-ink)]">{value}</div>
  </div>
);

const Select = ({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
}) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 text-sm text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
  >
    <option value="all">{allLabel}</option>
    {options.map((o) => (
      <option key={o} value={o}>
        {o}
      </option>
    ))}
  </select>
);

export function SalesOutlookPage() {
  // 데이터는 앱에 내장된 시드(원본 엑셀에서 생성). 업로드 없이 바로 시각화한다.
  const data = SALES_OUTLOOK_DATA;
  const [activeSheet, setActiveSheet] = useState<string>(
    data.planSheetNames.includes('전체사업부') ? '전체사업부' : (data.planSheetNames[0] ?? (data.ledgerRows.length ? LEDGER_KEY : '')),
  );

  // 필터
  const [q, setQ] = useState('');
  const [fDivision, setFDivision] = useState('all');
  const [fCategory, setFCategory] = useState('all');
  const [fStage, setFStage] = useState('all');
  const [fPm, setFPm] = useState('all');
  const [fMonth, setFMonth] = useState('all');

  // 시트 전환 시 필터 초기화
  useEffect(() => {
    setQ('');
    setFDivision('all');
    setFCategory('all');
    setFStage('all');
    setFPm('all');
    setFMonth('all');
  }, [activeSheet]);

  const isLedger = activeSheet === LEDGER_KEY;
  const planRows = useMemo<OutlookPlanRow[]>(
    () => (!isLedger ? (data.planRowsBySheet[activeSheet] ?? []) : []),
    [data, activeSheet, isLedger],
  );
  const ledgerRows = useMemo<LedgerRow[]>(() => (isLedger ? data.ledgerRows : []), [data, isLedger]);

  // 필터 옵션
  const divisionOptions = useMemo(() => uniqSorted(planRows.map((r) => r.division)), [planRows]);
  const categoryOptions = useMemo(() => uniqSorted(planRows.map((r) => r.category)), [planRows]);
  const stageOptions = useMemo(() => uniqSorted(planRows.map((r) => r.stage)), [planRows]);
  const pmOptions = useMemo(() => uniqSorted(planRows.map((r) => r.pm)), [planRows]);
  /** 동일 시트에 사업부 값이 2종 이상일 때만 필터 노출. 표의 사업부 컬럼은 항상 표시(공통 양식). */
  const showDivisionFilter = divisionOptions.length > 1;

  const ledgerDivisionOptions = useMemo(() => uniqSorted(ledgerRows.map((r) => r.division)), [ledgerRows]);
  const ledgerMonthOptions = useMemo(() => {
    const set = new Set<number>();
    for (const r of ledgerRows) if (typeof r.month === 'number') set.add(r.month);
    return Array.from(set)
      .sort((a, b) => a - b)
      .map((m) => `${m}월`);
  }, [ledgerRows]);

  const filteredPlan = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // 표준 양식 충실 표시를 위해 원본(엑셀) 행 순서 유지 — 필터만 적용
    return planRows.filter((r) => {
      if (showDivisionFilter && fDivision !== 'all' && r.division !== fDivision) return false;
      if (fCategory !== 'all' && r.category !== fCategory) return false;
      if (fStage !== 'all' && r.stage !== fStage) return false;
      if (fPm !== 'all' && r.pm !== fPm) return false;
      if (needle) {
        const hay = `${r.name} ${r.client} ${r.pjCode} ${r.pm}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [planRows, q, fDivision, fCategory, fStage, fPm, showDivisionFilter]);

  const filteredLedger = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ledgerRows.filter((r) => {
      if (fDivision !== 'all' && r.division !== fDivision) return false;
      if (fMonth !== 'all' && `${r.month}월` !== fMonth) return false;
      if (needle) {
        const hay = `${r.project} ${r.client} ${r.summary} ${r.pjCode}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [ledgerRows, q, fDivision, fMonth]);

  const planSummary = useMemo(() => summarizePlan(filteredPlan), [filteredPlan]);
  const ledgerSummary = useMemo(() => summarizeLedger(filteredLedger), [filteredLedger]);

  const sheetTabs: { key: string; label: string }[] = [
    ...data.planSheetNames.map((n) => ({ key: n, label: n })),
    ...(data.ledgerRows.length ? [{ key: LEDGER_KEY, label: `매출장 (${data.ledgerRows.length})` }] : []),
  ];

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
      {/* 헤더 */}
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-xl font-bold text-[var(--color-ink)]">
          <TrendingUp size={22} className="text-indigo-600" /> 영업 아웃룩
        </h1>
        <p className="mt-0.5 text-xs text-slate-500">
          <FileSpreadsheet size={12} className="mr-1 inline" />
          기준 자료: {data.fileName} · 계획 탭은 엑셀과 같은 공통 표가 항상 보이며, 매출장도 표가 기본입니다. 상단 탭으로
          시트(전체·사업부·당초 등)를 바꿉니다.
        </p>
      </div>

      {/* 시트 탭 */}
      <div className="mb-4 flex flex-wrap gap-1.5 border-b border-[var(--color-line)] pb-2">
        {sheetTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveSheet(t.key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              activeSheet === t.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLedger ? (
        <LedgerView
          rows={filteredLedger}
          summary={ledgerSummary}
          q={q}
          setQ={setQ}
          fDivision={fDivision}
          setFDivision={setFDivision}
          fMonth={fMonth}
          setFMonth={setFMonth}
          divisionOptions={ledgerDivisionOptions}
          monthOptions={ledgerMonthOptions}
        />
      ) : (
        <>
          {/* 요약 카드 */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="건수" value={`${planSummary.count.toLocaleString('ko-KR')}건`} />
            <StatCard
              label="예상수주금액 합계"
              value={formatKRWCompact(planSummary.totalExpected)}
              hint={formatKRW(planSummary.totalExpected)}
            />
            <StatCard label="사업예산 합계" value={formatKRWCompact(planSummary.totalBudget)} hint={formatKRW(planSummary.totalBudget)} />
            <div className="card px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">구분별</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {planSummary.byCategory.map((c) => (
                  <span
                    key={c.key}
                    className={cn('rounded border px-1.5 py-0.5 text-[11px] font-medium', catBadgeClass(c.key))}
                    title={formatKRW(c.expected)}
                  >
                    {c.key} {c.count}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 사업부별 현황(필터 반영·2개 이상 사업부일 때만) */}
          {planSummary.byDivision.length > 1 && (
            <div className="mb-4 overflow-x-auto rounded-xl border border-[var(--color-line)] bg-white">
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                사업부별 현황 (건수·예상수주금액)
              </div>
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-xs text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 text-left font-medium">사업부</th>
                    <th className="px-3 py-2 text-right font-medium">건수</th>
                    <th className="px-3 py-2 text-right font-medium">예상수주금액</th>
                  </tr>
                </thead>
                <tbody>
                  {planSummary.byDivision.map((d) => (
                    <tr key={d.key} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-1.5 font-medium text-[var(--color-ink)]">{d.key}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{d.count.toLocaleString('ko-KR')}</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-indigo-700" title={formatKRW(d.expected)}>
                        {formatKRW(d.expected)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 필터 바 */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="사업명·발주처·PM·PJ코드 검색"
                className="h-9 w-60 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            {showDivisionFilter && <Select value={fDivision} onChange={setFDivision} options={divisionOptions} allLabel="전체 사업부" />}
            <Select value={fCategory} onChange={setFCategory} options={categoryOptions} allLabel="전체 구분" />
            <Select value={fStage} onChange={setFStage} options={stageOptions} allLabel="전체 단계" />
            <Select value={fPm} onChange={setFPm} options={pmOptions} allLabel="전체 PM" />
            <div className="ml-auto flex items-center gap-3">
              <span className="text-sm text-slate-500">
                <b className="text-[var(--color-ink)]">{filteredPlan.length.toLocaleString('ko-KR')}</b>건 · 예상수주{' '}
                <b className="text-indigo-700">{formatKRW(planSummary.totalExpected)}</b>
              </span>
            </div>
          </div>

          <SalesOutlookStandardTable columns={data.planColumnsBySheet[activeSheet] ?? []} rows={filteredPlan} />
          <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <summary className="cursor-pointer select-none text-sm font-medium text-slate-600">요약 차트 보기</summary>
            <div className="mt-3">
              <PlanCharts rows={filteredPlan} />
            </div>
          </details>
        </>
      )}
    </div>
  );
}

const Th = ({
  children,
  className,
  onClick,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  title?: string;
}) => (
  <th
    onClick={onClick}
    title={title}
    className={cn(
      'whitespace-nowrap px-3 py-2 text-left font-medium',
      onClick && 'cursor-pointer select-none hover:text-[var(--color-ink)]',
      className,
    )}
  >
    {children}
  </th>
);

const Td = ({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) => (
  <td title={title} className={cn('px-3 py-1.5 align-middle', className)}>
    {children}
  </td>
);

function LedgerView({
  rows,
  summary,
  q,
  setQ,
  fDivision,
  setFDivision,
  fMonth,
  setFMonth,
  divisionOptions,
  monthOptions,
}: {
  rows: LedgerRow[];
  summary: ReturnType<typeof summarizeLedger>;
  q: string;
  setQ: (v: string) => void;
  fDivision: string;
  setFDivision: (v: string) => void;
  fMonth: string;
  setFMonth: (v: string) => void;
  divisionOptions: string[];
  monthOptions: string[];
}) {
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="건수" value={`${summary.count.toLocaleString('ko-KR')}건`} />
        <StatCard label="공급가액 합계" value={formatKRWCompact(summary.totalSupply)} hint={formatKRW(summary.totalSupply)} />
        <StatCard label="세액 합계" value={formatKRWCompact(summary.totalTax)} hint={formatKRW(summary.totalTax)} />
        <StatCard label="합계(공급가+세액)" value={formatKRWCompact(summary.totalAmount)} hint={formatKRW(summary.totalAmount)} />
      </div>

      {summary.byMonth.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {summary.byMonth.map((m) => (
            <span
              key={m.key}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
              title={formatKRW(m.total)}
            >
              {m.key} <b className="text-[var(--color-ink)]">{formatKRWCompact(m.total)}</b>
            </span>
          ))}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="프로젝트·거래처·적요 검색"
            className="h-9 w-60 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        {divisionOptions.length > 1 && (
          <Select value={fDivision} onChange={setFDivision} options={divisionOptions} allLabel="전체 사업부" />
        )}
        {monthOptions.length > 1 && <Select value={fMonth} onChange={setFMonth} options={monthOptions} allLabel="전체 월" />}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-slate-500">
            <b className="text-[var(--color-ink)]">{rows.length.toLocaleString('ko-KR')}</b>건 · 합계{' '}
            <b className="text-indigo-700">{formatKRW(summary.totalAmount)}</b>
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--color-line)] bg-white">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
            <tr className="border-b border-slate-200">
              <Th>발생일자</Th>
              <Th>월</Th>
              <Th>사업부</Th>
              <Th>PJ코드</Th>
              <Th>프로젝트</Th>
              <Th>거래처명</Th>
              <Th>적요</Th>
              <Th>세무구분</Th>
              <Th className="text-right">공급가액</Th>
              <Th className="text-right">세액</Th>
              <Th className="text-right">합계</Th>
              <Th>전송상태</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-10 text-center text-sm text-slate-400">
                  조건에 맞는 항목이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={`${r.pjCode}-${i}`} className="border-b border-slate-100 hover:bg-indigo-50/40">
                  <Td className="whitespace-nowrap text-xs text-slate-500">{r.date}</Td>
                  <Td className="whitespace-nowrap text-slate-500">{r.month != null ? `${r.month}월` : ''}</Td>
                  <Td className="whitespace-nowrap text-slate-500">{r.division}</Td>
                  <Td className="whitespace-nowrap font-mono text-xs text-slate-500">{r.pjCode}</Td>
                  <Td className="max-w-[200px] truncate text-slate-600" title={r.project}>
                    {r.project}
                  </Td>
                  <Td className="max-w-[160px] truncate text-slate-600" title={r.client}>
                    {r.client}
                  </Td>
                  <Td className="max-w-[240px] truncate text-slate-500" title={r.summary}>
                    {r.summary}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-slate-500">{r.taxType}</Td>
                  <Td className={cn('whitespace-nowrap text-right tabular-nums', r.supply < 0 ? 'text-red-600' : 'text-slate-600')}>
                    {formatKRW(r.supply)}
                  </Td>
                  <Td className={cn('whitespace-nowrap text-right tabular-nums', r.tax < 0 ? 'text-red-600' : 'text-slate-500')}>
                    {formatKRW(r.tax)}
                  </Td>
                  <Td
                    className={cn(
                      'whitespace-nowrap text-right font-semibold tabular-nums',
                      r.total < 0 ? 'text-red-600' : 'text-indigo-700',
                    )}
                  >
                    {formatKRW(r.total)}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-slate-400">{r.ntsStatus}</Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
        <summary className="cursor-pointer select-none text-sm font-medium text-slate-600">요약 차트 보기</summary>
        <div className="mt-3">
          <LedgerCharts rows={rows} />
        </div>
      </details>
    </>
  );
}
