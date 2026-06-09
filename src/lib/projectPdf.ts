/**
 * 프로젝트 관련 PDF (DOM → html2canvas → jsPDF 가로 A4).
 * - 등록현황: 대시보드·등록 프로젝트 상세
 * - 관리 목록: 프로젝트 관리 화면(조직도 순·섹션 행)
 */

import type { OrgMember, OrgNode } from '../data/organization';
import type { Project } from '../types';
import { formatProjectDisplayName } from './projectKind';
import { resolveProjectOwnerDisplayName } from './projectPmDisplay';
import { buildOrgChartProjectListBlocks, type OrgChartGroupBranch } from './projectListOrgGrouping';
import { formatPercent1, formatNum1, formatNum2 } from './utils';
import { formatProjectPeriodRange } from './projectPeriod';

// ─── 공통 ─────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatReportTimestamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function safeFileNamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

function renderPdfToCanvas(root: HTMLElement, windowWidth: number) {
  return import('html2canvas').then(({ default: html2canvas }) =>
    html2canvas(root, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth,
    }),
  );
}

function saveCanvasToLandscapePdf(canvas: HTMLCanvasElement, fileBase: string) {
  return import('jspdf').then(({ jsPDF }) => {
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const pageInnerH = pdfHeight - margin * 2;
    const imgWidth = pdfWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let y = margin;

    pdf.addImage(imgData, 'PNG', margin, y, imgWidth, imgHeight);
    heightLeft -= pageInnerH;

    while (heightLeft >= 0) {
      y = margin + (heightLeft - imgHeight);
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, y, imgWidth, imgHeight);
      heightLeft -= pageInnerH;
    }

    const stamp = formatReportTimestamp(new Date()).replace(/[: ]/g, '-');
    pdf.save(`${safeFileNamePart(fileBase)}_${stamp}.pdf`);
  });
}

// ─── 프로젝트 관리 화면 PDF ─────────────────────────────────────────────

export type ProjectManagementPdfEntry =
  | { kind: 'section'; label: string }
  | {
      kind: 'row';
      seq: number;
      projectName: string;
      pm: string;
      po: string;
      start: string;
      end: string;
      tasks: number;
      inputLabel: string;
      planned: string;
      progress: string;
    };

function addManagementPdfTableToRoot(root: HTMLElement, reportTitle: string, entries: ProjectManagementPdfEntry[]) {
  const title = document.createElement('h1');
  title.textContent = reportTitle;
  title.style.margin = '0 0 8px';
  title.style.fontSize = '18px';
  title.style.fontWeight = '700';
  root.appendChild(title);

  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.fontSize = '10px';
  table.style.tableLayout = 'fixed';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const headers = ['순번', '프로젝트명', 'PM', 'PO', '시작일', '종료일', '작업수', '투입(M/M·M/D)', '계획율', '진척율'];
  const widths = ['5%', '24%', '9%', '9%', '8%', '8%', '7%', '8%', '7%', '7%'];
  headers.forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    th.style.width = widths[i]!;
    th.style.textAlign = i === 0 || i >= 6 ? 'center' : 'left';
    th.style.padding = '8px 4px';
    th.style.borderBottom = '2px solid #d6d3d1';
    th.style.background = '#f5f5f4';
    th.style.fontWeight = '600';
    th.style.color = '#44403c';
    th.style.wordBreak = 'break-word';
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const e of entries) {
    if (e.kind === 'section') {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 10;
      td.textContent = e.label;
      td.style.padding = '8px 6px';
      td.style.fontWeight = '700';
      td.style.fontSize = '11px';
      td.style.background = '#ecfdf5';
      td.style.color = '#134e4a';
      td.style.borderBottom = '1px solid #99f6e4';
      td.style.wordBreak = 'break-word';
      tr.appendChild(td);
      tbody.appendChild(tr);
      continue;
    }
    const tr = document.createElement('tr');
    const cells = [String(e.seq), e.projectName, e.pm, e.po, e.start, e.end, String(e.tasks), e.inputLabel, e.planned, e.progress];
    const aligns: Array<'left' | 'center' | 'right'> = [
      'center',
      'left',
      'left',
      'left',
      'center',
      'center',
      'center',
      'right',
      'center',
      'center',
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      td.style.textAlign = aligns[i]!;
      td.style.padding = '6px 4px';
      td.style.borderBottom = '1px solid #e7e5e4';
      td.style.verticalAlign = 'top';
      td.style.wordBreak = 'break-word';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);
}

const MANAGEMENT_PDF_WINDOW_WIDTH = 1100;

export async function downloadProjectManagementPdfReport(options: {
  entries: ProjectManagementPdfEntry[];
  reportTitle?: string;
  subtitleLines?: string[];
  fileNamePrefix?: string;
}): Promise<void> {
  const { entries, reportTitle = '프로젝트 목록', subtitleLines = [], fileNamePrefix = '프로젝트목록' } = options;

  const root = document.createElement('div');
  root.setAttribute('data-pdf-export-root', '1');
  root.style.boxSizing = 'border-box';
  root.style.position = 'fixed';
  root.style.left = '-12000px';
  root.style.top = '0';
  root.style.width = `${MANAGEMENT_PDF_WINDOW_WIDTH}px`;
  root.style.padding = '20px 24px 28px';
  root.style.backgroundColor = '#ffffff';
  root.style.color = '#1c1917';
  root.style.fontFamily = 'system-ui, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

  const meta = document.createElement('p');
  meta.textContent = `발행: ${formatReportTimestamp(new Date())}`;
  meta.style.margin = '0 0 8px';
  meta.style.fontSize = '11px';
  meta.style.color = '#57534e';
  root.appendChild(meta);

  for (const line of subtitleLines) {
    if (!line.trim()) continue;
    const p = document.createElement('p');
    p.textContent = line;
    p.style.margin = '0 0 4px';
    p.style.fontSize = '10px';
    p.style.color = '#78716c';
    root.appendChild(p);
  }

  const note = document.createElement('p');
  note.textContent =
    '진척율·계획율은 대시보드와 동일하게 WBS 1레벨(없으면 리프) 가중 평균으로 집계했습니다. 투입은 프로젝트 투입·작업 담당 기준 공수 합입니다.';
  note.style.margin = '10px 0 14px';
  note.style.fontSize = '10px';
  note.style.color = '#57534e';
  root.appendChild(note);

  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = '보낼 프로젝트가 없습니다.';
    empty.style.padding = '16px';
    empty.style.color = '#78716c';
    root.appendChild(empty);
  } else {
    addManagementPdfTableToRoot(root, reportTitle, entries);
  }

  document.body.appendChild(root);

  try {
    const canvas = await renderPdfToCanvas(root, MANAGEMENT_PDF_WINDOW_WIDTH);
    await saveCanvasToLandscapePdf(canvas, fileNamePrefix);
  } finally {
    document.body.removeChild(root);
  }
}

// ─── 프로젝트 등록현황 PDF ────────────────────────────────────────────

export type ProjectRegistrationPdfRow = Project & {
  stats: {
    total: number;
    progress: number;
    assigneeCount: number;
    planned?: number;
    variance?: number;
    inputManDays?: number;
    issueCount?: number;
    actionCount?: number;
    overdueCount?: number;
  };
};

function sortRegistrationRowsByNameKo(a: ProjectRegistrationPdfRow, b: ProjectRegistrationPdfRow): number {
  const c = (a.name ?? '').localeCompare(b.name ?? '', 'ko');
  if (c !== 0) return c;
  return (a.id ?? '').localeCompare(b.id ?? '', 'ko');
}

/** 사업부 브랜치에 속한 모든 프로젝트(리프 수집) */
function collectProjectsFromOrgBranch(branch: OrgChartGroupBranch): Project[] {
  const list: Project[] = [...branch.projects];
  for (const c of branch.children) list.push(...collectProjectsFromOrgBranch(c));
  return list;
}

function truncateCell(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return '—';
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function formatAssignmentsCell(project: Project): string {
  const list = project.assignments ?? [];
  if (list.length === 0) return '—';
  const names = list.map((a) => (a.assignee || '').trim()).filter(Boolean);
  if (names.length === 0) return `${list.length}명`;
  return truncateCell(names.join(', '), 72);
}

function formatOwnerCell(project: Project, profileMap?: Readonly<Record<string, string>>): string {
  const s = resolveProjectOwnerDisplayName(project, profileMap);
  return s.trim() ? s : '—';
}

const REGISTRATION_PDF_WINDOW_WIDTH = 1500;

/** 대시보드 전체현황·사업부별 진척/계획 요약 (PDF 상단 표) */
export interface DashboardPdfSummary {
  totalProjects: number;
  totalTasks: number;
  memberCount: number;
  overallProgress: number;
  overallPlanned: number;
  divisions: { name: string; projectCount: number; taskTotal: number; progress: number; planned: number }[];
}

/** 대시보드 전체현황 + 사업부별 진척·계획 요약 블록(등록현황 PDF 상단용). */
function buildDashboardSummaryBlock(summary: DashboardPdfSummary): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.margin = '12px auto 6px';
  wrap.style.maxWidth = '760px';
  wrap.style.textAlign = 'center';

  const h = document.createElement('div');
  h.textContent = '전체현황';
  h.style.fontSize = '13px';
  h.style.fontWeight = '700';
  h.style.color = '#1c1917';
  h.style.margin = '0 0 4px';
  wrap.appendChild(h);

  const kpi = document.createElement('p');
  kpi.textContent = `프로젝트 ${summary.totalProjects} · 작업 ${summary.totalTasks} · 회원 ${summary.memberCount}`;
  kpi.style.margin = '0 0 2px';
  kpi.style.fontSize = '11px';
  kpi.style.color = '#292524';
  wrap.appendChild(kpi);

  const prog = document.createElement('p');
  prog.textContent = `전체 진척 ${formatPercent1(summary.overallProgress)}% · 계획 ${formatPercent1(summary.overallPlanned)}%`;
  prog.style.margin = '0 0 10px';
  prog.style.fontSize = '11px';
  prog.style.fontWeight = '600';
  prog.style.color = '#1c1917';
  wrap.appendChild(prog);

  if (summary.divisions.length > 0) {
    const dh = document.createElement('div');
    dh.textContent = '사업부별 진척·계획';
    dh.style.fontSize = '12px';
    dh.style.fontWeight = '700';
    dh.style.color = '#1c1917';
    dh.style.margin = '0 0 4px';
    wrap.appendChild(dh);

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '9px';
    table.style.tableLayout = 'fixed';

    const colMeta: { label: string; width: string; align: 'left' | 'right' }[] = [
      { label: '사업부', width: '40%', align: 'left' },
      { label: '프로젝트', width: '15%', align: 'right' },
      { label: 'Task', width: '15%', align: 'right' },
      { label: '진척%', width: '15%', align: 'right' },
      { label: '계획%', width: '15%', align: 'right' },
    ];

    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    for (const c of colMeta) {
      const th = document.createElement('th');
      th.textContent = c.label;
      th.style.width = c.width;
      th.style.textAlign = c.align;
      th.style.padding = '5px 4px';
      th.style.borderBottom = '2px solid #d6d3d1';
      th.style.background = '#f5f5f4';
      th.style.fontWeight = '600';
      th.style.color = '#44403c';
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const d of summary.divisions) {
      const tr = document.createElement('tr');
      const values = [
        d.name,
        String(d.projectCount),
        String(d.taskTotal),
        `${formatPercent1(d.progress)}%`,
        `${formatPercent1(d.planned)}%`,
      ];
      for (let i = 0; i < values.length; i++) {
        const td = document.createElement('td');
        td.textContent = values[i]!;
        td.style.padding = '4px';
        td.style.borderBottom = '1px solid #e7e5e4';
        td.style.textAlign = colMeta[i]!.align;
        td.style.color = '#292524';
        if (i === 0) td.style.wordBreak = 'break-word';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  const divider = document.createElement('div');
  divider.style.borderTop = '1px solid #d6d3d1';
  divider.style.margin = '12px 0 2px';
  wrap.appendChild(divider);

  return wrap;
}

export async function downloadProjectRegistrationPdfReport(options: {
  rows: ProjectRegistrationPdfRow[];
  subtitleLines?: string[];
  fileNamePrefix?: string;
  profileMap?: Readonly<Record<string, string>>;
  /** 조직도가 있으면 최상위 사업부별로 표를 나눕니다. */
  orgTree?: OrgNode;
  orgMembers?: OrgMember[];
  ownerDepartmentByUserId?: Record<string, string | null | undefined>;
  /** 대시보드 전체현황·사업부 요약 (있으면 표 상단에 추가) */
  dashboardSummary?: DashboardPdfSummary;
}): Promise<void> {
  const {
    rows,
    subtitleLines = [],
    fileNamePrefix = '프로젝트등록현황',
    profileMap,
    orgTree,
    orgMembers,
    ownerDepartmentByUserId,
    dashboardSummary,
  } = options;

  const rowById = new Map(rows.map((r) => [r.id, r] as const));
  const sections: { title: string; sectionRows: ProjectRegistrationPdfRow[] }[] = [];

  if (orgTree && orgMembers && orgMembers.length > 0) {
    const { blocks, unmapped } = buildOrgChartProjectListBlocks(rows, orgTree, orgMembers, ownerDepartmentByUserId);
    for (const block of blocks) {
      if (block.totalInBlock === 0) continue;
      const projectsHere = collectProjectsFromOrgBranch(block.branch);
      const sectionRows = projectsHere
        .map((p) => rowById.get(p.id))
        .filter((x): x is ProjectRegistrationPdfRow => Boolean(x))
        .sort(sortRegistrationRowsByNameKo);
      if (sectionRows.length > 0) sections.push({ title: block.division.name || '사업부', sectionRows });
    }
    if (unmapped.length > 0) {
      const sectionRows = unmapped
        .map((p) => rowById.get(p.id))
        .filter((x): x is ProjectRegistrationPdfRow => Boolean(x))
        .sort(sortRegistrationRowsByNameKo);
      if (sectionRows.length > 0) sections.push({ title: '조직 미매칭', sectionRows });
    }
  }

  if (sections.length === 0) {
    sections.push({
      title: '전체',
      sectionRows: [...rows].sort(sortRegistrationRowsByNameKo),
    });
  }

  const root = document.createElement('div');
  root.setAttribute('data-pdf-export-root', '1');
  root.style.boxSizing = 'border-box';
  root.style.position = 'fixed';
  root.style.left = '-12000px';
  root.style.top = '0';
  root.style.width = `${REGISTRATION_PDF_WINDOW_WIDTH}px`;
  root.style.padding = '20px 24px 28px';
  root.style.backgroundColor = '#ffffff';
  root.style.color = '#1c1917';
  root.style.fontFamily = 'system-ui, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  root.style.fontSize = '13px';
  root.style.lineHeight = '1.45';
  root.style.textAlign = 'center';

  const title = document.createElement('h1');
  title.textContent = '프로젝트 등록현황';
  title.style.margin = '0 0 8px';
  title.style.fontSize = '20px';
  title.style.fontWeight = '700';
  title.style.textAlign = 'center';
  root.appendChild(title);

  const meta = document.createElement('p');
  meta.textContent = `발행: ${formatReportTimestamp(new Date())}`;
  meta.style.margin = '0 0 6px';
  meta.style.fontSize = '11px';
  meta.style.color = '#57534e';
  meta.style.textAlign = 'center';
  root.appendChild(meta);

  for (const line of subtitleLines) {
    if (!line.trim()) continue;
    const p = document.createElement('p');
    p.textContent = line;
    p.style.margin = '0 0 4px';
    p.style.fontSize = '10px';
    p.style.color = '#78716c';
    p.style.textAlign = 'center';
    root.appendChild(p);
  }

  if (dashboardSummary) {
    root.appendChild(buildDashboardSummaryBlock(dashboardSummary));
  }

  const note = document.createElement('p');
  note.textContent =
    '프로젝트 단위 등록 정보·집계입니다. WBS 개별 작업 목록은 제외합니다. 진척·계획은 대시보드와 동일(1레벨·없으면 리프 가중). ' +
    '사업부 구분은 조직도·PM(또는 소유자 부서) 매칭 기준과 대시보드 등록 프로젝트 목록과 같습니다. 순번은 사업부(구간)마다 1부터입니다.';
  note.style.margin = '10px 0 12px';
  note.style.fontSize = '10px';
  note.style.color = '#57534e';
  note.style.textAlign = 'center';
  root.appendChild(note);

  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.fontSize = '9px';
  table.style.tableLayout = 'fixed';
  table.style.marginLeft = 'auto';
  table.style.marginRight = 'auto';

  const headers = ['순번', '프로젝트', '기간', 'PM', 'PO', '작업', '진척%', '계획%', '편차%p', 'WBS공수(M/D)', '투입(명단)', '만든 사람'];
  const colWidths = ['4%', '19%', '10%', '8%', '8%', '5%', '6%', '6%', '5%', '7%', '14%', '8%'];

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (let i = 0; i < headers.length; i++) {
    const th = document.createElement('th');
    th.textContent = headers[i]!;
    th.style.width = colWidths[i]!;
    th.style.textAlign = 'center';
    th.style.padding = '7px 3px';
    th.style.borderBottom = '2px solid #d6d3d1';
    th.style.background = '#f5f5f4';
    th.style.fontWeight = '600';
    th.style.color = '#44403c';
    th.style.wordBreak = 'break-word';
    th.style.verticalAlign = 'middle';
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const colCount = headers.length;

  const appendSectionHeader = (sectionTitle: string) => {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colCount;
    td.textContent = sectionTitle;
    td.style.padding = '8px 6px';
    td.style.fontWeight = '700';
    td.style.fontSize = '11px';
    td.style.background = '#ecfdf5';
    td.style.color = '#134e4a';
    td.style.borderBottom = '1px solid #99f6e4';
    td.style.textAlign = 'center';
    td.style.wordBreak = 'break-word';
    tr.appendChild(td);
    tbody.appendChild(tr);
  };

  const appendDataRow = (p: ProjectRegistrationPdfRow, seq: number) => {
    const st = p.stats;
    const planned = typeof st.planned === 'number' && Number.isFinite(st.planned) ? st.planned : 0;
    const variance = typeof st.variance === 'number' && Number.isFinite(st.variance) ? st.variance : 0;
    const inputMd = typeof st.inputManDays === 'number' && Number.isFinite(st.inputManDays) ? st.inputManDays : 0;

    const period = formatProjectPeriodRange(p.startDate, p.endDate);
    const varianceStr = `${variance > 0 ? '+' : ''}${formatNum1(variance)}`;
    const inputStr = inputMd > 0 ? formatNum2(inputMd) : '—';

    const cells: string[] = [
      String(seq),
      formatProjectDisplayName(p.name, p.projectKind),
      period,
      truncateCell(p.pmName ?? '', 18),
      truncateCell(p.poName ?? '', 18),
      String(st.total),
      `${formatPercent1(st.progress)}%`,
      `${formatPercent1(planned)}%`,
      varianceStr,
      inputStr,
      formatAssignmentsCell(p),
      formatOwnerCell(p, profileMap),
    ];

    const tr = document.createElement('tr');
    for (let i = 0; i < cells.length; i++) {
      const td = document.createElement('td');
      td.textContent = cells[i]!;
      td.style.textAlign = 'center';
      td.style.padding = '5px 3px';
      td.style.borderBottom = '1px solid #e7e5e4';
      td.style.verticalAlign = 'middle';
      td.style.wordBreak = 'break-word';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  };

  let totalDataRows = 0;
  for (const sec of sections) {
    if (sec.sectionRows.length === 0) continue;
    appendSectionHeader(`【 ${sec.title} 】`);
    sec.sectionRows.forEach((p, i) => {
      appendDataRow(p, i + 1);
      totalDataRows++;
    });
  }

  if (rows.length === 0 || totalDataRows === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colCount;
    td.textContent = '표시할 프로젝트가 없습니다.';
    td.style.padding = '20px 8px';
    td.style.textAlign = 'center';
    td.style.color = '#78716c';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);

  document.body.appendChild(root);

  try {
    const canvas = await renderPdfToCanvas(root, REGISTRATION_PDF_WINDOW_WIDTH);
    await saveCanvasToLandscapePdf(canvas, fileNamePrefix);
  } finally {
    document.body.removeChild(root);
  }
}
