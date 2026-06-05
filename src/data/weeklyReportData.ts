import rawHtml from './weeklyReport.html?raw';
import type { WeeklyReportContent } from '../lib/db/weeklyReports';

/**
 * 기존(빌드 시 Word→주입) 주간보고 REPORTS 데이터를 React에서 읽어,
 * "기존 양식·데이터에서 일부 수정해 등록"하는 작성 폼의 초기값으로 사용한다.
 * weeklyReport.html 의 @@REPORTS_START@@ ~ @@REPORTS_END@@ 센티넬 사이 REPORTS 배열
 * 구간은 gen 스크립트가 json.dumps로 채우므로 유효한 JSON → 그대로 파싱한다.
 */

type Bullet = string | { t?: string; sub?: unknown[] };

export type ExistingProject = {
  name?: string;
  type?: string;
  period?: string;
  po?: string;
  pm?: string;
  prog?: { actual?: number; plan?: number; text?: string } | null;
  content?: unknown;
  issue?: unknown;
  note?: string;
};
export type ExistingReport = {
  id: string;
  group?: string;
  icon?: string;
  org?: string;
  reporter?: string;
  recipient?: string;
  projects?: ExistingProject[];
  issues?: { title?: string; content?: unknown; plan?: unknown; result?: unknown; note?: string }[];
  strategy?: { div?: string; content?: unknown; start?: string; plan?: unknown; action?: unknown }[];
  sales?: { project?: string; content?: unknown }[];
  research?: { name?: string; org?: string; period?: string; lead?: string; fund?: string; exec?: number }[];
  nextWeek?: unknown[];
};

const START = '/* @@REPORTS_START@@ */';
const END = '/* @@REPORTS_END@@ */';

function parseReports(): ExistingReport[] {
  const s = rawHtml.indexOf(START);
  const e = rawHtml.indexOf(END);
  if (s < 0 || e < 0) return [];
  const block = rawHtml.slice(s + START.length, e);
  const lb = block.indexOf('[');
  const rb = block.lastIndexOf(']');
  if (lb < 0 || rb < 0) return [];
  try {
    const arr = JSON.parse(block.slice(lb, rb + 1));
    return Array.isArray(arr) ? (arr as ExistingReport[]) : [];
  } catch {
    return [];
  }
}

let cache: ExistingReport[] | null = null;
/** 기존 주간보고(조직별) 전체 */
export function getExistingWeeklyReports(): ExistingReport[] {
  if (!cache) cache = parseReports();
  return cache;
}

/** 중첩 불릿(string | {t,sub[]}) 배열을 들여쓰기 텍스트로 직렬화 */
function bulletsToText(items: unknown, indent = ''): string {
  if (items == null) return '';
  if (typeof items === 'string') return indent + items;
  if (!Array.isArray(items)) return '';
  const lines: string[] = [];
  for (const it of items as Bullet[]) {
    if (typeof it === 'string') {
      if (it.trim()) lines.push(indent + it);
    } else if (it && typeof it === 'object') {
      const o = it as { t?: string; sub?: unknown[] };
      if (o.t && o.t.trim()) lines.push(indent + o.t);
      if (Array.isArray(o.sub) && o.sub.length) lines.push(bulletsToText(o.sub, indent + '  - '));
    }
  }
  return lines.filter(Boolean).join('\n');
}

function progParts(prog: ExistingProject['prog']): { actual: string; plan: string } {
  if (!prog || typeof prog !== 'object') return { actual: '', plan: '' };
  const actual = prog.actual != null ? String(prog.actual) : prog.text != null ? String(prog.text) : '';
  const plan = prog.plan != null ? String(prog.plan) : '';
  return { actual, plan };
}

/** 기존 보고 1건 → 작성 폼 초기값(조직·보고자·본문) */
export function mapExistingReportToForm(r: ExistingReport): {
  organization: string;
  reporter: string;
  content: WeeklyReportContent;
} {
  const projects = (Array.isArray(r.projects) ? r.projects : []).map((p) => {
    const { actual, plan } = progParts(p.prog);
    const note = [p.type ? `구분: ${p.type}` : '', p.po && p.po !== p.pm ? `PO: ${p.po}` : '', p.note ?? ''].filter(Boolean).join(' · ');
    return {
      name: p.name ?? '',
      period: p.period ?? '',
      owner: p.pm || p.po || '',
      planPct: plan,
      actualPct: actual,
      content: bulletsToText(p.content),
      issue: typeof p.issue === 'string' ? p.issue : bulletsToText(p.issue),
      note,
    };
  });

  const issues = (Array.isArray(r.issues) ? r.issues : []).map((it) => ({
    title: it.title ?? '',
    content: bulletsToText(it.content),
    plan: bulletsToText(it.plan),
    result: typeof it.result === 'string' ? it.result : bulletsToText(it.result),
    note: it.note ?? '',
  }));

  const nextWeek = (Array.isArray(r.nextWeek) ? r.nextWeek : [])
    .flatMap((x) => (typeof x === 'string' ? [x] : bulletsToText([x]).split('\n')))
    .map((s) => s.trim())
    .filter(Boolean);

  // 구조화 폼에 없는 섹션(전략회의·영업·연구)은 '기타'에 라벨과 함께 보존
  const etcParts: string[] = [];
  if (Array.isArray(r.strategy) && r.strategy.length) {
    etcParts.push(
      '[전략회의]\n' +
        r.strategy
          .map((s) => `${s.div ? `(${s.div}) ` : ''}${bulletsToText(s.content)}`.trim())
          .filter(Boolean)
          .join('\n'),
    );
  }
  if (Array.isArray(r.sales) && r.sales.length) {
    etcParts.push('[영업]\n' + r.sales.map((s) => `${s.project ? `${s.project}: ` : ''}\n${bulletsToText(s.content)}`).join('\n'));
  }
  if (Array.isArray(r.research) && r.research.length) {
    etcParts.push(
      '[연구]\n' +
        r.research
          .map(
            (s) =>
              `${s.name ?? ''}${s.org ? ` (${s.org})` : ''}${s.period ? ` · ${s.period}` : ''}${s.lead ? ` · 책임 ${s.lead}` : ''}${
                s.exec != null ? ` · 진척 ${s.exec}%` : ''
              }`,
          )
          .join('\n'),
    );
  }

  return {
    organization: r.org ?? '',
    reporter: r.reporter ?? '',
    content: { projects, issues, nextWeek, etc: etcParts.join('\n\n') },
  };
}
