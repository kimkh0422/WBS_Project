import React, { useState, useEffect } from 'react';
import { Task, TaskStatus, TaskAssignment } from '../types';
import { X, Trash2, CornerDownRight, Calculator, Info, Flag, Bug, Sparkles, Loader2 } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { useWBS } from '../context/WBSContext';
import { computeEndDateFromEffort, computeWorkEffortFromDates } from '../lib/schedule';
import { randomUUID } from '../lib/utils';
import { useToast } from './Toast';
import { GoogleGenAI } from '@google/genai';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Omit<Task, 'id'> | Partial<Task>) => void;
  onDelete?: () => void;
  initialData?: Task;
  parentOptions: Task[];
  /** 하위 작업 클릭 시 해당 작업을 모달에서 열 때 호출 (없으면 하위 작업 목록만 표시) */
  onOpenTask?: (task: Task) => void;
  /** 담당자 필터(예: 내 업무만)가 켜져 있을 때 새 작업의 기본 담당자 */
  defaultAssignee?: string;
  /** 기한 필터(금일/금주 등)가 켜져 있을 때 새 작업의 기본 시작일 */
  defaultStartDate?: string;
  /** 기한 필터(금일/금주 등)가 켜져 있을 때 새 작업의 기본 종료일 */
  defaultEndDate?: string;
}

const GEMINI_API_KEY_STORAGE = 'gemini-api-key';
const DESCRIPTION_CORRECTION_PROMPT = `다음 작업 설명 텍스트를 교정해 주세요.
규칙:
- 내용의 의미는 바꾸지 말고, 맞춤법·띄어쓰기·문장 부호·문단/줄바꿈만 정리하세요.
- 불릿·번호 목록 형식이 있으면 통일하세요.
- 마크다운(이미지 ![...](...), 링크 등)은 그대로 유지하세요.
- 교정된 텍스트만 출력하고, 설명이나 부가 문구는 붙이지 마세요.`;

export function TaskModal({ isOpen, onClose, onSave, onDelete, initialData, parentOptions, onOpenTask, defaultAssignee, defaultStartDate, defaultEndDate }: TaskModalProps) {
  const { wbsMap, displayWbsMap, addTask, updateTask, wbsSettings, projects, currentProjectId } = useWBS();
  const { push: pushToast } = useToast();
  const taskProjectId = initialData?.projectId ?? currentProjectId;
  const taskProject = projects.find(p => p.id === taskProjectId);
  const projectAssignments: TaskAssignment[] = (taskProject?.assignments ?? []).map(a => ({ assignee: a.assignee, allocationPercent: a.allocationPercent }));
  const defaultDate = taskProject?.startDate || new Date().toISOString().split('T')[0];
  const [formData, setFormData] = useState<Partial<Task>>({
    name: '',
    startDate: defaultDate,
    endDate: defaultDate,
    progress: 0,
    workEffort: 0.5,
    assignee: '',
    status: 'todo',
    parentId: null,
    description: '',
    checklist: [],
    deliverables: '',
    isMilestone: false,
    isIssue: false,
    baselineStartDate: undefined,
    baselineEndDate: undefined,
    baselineWorkEffort: undefined,
  });

  const [newChecklistItem, setNewChecklistItem] = useState('');

  const [depsInput, setDepsInput] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isCorrectingDescription, setIsCorrectingDescription] = useState(false);

  useEffect(() => {
    if (initialData) {
      const { assignments: _a, ...rest } = initialData as any;
      setFormData(rest);
    } else {
      const defaultDate = taskProject?.startDate || new Date().toISOString().split('T')[0];
      setFormData({
        name: '',
        startDate: defaultStartDate || defaultDate,
        endDate: defaultEndDate || defaultDate,
        progress: 0,
        workEffort: 0.5,
        assignee: defaultAssignee || '',
        status: 'todo',
        parentId: null,
        description: '',
        checklist: [],
        deliverables: '',
        isMilestone: false,
        isIssue: false,
        baselineStartDate: undefined,
        baselineEndDate: undefined,
        baselineWorkEffort: undefined,
      });
    }
  }, [initialData, isOpen, taskProject?.startDate, defaultAssignee, defaultStartDate, defaultEndDate]);

  const depOptions = parentOptions.filter(t => t.id !== initialData?.id);
  const idToNum = new Map<string, number>(depOptions.map((t, i) => [t.id, i + 1] as const));
  const numToId = new Map<number, string>(depOptions.map((t, i) => [i + 1, t.id] as const));
  const maxDepNum: number = depOptions.length;

  /** 현재 작업의 하위 작업 목록 (WBS 순 정렬) */
  const childTasks = (initialData?.id
    ? parentOptions
        .filter(t => t.parentId === initialData.id)
        .sort((a, b) => {
          const wbsA = displayWbsMap.get(a.id) ?? '';
          const wbsB = displayWbsMap.get(b.id) ?? '';
          return wbsA.localeCompare(wbsB, undefined, { numeric: true });
        })
    : []) as Task[];

  useEffect(() => {
    const nums = (formData.dependencies || []).map(id => idToNum.get(id)).filter((n): n is number => n != null).sort((a, b) => a - b);
    setDepsInput(nums.join(', '));
  }, [isOpen, formData.dependencies, parentOptions, initialData?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement;
        // Don't close modal if the escape was meant to close a native datalist/select
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT') {
          target.blur(); // Blur the input first
        } else {
          onClose();
        }
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const dependencyCount = formData.dependencies?.length ?? 0;
  const deliverablesCount = formData.deliverables?.trim() ? formData.deliverables!.split(',').map(s => s.trim()).filter(Boolean).length : 0;
  const effortHelpText = '투입비율: 프로젝트 설정의 인원·비율로 기간/공수가 계산됩니다. 기간 자동: 시작일+공수→종료일. 공수 역산: 시작~종료일→공수.';

  const parseDepsInput = (): string[] => {
    const nums: number[] = depsInput
      .split(/[\s,]+/)
      .map(s => parseInt(s.trim(), 10))
      .filter((n): n is number => !Number.isNaN(n) && n >= 1 && n <= maxDepNum);
    const unique: number[] = Array.from(new Set<number>(nums));
    return unique.map((n: number) => numToId.get(n)).filter((id): id is string => id != null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedDeps = parseDepsInput();
    const toMerge = { ...formData, dependencies: parsedDeps };
    const start = toMerge.startDate || '';
    const end = toMerge.endDate || start;
    if (taskProject?.startDate && start < taskProject.startDate) {
      alert(`작업 시작일은 프로젝트 시작일(${taskProject.startDate})보다 이전일 수 없습니다.`);
      return;
    }
    if (taskProject?.endDate && end > taskProject.endDate) {
      alert(`작업 종료일은 프로젝트 종료일(${taskProject.endDate})을 초과할 수 없습니다.`);
      return;
    }
    const toSave = { ...toMerge, assignments: toMerge.assignments ?? initialData?.assignments ?? [] } as Partial<Task>;
    if (initialData?.id) {
      type LockedField = NonNullable<Task['userLockedFields']>[number];
      const locked = new Set<LockedField>(initialData.userLockedFields ?? []);
      if (formData.startDate !== initialData.startDate) locked.add('startDate');
      if (formData.endDate !== initialData.endDate) locked.add('endDate');
      const depA = (toMerge.dependencies ?? []).slice().sort();
      const depB = (initialData.dependencies ?? []).slice().sort();
      const depsChanged = depA.length !== depB.length || depA.some((id, i) => id !== depB[i]);
      if (depsChanged) locked.add('dependencies');
      if (formData.workEffort !== initialData.workEffort) locked.add('workEffort');
      toSave.userLockedFields = Array.from(locked);
    }
    if (initialData && initialData.id === '') {
      const { id, ...rest } = toSave as Task & { id?: string };
      onSave(rest);
    } else {
      onSave(toSave as any);
    }
    onClose();
  };

  const assigneeOptions = Array.from(new Set([...(projectAssignments.map(a => a.assignee)), ...parentOptions.map(t => t.assignee).filter(Boolean)])).filter(Boolean).sort();

  const handleApplyEndDateFromEffort = () => {
    const start = formData.startDate || new Date().toISOString().split('T')[0];
    const effort = typeof formData.workEffort === 'number' && formData.workEffort > 0 ? formData.workEffort : 1;
    let end = computeEndDateFromEffort(start, effort, projectAssignments.length > 0 ? projectAssignments : undefined);
    if (taskProject?.endDate && end > taskProject.endDate) end = taskProject.endDate;
    setFormData(prev => ({ ...prev, startDate: start, endDate: end }));
  };

  const handleApplyWorkEffortFromDates = () => {
    const start = formData.startDate || new Date().toISOString().split('T')[0];
    const end = formData.endDate || start;
    const effort = computeWorkEffortFromDates(start, end, projectAssignments.length > 0 ? projectAssignments : undefined);
    setFormData(prev => ({ ...prev, workEffort: effort }));
  };

  const handleDeleteClick = () => {
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    if (onDelete) {
      onDelete();
      onClose();
    }
    setIsDeleteConfirmOpen(false);
  };

  const handleCorrectDescriptionWithAI = async () => {
    const apiKey = localStorage.getItem(GEMINI_API_KEY_STORAGE)?.trim();
    if (!apiKey) {
      pushToast('API 키를 먼저 설정해 주세요. (상단 AI 분석 메뉴에서 설정)', { variant: 'warning' });
      return;
    }
    const desc = (formData.description ?? '').trim();
    if (!desc) {
      pushToast('설명란에 교정할 내용을 입력해 주세요.', { variant: 'warning' });
      return;
    }
    setIsCorrectingDescription(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: `${DESCRIPTION_CORRECTION_PROMPT}\n\n---\n\n${desc}` }] }],
      });
      const text = result.text?.trim();
      if (text) {
        setFormData(prev => ({ ...prev, description: text }));
        pushToast('설명을 교정했습니다.');
      } else {
        pushToast('AI 응답이 비어 있습니다.', { variant: 'warning' });
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : '교정 중 오류가 발생했습니다.', { variant: 'error' });
    } finally {
      setIsCorrectingDescription(false);
    }
  };

  const handleAddChecklist = () => {
    if (!newChecklistItem.trim()) return;
    const newItem = { id: randomUUID(), text: newChecklistItem.trim(), completed: false };
    setFormData(prev => ({
      ...prev,
      checklist: [...(prev.checklist || []), newItem]
    }));
    setNewChecklistItem('');
  };

  const handleToggleChecklist = (id: string) => {
    setFormData(prev => ({
      ...prev,
      checklist: (prev.checklist || []).map(item =>
        item.id === id ? { ...item, completed: !item.completed } : item
      )
    }));
  };

  const handleDeleteChecklist = (id: string) => {
    setFormData(prev => ({
      ...prev,
      checklist: (prev.checklist || []).filter(item => item.id !== id)
    }));
  };

  const handleConvertToSubtask = (item: { id: string; text: string }) => {
    if (!initialData || !initialData.id) return; // Must have an existing task to add a subtask to

    const today = new Date().toISOString().split('T')[0];

    // Add the new subtask
    addTask({
      name: item.text,
      startDate: formData.startDate || today,
      endDate: formData.endDate || today,
      progress: 0,
      assignee: formData.assignee || '',
      status: 'todo',
      parentId: initialData.id
    });

    // Remove from the checklist form state
    handleDeleteChecklist(item.id);
  };

  const handleConvertAllToSubtasks = () => {
    if (!initialData || !initialData.id) return;
    if (!formData.checklist || formData.checklist.length === 0) return;

    const today = new Date().toISOString().split('T')[0];

    formData.checklist.forEach(item => {
      addTask({
        name: item.text,
        startDate: formData.startDate || today,
        endDate: formData.endDate || today,
        progress: 0,
        assignee: formData.assignee || '',
        status: 'todo',
        parentId: initialData.id
      });
    });

    // Clear the checklist
    setFormData(prev => ({
      ...prev,
      checklist: []
    }));
  };


  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items) as DataTransferItem[]) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = (item as any).getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          setFormData(prev => ({
            ...prev,
            description: (prev.description ? prev.description + '\n' : '') + `![image](${dataUrl})`
          }));
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  };

  const assigneeTitle = '프로젝트 등록 인원 선택 또는 직접 입력. 투입비율은 프로젝트 설정에서 적용됩니다.';

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 backdrop-blur-sm p-3 sm:p-4">
      <div className="bg-[var(--color-surface)] w-full max-w-7xl rounded-2xl shadow-2xl overflow-hidden border border-[var(--color-line)] max-h-[calc(100vh-2rem)] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center px-4 py-2.5 border-b border-[var(--color-line)] bg-slate-50/80 flex-shrink-0">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">{initialData ? '작업 수정' : '새 작업'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 -mr-1.5 rounded-lg text-slate-500 hover:bg-slate-200/80 hover:text-slate-800 transition-colors" aria-label="닫기">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 content-start p-4 overflow-y-auto min-h-0">
            {/* 기본 정보 - 한 줄 */}
            <div className="col-span-full flex items-center gap-1.5 mb-0.5">
              <span className="w-0.5 h-3.5 rounded-full bg-[var(--color-accent)]" aria-hidden />
              <span className="text-[11px] font-semibold text-[var(--color-ink-muted)] uppercase tracking-wider">기본 정보</span>
            </div>
            <div className="col-span-2 min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">작업명</label>
              <input
                required
                type="text"
                list="task-name-suggestions"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input-field py-1.5 text-sm"
                placeholder="작업 이름..."
                autoFocus
              />
              <datalist id="task-name-suggestions">
                <option value="기획" /><option value="디자인" /><option value="프론트엔드 개발" /><option value="백엔드 개발" /><option value="테스트" /><option value="배포" /><option value="문서화" /><option value="미팅" />
              </datalist>
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">상위 작업</label>
              <select
                value={formData.parentId || ''}
                onChange={(e) => setFormData({ ...formData, parentId: e.target.value || null })}
                className="input-field py-1.5 text-sm"
              >
                <option value="">없음</option>
                {parentOptions.filter(t => t.id !== initialData?.id).map((task) => (
                  <option key={task.id} value={task.id}>{displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">상태</label>
              <select
                value={formData.status}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  const config = wbsSettings.statusConfigs.find(c => c.id === newStatus);
                  setFormData(prev => ({ ...prev, status: newStatus, progress: config?.progress ?? prev.progress }));
                }}
                className="input-field py-1.5 text-sm"
              >
                {wbsSettings.statusConfigs.map(config => <option key={config.id} value={config.id}>{config.name}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">
                <span className="inline-flex items-center gap-1">
                  담당자
                  <span className="cursor-help text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]" title={assigneeTitle} aria-label="안내"><Info size={12} /></span>
                </span>
              </label>
              <input
                type="text"
                list="task-modal-assignees"
                value={formData.assignee || ''}
                onChange={(e) => setFormData({ ...formData, assignee: e.target.value })}
                placeholder="선택 또는 입력"
                className="input-field py-1.5 text-sm"
                title={assigneeTitle}
              />
              <datalist id="task-modal-assignees">
                <option value="">선택 안 함</option>
                {assigneeOptions.map(a => <option key={a} value={a} />)}
              </datalist>
              {initialData?.assignments && initialData.assignments.length > 0 && (
                <p className="text-[10px] text-[var(--color-ink-muted)] mt-0.5" role="note">투입율: {initialData.assignments.map(a => `${a.assignee} ${a.allocationPercent}%`).join(', ')}</p>
              )}
            </div>
            {initialData?.id ? (
              <div className="min-w-0 col-span-full">
                <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">하위 작업</label>
                {childTasks.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto rounded-lg border border-[var(--color-line-soft)] bg-slate-50/60 px-2 py-1.5">
                    {childTasks.map((child) => (
                      <button
                        key={child.id}
                        type="button"
                        onClick={() => onOpenTask?.(child)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--color-ink)] bg-white border border-[var(--color-line)] rounded-md hover:bg-[var(--color-accent-soft)] hover:border-indigo-200 transition-colors text-left"
                        title={onOpenTask ? `${child.name} 작업 열기` : undefined}
                      >
                        {displayWbsMap.get(child.id) && <span className="text-[var(--color-ink-muted)] tabular-nums">{displayWbsMap.get(child.id)}</span>}
                        <span className="truncate max-w-[180px]">{child.name}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--color-ink-muted)] py-1">하위 작업 없음</p>
                )}
              </div>
            ) : null}

            {/* 일정 + 공수 - 한 줄 */}
            <div className="col-span-full flex items-center gap-1.5 mb-0.5 mt-1">
              <span className="w-0.5 h-3.5 rounded-full bg-[var(--color-accent)]" aria-hidden />
              <span className="text-[11px] font-semibold text-[var(--color-ink-muted)] uppercase tracking-wider">일정 · 공수</span>
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">시작일</label>
              <input
                required
                type="date"
                value={formData.startDate?.split('T')[0]}
                onChange={(e) => {
                  const newStart = e.target.value;
                  const effort = typeof formData.workEffort === 'number' && formData.workEffort > 0 ? formData.workEffort : (formData.workEffort ?? 1);
                  let newEnd = computeEndDateFromEffort(newStart, effort, projectAssignments.length > 0 ? projectAssignments : undefined);
                  if (taskProject?.endDate && newEnd > taskProject.endDate) newEnd = taskProject.endDate;
                  setFormData(prev => ({ ...prev, startDate: newStart, endDate: newEnd }));
                }}
                className="input-field py-1.5 text-sm"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">종료일</label>
              <input required type="date" value={formData.endDate?.split('T')[0]} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} className="input-field py-1.5 text-sm" />
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">진행률 %</label>
              <input type="number" min="0" max="100" value={formData.progress} onChange={(e) => setFormData({ ...formData, progress: parseInt(e.target.value) || 0 })} className="input-field py-1.5 text-sm w-full" />
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">공수 (D)</label>
              <div className="flex gap-1.5 items-center">
                <input type="number" min="0" step="0.5" value={formData.workEffort ?? ''} onChange={(e) => setFormData({ ...formData, workEffort: e.target.value === '' ? undefined : parseFloat(e.target.value) })} className="input-field py-1.5 text-sm w-14 flex-shrink-0" placeholder="0.5" aria-label="작업 공수" />
                <button type="button" onClick={handleApplyEndDateFromEffort} className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] rounded-lg border border-indigo-200 transition-colors shrink-0" title="시작일·공수·투입비율 → 종료일"><Calculator size={12} /> 기간자동</button>
                <button type="button" onClick={handleApplyWorkEffortFromDates} className="px-2 py-1.5 text-[11px] font-medium text-[var(--color-ink)] hover:bg-slate-100 rounded-lg border border-[var(--color-line)] transition-colors shrink-0" title="시작일·종료일 → 공수">공수역산</button>
                <span className="cursor-help text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] p-0.5 shrink-0" title={effortHelpText} aria-label="공수 도움말"><Info size={12} /></span>
              </div>
            </div>
            {showHelp && (
              <div className="col-span-full rounded-lg bg-[var(--color-accent-soft)] border border-indigo-100 px-2.5 py-2 text-[11px] text-[var(--color-ink)]" role="status">{effortHelpText}</div>
            )}

            {/* 작업 옵션 - 한 줄 */}
            <div className="col-span-full flex items-center gap-1.5 mb-0.5 mt-1">
              <span className="w-0.5 h-3.5 rounded-full bg-[var(--color-accent)]" aria-hidden />
              <span className="text-[11px] font-semibold text-[var(--color-ink-muted)] uppercase tracking-wider">작업 옵션</span>
            </div>
            <div className="col-span-full flex items-center gap-4 flex-wrap rounded-lg bg-slate-50/80 border border-[var(--color-line-soft)] px-3 py-2">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[var(--color-ink)]">
                <input type="checkbox" checked={!!formData.isMilestone} onChange={(e) => { const checked = e.target.checked; setFormData(prev => ({ ...prev, isMilestone: checked, ...(checked && prev.startDate ? { endDate: prev.startDate, workEffort: 0 } : {}) })); }} className="rounded border-[var(--color-line)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/30" />
                <Flag size={12} className="text-amber-500 shrink-0" aria-hidden />
                <span>마일스톤</span>
                <span className="text-[10px] text-[var(--color-ink-muted)]">(이정표)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[var(--color-ink)]">
                <input
                  type="checkbox"
                  checked={!!formData.isIssue}
                  onChange={(e) => setFormData(prev => ({ ...prev, isIssue: e.target.checked }))}
                  className="rounded border-[var(--color-line)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/30"
                />
                <Bug size={12} className="text-rose-600 shrink-0" aria-hidden />
                <span>이슈</span>
                <span className="text-[10px] text-[var(--color-ink-muted)]">(강조 표시)</span>
              </label>
            </div>

            {/* 의존성 - 한 줄 */}
            <div className="col-span-full flex items-center gap-1.5 mb-0.5 mt-1">
              <span className="w-0.5 h-3.5 rounded-full bg-[var(--color-accent)]" aria-hidden />
              <label className="text-[11px] font-semibold text-[var(--color-ink-muted)] uppercase tracking-wider">
                의존성 (번호)
                {dependencyCount > 0 && <span className="ml-1 font-normal text-[var(--color-accent)] normal-case">· {dependencyCount}개</span>}
              </label>
            </div>
            <div className="col-span-full">
              <input
                type="text"
                value={depsInput}
                onChange={(e) => setDepsInput(e.target.value)}
                onBlur={() => {
                  const nums: number[] = depsInput
                    .split(/[\s,]+/)
                    .map(s => parseInt(s.trim(), 10))
                    .filter((n): n is number => !Number.isNaN(n) && n >= 1 && n <= maxDepNum);
                  const unique: number[] = Array.from(new Set<number>(nums));
                  const ids = unique.map((n: number) => numToId.get(n)).filter((id): id is string => id != null);
                  setFormData(prev => ({ ...prev, dependencies: ids }));
                  setDepsInput(unique.sort((a, b) => a - b).join(', '));
                }}
                placeholder="선행 작업 번호 (쉼표/공백 구분, 예: 1, 3, 4)"
                className="input-field py-1.5 text-sm w-full"
                title="쉼표 또는 공백으로 구분하여 선행 작업 번호 입력"
              />
            </div>

            {/* 설명(좌) · 체크리스트·산출물(우) - 2열로 화면 넓게 사용 */}
            <div className="col-span-full flex items-center gap-1.5 mb-0.5 mt-1">
              <span className="w-0.5 h-3.5 rounded-full bg-[var(--color-accent)]" aria-hidden />
              <span className="text-[11px] font-semibold text-[var(--color-ink-muted)] uppercase tracking-wider">설명 · 체크리스트 · 산출물</span>
            </div>
            <div className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-4 min-h-0">
              {/* 좌: 설명 */}
              <div className="min-w-0 flex flex-col min-h-0">
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <label className="text-[11px] font-medium text-[var(--color-ink)]">설명</label>
                  <button
                    type="button"
                    onClick={handleCorrectDescriptionWithAI}
                    disabled={isCorrectingDescription || !(formData.description ?? '').trim()}
                    className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] rounded-lg border border-indigo-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="설명란 내용을 맞춤법·형식 위주로 교정 (내용 변경 최소화)"
                  >
                    {isCorrectingDescription ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    AI로 교정
                  </button>
                </div>
                <textarea value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} onPaste={handlePaste} className="input-field py-1.5 px-2 text-sm min-h-[7rem] max-h-48 resize-y rounded-lg w-full" placeholder="상세 설명 (이미지 Ctrl+V)" rows={5} />
              </div>
              {/* 우: 체크리스트 + 산출물 - 모달 우측 절반 넓게 사용 */}
              <div className="min-w-0 flex flex-col gap-3">
                <div className="min-w-0 flex flex-col">
                  <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5 flex items-center justify-between">
                    <span>체크리스트</span>
                    <span className="text-[10px] text-[var(--color-ink-muted)] tabular-nums bg-slate-100 px-1.5 py-0.5 rounded">{formData.checklist?.filter(i => i.completed).length || 0}/{formData.checklist?.length || 0}</span>
                  </label>
                  {initialData?.id && formData.checklist && formData.checklist.length > 0 && (
                    <button type="button" onClick={handleConvertAllToSubtasks} className="text-[10px] text-blue-600 hover:underline mb-0.5">전체→하위작업</button>
                  )}
                  <div className="space-y-0.5 max-h-32 overflow-y-auto pr-0.5">
                    {formData.checklist?.map((item, index) => (
                      <div key={item.id} className="flex items-center gap-1 group">
                        <input type="checkbox" checked={item.completed} onChange={() => handleToggleChecklist(item.id)} className="rounded border-stone-300 text-blue-600 cursor-pointer shrink-0" />
                        <input type="text" value={item.text} onChange={(e) => { const c = [...(formData.checklist || [])]; c[index].text = e.target.value; setFormData({ ...formData, checklist: c }); }} className={`flex-1 min-w-0 py-0.5 text-xs border-0 bg-transparent focus:ring-0 ${item.completed ? 'line-through text-stone-400' : ''}`} />
                        {initialData?.id && <button type="button" onClick={() => handleConvertToSubtask(item)} className="p-0.5 text-stone-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 shrink-0" title="하위 작업으로 변환"><CornerDownRight size={11} /></button>}
                        <button type="button" onClick={() => handleDeleteChecklist(item.id)} className="p-0.5 text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 shrink-0" title="삭제"><X size={11} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1.5 mt-1">
                    <input type="text" value={newChecklistItem} onChange={(e) => setNewChecklistItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddChecklist())} placeholder="항목 추가" className="input-field py-1.5 text-xs flex-1 rounded-lg min-w-0" />
                    <button type="button" onClick={handleAddChecklist} disabled={!newChecklistItem.trim()} className="btn-secondary py-1.5 px-2 text-[11px] rounded-lg disabled:opacity-50 shrink-0">추가</button>
                  </div>
                </div>
                <div className="min-w-0 flex flex-col">
                  <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5 flex items-center justify-between">
                    <span>산출물</span>
                    <span className="text-[10px] text-[var(--color-ink-muted)] tabular-nums bg-slate-100 px-1.5 py-0.5 rounded">{deliverablesCount > 0 ? `${deliverablesCount}개` : '-'}</span>
                  </label>
                  <input type="text" value={formData.deliverables || ''} onChange={(e) => setFormData({ ...formData, deliverables: e.target.value })} placeholder="쉼표 구분" className="input-field py-1.5 text-sm rounded-lg w-full" />
                </div>
              </div>
            </div>
          </div>
        </form>
        <div className="px-4 py-2.5 flex justify-between items-center border-t border-[var(--color-line)] bg-slate-50/70 flex-shrink-0 gap-4">
          <div>
            {onDelete && initialData && (
              <button
                type="button"
                onClick={handleDeleteClick}
                className="text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] px-3 py-2 rounded-lg text-xs font-medium transition-colors"
              >
                작업 삭제
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost px-3 py-2 rounded-lg text-sm">
              취소
            </button>
            <button type="button" onClick={(e) => { e.preventDefault(); handleSubmit(e as React.FormEvent); }} className="btn-primary px-4 py-2 rounded-lg text-sm">
              저장
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        title="작업 삭제"
        message="이 작업을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다."
        confirmLabel="삭제"
        isDanger={true}
      />
    </div>
  );
}
