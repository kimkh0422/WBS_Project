import * as XLSX from 'xlsx';
import { Task, TaskStatus } from '../types';

// Map internal keys to Korean headers
const HEADER_MAP: Record<string, string> = {
  wbsId: 'WBS번호',
  id: '시스템ID',
  parentId: '상위작업ID',
  name: '작업명',
  startDate: '시작일',
  endDate: '종료일',
  progress: '진행률',
  assignee: '담당자',
  status: '상태',
  dependencies: '선행작업',
  workEffort: '작업공수',
  deliverables: '산출물',
};

const REVERSE_HEADER_MAP: Record<string, keyof Task> = Object.entries(HEADER_MAP).reduce(
  (acc, [key, value]) => ({ ...acc, [value]: key as keyof Task }),
  {}
);

export const exportToExcel = (tasks: Task[], wbsMap: Map<string, string>, fileName: string = 'wbs_export.xlsx') => {
  // Use context wbsMap (which has user-configured prefixes like W1, T1.1).
  // For tasks beyond maxLevel (wbsMap value is ''), derive from parent's WBS number.
  const exportWbsMap = new Map<string, string>();
  const fillWbs = (parentId: string | null) => {
    const children = tasks.filter(t => t.parentId === parentId);
    children.forEach((child, index) => {
      const contextVal = wbsMap.get(child.id);
      if (contextVal) {
        exportWbsMap.set(child.id, contextVal);
      } else {
        const parentWbs = parentId ? (exportWbsMap.get(parentId) || '') : '';
        exportWbsMap.set(child.id, parentWbs ? `${parentWbs}.${index + 1}` : `${index + 1}`);
      }
      fillWbs(child.id);
    });
  };
  fillWbs(null);

  // Prepare data for export
  const data = tasks.map((task) => ({
    [HEADER_MAP.wbsId]: exportWbsMap.get(task.id) || '',
    [HEADER_MAP.name]: task.name,
    [HEADER_MAP.startDate]: task.startDate,
    [HEADER_MAP.endDate]: task.endDate,
    [HEADER_MAP.progress]: task.progress,
    [HEADER_MAP.assignee]: task.assignee,
    [HEADER_MAP.status]: task.status,
    [HEADER_MAP.dependencies]: task.dependencies ? task.dependencies.join(',') : '',
    [HEADER_MAP.workEffort]: task.workEffort || 0,
    [HEADER_MAP.deliverables]: task.deliverables || '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Tasks');
  XLSX.writeFile(workbook, fileName);
};

export const parseExcel = (file: File): Promise<Task[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const tasks: Task[] = jsonData.map((row: any) => {
          const task: any = {};

          // Map headers back to keys
          Object.keys(row).forEach((header) => {
            const key = REVERSE_HEADER_MAP[header];
            if (key) {
              if (key === 'dependencies') {
                task[key] = row[header] ? String(row[header]).split(',').map(s => s.trim()) : [];
              } else if (key === 'parentId') {
                task[key] = row[header] ? String(row[header]) : null;
              } else if (key === 'id') {
                task[key] = String(row[header]);
              } else if (key === 'progress' || key === 'workEffort') {
                task[key] = Number(row[header]) || 0;
              } else {
                task[key] = row[header];
              }
            }
          });

          // Default values for missing fields
          if (!task.id) task.id = crypto.randomUUID();
          if (!task.status) task.status = 'todo';
          if (!task.progress) task.progress = 0;
          if (!task.expanded) task.expanded = true;

          return task as Task;
        });

        resolve(tasks);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = (error) => reject(error);
    reader.readAsBinaryString(file);
  });
};
