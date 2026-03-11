import React, { useState, useEffect } from 'react';
import { Task, TaskStatus, TaskAssignment } from '../types';
import { X, Trash2, CornerDownRight, Calculator, Info, Flag, Target } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { useWBS } from '../context/WBSContext';
import { computeEndDateFromEffort, computeWorkEffortFromDates } from '../lib/schedule';
import { randomUUID } from '../lib/utils';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Omit<Task, 'id'> | Partial<Task>) => void;
  onDelete?: () => void;
  initialData?: Task;
  parentOptions: Task[];
}

export function TaskModal({ isOpen, onClose, onSave, onDelete, initialData, parentOptions }: TaskModalProps) {
  const { wbsMap, displayWbsMap, addTask, updateTask, wbsSettings, projects, currentProjectId } = useWBS();
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
    baselineStartDate: undefined,
    baselineEndDate: undefined,
    baselineWorkEffort: undefined,
  });

  const [newChecklistItem, setNewChecklistItem] = useState('');

  const [depsInput, setDepsInput] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (initialData) {
      const { assignments: _a, ...rest } = initialData as any;
      setFormData(rest);
    } else {
      const defaultDate = taskProject?.startDate || new Date().toISOString().split('T')[0];
      setFormData({
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
        baselineStartDate: undefined,
        baselineEndDate: undefined,
        baselineWorkEffort: undefined,
      });
    }
  }, [initialData, isOpen, taskProject?.startDate]);

  const depOptions = parentOptions.filter(t => t.id !== initialData?.id);
  const idToNum = new Map(depOptions.map((t, i) => [t.id, i + 1]));
  const numToId = new Map(depOptions.map((t, i) => [i + 1, t.id]));
  const maxDepNum = depOptions.length;

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
    const nums = depsInput
      .split(/[\s,]+/)
      .map(s => parseInt(s.trim(), 10))
      .filter((n): n is number => !Number.isNaN(n) && n >= 1 && n <= maxDepNum);
    const unique = [...new Set(nums)];
    return unique.map(n => numToId.get(n)).filter((id): id is string => id != null);
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

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 backdrop-blur-sm p-2">
      <div className="bg-glass-elevated w-full max-w-5xl rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-300 border border-white/60 h-[90vh] max-h-[900px] flex flex-col">
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-200/50 bg-white/40 flex-shrink-0">
          <h2 className="font-bold text-lg tracking-tight text-[var(--color-ink)]">{initialData ? '작업 수정' : '새 작업'}</h2>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-white/60 rounded-full transition-all text-slate-400 hover:text-slate-800" aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4">
          <div className="h-full grid grid-cols-1 lg:grid-cols-3 gap-5 content-start">
            <div className="lg:col-span-3">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3">기본 정보</p>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">작업명</label>
              <input
                required
                type="text"
                list="task-name-suggestions"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input-field py-2 text-sm"
                placeholder="작업 이름..."
                autoFocus
              />
              <datalist id="task-name-suggestions">
                <option value="기획" /><option value="디자인" /><option value="프론트엔드 개발" /><option value="백엔드 개발" /><option value="테스트" /><option value="배포" /><option value="문서화" /><option value="미팅" />
              </datalist>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">상위 작업</label>
              <select
                value={formData.parentId || ''}
                onChange={(e) => setFormData({ ...formData, parentId: e.target.value || null })}
                className="input-field py-2 text-sm"
              >
                <option value="">없음 (최상위)</option>
                {parentOptions.filter(t => t.id !== initialData?.id).map((task) => (
                  <option key={task.id} value={task.id}>{displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">상태</label>
              <select
                value={formData.status}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  const config = wbsSettings.statusConfigs.find(c => c.id === newStatus);
                  setFormData(prev => ({ ...prev, status: newStatus, progress: config?.progress ?? prev.progress }));
                }}
                className="input-field py-2 text-sm"
              >
                {wbsSettings.statusConfigs.map(config => <option key={config.id} value={config.id}>{config.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">
                <span className="inline-flex items-center gap-1">
                  담당자
                  <span className="inline-flex items-center cursor-help text-stone-400 hover:text-stone-600" title="프로젝트 등록 인원을 선택하거나 직접 입력하여 추가할 수 있습니다. 투입비율은 프로젝트 설정에서 적용됩니다." aria-label="안내">
                    <Info size={12} />
                  </span>
                </span>
              </label>
              <input
                type="text"
                list="task-modal-assignees"
                value={formData.assignee || ''}
                onChange={(e) => setFormData({ ...formData, assignee: e.target.value })}
                placeholder="선택 또는 직접 입력"
                className="input-field py-2 text-sm"
              />
              <datalist id="task-modal-assignees">
                <option value="">선택 안 함</option>
                {assigneeOptions.map(a => <option key={a} value={a} />)}
              </datalist>
              {initialData?.assignments && initialData.assignments.length > 0 && (
                <p className="text-[11px] text-stone-600 mt-1.5 font-medium" role="note">
                  투입율: {initialData.assignments.map(a => `${a.assignee} ${a.allocationPercent}%`).join(', ')}
                </p>
              )}
              <p className="text-[10px] text-stone-500 mt-1" role="note">투입비율은 프로젝트 설정에서 적용됩니다.</p>
            </div>

            <div className="lg:col-span-3">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3">일정</p>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">시작일</label>
              <input required type="date" value={formData.startDate?.split('T')[0]} onChange={(e) => setFormData({ ...formData, startDate: e.target.value })} className="input-field py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">종료일</label>
              <input required type="date" value={formData.endDate?.split('T')[0]} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} className="input-field py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">진행률 %</label>
              <input type="number" min="0" max="100" value={formData.progress} onChange={(e) => setFormData({ ...formData, progress: parseInt(e.target.value) || 0 })} className="input-field py-2 text-sm" />
            </div>
            <div className="lg:col-span-2 flex items-end">
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1 w-full">작업 공수 (D)</label>
            </div>
            <div className="lg:col-span-2 flex gap-2 items-center flex-wrap -mt-1">
              <input type="number" min="0" step="0.5" value={formData.workEffort ?? ''} onChange={(e) => setFormData({ ...formData, workEffort: e.target.value === '' ? undefined : parseFloat(e.target.value) })} className="input-field py-2 text-sm w-20" placeholder="0.5" aria-label="작업 공수" />
              <button type="button" onClick={handleApplyEndDateFromEffort} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg border border-blue-200 transition-colors" title="시작일·공수·투입비율 → 종료일"><Calculator size={12} /> 기간 자동</button>
              <button type="button" onClick={handleApplyWorkEffortFromDates} className="px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 rounded-lg border border-stone-200 transition-colors" title="시작일·종료일 → 공수">공수 역산</button>
              <span className="inline-flex items-center cursor-help text-stone-400 hover:text-stone-600 p-1" title={effortHelpText} aria-label="공수 도움말">
                <button type="button" onClick={() => setShowHelp(!showHelp)} className="rounded focus:ring-2 focus:ring-indigo-300" aria-expanded={showHelp} aria-label="도움말 토글">
                  <Info size={14} />
                </button>
              </span>
            </div>
            {showHelp && (
              <div className="lg:col-span-3 rounded-xl bg-blue-50/90 border border-blue-100 p-3 text-xs text-stone-600" role="status">
                {effortHelpText}
              </div>
            )}

            <div className="lg:col-span-3">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">작업 옵션</p>
              <div className="flex items-center gap-6 flex-wrap rounded-xl bg-slate-50/80 border border-slate-100 px-4 py-3">
                <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                  <input type="checkbox" checked={!!formData.isMilestone} onChange={(e) => { const checked = e.target.checked; setFormData(prev => ({ ...prev, isMilestone: checked, ...(checked && prev.startDate ? { endDate: prev.startDate, workEffort: 0 } : {}) })); }} className="rounded border-stone-300 text-indigo-600 focus:ring-indigo-500" />
                  <Flag size={14} className="text-amber-500 shrink-0" aria-hidden />
                  <span>마일스톤</span>
                  <span className="text-[10px] text-stone-400 font-normal">(이정표, 일정 한 시점)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                  <input
                    type="checkbox"
                    checked={!!(formData.baselineStartDate || formData.baselineEndDate)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setFormData(prev => ({
                        ...prev,
                        ...(checked
                          ? {
                              baselineStartDate: prev.startDate || new Date().toISOString().split('T')[0],
                              baselineEndDate: prev.endDate || prev.startDate || new Date().toISOString().split('T')[0],
                              baselineWorkEffort: typeof prev.workEffort === 'number' ? prev.workEffort : prev.workEffort ?? 0.5,
                            }
                          : { baselineStartDate: undefined, baselineEndDate: undefined, baselineWorkEffort: undefined }),
                      }));
                    }}
                    className="rounded border-stone-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <Target size={14} className="text-slate-500 shrink-0" aria-hidden />
                  <span>베이스라인</span>
                  <span className="text-[10px] text-stone-400 font-normal">(기준 일정 비교용)</span>
                </label>
              </div>
            </div>

            <div className="lg:col-span-3">
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">
                의존성 (번호로 입력)
                {dependencyCount > 0 && <span className="ml-1.5 font-normal text-indigo-600">· 선택 {dependencyCount}개</span>}
              </label>
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  value={depsInput}
                  onChange={(e) => setDepsInput(e.target.value)}
                  onBlur={() => {
                    const nums = depsInput
                      .split(/[\s,]+/)
                      .map(s => parseInt(s.trim(), 10))
                      .filter((n): n is number => !Number.isNaN(n) && n >= 1 && n <= maxDepNum);
                    const unique = [...new Set(nums)];
                    const ids = unique.map(n => numToId.get(n)).filter((id): id is string => id != null);
                    setFormData(prev => ({ ...prev, dependencies: ids }));
                    setDepsInput(unique.sort((a, b) => a - b).join(', '));
                  }}
                  placeholder="예: 1, 3, 4"
                  className="input-field py-2 text-sm"
                />
                <p className="text-[10px] text-stone-500">쉼표 또는 공백으로 구분하여 선행 작업 번호 입력 (예: 1, 3, 4)</p>
              </div>
            </div>

            <div className="lg:col-span-3">
              <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-3">설명 · 체크리스트 · 산출물</p>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">설명</label>
              <textarea value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} onPaste={handlePaste} className="input-field py-1.5 text-sm min-h-[5rem] resize-y" placeholder="상세 설명 (이미지 Ctrl+V)" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>체크리스트</span>
                <span className="text-stone-400 font-normal tabular-nums">{formData.checklist?.filter(i => i.completed).length || 0}/{formData.checklist?.length || 0}</span>
              </label>
              {initialData?.id && formData.checklist && formData.checklist.length > 0 && (
                <button type="button" onClick={handleConvertAllToSubtasks} className="text-[10px] text-blue-600 hover:underline mb-1">전체→하위작업</button>
              )}
              <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                {formData.checklist?.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-1 group">
                    <input type="checkbox" checked={item.completed} onChange={() => handleToggleChecklist(item.id)} className="rounded border-stone-300 text-blue-600 cursor-pointer" />
                    <input type="text" value={item.text} onChange={(e) => { const c = [...(formData.checklist || [])]; c[index].text = e.target.value; setFormData({ ...formData, checklist: c }); }} className={`flex-1 min-w-0 py-0.5 text-xs border-0 bg-transparent focus:ring-0 ${item.completed ? 'line-through text-stone-400' : ''}`} />
                    {initialData?.id && <button type="button" onClick={() => handleConvertToSubtask(item)} className="p-0.5 text-stone-400 hover:text-blue-500 opacity-0 group-hover:opacity-100" title="하위 작업으로 변환"><CornerDownRight size={12} /></button>}
                    <button type="button" onClick={() => handleDeleteChecklist(item.id)} className="p-0.5 text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100" title="삭제"><X size={12} /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1 mt-1">
                <input type="text" value={newChecklistItem} onChange={(e) => setNewChecklistItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddChecklist())} placeholder="항목 추가" className="input-field py-1 text-sm flex-1" />
                <button type="button" onClick={handleAddChecklist} disabled={!newChecklistItem.trim()} className="btn-secondary py-1 px-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed">추가</button>
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>산출물</span>
                <span className="text-stone-400 font-normal tabular-nums">{deliverablesCount > 0 ? `${deliverablesCount}개` : '비어 있음'}</span>
              </label>
              <input type="text" value={formData.deliverables || ''} onChange={(e) => setFormData({ ...formData, deliverables: e.target.value })} placeholder="보고서, 설계서 등 (쉼표로 구분)" className="input-field py-2 text-sm" />
            </div>
          </div>
        </form>
        <div className="px-4 py-3 flex justify-between items-center border-t border-slate-200/50 bg-slate-50/50 flex-shrink-0 gap-4">
          <div>
            {onDelete && initialData && (
              <button
                type="button"
                onClick={handleDeleteClick}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-xl text-sm font-medium transition-colors"
              >
                작업 삭제
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              취소
            </button>
            <button type="button" onClick={(e) => { e.preventDefault(); handleSubmit(e as React.FormEvent); }} className="btn-primary">
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
