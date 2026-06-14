import { Project, Task } from '../types';
import { WBSSettings } from './wbsSettings';
import { buildTasksInTreeOrderWithWbs } from './taskView';
import { formatPercent1, round2 } from './utils';
import { formatAssigneeDisplay, type PersonDisplayMeta } from './assigneeOptions';
import { formatProjectDisplayName } from './projectKind';
import { isProjectTitleRootTask } from './ensureProjectTopLevelName';

export interface BackupData {
  version: string;
  projects: Project[];
  tasks: Task[];
  settings: WBSSettings;
  exportDate: string;
}

export const exportBackupToJson = (data: BackupData, fileName: string = 'wbs_backup.json') => {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/** 현재 표와 동일한 형식의 마크다운 문자열 생성 (다운로드 없음). 편집 모달용 */
export function buildMarkdownFromTasks(
  tasks: Task[],
  wbsMap: Map<string, string>,
  projects: Project[] = [],
  assigneeDisplayMetaByName?: Map<string, PersonDisplayMeta>,
): string {
  const lines: string[] = [];
  lines.push('# WBS 내보내기');
  lines.push('');
  lines.push(`*내보내기 일시: ${new Date().toLocaleString('ko-KR')}*`);
  lines.push('');

  const projectIdToName = new Map(projects.map((p) => [p.id, formatProjectDisplayName(p.name, p.projectKind)]));

  for (const project of projects) {
    const projectTasks = tasks.filter((t) => t.projectId === project.id);

    const projectName = formatProjectDisplayName(project.name, project.projectKind) || projectIdToName.get(project.id) || '프로젝트';
    lines.push(`## ${projectName}`);
    lines.push('');

    if (projectTasks.length === 0) {
      lines.push('*작업이 없습니다.*');
      lines.push('');
      continue;
    }

    const ordered = buildTasksInTreeOrderWithWbs(projectTasks, {
      isWbsTreeRootSkip: (t) => isProjectTitleRootTask(t, project),
    });

    lines.push('| WBS | 작업명 | 시작일 | 종료일 | 진행률 | 담당자 | 상태 | 공수 |');
    lines.push('|-----|--------|--------|--------|--------|--------|------|------|');

    for (const { task, depth, wbsCode } of ordered) {
      const indent = '  '.repeat(depth);
      // 편집 후 표 반영 시 매칭을 위해 컨텍스트 wbsMap과 동일한 코드 사용
      const displayCode = wbsMap.get(task.id) ?? wbsCode;
      const name = (task.name || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const start = (task.startDate || '').slice(0, 10);
      const end = (task.endDate || '').slice(0, 10);
      const progress = `${formatPercent1(task.progress ?? 0)}%`;
      const assignee = formatAssigneeDisplay(task.assignee, assigneeDisplayMetaByName).replace(/\|/g, '\\|');
      const status = (task.status || '').replace(/\|/g, '\\|');
      const effort = task.workEffort != null ? `${task.workEffort}일` : '-';
      lines.push(
        `| ${indent}**${displayCode}** | ${indent}${name} | ${start} | ${end} | ${progress} | ${assignee} | ${status} | ${effort} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 단일 프로젝트만 — 편집 후 저장 시 그 프로젝트 표에 바로 반영할 수 있는 마크다운.
 * 표는 `parseMarkdownTable`이 읽는 것과 동일한 8열 파이프 테이블 형식이다.
 */
export function buildMarkdownForProjectTable(
  project: Project,
  tasks: Task[],
  wbsMap: Map<string, string>,
  assigneeDisplayMetaByName?: Map<string, PersonDisplayMeta>,
): string {
  const lines: string[] = [];
  const projectName = formatProjectDisplayName(project.name, project.projectKind) || project.name;
  lines.push(`# ${projectName} — WBS 표`);
  lines.push('');
  lines.push(
    '이 블록을 **그대로** 편집 모달에 붙여넣고 저장하면, 아래 표의 행이 **이 프로젝트** 작업에 반영됩니다. `| WBS | 작업명 | …` 헤더·구분선(`|-----|`) 두 줄과 열 개수(8열)는 유지하세요.',
  );
  lines.push('');
  lines.push('**`WBS` 열의 `**1**`, `**1.1**` 형태 코드는 변경하지 마세요.** (행과 작업을 맞추는 키입니다.)');
  lines.push('');
  lines.push(`*projectId: \`${project.id}\` · 생성: ${new Date().toLocaleString('ko-KR')}*`);
  lines.push('');

  const projectTasks = tasks.filter((t) => t.projectId === project.id);
  if (projectTasks.length === 0) {
    lines.push('*작업이 없습니다.*');
    return lines.join('\n');
  }

  const ordered = buildTasksInTreeOrderWithWbs(projectTasks, {
    isWbsTreeRootSkip: (t) => isProjectTitleRootTask(t, project),
  });

  lines.push('| WBS | 작업명 | 시작일 | 종료일 | 진행률 | 담당자 | 상태 | 공수 |');
  lines.push('|-----|--------|--------|--------|--------|--------|------|------|');

  for (const { task, depth, wbsCode } of ordered) {
    const indent = '  '.repeat(depth);
    const displayCode = wbsMap.get(task.id) ?? wbsCode;
    const name = (task.name || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const start = (task.startDate || '').slice(0, 10);
    const end = (task.endDate || '').slice(0, 10);
    const progress = `${formatPercent1(task.progress ?? 0)}%`;
    const assignee = formatAssigneeDisplay(task.assignee, assigneeDisplayMetaByName).replace(/\|/g, '\\|');
    const status = (task.status || '').replace(/\|/g, '\\|');
    const effort = task.workEffort != null ? `${task.workEffort}일` : '-';
    lines.push(
      `| ${indent}**${displayCode}** | ${indent}${name} | ${start} | ${end} | ${progress} | ${assignee} | ${status} | ${effort} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** 마크다운 파이프 표 한 줄을 셀 배열로 분리 (GFM: 양끝 `|` 제거 후 `|`로만 분리) */
function splitMarkdownTableRow(line: string): string[] {
  let s = line.trim().replace(/\uFF5C/g, '|');
  if (!s.startsWith('|')) return [];
  s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  if (!s.trim()) return [];
  return s.split('|').map((c) => c.replace(/\u00a0/g, ' ').trim());
}

/** 8열 WBS 표 행으로 정규화: 열이 부족하면 오른쪽을 빈 문자열로 채움 */
function normalizeMarkdownTableEightCells(raw: string[]): string[] {
  const cells = raw.slice(0, 8);
  while (cells.length < 8) cells.push('');
  return cells;
}

/**
 * 표 첫 번째 셀에서 WBS 코드 추출.
 * - `**1.1**` (권장)
 * - `` `1.1` `` 또는 백틱으로 감싼 값
 * - 들여쓰기·공백 뒤 `1`, `1.2.3` 같은 순수 번호
 * - `P-1.1` 등 숫자를 포함한 짧은 토큰
 */
export function extractWbsCodeFromMarkdownCell(raw: string): string | null {
  const cell = raw.replace(/\u00a0/g, ' ').trim();
  if (!cell) return null;
  const deHtml = cell.replace(/<[^>]+>/g, '').trim();
  if (!deHtml) return null;
  if (/^[-:\s|_]+$/i.test(deHtml)) return null;

  const bold = deHtml.match(/\*\*\s*([^*]+?)\s*\*\*/);
  if (bold) {
    const v = bold[1].trim();
    if (v && !/^wbs$/i.test(v)) return v;
  }

  const tick = deHtml.match(/`([^`]+)`/);
  if (tick) {
    const v = tick[1].trim();
    if (v && !/^wbs$/i.test(v)) return v;
  }

  const firstToken = deHtml.split(/\s+/)[0]?.trim() ?? '';
  if (!firstToken) return null;
  if (/^wbs$/i.test(firstToken)) return null;
  if (/^-+$/.test(firstToken)) return null;

  if (/^[\d.]+$/.test(firstToken)) return firstToken;
  if (/^[\w.-]+$/.test(firstToken) && /\d/.test(firstToken)) return firstToken;

  return null;
}

/** 붙여넣은 WBS(예: `1.0`)와 저장 코드(`1`)를 맞추기 위해, 끝의 `.0`을 반복 제거한 대체 키(원본 우선) */
export function wbsAlternatesForPasteLookup(code: string): string[] {
  const list: string[] = [];
  const seen = new Set<string>();
  let c = code.trim();
  while (c.length > 0 && !seen.has(c)) {
    seen.add(c);
    list.push(c);
    const m = /^(.+)\.0$/.exec(c);
    if (!m) break;
    c = m[1];
  }
  return list;
}

/**
 * MD 붙여넣기 저장용: 지정 프로젝트 작업만으로 WBS 키 → taskId 맵을 만든다.
 * - `currentProjectId === 'all'`일 때 전역 wbsMap과 달리, 프로젝트 트리 기준 번호와 일치한다.
 * - 컨텍스트 `wbsMap`(접두어·설정 반영) 문자열도 같은 작업에 등록한다.
 * - `1` ↔ `1.0` 등 흔한 표기 차이는 `wbsAlternatesForPasteLookup` + `.0` 보조 키로 흡수한다.
 */
export function buildWbsCodeToTaskIdForMarkdownPaste(
  scopeProjectId: string,
  tasks: Task[],
  projects: Project[],
  wbsMap: Map<string, string>,
): Map<string, string> {
  const project = projects.find((p) => p.id === scopeProjectId);
  const projectTasks = tasks.filter((t) => t.projectId === scopeProjectId && !t.mirroredFromTaskId);
  const ordered = buildTasksInTreeOrderWithWbs(projectTasks, {
    isWbsTreeRootSkip: (t) => (project ? isProjectTitleRootTask(t, project) : false),
  });
  const m = new Map<string, string>();

  const registerKey = (rawKey: string, taskId: string) => {
    const k = rawKey.trim();
    if (!k) return;
    if (!m.has(k)) m.set(k, taskId);
    for (const alt of wbsAlternatesForPasteLookup(k)) {
      if (!m.has(alt)) m.set(alt, taskId);
    }
    const with0 = `${k}.0`;
    if (with0 !== k && !m.has(with0)) m.set(with0, taskId);
  };

  for (const { task, wbsCode } of ordered) {
    const ctx = (wbsMap.get(task.id) || '').trim();
    if (ctx) registerKey(ctx, task.id);
    if (wbsCode) registerKey(wbsCode, task.id);
  }
  return m;
}

/** 편집된 마크다운에서 테이블 행 파싱. WBS 코드로 기존 작업 매칭 후 반영용 */
export interface ParsedMarkdownRow {
  wbsCode: string;
  name: string;
  startDate: string;
  endDate: string;
  progress: number;
  assignee: string;
  status: string;
  workEffort: number | undefined;
}

export function parseMarkdownTable(md: string): ParsedMarkdownRow[] {
  const rows: ParsedMarkdownRow[] = [];
  const lines = md.replace(/\uFF5C/g, '|').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const rawCells = splitMarkdownTableRow(trimmed);
    if (rawCells.length < 2) continue;
    const cells = normalizeMarkdownTableEightCells(rawCells);
    const wbsCode = extractWbsCodeFromMarkdownCell(cells[0] ?? '');
    if (!wbsCode) continue;

    const name = (cells[1] || '').replace(/\\\|/g, '|').trim();
    const startDate = (cells[2] || '').trim().slice(0, 10);
    const endDate = (cells[3] || '').trim().slice(0, 10);
    const progressStr = (cells[4] || '0').replace(/%/g, '').replace(/,/g, '').trim();
    const progress = Math.min(100, Math.max(0, round2(parseFloat(progressStr) || 0)));
    const assignee = (cells[5] || '').replace(/\\\|/g, '|').trim();
    const status = (cells[6] || '').replace(/\\\|/g, '|').trim();
    const effortStr = (cells[7] || '').trim();
    const effortMatch = effortStr.match(/^(\d+(?:\.\d+)?)\s*(?:일|md|MD)?$/i);
    const workEffort = effortMatch ? parseFloat(effortMatch[1]) : undefined;

    rows.push({
      wbsCode,
      name,
      startDate,
      endDate,
      progress,
      assignee,
      status,
      workEffort,
    });
  }

  return rows;
}

/** WBS 작업을 마크다운 형식으로 내보냄. 프로젝트별 계층 구조 + 테이블 */
export const exportToMarkdown = (
  tasks: Task[],
  wbsMap: Map<string, string>,
  fileName: string = 'wbs_export.md',
  projects: Project[] = [],
  assigneeDisplayMetaByName?: Map<string, PersonDisplayMeta>,
) => {
  const md = buildMarkdownFromTasks(tasks, wbsMap, projects, assigneeDisplayMetaByName);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const parseSingleBackupJson = (file: File): Promise<BackupData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const result = e.target?.result as string;
        const data = JSON.parse(result) as Partial<BackupData>;

        // Basic validation
        if (!data.projects || !Array.isArray(data.projects)) {
          throw new Error(`${file.name}: 유효하지 않은 백업 파일 - 프로젝트 데이터 누락`);
        }
        if (!data.tasks || !Array.isArray(data.tasks)) {
          throw new Error(`${file.name}: 유효하지 않은 백업 파일 - 작업 데이터 누락`);
        }

        resolve(data as BackupData);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = (error) => reject(error);
    reader.readAsText(file);
  });
};

export const parseBackupJson = (file: File): Promise<BackupData> => {
  return parseSingleBackupJson(file);
};

export const parseMultipleBackupJsons = (files: File[]): Promise<BackupData[]> => {
  return Promise.all(files.map(parseSingleBackupJson));
};
