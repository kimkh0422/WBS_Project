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

/** PDF용 오프스크린 루트(흰 배경·고정 폭). 화면 밖에 잠시 붙여 html2canvas로 렌더한다. */
function createPdfRoot(widthPx: number): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('data-pdf-export-root', '1');
  root.style.boxSizing = 'border-box';
  root.style.position = 'fixed';
  root.style.left = '-12000px';
  root.style.top = '0';
  root.style.width = `${widthPx}px`;
  root.style.padding = '20px 24px 28px';
  root.style.backgroundColor = '#ffffff';
  root.style.color = '#1c1917';
  root.style.fontFamily = 'system-ui, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  return root;
}

/** 오프스크린 루트를 잠시 body에 붙여 캔버스로 렌더하고, 끝나면 정리한다. */
async function renderRootToCanvas(root: HTMLElement, windowWidth: number): Promise<HTMLCanvasElement> {
  document.body.appendChild(root);
  try {
    return await renderPdfToCanvas(root, windowWidth);
  } finally {
    document.body.removeChild(root);
  }
}

/** JPEG 품질(0~1). 텍스트·표 가독성과 용량 균형. */
const PDF_JPEG_QUALITY = 0.85;

/**
 * 여러 캔버스(섹션)를 가로 A4 PDF로 저장한다.
 * - 각 캔버스는 항상 "새 페이지"에서 시작 → 섹션(업무협조요청·전체현황·프로젝트 현황)별 페이지 분리.
 * - 한 섹션이 한 페이지보다 길면 자연스럽게 다음 페이지로 이어서 슬라이스한다.
 * - 페이지마다 "보이는 슬라이스"만 JPEG로 추가 → 무손실 PNG·전체 이미지 중복 임베드를 제거해 용량을 크게 줄인다.
 */
function saveCanvasesToLandscapePdf(canvases: HTMLCanvasElement[], fileBase: string) {
  return import('jspdf').then(({ jsPDF }) => {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const pageInnerH = pdfHeight - margin * 2; // mm
    const imgWidth = pdfWidth - margin * 2; // mm

    // 한 번이라도 페이지에 그렸으면, 이후 슬라이스는 모두 새 페이지에 → 다음 섹션은 항상 새 페이지에서 시작.
    let hasContent = false;
    for (const canvas of canvases) {
      if (canvas.width <= 0 || canvas.height <= 0) continue;
      const pxPerMm = canvas.width / imgWidth; // 캔버스 픽셀 ↔ mm 환산
      const pageSlicePx = Math.max(1, Math.floor(pageInnerH * pxPerMm)); // 한 페이지에 담기는 원본 픽셀 높이
      const totalPages = Math.max(1, Math.ceil(canvas.height / pageSlicePx));
      for (let page = 0; page < totalPages; page++) {
        const srcY = page * pageSlicePx;
        const srcH = Math.min(pageSlicePx, canvas.height - srcY);
        if (srcH <= 0) break;

        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = srcH;
        const ctx = slice.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff'; // JPEG는 투명 미지원 → 흰 배경으로 채움
          ctx.fillRect(0, 0, slice.width, slice.height);
          ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
        }
        const sliceData = slice.toDataURL('image/jpeg', PDF_JPEG_QUALITY);
        const destH = srcH / pxPerMm; // 마지막 페이지는 내용 높이만큼만(빈 공간을 늘이지 않음)
        if (hasContent) pdf.addPage();
        pdf.addImage(sliceData, 'JPEG', margin, margin, imgWidth, destH);
        hasContent = true;
      }
    }

    // 페이지 번호 푸터(ASCII만 — 한글은 jsPDF 기본 폰트 미지원이라 이미지로만 렌더).
    const pageCount = pdf.getNumberOfPages();
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.text(`${i} / ${pageCount}`, pdfWidth - margin, pdfHeight - 3.5, { align: 'right' });
    }

    const stamp = formatReportTimestamp(new Date()).replace(/[: ]/g, '-');
    pdf.save(`${safeFileNamePart(fileBase)}_${stamp}.pdf`);
  });
}

/** 단일 캔버스를 가로 A4 PDF로 저장(슬라이스 페이징). */
function saveCanvasToLandscapePdf(canvas: HTMLCanvasElement, fileBase: string) {
  return saveCanvasesToLandscapePdf([canvas], fileBase);
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

/** PDF에 포함할 협조 요청 행(요약). Dashboard 화면의 협조 요청 섹션과 동일한 핵심 컬럼만 추출. */
export interface CooperationRequestPdfRow {
  mgmtId: string;
  title: string;
  requester: string;
  assignee: string;
  requestDate: string;
  dueDate: string;
  status: string;
  priority: string;
  /** 0~1 진척률 */
  progress: number;
}

// ─── 보고서 공통 UI(틸 톤 팔레트·섹션 배너·KPI 카드·표 셀) ───────────────
const REPORT_TEAL = '#0f766e';
const REPORT_TEAL_DARK = '#134e4a';
const REPORT_TEAL_LINE = '#5eead4';
const REPORT_TEAL_BG = '#ecfdf5';
const REPORT_BORDER = '#e7e5e4';
const REPORT_ROW_LINE = '#eceae8';
const REPORT_ZEBRA = '#fafaf9';
const REPORT_TEXT = '#292524';
const REPORT_MUTED = '#78716c';

type ReportAlign = 'left' | 'right' | 'center';

/** 섹션 제목 배너(좌측 틸 액센트·연한 배경, 선택적 배지). */
function buildSectionBanner(label: string, badge?: string): HTMLElement {
  const b = document.createElement('div');
  b.style.display = 'flex';
  b.style.alignItems = 'center';
  b.style.background = REPORT_TEAL_BG;
  b.style.borderLeft = `5px solid ${REPORT_TEAL}`;
  b.style.borderRadius = '5px';
  b.style.padding = '9px 14px';
  b.style.margin = '2px 0 12px';

  const t = document.createElement('span');
  t.textContent = label;
  t.style.fontSize = '15px';
  t.style.fontWeight = '800';
  t.style.color = REPORT_TEAL_DARK;
  b.appendChild(t);

  if (badge) {
    const pill = document.createElement('span');
    pill.textContent = badge;
    pill.style.marginLeft = '8px';
    pill.style.fontSize = '11px';
    pill.style.fontWeight = '700';
    pill.style.color = REPORT_TEAL;
    pill.style.background = '#ffffff';
    pill.style.border = `1px solid ${REPORT_TEAL_LINE}`;
    pill.style.borderRadius = '999px';
    pill.style.padding = '2px 9px';
    b.appendChild(pill);
  }
  return b;
}

/** KPI 카드 한 줄(전체현황 상단 요약 수치). */
function buildKpiCardRow(items: { label: string; value: string; accent?: boolean }[]): HTMLElement {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '10px';
  row.style.margin = '0 0 16px';
  for (const it of items) {
    const card = document.createElement('div');
    card.style.flex = '1';
    card.style.boxSizing = 'border-box';
    card.style.border = `1px solid ${REPORT_BORDER}`;
    card.style.borderTop = `3px solid ${it.accent ? REPORT_TEAL : '#cbd5e1'}`;
    card.style.borderRadius = '8px';
    card.style.padding = '13px 10px';
    card.style.background = '#ffffff';
    card.style.textAlign = 'center';

    const v = document.createElement('div');
    v.textContent = it.value;
    v.style.fontSize = '23px';
    v.style.fontWeight = '800';
    v.style.lineHeight = '1.1';
    v.style.color = it.accent ? REPORT_TEAL : '#1c1917';
    card.appendChild(v);

    const l = document.createElement('div');
    l.textContent = it.label;
    l.style.fontSize = '11px';
    l.style.fontWeight = '600';
    l.style.color = REPORT_MUTED;
    l.style.marginTop = '5px';
    card.appendChild(l);

    row.appendChild(card);
  }
  return row;
}

/** 보고서 표 골격(고정 레이아웃·외곽선). */
function makeReportTable(fontSize: string): HTMLTableElement {
  const t = document.createElement('table');
  t.style.width = '100%';
  t.style.borderCollapse = 'collapse';
  t.style.tableLayout = 'fixed';
  t.style.fontSize = fontSize;
  t.style.border = `1px solid ${REPORT_BORDER}`;
  return t;
}

/** 보고서 표 헤더 셀(틸 톤). */
function makeReportHeadCell(label: string, width: string, align: ReportAlign): HTMLTableCellElement {
  const th = document.createElement('th');
  th.textContent = label;
  th.style.width = width;
  th.style.textAlign = align;
  th.style.padding = '8px 6px';
  th.style.background = REPORT_TEAL_BG;
  th.style.color = REPORT_TEAL_DARK;
  th.style.fontWeight = '700';
  th.style.borderBottom = `2px solid ${REPORT_TEAL_LINE}`;
  th.style.wordBreak = 'break-word';
  th.style.verticalAlign = 'middle';
  return th;
}

/** 보고서 표 본문 셀 스타일(짝수행 줄무늬). */
function styleReportBodyCell(td: HTMLTableCellElement, align: ReportAlign, zebra: boolean): void {
  td.style.padding = '7px 6px';
  td.style.borderBottom = `1px solid ${REPORT_ROW_LINE}`;
  td.style.textAlign = align;
  td.style.color = REPORT_TEXT;
  td.style.wordBreak = 'break-word';
  td.style.verticalAlign = 'middle';
  if (zebra) td.style.background = REPORT_ZEBRA;
}

/** 협조 요청 PDF 블록(표) 생성. 비어 있어도 빈 상태 문구를 함께 표시. */
function buildCooperationRequestsBlock(rows: CooperationRequestPdfRow[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.margin = '8px 0';
  wrap.style.textAlign = 'left';

  wrap.appendChild(buildSectionBanner('업무 협조 요청', `${rows.length}건`));

  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = '등록된 협조 요청이 없습니다.';
    empty.style.margin = '6px 2px';
    empty.style.fontSize = '12px';
    empty.style.color = REPORT_MUTED;
    wrap.appendChild(empty);
    return wrap;
  }

  const colMeta: { label: string; width: string; align: ReportAlign }[] = [
    { label: '관리ID', width: '8%', align: 'left' },
    { label: '제목', width: '30%', align: 'left' },
    { label: '요청자', width: '10%', align: 'left' },
    { label: '담당자', width: '14%', align: 'left' },
    { label: '요청일', width: '8%', align: 'center' },
    { label: '기한', width: '8%', align: 'center' },
    { label: '상태', width: '8%', align: 'center' },
    { label: '우선', width: '6%', align: 'center' },
    { label: '진척%', width: '8%', align: 'right' },
  ];

  const table = makeReportTable('11px');
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  for (const c of colMeta) hrow.appendChild(makeReportHeadCell(c.label, c.width, c.align));
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    const values = [
      r.mgmtId || '—',
      r.title || '—',
      r.requester || '—',
      r.assignee || '—',
      r.requestDate || '—',
      r.dueDate || '—',
      r.status || '—',
      r.priority || '—',
      `${formatPercent1(Math.max(0, Math.min(1, r.progress)) * 100)}%`,
    ];
    for (let i = 0; i < values.length; i++) {
      const td = document.createElement('td');
      td.textContent = values[i]!;
      styleReportBodyCell(td, colMeta[i]!.align, idx % 2 === 1);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

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
  wrap.style.margin = '8px 0';
  wrap.style.textAlign = 'left';

  wrap.appendChild(buildSectionBanner('전체현황'));

  wrap.appendChild(
    buildKpiCardRow([
      { label: '프로젝트', value: String(summary.totalProjects) },
      { label: '작업', value: String(summary.totalTasks) },
      { label: '회원', value: String(summary.memberCount) },
      { label: '전체 진척', value: `${formatPercent1(summary.overallProgress)}%`, accent: true },
      { label: '전체 계획', value: `${formatPercent1(summary.overallPlanned)}%`, accent: true },
    ]),
  );

  if (summary.divisions.length > 0) {
    const dh = document.createElement('div');
    dh.textContent = '사업부별 진척·계획';
    dh.style.fontSize = '13px';
    dh.style.fontWeight = '700';
    dh.style.color = REPORT_TEAL_DARK;
    dh.style.margin = '4px 2px 8px';
    wrap.appendChild(dh);

    const colMeta: { label: string; width: string; align: ReportAlign }[] = [
      { label: '사업부', width: '40%', align: 'left' },
      { label: '프로젝트', width: '15%', align: 'right' },
      { label: 'Task', width: '15%', align: 'right' },
      { label: '진척%', width: '15%', align: 'right' },
      { label: '계획%', width: '15%', align: 'right' },
    ];

    const table = makeReportTable('12px');
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    for (const c of colMeta) hrow.appendChild(makeReportHeadCell(c.label, c.width, c.align));
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    summary.divisions.forEach((d, idx) => {
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
        styleReportBodyCell(td, colMeta[i]!.align, idx % 2 === 1);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  return wrap;
}

/** 등록현황 PDF 각 섹션 페이지 상단 공통 헤더(제목·발행시각·부제). */
function appendRegistrationReportHeader(root: HTMLElement, opts: { issuedAt: string; subtitleLines?: string[] }): void {
  const band = document.createElement('div');
  band.style.borderBottom = `3px solid ${REPORT_TEAL}`;
  band.style.paddingBottom = '10px';
  band.style.marginBottom = '16px';

  const title = document.createElement('div');
  title.textContent = '프로젝트 등록현황';
  title.style.fontSize = '24px';
  title.style.fontWeight = '800';
  title.style.color = REPORT_TEAL;
  title.style.textAlign = 'center';
  title.style.letterSpacing = '1px';
  band.appendChild(title);

  const meta = document.createElement('div');
  meta.textContent = `발행일시  ${opts.issuedAt}`;
  meta.style.fontSize = '11px';
  meta.style.color = REPORT_MUTED;
  meta.style.textAlign = 'center';
  meta.style.marginTop = '5px';
  band.appendChild(meta);

  root.appendChild(band);

  for (const line of opts.subtitleLines ?? []) {
    if (!line.trim()) continue;
    const p = document.createElement('p');
    p.textContent = line;
    p.style.margin = '0 0 4px';
    p.style.fontSize = '11px';
    p.style.color = REPORT_MUTED;
    p.style.textAlign = 'center';
    root.appendChild(p);
  }
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
  /** 업무 협조 요청 목록 (있으면 표 상단에 추가) */
  cooperationRequests?: CooperationRequestPdfRow[];
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
    cooperationRequests,
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

  // 모든 섹션이 같은 발행 시각을 공유하도록 1회만 계산.
  const issuedAt = formatReportTimestamp(new Date());
  const canvases: HTMLCanvasElement[] = [];

  // 부제(필터·제외 안내)는 첫 섹션 페이지에만 1회 표시.
  let subtitleConsumed = false;
  const nextSubtitle = (): string[] | undefined => {
    if (subtitleConsumed) return undefined;
    subtitleConsumed = true;
    return subtitleLines;
  };

  const makeSectionRoot = (): HTMLElement => {
    const r = createPdfRoot(REGISTRATION_PDF_WINDOW_WIDTH);
    r.style.fontSize = '13px';
    r.style.lineHeight = '1.45';
    r.style.textAlign = 'center';
    return r;
  };

  // 1) 업무 협조 요청 — 별도 페이지(제공된 경우)
  if (cooperationRequests) {
    const coopRoot = makeSectionRoot();
    appendRegistrationReportHeader(coopRoot, { issuedAt, subtitleLines: nextSubtitle() });
    coopRoot.appendChild(buildCooperationRequestsBlock(cooperationRequests));
    canvases.push(await renderRootToCanvas(coopRoot, REGISTRATION_PDF_WINDOW_WIDTH));
  }

  // 2) 전체현황 — 별도 페이지(제공된 경우)
  if (dashboardSummary) {
    const summaryRoot = makeSectionRoot();
    appendRegistrationReportHeader(summaryRoot, { issuedAt, subtitleLines: nextSubtitle() });
    summaryRoot.appendChild(buildDashboardSummaryBlock(dashboardSummary));
    canvases.push(await renderRootToCanvas(summaryRoot, REGISTRATION_PDF_WINDOW_WIDTH));
  }

  // 3) 프로젝트 현황(표) — 별도 페이지(내용이 길면 다음 페이지로 이어짐)
  const root = makeSectionRoot();
  appendRegistrationReportHeader(root, { issuedAt, subtitleLines: nextSubtitle() });

  root.appendChild(buildSectionBanner('프로젝트 현황'));

  const note = document.createElement('p');
  note.textContent =
    '프로젝트 단위 등록 정보·집계입니다. WBS 개별 작업 목록은 제외합니다. 진척·계획은 대시보드와 동일(1레벨·없으면 리프 가중). ' +
    '사업부 구분은 조직도·PM(또는 소유자 부서) 매칭 기준과 대시보드 등록 프로젝트 목록과 같습니다. 순번은 사업부(구간)마다 1부터입니다.';
  note.style.margin = '0 2px 12px';
  note.style.fontSize = '10.5px';
  note.style.lineHeight = '1.55';
  note.style.color = REPORT_MUTED;
  note.style.textAlign = 'left';
  root.appendChild(note);

  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.fontSize = '9px';
  table.style.tableLayout = 'fixed';
  table.style.border = `1px solid ${REPORT_BORDER}`;

  const headers = ['순번', '프로젝트', '기간', 'PM', 'PO', '작업', '진척%', '계획%', '편차%p', 'WBS공수(M/D)', '투입(명단)', '만든 사람'];
  const colWidths = ['4%', '19%', '10%', '8%', '8%', '5%', '6%', '6%', '5%', '7%', '14%', '8%'];

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (let i = 0; i < headers.length; i++) {
    const th = document.createElement('th');
    th.textContent = headers[i]!;
    th.style.width = colWidths[i]!;
    th.style.textAlign = 'center';
    th.style.padding = '8px 3px';
    th.style.borderBottom = `2px solid ${REPORT_TEAL_LINE}`;
    th.style.background = REPORT_TEAL_BG;
    th.style.fontWeight = '700';
    th.style.color = REPORT_TEAL_DARK;
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
    td.style.padding = '9px 10px';
    td.style.fontWeight = '800';
    td.style.fontSize = '12px';
    td.style.background = '#ccfbf1';
    td.style.color = REPORT_TEAL_DARK;
    td.style.borderTop = `1px solid ${REPORT_TEAL_LINE}`;
    td.style.borderBottom = `1px solid ${REPORT_TEAL_LINE}`;
    td.style.textAlign = 'left';
    td.style.letterSpacing = '0.3px';
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

    const zebra = seq % 2 === 0;
    const tr = document.createElement('tr');
    for (let i = 0; i < cells.length; i++) {
      const td = document.createElement('td');
      td.textContent = cells[i]!;
      td.style.textAlign = i === 1 ? 'left' : 'center'; // 프로젝트명만 좌측 정렬(가독성)
      td.style.padding = '6px 4px';
      td.style.borderBottom = `1px solid ${REPORT_ROW_LINE}`;
      td.style.verticalAlign = 'middle';
      td.style.wordBreak = 'break-word';
      if (zebra) td.style.background = REPORT_ZEBRA;
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

  canvases.push(await renderRootToCanvas(root, REGISTRATION_PDF_WINDOW_WIDTH));

  await saveCanvasesToLandscapePdf(canvases, fileNamePrefix);
}
