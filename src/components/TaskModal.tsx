import React, { useState, useEffect } from 'react';
import { Task, TaskStatus } from '../types';
import { X, Plus, Trash2, GripVertical, CornerDownRight } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { useWBS } from '../context/WBSContext';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Omit<Task, 'id'> | Partial<Task>) => void;
  onDelete?: () => void;
  initialData?: Task;
  parentOptions: Task[];
}

export function TaskModal({ isOpen, onClose, onSave, onDelete, initialData, parentOptions }: TaskModalProps) {
  const { wbsMap, displayWbsMap, addTask, updateTask } = useWBS();
  const [formData, setFormData] = useState<Partial<Task>>({
    name: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    progress: 0,
    workEffort: 0.5,
    assignee: '',
    status: 'todo',
    parentId: null,
    description: '',
    checklist: [],
    deliverables: '',
  });

  const [newChecklistItem, setNewChecklistItem] = useState('');

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    } else {
      setFormData({
        name: '',
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        progress: 0,
        workEffort: 0.5,
        assignee: '',
        status: 'todo',
        parentId: null,
        description: '',
        checklist: [],
        deliverables: '',
      });
    }
  }, [initialData, isOpen]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (initialData && initialData.id === '') {
      // It's a new task pre-filled (e.g. from context menu "Add Child")
      // We need to strip the ID so the context adds a new one
      const { id, ...rest } = formData as Task;
      onSave(rest);
    } else {
      onSave(formData as any);
    }
    onClose();
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
    const newItem = { id: crypto.randomUUID(), text: newChecklistItem.trim(), completed: false };
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

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-4xl rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-[var(--color-line)] max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-5 border-b border-[var(--color-line)] bg-stone-50 flex-shrink-0">
          <h2 className="font-bold text-lg text-[var(--color-ink)]">{initialData ? '작업 수정' : '새 작업'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-stone-200 rounded-full transition-colors text-stone-500 hover:text-[var(--color-ink)]">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left Column: Basic Info */}
            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">작업명</label>
                <input
                  required
                  type="text"
                  list="task-name-suggestions"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input-field"
                  placeholder="작업 이름을 입력하세요..."
                  autoFocus
                />
                <datalist id="task-name-suggestions">
                  <option value="기획" />
                  <option value="디자인" />
                  <option value="프론트엔드 개발" />
                  <option value="백엔드 개발" />
                  <option value="테스트" />
                  <option value="배포" />
                  <option value="문서화" />
                  <option value="미팅" />
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">시작일</label>
                  <input
                    required
                    type="date"
                    value={formData.startDate?.split('T')[0]}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">종료일</label>
                  <input
                    required
                    type="date"
                    value={formData.endDate?.split('T')[0]}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">상위 작업</label>
                  <select
                    value={formData.parentId || ''}
                    onChange={(e) => setFormData({ ...formData, parentId: e.target.value || null })}
                    className="input-field"
                  >
                    <option value="">없음 (최상위)</option>
                    {parentOptions.filter(t => t.id !== initialData?.id).map((task) => (
                      <option key={task.id} value={task.id}>
                        {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">상태</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as TaskStatus })}
                    className="input-field"
                  >
                    <option value="todo">할 일</option>
                    <option value="in-progress">진행 중</option>
                    <option value="done">완료</option>
                    <option value="blocked">지연됨</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">담당자</label>
                  <select
                    value={formData.assignee || ''}
                    onChange={(e) => setFormData({ ...formData, assignee: e.target.value })}
                    className="input-field"
                  >
                    <option value="">배정 안됨 (새 담당자는 표에서 입력)</option>
                    {Array.from(new Set(parentOptions.map(t => t.assignee).filter(Boolean))).map(assignee => (
                      <option key={assignee} value={assignee}>{assignee}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">진행률 (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.progress}
                    onChange={(e) => setFormData({ ...formData, progress: parseInt(e.target.value) })}
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">작업 공수 (D)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={formData.workEffort ?? ''}
                  onChange={(e) => setFormData({ ...formData, workEffort: parseFloat(e.target.value) })}
                  className="input-field"
                  placeholder="0.5"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">의존성 (다중 선택: Ctrl/Cmd + 클릭)</label>
                <select
                  multiple
                  value={formData.dependencies || []}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions, (option: HTMLOptionElement) => option.value);
                    setFormData({ ...formData, dependencies: selected });
                  }}
                  className="input-field h-24"
                >
                  {parentOptions
                    .filter(t => t.id !== initialData?.id) // Cannot depend on self
                    .map((task) => (
                      <option key={task.id} value={task.id}>
                        {displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-stone-400 mt-1">이 작업이 시작되기 전에 완료되어야 하는 작업들을 선택하세요.</p>
              </div>
            </div>

            {/* Right Column: Extended Details */}
            <div className="space-y-6">
              {/* Description */}
              <div>
                <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5 flex justify-between">
                  <span>설명</span>
                  <span className="text-[9px] text-stone-400 font-normal normal-case">이미지를 붙여넣기(Ctrl+V)할 수 있습니다.</span>
                </label>
                <textarea
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  onPaste={handlePaste}
                  className="input-field min-h-[100px] resize-y"
                  placeholder="작업에 대한 상세 설명을 입력하세요..."
                />
              </div>

              {/* Checklist */}
              <div>
                <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>체크리스트</span>
                    {initialData && initialData.id && formData.checklist && formData.checklist.length > 0 && (
                      <button
                        type="button"
                        onClick={handleConvertAllToSubtasks}
                        className="text-stone-400 hover:text-blue-500 flex items-center gap-1 group/convert transition-colors"
                        title="모든 항목을 하위 작업으로 변환"
                      >
                        <CornerDownRight size={12} className="group-hover/convert:translate-x-0.5 transition-transform" />
                        전체 하위작업으로 변환
                      </button>
                    )}
                  </div>
                  <span className="text-stone-400 font-normal">
                    {formData.checklist?.filter(i => i.completed).length || 0} / {formData.checklist?.length || 0}
                  </span>
                </label>

                {/* Progress Bar for Checklist */}
                {formData.checklist && formData.checklist.length > 0 && (
                  <div className="h-1.5 w-full bg-stone-100 rounded-full mb-3 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${(formData.checklist.filter(i => i.completed).length / formData.checklist.length) * 100}%` }}
                    />
                  </div>
                )}

                <div className="space-y-2 mb-3 max-h-[150px] overflow-y-auto pr-1">
                  {formData.checklist?.map((item, index) => (
                    <div key={item.id} className="flex items-start gap-2 group">
                      <div className="pt-1 cursor-grab text-stone-300 hover:text-stone-500">
                        <GripVertical size={14} />
                      </div>
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => handleToggleChecklist(item.id)}
                        className="mt-1 rounded border-stone-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={item.text}
                        onChange={(e) => {
                          const newChecklist = [...(formData.checklist || [])];
                          newChecklist[index].text = e.target.value;
                          setFormData({ ...formData, checklist: newChecklist });
                        }}
                        className={`flex-1 bg-transparent border-none text-sm p-0 focus:ring-0 ${item.completed ? 'text-stone-400 line-through' : 'text-stone-700'}`}
                      />
                      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        {initialData && initialData.id && (
                          <button
                            type="button"
                            onClick={() => handleConvertToSubtask(item)}
                            className="text-stone-400 hover:text-blue-500 p-1"
                            title="하위 작업으로 변환"
                          >
                            <CornerDownRight size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteChecklist(item.id)}
                          className="text-stone-300 hover:text-red-500 p-1"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newChecklistItem}
                    onChange={(e) => setNewChecklistItem(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddChecklist();
                      }
                    }}
                    placeholder="항목 추가..."
                    className="input-field flex-1"
                  />
                  <button
                    type="button"
                    onClick={handleAddChecklist}
                    disabled={!newChecklistItem.trim()}
                    className="btn-secondary px-3"
                  >
                    추가
                  </button>
                </div>
              </div>

              {/* Deliverables */}
              <div>
                <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">산출물</label>
                <textarea
                  value={formData.deliverables || ''}
                  onChange={(e) => setFormData({ ...formData, deliverables: e.target.value })}
                  placeholder="이 작업의 산출물을 입력하세요 (예: 보고서, 설계서, 소스코드 등)"
                  className="input-field h-24 resize-none"
                />
              </div>
            </div>
          </div>

        </form>
        <div className="p-4 flex justify-between items-center border-t border-[var(--color-line)] bg-stone-50 flex-shrink-0">
          <div>
            {onDelete && initialData && (
              <button
                type="button"
                onClick={handleDeleteClick}
                className="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                작업 삭제
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost"
            >
              취소
            </button>
            <button
              type="button" // Change to button since form submission is separated
              onClick={handleSubmit}
              className="btn-primary"
            >
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
