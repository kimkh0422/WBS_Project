import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { Task, TaskStatus } from '../types';
import { X, Trash2, CornerDownRight, Calculator, Info, Flag, Bug, Sparkles, Loader2 } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { useWBS } from '../context/WBSContext';
import { computeEndDateFromEffort, computeWorkEffortFromDates } from '../lib/schedule';
import { randomUUID, cn, round2 } from '../lib/utils';
import { useToast } from './Toast';
import { GoogleGenAI } from '@google/genai';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import * as Y from 'yjs';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { SupabaseYjsProvider } from '../lib/yjsSupabaseProvider';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Omit<Task, 'id'> | Partial<Task>) => void;
  onDelete?: () => void;
  initialData?: Task;
  parentOptions: Task[];
  /** 보기 전용(편집 불가). 보기 권한만 있을 때 true */
  readOnly?: boolean;
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
const DESCRIPTION_CORRECTION_PROMPT = `다음 작업 설명을 (1) 교정하고 (2) 설명 내용을 바탕으로 실행 가능한 체크리스트 항목을 도출하세요.

규칙:
- description: 의미는 유지하고 맞춤법·띄어쓰기·문장 부호·문단만 정리. 마크다운은 유지.
- checklist: 3~12개, 짧은 한 줄 항목(동사형 또는 명사구), 중복·너무 세분화된 항목은 제외.

반드시 아래 형식의 JSON만 출력하세요. 앞뒤 설명·코드펜스(\`\`\`) 금지.
{"description":"교정된 설명 전체","checklist":["항목1","항목2",...]}`;

function parseDescriptionCorrectionJson(raw: string): { description: string; checklist: string[] } | null {
  const trimmed = raw.trim();
  const block = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (block?.[1] ?? trimmed).trim();
  const brace = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (brace < 0 || end <= brace) return null;
  try {
    const obj = JSON.parse(candidate.slice(brace, end + 1)) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    const o = obj as Record<string, unknown>;
    if (typeof o.description !== 'string') return null;
    const list = Array.isArray(o.checklist)
      ? o.checklist.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean)
      : [];
    const seen = new Set<string>();
    const deduped = list.filter(t => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { description: o.description.trim(), checklist: deduped };
  } catch {
    return null;
  }
}

function tiptapDocFromPlainText(text: string) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const content = lines.map((line, idx) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
    ...(idx < lines.length - 1 ? {} : {}),
  }));
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }] } as any;
}

function colorForUserId(uid: string) {
  const palette = ['#2563eb', '#16a34a', '#f97316', '#db2777', '#7c3aed', '#0ea5e9', '#ca8a04', '#dc2626'];
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}

/** Y.Doc 준비 후에만 마운트 — 부모에서 useEditor(null) 호출로 크래시 나지 않게 함 */
function TaskDescriptionCollabEditor({
  doc,
  awareness,
  readOnly,
  initialPlainText,
  onPlainTextChange,
  userName,
  userColor,
  onPaste,
}: {
  doc: Y.Doc;
  awareness: import('y-protocols/awareness').Awareness;
  readOnly: boolean;
  initialPlainText: string;
  onPlainTextChange: (text: string) => void;
  userName: string;
  userColor: string;
  onPaste?: (e: React.ClipboardEvent) => void;
}) {
  const seededRef = useRef(false);
  const editor = useEditor({
    immediatelyRender: true,
    extensions: [
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: doc, field: 'description' }),
      // TipTap CollaborationCursor는 provider.awareness 를 참조함 (Awareness 단독 전달 시 크래시)
      CollaborationCursor.configure({
        provider: { awareness } as any,
        user: { name: userName, color: userColor },
      }),
    ],
    content: tiptapDocFromPlainText(initialPlainText),
    editable: !readOnly,
    editorProps: {
      attributes: {
        class:
          'input-field py-1.5 px-2 text-sm min-h-[7rem] max-h-48 resize-y rounded-lg w-full overflow-auto focus:outline-none',
      },
    },
    onUpdate: ({ editor: ed }: { editor: { getText: (o: { blockSeparator: string }) => string } }) => {
      const text = ed.getText({ blockSeparator: '\n' });
      onPlainTextChange(text);
    },
  });

  useEffect(() => {
    if (!editor || seededRef.current) return;
    const cur = editor.getText({ blockSeparator: '\n' });
    const src = String(initialPlainText ?? '').trim();
    if (!cur.trim() && src) {
      editor.commands.setContent(tiptapDocFromPlainText(initialPlainText), false);
    }
    seededRef.current = true;
  }, [editor, initialPlainText]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) return <div className="input-field min-h-[7rem] rounded-lg bg-stone-50 animate-pulse" aria-hidden />;
  return (
    <div onPaste={onPaste}>
      <EditorContent editor={editor} />
    </div>
  );
}

export function TaskModal({ isOpen, onClose, onSave, onDelete, initialData, parentOptions, readOnly: readOnlyProp, onOpenTask, defaultAssignee, defaultStartDate, defaultEndDate }: TaskModalProps) {
  const { wbsMap, displayWbsMap, addTask, updateTask, wbsSettings, projects, currentProjectId, editableProjectIds } = useWBS();
  const taskProjectId = initialData?.projectId ?? currentProjectId;
  const readOnly = readOnlyProp ?? (editableProjectIds != null && editableProjectIds.length > 0 && !editableProjectIds.includes(taskProjectId ?? ''));
  const { push: pushToast } = useToast();
  const { user } = useAuth();
  const currentUserId = user?.id ?? '';
  const currentUserName = String((user as any)?.user_metadata?.full_name ?? user?.email ?? '').trim() || '(이름 없음)';
  const currentUserColor = currentUserId ? colorForUserId(currentUserId) : '#2563eb';
  const taskProject = projects.find(p => p.id === taskProjectId);
  const projectAssignments = (taskProject?.assignments ?? []).map(a => ({ assignee: a.assignee, allocationPercent: a.allocationPercent }));
  const defaultDate = taskProject?.startDate || new Date().toISOString().split('T')[0];
  type TaskFormState = Partial<Task> & { allocationPercent?: number };
  const [formData, setFormData] = useState<TaskFormState>({
    name: '',
    startDate: defaultDate,
    endDate: defaultDate,
    progress: 0,
    workEffort: 0.5,
    assignee: '',
    allocationPercent: 100,
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

  // 진행률 입력: type=number + 즉시 숫자변환은 일부 브라우저/IME에서 "80" 같은 입력이 막히는 케이스가 있어
  // 입력 중에는 문자열로 유지하고(중간 상태 허용), blur/저장 시점에만 숫자 변환/검증한다.
  const [progressInput, setProgressInput] = useState<string>('0');
  const [progressTouched, setProgressTouched] = useState(false);
  const progressTouchedRef = useRef(false);
  const markProgressTouched = () => {
    if (!progressTouchedRef.current) progressTouchedRef.current = true;
    setProgressTouched(true);
  };

  const [newChecklistItem, setNewChecklistItem] = useState('');

  const [depsInput, setDepsInput] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [isCorrectingDescription, setIsCorrectingDescription] = useState(false);

  // ─── CRDT: Y.Doc 생성 후 자식에서만 useEditor 호출 (null 전달 크래시 방지) ─
  const [descCollab, setDescCollab] = useState<{ doc: Y.Doc; provider: SupabaseYjsProvider } | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      setDescCollab(null);
      return;
    }
    const pid = String(taskProjectId ?? '').trim();
    const canCollab =
      isSupabaseConfigured &&
      !!supabase &&
      !!initialData?.id &&
      !!pid &&
      !!currentUserId;
    if (!canCollab) {
      setDescCollab(null);
      return;
    }
    const doc = new Y.Doc();
    const provider = new SupabaseYjsProvider({
      supabase: supabase!,
      channelName: `wbs-desc-${pid}-${initialData!.id}`,
      doc,
      clientId: `${currentUserId}:${pid}:${initialData!.id}`,
    });
    provider.awareness.setLocalStateField('user', { name: currentUserName, color: currentUserColor });
    provider.connect();
    setDescCollab({ doc, provider });
    return () => {
      provider.destroy();
      doc.destroy();
    };
  }, [isOpen, initialData?.id, taskProjectId, currentUserId, currentUserName, currentUserColor]);

  const parentOptionsRef = useRef(parentOptions);
  const displayWbsMapRef = useRef(displayWbsMap);
  parentOptionsRef.current = parentOptions;
  displayWbsMapRef.current = displayWbsMap;

  /** 하위 작업과 동일한 체크리스트 항목 제외(하위 작업 영역과 중복 표시 방지) */
  const filterChecklistAgainstChildren = (
    checklist: { id: string; text: string; completed: boolean }[] | undefined,
    parentTaskId: string,
    options: Task[],
    wbsMap: Map<string, string>,
  ) => {
    const direct = options.filter((t) => t.parentId === parentTaskId);
    const childIds = new Set(direct.map((t) => t.id));
    const childTitles = new Set(
      direct.map((c) => {
        const wbs = wbsMap.get(c.id);
        return (wbs ? `${wbs} ${c.name}` : c.name).trim();
      }),
    );
    return (checklist || []).filter(
      (item) => !childIds.has(item.id) && !childTitles.has(item.text.trim()),
    );
  };

  useEffect(() => {
    if (initialData) {
      const { ...rest } = initialData as Task;
      const assignee = (rest.assignee || '').trim();
      const projectMatch = projectAssignments.find(a => (a.assignee || '').trim() === assignee);
      const allocationPercent = projectMatch?.allocationPercent ?? 100;
      const checklist = filterChecklistAgainstChildren(
        rest.checklist,
        initialData.id,
        parentOptionsRef.current,
        displayWbsMapRef.current,
      );
      setFormData({ ...rest, checklist, allocationPercent });
      setProgressInput(typeof rest.progress === 'number' && Number.isFinite(rest.progress) ? String(rest.progress) : '');
      progressTouchedRef.current = false;
      setProgressTouched(false);
    } else {
      const defaultDate = taskProject?.startDate || new Date().toISOString().split('T')[0];
      const projectMatch = defaultAssignee ? projectAssignments.find(a => (a.assignee || '').trim() === (defaultAssignee || '').trim()) : undefined;
      setFormData({
        name: '',
        startDate: defaultStartDate || defaultDate,
        endDate: defaultEndDate || defaultDate,
        progress: 0,
        workEffort: 0.5,
        assignee: defaultAssignee || '',
        allocationPercent: projectMatch?.allocationPercent ?? 100,
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
      setProgressInput('0');
      progressTouchedRef.current = false;
      setProgressTouched(false);
    }
  }, [initialData, isOpen, taskProject?.startDate, defaultAssignee, defaultStartDate, defaultEndDate]);

  useEffect(() => {
    // 모달 열림/초기 데이터 변경 시 진행률 입력값 동기화
    const v = initialData?.progress ?? formData.progress;
    setProgressInput(typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  }, [isOpen, initialData?.id]);

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

  /** 저장·편집용: 하위 작업과 겹치지 않는 체크리스트만 (하위는 화면에서 자동 표시) */
  const manualChecklist = useMemo(() => {
    if (!initialData?.id) return formData.checklist || [];
    return filterChecklistAgainstChildren(
      formData.checklist,
      initialData.id,
      parentOptions,
      displayWbsMap,
    );
  }, [formData.checklist, initialData?.id, parentOptions, displayWbsMap]);

  const childChecklistCompleted = useMemo(
    () =>
      childTasks.filter((c) => c.status === 'done' || (c.progress ?? 0) >= 100).length,
    [childTasks],
  );
  const checklistDoneCount = childChecklistCompleted + manualChecklist.filter((i) => i.completed).length;
  const checklistTotalCount = childTasks.length + manualChecklist.length;

  const handleToggleChildInChecklist = (childId: string) => {
    const child = parentOptions.find((t) => t.id === childId);
    if (!child) return;
    const completed = child.status === 'done' || (child.progress ?? 0) >= 100;
    const doneCfg =
      wbsSettings.statusConfigs.find((c) => (c.progress ?? 0) >= 100) ??
      wbsSettings.statusConfigs.find((c) => c.id === 'done');
    const todoCfg = wbsSettings.statusConfigs.find((c) => c.id === 'todo');
    if (completed) {
      updateTask(childId, {
        status: todoCfg?.id ?? 'todo',
        progress: todoCfg?.progress ?? 0,
      });
    } else {
      updateTask(childId, {
        status: doneCfg?.id ?? 'done',
        progress: doneCfg?.progress ?? 100,
      });
    }
  };

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
    if (readOnly) return;
    // 입력 중 문자열로 유지되는 진행률을 저장 직전에 확정
    const parsedProgress = (() => {
      const raw = progressInput.trim();
      const parsed = raw === '' ? 0 : parseFloat(raw);
      if (!Number.isFinite(parsed)) return 0;
      return Math.min(100, Math.max(0, round2(parsed)));
    })();
    const parsedDeps = parseDepsInput();
    let checklist = formData.checklist;
    if (initialData?.id) {
      checklist = filterChecklistAgainstChildren(
        formData.checklist,
        initialData.id,
        parentOptions,
        displayWbsMap,
      );
    }
    const toMerge = { ...formData, progress: parsedProgress, dependencies: parsedDeps, checklist };
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
    const { allocationPercent: _ap, ...toMergeRest } = toMerge as TaskFormState;
    const toSave = { ...toMergeRest } as Partial<Task>;
    if (typeof toSave.progress === 'number' && Number.isFinite(toSave.progress)) toSave.progress = round2(toSave.progress);
    if (typeof toSave.weight === 'number' && Number.isFinite(toSave.weight)) toSave.weight = round2(toSave.weight);
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
    const assignee = (formData.assignee || '').trim();
    const pct = Math.min(100, Math.max(0, formData.allocationPercent ?? 100));
    const assignmentsForEffort = assignee ? [{ assignee, allocationPercent: pct }] : projectAssignments.length > 0 ? projectAssignments : undefined;
    let end = computeEndDateFromEffort(start, effort, assignmentsForEffort);
    if (taskProject?.endDate && end > taskProject.endDate) end = taskProject.endDate;
    setFormData(prev => ({ ...prev, startDate: start, endDate: end }));
  };

  const handleApplyWorkEffortFromDates = () => {
    const start = formData.startDate || new Date().toISOString().split('T')[0];
    const end = formData.endDate || start;
    const assignee = (formData.assignee || '').trim();
    const pct = Math.min(100, Math.max(0, formData.allocationPercent ?? 100));
    const assignmentsForEffort = assignee ? [{ assignee, allocationPercent: pct }] : projectAssignments.length > 0 ? projectAssignments : undefined;
    const effort = computeWorkEffortFromDates(start, end, assignmentsForEffort);
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
      if (!text) {
        pushToast('AI 응답이 비어 있습니다.', { variant: 'warning' });
        return;
      }
      const parsed = parseDescriptionCorrectionJson(text);
      if (parsed) {
        let addedCount = 0;
        setFormData(prev => {
          const childTitleKeys = new Set<string>();
          if (initialData?.id) {
            parentOptions
              .filter((t) => t.parentId === initialData.id)
              .forEach((c) => {
                const wbs = displayWbsMap.get(c.id);
                childTitleKeys.add((wbs ? `${wbs} ${c.name}` : c.name).trim().toLowerCase());
                childTitleKeys.add(c.name.trim().toLowerCase());
              });
          }
          const existingTexts = new Set(
            (prev.checklist ?? []).map((i) => i.text.trim().toLowerCase()),
          );
          const newItems = parsed.checklist
            .filter(
              (t) =>
                !existingTexts.has(t.toLowerCase()) && !childTitleKeys.has(t.trim().toLowerCase()),
            )
            .map((t) => ({ id: randomUUID(), text: t, completed: false }));
          addedCount = newItems.length;
          return {
            ...prev,
            description: parsed.description,
            checklist: [...(prev.checklist || []), ...newItems],
          };
        });
        pushToast(
          addedCount > 0
            ? `설명을 교정했고 체크리스트 ${addedCount}개를 추가했습니다.`
            : '설명을 교정했습니다. (추가할 새 체크리스트 항목 없음)',
        );
      } else {
        setFormData(prev => ({ ...prev, description: text }));
        pushToast('설명만 반영했습니다. (JSON 형식이 아니어 체크리스트는 건너뜀)', { variant: 'warning' });
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

  const handleConvertToSubtask = (item: { id: string; text: string; completed?: boolean }) => {
    if (!initialData || !initialData.id) return; // Must have an existing task to add a subtask to

    const today = new Date().toISOString().split('T')[0];
    const trimmedName = item.text.trim();
    const isDone = !!item.completed;
    const doneCfg =
      wbsSettings.statusConfigs.find((c) => (c.progress ?? 0) >= 100) ??
      wbsSettings.statusConfigs.find((c) => c.id === 'done');
    const todoCfg = wbsSettings.statusConfigs.find((c) => c.id === 'todo');

    // 이미 같은 이름의 직속 하위 작업이 있으면 새로 만들지 않음
    const exists = childTasks.some(
      (t) => t.parentId === initialData.id && t.name.trim() === trimmedName,
    );

    if (!exists) {
      addTask({
        name: trimmedName,
        startDate: formData.startDate || today,
        endDate: formData.endDate || today,
        progress: isDone ? (doneCfg?.progress ?? 100) : (todoCfg?.progress ?? 0),
        assignee: formData.assignee || '',
        status: isDone ? (doneCfg?.id ?? 'done') : (todoCfg?.id ?? 'todo'),
        parentId: initialData.id,
      });
    }

    // 체크리스트에서는 제거
    handleDeleteChecklist(item.id);
  };

  const handleConvertAllToSubtasks = () => {
    if (!initialData || !initialData.id) return;
    if (!manualChecklist.length) return;

    const today = new Date().toISOString().split('T')[0];
    const doneCfg =
      wbsSettings.statusConfigs.find((c) => (c.progress ?? 0) >= 100) ??
      wbsSettings.statusConfigs.find((c) => c.id === 'done');
    const todoCfg = wbsSettings.statusConfigs.find((c) => c.id === 'todo');

    // 이미 존재하는 하위 작업 이름 집합 (트림 기준)
    const existingNames = new Set(
      childTasks
        .filter((t) => t.parentId === initialData.id)
        .map((t) => t.name.trim()),
    );

    manualChecklist.forEach((item) => {
      const trimmedName = item.text.trim();
      if (!trimmedName) return;

      if (!existingNames.has(trimmedName)) {
        const isDone = !!item.completed;
        addTask({
          name: trimmedName,
          startDate: formData.startDate || today,
          endDate: formData.endDate || today,
          progress: isDone ? (doneCfg?.progress ?? 100) : (todoCfg?.progress ?? 0),
          assignee: formData.assignee || '',
          status: isDone ? (doneCfg?.id ?? 'done') : (todoCfg?.id ?? 'todo'),
          parentId: initialData.id,
        });
        existingNames.add(trimmedName);
      }
    });

    // 체크리스트는 비움
    setFormData((prev) => ({
      ...prev,
      checklist: [],
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
          <h2 className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">{initialData ? (readOnly ? '작업 보기' : '작업 수정') : '새 작업'}</h2>
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
                readOnly={readOnly}
                disabled={readOnly}
              />
              <datalist id="task-name-suggestions">
                <option value="기획" /><option value="디자인" /><option value="프론트엔드 개발" /><option value="백엔드 개발" /><option value="테스트" /><option value="배포" /><option value="문서화" /><option value="미팅" />
              </datalist>
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">상위 작업</label>
              <div className="flex items-center gap-1.5">
                <select
                  value={formData.parentId || ''}
                  onChange={(e) => setFormData({ ...formData, parentId: e.target.value || null })}
                  className="input-field py-1.5 text-sm flex-1"
                  disabled={readOnly}
                >
                  <option value="">없음</option>
                  {parentOptions.filter(t => t.id !== initialData?.id).map((task) => (
                    <option key={task.id} value={task.id}>{displayWbsMap.get(task.id) ? `${displayWbsMap.get(task.id)} ` : ''}{task.name}</option>
                  ))}
                </select>
                {initialData?.parentId && onOpenTask && (
                  <button
                    type="button"
                    onClick={() => {
                      const parentTask = parentOptions.find(t => t.id === initialData.parentId);
                      if (parentTask) onOpenTask(parentTask);
                    }}
                    className="px-2 py-1.5 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] rounded-lg border border-indigo-200 transition-colors whitespace-nowrap"
                    title="상위 작업 열기"
                  >
                    상위 열기
                  </button>
                )}
              </div>
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">상태</label>
              <select
                value={formData.status}
                onChange={(e) => {
                  const newStatus = e.target.value;
                  const config = wbsSettings.statusConfigs.find(c => c.id === newStatus);
                  // 상태별 진척도 연동이 켜져 있고, 사용자가 아직 진행률을 직접 수정하지 않은 경우에만
                  // 상태 변경 시 해당 상태의 기본 진척도로 자동 설정한다.
                  if (
                    wbsSettings.linkStatusAndProgress !== false &&
                    !progressTouchedRef.current &&
                    typeof config?.progress === 'number' &&
                    Number.isFinite(config.progress)
                  ) {
                    const p = Math.min(100, Math.max(0, round2(config.progress)));
                    setProgressInput(String(p));
                    setFormData(prev => ({ ...prev, status: newStatus, progress: p }));
                  } else {
                    setFormData(prev => ({ ...prev, status: newStatus }));
                  }
                }}
                className="input-field py-1.5 text-sm"
                disabled={readOnly}
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
                readOnly={readOnly}
                disabled={readOnly}
              />
              <datalist id="task-modal-assignees">
                <option value="">선택 안 함</option>
                {assigneeOptions.map(a => <option key={a} value={a} />)}
              </datalist>
              <div className="mt-0.5 flex items-center gap-2">
                <label className="text-[10px] font-medium text-[var(--color-ink-muted)] shrink-0">투입율 %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={10}
                  value={formData.allocationPercent ?? 100}
                  onChange={(e) => setFormData({ ...formData, allocationPercent: parseInt(e.target.value, 10) || 0 })}
                  className="input-field py-1 text-[11px] w-14"
                  readOnly={readOnly}
                  disabled={readOnly}
                  title="담당자 1명 기준 투입 비율 (0~100%)"
                />
              </div>
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
                readOnly={readOnly}
                disabled={readOnly}
              />
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">종료일</label>
              <input required type="date" value={formData.endDate?.split('T')[0]} onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} className="input-field py-1.5 text-sm" readOnly={readOnly} disabled={readOnly} />
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">진행률 %</label>
              <input
                type="text"
                inputMode="decimal"
                value={progressInput}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === '' || /^\d*([.]\d*)?$/.test(next)) {
                    setProgressInput(next);
                    if (!readOnly) markProgressTouched();
                  }
                }}
                onBlur={() => {
                  if (readOnly) return;
                  const raw = progressInput.trim();
                  const parsed = raw === '' ? 0 : parseFloat(raw);
                  const safe = !Number.isFinite(parsed) ? 0 : Math.min(100, Math.max(0, round2(parsed)));
                  setProgressInput(String(safe));
                  setFormData(prev => ({ ...prev, progress: safe }));
                }}
                className="input-field py-1.5 text-sm w-full"
                placeholder="0~100"
                readOnly={readOnly}
                disabled={readOnly}
              />
            </div>
            <div className="col-span-full min-w-0">
              <div className="flex flex-wrap gap-x-6 gap-y-2 items-end">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">공수 (D)</label>
                  <div className="flex gap-1.5 items-center">
                    <input type="number" min="0" step="0.5" value={formData.workEffort ?? ''} onChange={(e) => setFormData({ ...formData, workEffort: e.target.value === '' ? undefined : parseFloat(e.target.value) })} className="input-field py-1.5 text-sm w-20 flex-shrink-0" placeholder="0.5" aria-label="작업 공수" readOnly={readOnly} disabled={readOnly} />
                    {!readOnly && (
                      <>
                        <button type="button" onClick={handleApplyEndDateFromEffort} className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] rounded-lg border border-indigo-200 transition-colors shrink-0" title="시작일·공수·투입비율 → 종료일"><Calculator size={12} /> 기간자동</button>
                        <button type="button" onClick={handleApplyWorkEffortFromDates} className="px-2 py-1.5 text-[11px] font-medium text-[var(--color-ink)] hover:bg-slate-100 rounded-lg border border-[var(--color-line)] transition-colors shrink-0" title="시작일·종료일 → 공수">공수역산</button>
                      </>
                    )}
                    <span className="cursor-help text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] p-0.5 shrink-0" title={effortHelpText} aria-label="공수 도움말"><Info size={12} /></span>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5">가중치</label>
                  <input type="number" min="0" step="0.1" value={formData.weight ?? ''} onChange={(e) => setFormData({ ...formData, weight: e.target.value === '' ? undefined : parseFloat(e.target.value) })} className="input-field py-1.5 text-sm w-24" placeholder="—" aria-label="작업 가중치" readOnly={readOnly} disabled={readOnly} />
                </div>
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
              <label className={cn("flex items-center gap-2 select-none text-xs text-[var(--color-ink)]", !readOnly && "cursor-pointer")}>
                <input type="checkbox" checked={!!formData.isMilestone} onChange={(e) => { const checked = e.target.checked; setFormData(prev => ({ ...prev, isMilestone: checked, ...(checked && prev.startDate ? { endDate: prev.startDate, workEffort: 0 } : {}) })); }} className="rounded border-[var(--color-line)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/30" disabled={readOnly} />
                <Flag size={12} className="text-amber-500 shrink-0" aria-hidden />
                <span>마일스톤</span>
                <span className="text-[10px] text-[var(--color-ink-muted)]">(이정표)</span>
              </label>
              <label className={cn("flex items-center gap-2 select-none text-xs text-[var(--color-ink)]", !readOnly && "cursor-pointer")}>
                <input
                  type="checkbox"
                  checked={!!formData.isIssue}
                  onChange={(e) => setFormData(prev => ({ ...prev, isIssue: e.target.checked }))}
                  className="rounded border-[var(--color-line)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]/30"
                  disabled={readOnly}
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
                  if (readOnly) return;
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
                readOnly={readOnly}
                disabled={readOnly}
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
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={handleCorrectDescriptionWithAI}
                      disabled={isCorrectingDescription || !(formData.description ?? '').trim()}
                      className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] rounded-lg border border-indigo-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="설명 교정 + 설명 기반 체크리스트 항목을 우측 목록에 추가"
                    >
                      {isCorrectingDescription ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      AI로 교정
                    </button>
                  )}
                </div>
                <div className="relative min-h-[7rem] max-h-48">
                  {descCollab ? (
                    <>
                      <TaskDescriptionCollabEditor
                        key={`${initialData?.id}-${taskProjectId}`}
                        doc={descCollab.doc}
                        awareness={descCollab.provider.awareness}
                        readOnly={readOnly}
                        initialPlainText={formData.description ?? ''}
                        onPlainTextChange={(text) =>
                          setFormData((prev) => (prev.description === text ? prev : { ...prev, description: text }))
                        }
                        userName={currentUserName}
                        userColor={currentUserColor}
                        onPaste={readOnly ? undefined : handlePaste}
                      />
                      {!readOnly && (
                        <div className="mt-1 text-[10px] text-[var(--color-ink-muted)]">
                          실시간 공동편집: 같은 작업의 설명을 여러 명이 동시에 수정할 수 있습니다.
                        </div>
                      )}
                    </>
                  ) : (
                    <textarea
                      value={formData.description || ''}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      onPaste={readOnly ? undefined : handlePaste}
                      readOnly={readOnly}
                      disabled={readOnly}
                      className="input-field py-1.5 px-2 text-sm min-h-[7rem] max-h-48 resize-y rounded-lg w-full"
                      placeholder="상세 설명 (이미지 Ctrl+V)"
                      rows={5}
                    />
                  )}
                </div>
              </div>
              {/* 우: 체크리스트 + 산출물 - 모달 우측 절반 넓게 사용 */}
              <div className="min-w-0 flex flex-col gap-3">
                <div className="min-w-0 flex flex-col">
                  <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5 flex items-center justify-between">
                    <span>체크리스트</span>
                    <span className="text-[10px] text-[var(--color-ink-muted)] tabular-nums bg-slate-100 px-1.5 py-0.5 rounded">
                      {checklistDoneCount}/{checklistTotalCount}
                    </span>
                  </label>
                  {!readOnly && initialData?.id && manualChecklist.length > 0 && (
                    <button type="button" onClick={handleConvertAllToSubtasks} className="text-[10px] text-blue-600 hover:underline mb-0.5">전체→하위작업</button>
                  )}
                  <div className="space-y-0.5 max-h-32 overflow-y-auto pr-0.5">
                    {childTasks.map((child) => {
                      const wbs = displayWbsMap.get(child.id);
                      const title = wbs ? `${wbs} ${child.name}` : child.name;
                      const completed = child.status === 'done' || (child.progress ?? 0) >= 100;
                      return (
                        <div key={child.id} className="flex items-center gap-1 group">
                          <input
                            type="checkbox"
                            checked={completed}
                            onChange={() => handleToggleChildInChecklist(child.id)}
                            className="rounded border-stone-300 text-blue-600 shrink-0"
                            title="하위 작업 완료 여부"
                            disabled={readOnly}
                          />
                          <button
                            type="button"
                            onClick={() => onOpenTask?.(child)}
                            className={`flex-1 min-w-0 text-left py-0.5 text-xs border-0 bg-transparent focus:ring-0 hover:text-[var(--color-accent)] ${completed ? 'line-through text-stone-400' : ''}`}
                            title={onOpenTask ? '작업 열기' : undefined}
                          >
                            {title}
                          </button>
                        </div>
                      );
                    })}
                    {childTasks.length > 0 && manualChecklist.length > 0 && (
                      <div className="text-[9px] text-[var(--color-ink-muted)] uppercase tracking-wide pt-1 border-t border-[var(--color-line-soft)] mt-0.5">
                        추가 항목
                      </div>
                    )}
                    {manualChecklist.map((item) => {
                      return (
                        <div key={item.id} className="flex items-center gap-1 group">
                          <input type="checkbox" checked={item.completed} onChange={() => handleToggleChecklist(item.id)} className="rounded border-stone-300 text-blue-600 shrink-0" disabled={readOnly} />
                          <input
                            type="text"
                            value={item.text}
                            onChange={(e) => {
                              const c = [...(formData.checklist || [])];
                              const i = c.findIndex((x) => x.id === item.id);
                              if (i >= 0) {
                                c[i] = { ...c[i], text: e.target.value };
                                setFormData({ ...formData, checklist: c });
                              }
                            }}
                            readOnly={readOnly}
                            disabled={readOnly}
                            className={`flex-1 min-w-0 py-0.5 text-xs border-0 bg-transparent focus:ring-0 ${item.completed ? 'line-through text-stone-400' : ''}`}
                          />
                          {!readOnly && initialData?.id && (
                            <button type="button" onClick={() => handleConvertToSubtask(item)} className="p-0.5 text-stone-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 shrink-0" title="하위 작업으로 변환">
                              <CornerDownRight size={11} />
                            </button>
                          )}
                          {!readOnly && (
                            <button type="button" onClick={() => handleDeleteChecklist(item.id)} className="p-0.5 text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 shrink-0" title="삭제">
                              <X size={11} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {!readOnly && (
                  <div className="flex gap-1.5 mt-1">
                    <input type="text" value={newChecklistItem} onChange={(e) => setNewChecklistItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddChecklist())} placeholder="항목 추가" className="input-field py-1.5 text-xs flex-1 rounded-lg min-w-0" />
                    <button type="button" onClick={handleAddChecklist} disabled={!newChecklistItem.trim()} className="btn-secondary py-1.5 px-2 text-[11px] rounded-lg disabled:opacity-50 shrink-0">추가</button>
                  </div>
                  )}
                </div>
                <div className="min-w-0 flex flex-col">
                  <label className="block text-[11px] font-medium text-[var(--color-ink)] mb-0.5 flex items-center justify-between">
                    <span>산출물</span>
                    <span className="text-[10px] text-[var(--color-ink-muted)] tabular-nums bg-slate-100 px-1.5 py-0.5 rounded">{deliverablesCount > 0 ? `${deliverablesCount}개` : '-'}</span>
                  </label>
                  <input type="text" value={formData.deliverables || ''} onChange={(e) => setFormData({ ...formData, deliverables: e.target.value })} placeholder="쉼표 구분" className="input-field py-1.5 text-sm rounded-lg w-full" readOnly={readOnly} disabled={readOnly} />
                </div>
              </div>
            </div>
          </div>
        </form>
        <div className="px-4 py-2.5 flex justify-between items-center border-t border-[var(--color-line)] bg-slate-50/70 flex-shrink-0 gap-4">
          <div>
            {!readOnly && onDelete && initialData && (
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
            <button type="button" onClick={onClose} className={readOnly ? "btn-primary px-4 py-2 rounded-lg text-sm" : "btn-ghost px-3 py-2 rounded-lg text-sm"}>
              {readOnly ? '닫기' : '취소'}
            </button>
            {!readOnly && (
              <button type="button" onClick={(e) => { e.preventDefault(); handleSubmit(e as React.FormEvent); }} className="btn-primary px-4 py-2 rounded-lg text-sm">
                저장
              </button>
            )}
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
