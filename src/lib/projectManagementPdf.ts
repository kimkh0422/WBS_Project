/**
 * 프로젝트 관리 화면용 PDF (조직도 순서·요청 열).
 * 한글은 DOM → html2canvas → jsPDF(가로 A4)로 처리합니다.
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatReportTimestamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function safeFileNamePart(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

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

function addPdfTableToRoot(root: HTMLElement, reportTitle: string, entries: ProjectManagementPdfEntry[]) {
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

function renderPdfToCanvas(root: HTMLElement) {
  return import('html2canvas').then(({ default: html2canvas }) =>
    html2canvas(root, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: 1100,
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
  root.style.width = '1100px';
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
    addPdfTableToRoot(root, reportTitle, entries);
  }

  document.body.appendChild(root);

  try {
    const canvas = await renderPdfToCanvas(root);
    await saveCanvasToLandscapePdf(canvas, fileNamePrefix);
  } finally {
    document.body.removeChild(root);
  }
}
