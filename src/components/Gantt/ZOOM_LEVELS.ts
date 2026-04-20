export type ViewMode = 'day' | 'week' | 'month';
export type DragType = 'move' | 'resize-left' | 'resize-right';

export interface TaskDragInfo {
  taskId: string;
  originalStartDate: string;
  originalEndDate: string;
  previewStartDate: string;
  previewEndDate: string;
}

export interface DragState {
  /** 단일 작업 리사이즈 시 taskId; 다중 이동 시 tasks[0].taskId가 기준 */
  taskId: string;
  type: DragType;
  startX: number;
  startY: number;
  /** 클릭(드래그 없음) 시 선택용 */
  clickTaskId: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** 다중 이동 시 모든 작업 정보; 단일 시 tasks.length === 1 */
  tasks: TaskDragInfo[];
}

// Zoom levels with corresponding view mode and per-day width
export const ZOOM_LEVELS: { mode: ViewMode; dayWidth: number; label: string }[] = [
  { mode: 'month', dayWidth: 2, label: '년간' },
  { mode: 'month', dayWidth: 4, label: '반기' },
  { mode: 'month', dayWidth: 8, label: '분기' },
  { mode: 'week', dayWidth: 14, label: '월간' },
  { mode: 'week', dayWidth: 20, label: '주간' },
  { mode: 'day', dayWidth: 30, label: '2주' },
  { mode: 'day', dayWidth: 40, label: '일간' },
  { mode: 'day', dayWidth: 60, label: '확대' },
  { mode: 'day', dayWidth: 90, label: '상세' },
];
