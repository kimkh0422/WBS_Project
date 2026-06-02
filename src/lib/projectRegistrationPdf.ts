import type { Project } from '../types';
import { formatProjectDisplayName } from './projectKind';
import { formatPercent1 } from './utils';

export type ProjectRegistrationPdfRow = Project & {
  stats: { total: number; progress: number; assigneeCount: number };
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatReportTimestamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function safeFileNamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

/**
 * 프로젝트 등록 현황(프로젝트 단위 요약만, 세부 작업 목록 없음)을 PDF로 저장합니다.
 * 한글은 브라우저가 그린 DOM을 html2canvas로 캡처해 반영합니다.
 */
export async function downloadProjectRegistrationPdfReport(options: {
  rows: ProjectRegistrationPdfRow[];
  subtitleLines?: string[];
  fileNamePrefix?: string;
}): Promise<void> {
  const { rows, subtitleLines = [], fileNamePrefix = '프로젝트등록현황' } = options;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  const root = document.createElement('div');
  root.setAttribute('data-pdf-export-root', '1');
  root.style.boxSizing = 'border-box';
  root.style.position = 'fixed';
  root.style.left = '-12000px';
  root.style.top = '0';
  root.style.width = '720px';
  root.style.padding = '28px 32px 32px';
  root.style.backgroundColor = '#ffffff';
  root.style.color = '#1c1917';
  root.style.fontFamily = 'system-ui, "Segoe UI", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  root.style.fontSize = '13px';
  root.style.lineHeight = '1.45';

  const title = document.createElement('h1');
  title.textContent = '프로젝트 등록현황';
  title.style.margin = '0 0 8px';
  title.style.fontSize = '22px';
  title.style.fontWeight = '700';
  root.appendChild(title);

  const meta = document.createElement('p');
  meta.textContent = `발행: ${formatReportTimestamp(new Date())}`;
  meta.style.margin = '0 0 6px';
  meta.style.fontSize = '12px';
  meta.style.color = '#57534e';
  root.appendChild(meta);

  for (const line of subtitleLines) {
    if (!line.trim()) continue;
    const p = document.createElement('p');
    p.textContent = line;
    p.style.margin = '0 0 4px';
    p.style.fontSize = '11px';
    p.style.color = '#78716c';
    root.appendChild(p);
  }

  const note = document.createElement('p');
  note.textContent = '본 리포트는 프로젝트별 요약(작업 수·진척률·담당자 수)만 포함하며, 세부 작업 목록은 포함하지 않습니다.';
  note.style.margin = '12px 0 14px';
  note.style.fontSize = '11px';
  note.style.color = '#57534e';
  root.appendChild(note);

  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.fontSize = '12px';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const headers = ['프로젝트', '작업 수', '진척률', '담당자 수'];
  const aligns: Array<'left' | 'right'> = ['left', 'right', 'right', 'right'];
  for (let i = 0; i < headers.length; i++) {
    const th = document.createElement('th');
    th.textContent = headers[i]!;
    th.style.textAlign = aligns[i]!;
    th.style.padding = '10px 8px';
    th.style.borderBottom = '2px solid #d6d3d1';
    th.style.background = '#f5f5f4';
    th.style.fontWeight = '600';
    th.style.color = '#44403c';
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const p of rows) {
    const tr = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.textContent = formatProjectDisplayName(p.name, p.projectKind);
    nameCell.style.textAlign = 'left';
    nameCell.style.padding = '8px';
    nameCell.style.borderBottom = '1px solid #e7e5e4';
    nameCell.style.wordBreak = 'break-word';
    nameCell.style.verticalAlign = 'top';
    tr.appendChild(nameCell);

    const tasksCell = document.createElement('td');
    tasksCell.textContent = String(p.stats.total);
    tasksCell.style.textAlign = 'right';
    tasksCell.style.padding = '8px';
    tasksCell.style.borderBottom = '1px solid #e7e5e4';
    tasksCell.style.whiteSpace = 'nowrap';
    tr.appendChild(tasksCell);

    const progCell = document.createElement('td');
    progCell.textContent = `${formatPercent1(p.stats.progress)}%`;
    progCell.style.textAlign = 'right';
    progCell.style.padding = '8px';
    progCell.style.borderBottom = '1px solid #e7e5e4';
    progCell.style.whiteSpace = 'nowrap';
    tr.appendChild(progCell);

    const asgCell = document.createElement('td');
    asgCell.textContent = String(p.stats.assigneeCount);
    asgCell.style.textAlign = 'right';
    asgCell.style.padding = '8px';
    asgCell.style.borderBottom = '1px solid #e7e5e4';
    asgCell.style.whiteSpace = 'nowrap';
    tr.appendChild(asgCell);

    tbody.appendChild(tr);
  }
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
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
    const canvas = await html2canvas(root, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 720,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
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
    pdf.save(`${safeFileNamePart(fileNamePrefix)}_${stamp}.pdf`);
  } finally {
    document.body.removeChild(root);
  }
}
