import { Project, Task } from '../types';
import { WBSSettings } from './wbsSettings';
import { buildTasksInTreeOrderWithWbs } from './taskView';
import { formatNum2, round2 } from './utils';

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
    projects: Project[] = []
): string {
    const lines: string[] = [];
    lines.push('# WBS 내보내기');
    lines.push('');
    lines.push(`*내보내기 일시: ${new Date().toLocaleString('ko-KR')}*`);
    lines.push('');

    const projectIdToName = new Map(projects.map(p => [p.id, p.name]));

    for (const project of projects) {
        const projectTasks = tasks.filter(t => t.projectId === project.id);
        if (projectTasks.length === 0 && projects.length > 1) continue;

        const projectName = project.name || projectIdToName.get(project.id) || '프로젝트';
        lines.push(`## ${projectName}`);
        lines.push('');

        if (projectTasks.length === 0) {
            lines.push('*작업이 없습니다.*');
            lines.push('');
            continue;
        }

        const ordered = buildTasksInTreeOrderWithWbs(projectTasks);

        lines.push('| WBS | 작업명 | 시작일 | 종료일 | 진행률 | 담당자 | 상태 | 공수 |');
        lines.push('|-----|--------|--------|--------|--------|--------|------|------|');

        for (const { task, depth, wbsCode } of ordered) {
            const indent = '  '.repeat(depth);
            // 편집 후 표 반영 시 매칭을 위해 컨텍스트 wbsMap과 동일한 코드 사용
            const displayCode = wbsMap.get(task.id) ?? wbsCode;
            const name = (task.name || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
            const start = (task.startDate || '').slice(0, 10);
            const end = (task.endDate || '').slice(0, 10);
            const progress = `${formatNum2(task.progress ?? 0)}%`;
            const assignee = (task.assignee || '').replace(/\|/g, '\\|');
            const status = (task.status || '').replace(/\|/g, '\\|');
            const effort = task.workEffort != null ? `${task.workEffort}일` : '-';
            lines.push(`| ${indent}**${displayCode}** | ${indent}${name} | ${start} | ${end} | ${progress} | ${assignee} | ${status} | ${effort} |`);
        }
        lines.push('');
    }

    return lines.join('\n');
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
    const lines = md.split(/\r?\n/);

    for (const line of lines) {
        if (!line.trim().startsWith('|')) continue;
        const cells = line.split('|').map(c => c.trim()).filter((_, i) => i > 0 && i < 9); // 8 columns
        if (cells.length < 8) continue;
        const wbsMatch = cells[0].match(/\*\*([^*]+)\*\*/);
        if (!wbsMatch) continue; // header/separator
        const wbsCode = wbsMatch[1].trim();
        const name = (cells[1] || '').replace(/\\\|/g, '|').trim();
        const startDate = (cells[2] || '').trim().slice(0, 10);
        const endDate = (cells[3] || '').trim().slice(0, 10);
        const progressStr = (cells[4] || '0').replace(/%/g, '');
        const progress = Math.min(100, Math.max(0, round2(parseFloat(progressStr) || 0)));
        const assignee = (cells[5] || '').replace(/\\\|/g, '|').trim();
        const status = (cells[6] || '').replace(/\\\|/g, '|').trim();
        const effortStr = (cells[7] || '').trim();
        const effortMatch = effortStr.match(/^(\d+(?:\.\d+)?)\s*일?$/);
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
    projects: Project[] = []
) => {
    const md = buildMarkdownFromTasks(tasks, wbsMap, projects);
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
