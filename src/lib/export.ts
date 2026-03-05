import { Project, Task } from '../types';
import { WBSSettings } from '../context/WBSContext';

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

export const parseBackupJson = (file: File): Promise<BackupData> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const result = e.target?.result as string;
                const data = JSON.parse(result) as Partial<BackupData>;

                // Basic validation
                if (!data.projects || !Array.isArray(data.projects)) {
                    throw new Error('유효하지 않은 백업 파일: 프로젝트 데이터 누락');
                }
                if (!data.tasks || !Array.isArray(data.tasks)) {
                    throw new Error('유효하지 않은 백업 파일: 작업 데이터 누락');
                }
                if (!data.settings) {
                    throw new Error('유효하지 않은 백업 파일: 설정 데이터 누락');
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
