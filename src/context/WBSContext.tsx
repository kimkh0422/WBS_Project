import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Task, Project, MOCK_TASKS, MOCK_PROJECTS, TaskStatus } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { BackupData } from '../lib/export';
import { addDays, differenceInDays, format, parseISO } from 'date-fns';

export interface StatusConfig {
  id: string;
  name: string;
  progress: number;
  color?: string;
}

export interface WBSSettings {
  appTitle: string;
  level1Prefix: string;
  level2Prefix: string;
  level3Prefix: string;
  maxLevel: number;
  statusConfigs: StatusConfig[];
  tableColumns?: { id: string; visible: boolean }[];
}

interface WBSContextType {
  allTasks: Task[];
  tasks: Task[];
  projects: Project[];
  currentProjectId: string;
  setCurrentProjectId: (id: string) => void;
  wbsSettings: WBSSettings;
  updateWbsSettings: (settings: Partial<WBSSettings>) => void;
  treeExpandLevel: number;
  setTreeExpandLevel: (level: number) => void;
  addProject: (name: string, description?: string, startDate?: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  addTask: (task: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string) => string;
  addTasks: (tasks: Task[]) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, direction: 'up' | 'down') => void;
  indentTask: (id: string) => void;
  outdentTask: (id: string) => void;
  indentTasks: (ids: string[]) => void;
  outdentTasks: (ids: string[]) => void;
  toggleExpand: (id: string) => void;
  expandToLevel: (level: number) => void;
  reorderTask: (id: string, overId: string) => void;
  importTasks: (tasks: Task[]) => void;
  deleteAllTasks: () => void;
  wbsMap: Map<string, string>;
  displayWbsMap: Map<string, string>;
  restoreBackup: (data: BackupData) => void;
  mergeBackups: (backups: BackupData[]) => { addedProjects: number; addedTasks: number };
  exportFullBackup: () => BackupData;
  undo: () => void;
  canUndo: boolean;
}

const WBSContext = createContext<WBSContextType | undefined>(undefined);

export function WBSProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem('wbs-projects');
    return saved ? JSON.parse(saved) : MOCK_PROJECTS;
  });

  const [currentProjectId, setCurrentProjectId] = useState<string>(() => {
    const saved = localStorage.getItem('wbs-current-project');
    return saved || projects[0]?.id || '';
  });

  const [allTasks, setAllTasks] = useState<Task[]>(() => {
    const saved = localStorage.getItem('wbs-tasks');
    // Migration: If tasks don't have projectId, assign them to the first project
    const parsed = saved ? JSON.parse(saved) : MOCK_TASKS;
    const defaultProjectId = projects[0]?.id || 'p1';
    return parsed.map((t: any) => ({ ...t, projectId: t.projectId || defaultProjectId }));
  });

  const historyRef = useRef<Task[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const allTasksRef = useRef<Task[]>([]);

  const saveHistory = () => {
    historyRef.current = [...historyRef.current.slice(-49), [...allTasksRef.current]];
    setCanUndo(true);
  };

  const undo = () => {
    if (historyRef.current.length === 0) return;
    const previous = historyRef.current[historyRef.current.length - 1];
    historyRef.current = historyRef.current.slice(0, -1);
    setCanUndo(historyRef.current.length > 0);
    setAllTasks(previous);
  };

  const DEFAULT_STATUS_CONFIGS: StatusConfig[] = [
    { id: 'todo', name: '할 일', progress: 0, color: 'bg-stone-100 border-stone-200' },
    { id: 'in-progress', name: '진행 중', progress: 10, color: 'bg-blue-50 border-blue-100' },
    { id: 'blocked', name: '지연됨', progress: 50, color: 'bg-red-50 border-red-100' },
    { id: 'done', name: '완료', progress: 100, color: 'bg-green-50 border-green-100' }
  ];

  const DEFAULT_SETTINGS: WBSSettings = {
    appTitle: '지엠티 WBS 매니저',
    level1Prefix: 'W',
    level2Prefix: 'W',
    level3Prefix: 'T',
    maxLevel: 3,
    statusConfigs: DEFAULT_STATUS_CONFIGS,
    tableColumns: [
      { id: 'wbsId', visible: true },
      { id: 'name', visible: true },
      { id: 'startDate', visible: true },
      { id: 'endDate', visible: true },
      { id: 'workEffort', visible: true },
      { id: 'assignee', visible: true },
      { id: 'status', visible: true },
      { id: 'deliverables', visible: true },
    ],
  };

  const [wbsSettings, setWbsSettings] = useState<WBSSettings>(() => {
    const saved = localStorage.getItem('wbs-settings');
    if (!saved) return DEFAULT_SETTINGS;

    try {
      const parsed = JSON.parse(saved);

      // Migration: convert old statusNames/statusProgress to statusConfigs
      let statusConfigs = parsed.statusConfigs;
      if (!statusConfigs && (parsed.statusNames || parsed.statusProgress)) {
        statusConfigs = (['todo', 'in-progress', 'blocked', 'done'] as const).map(id => ({
          id,
          name: parsed.statusNames?.[id] || (id === 'todo' ? '할 일' : id === 'in-progress' ? '진행 중' : id === 'blocked' ? '지연됨' : '완료'),
          progress: parsed.statusProgress?.[id] !== undefined ? parsed.statusProgress[id] : (id === 'todo' ? 0 : id === 'in-progress' ? 10 : id === 'blocked' ? 50 : 100),
          color: id === 'todo' ? 'bg-stone-100 border-stone-200' : id === 'in-progress' ? 'bg-blue-50 border-blue-100' : id === 'blocked' ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'
        }));
      }

      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        appTitle: parsed.appTitle || DEFAULT_SETTINGS.appTitle,
        statusConfigs: statusConfigs || DEFAULT_STATUS_CONFIGS,
        tableColumns: Array.isArray(parsed.tableColumns) && parsed.tableColumns.length > 0
          ? parsed.tableColumns
              .filter((c: any) => c && typeof c.id === 'string')
              .map((c: any) => ({ id: String(c.id), visible: c.visible !== false }))
          : DEFAULT_SETTINGS.tableColumns,
      };
    } catch (e) {
      console.error('Failed to parse wbs-settings', e);
      return DEFAULT_SETTINGS;
    }
  });

  const [treeExpandLevel, setTreeExpandLevel] = useState<number>(() => {
    const base = (wbsSettings?.maxLevel ?? 3) + 1;
    return Math.min(9, Math.max(1, base));
  });

  // Keep ref in sync with state
  allTasksRef.current = allTasks;

  // Derived state for current project's tasks
  const tasks = currentProjectId === 'all' ? allTasks : allTasks.filter(t => t.projectId === currentProjectId);

  // Generate WBS Maps
  // wbsMap: 모든 레벨에 ID 부여 (export, WBS ID 컬럼 등에서 사용)
  // displayWbsMap: maxLevel 설정에 따라 표시 여부 제어 (작업명 prefix에서 사용)
  const { wbsMap, displayWbsMap } = React.useMemo(() => {
    const map = new Map<string, string>();
    const displayMap = new Map<string, string>();
    const { level1Prefix, level2Prefix, level3Prefix, maxLevel } = wbsSettings;

    const buildWbs = (parentId: string | null, parentPrefixStr: string, depth: number) => {
      const children = tasks.filter(t => t.parentId === parentId);
      children.forEach((child, index) => {
        let wbsId = '';

        if (depth === 1) {
          wbsId = `${level1Prefix}${index + 1}`;
        } else if (depth === 2) {
          wbsId = `${parentPrefixStr.replace(level1Prefix, level2Prefix)}.${index + 1}`;
        } else if (depth === 3) {
          const numbersOnly = parentPrefixStr.replace(level2Prefix, '').replace(level1Prefix, '');
          wbsId = `${level3Prefix}${numbersOnly}.${index + 1}`;
        } else if (depth > 3) {
          wbsId = `${parentPrefixStr}.${index + 1}`;
        }

        map.set(child.id, wbsId);
        displayMap.set(child.id, depth <= maxLevel ? wbsId : '');
        buildWbs(child.id, wbsId, depth + 1);
      });
    };
    buildWbs(null, '', 1);
    return { wbsMap: map, displayWbsMap: displayMap };
  }, [tasks, wbsSettings]);

  useEffect(() => {
    localStorage.setItem('wbs-projects', JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem('wbs-current-project', currentProjectId);
  }, [currentProjectId]);

  useEffect(() => {
    localStorage.setItem('wbs-tasks', JSON.stringify(allTasks));
  }, [allTasks]);

  useEffect(() => {
    localStorage.setItem('wbs-settings', JSON.stringify(wbsSettings));
  }, [wbsSettings]);

  const updateWbsSettings = (updates: Partial<WBSSettings>) => {
    setWbsSettings(prev => ({ ...prev, ...updates }));
  };

  const addProject = (name: string, description?: string, startDate?: string) => {
    const newProject: Project = {
      id: uuidv4(),
      name,
      description,
      startDate
    };
    setProjects(prev => [...prev, newProject]);
    setCurrentProjectId(newProject.id);
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    setProjects(prev => {
      const project = prev.find(p => p.id === id);
      if (project && updates.startDate && updates.startDate !== project.startDate) {
        // Shift task dates if project start date changes
        const oldStart = parseISO(project.startDate || format(new Date(), 'yyyy-MM-dd'));
        const newStart = parseISO(updates.startDate);
        const diff = differenceInDays(newStart, oldStart);

        if (diff !== 0) {
          saveHistory();
          setAllTasks(currentTasks => currentTasks.map(t => {
            if (t.projectId === id) {
              return {
                ...t,
                startDate: format(addDays(parseISO(t.startDate), diff), 'yyyy-MM-dd'),
                endDate: format(addDays(parseISO(t.endDate), diff), 'yyyy-MM-dd')
              };
            }
            return t;
          }));
        }
      }
      return prev.map(p => p.id === id ? { ...p, ...updates } : p);
    });
  };

  const deleteProject = (id: string) => {
    if (projects.length <= 1) {
      alert('최소 하나의 프로젝트는 존재해야 합니다.');
      return;
    }

    if (confirm('프로젝트를 삭제하시겠습니까? 포함된 모든 작업이 삭제됩니다.')) {
      setProjects(prev => prev.filter(p => p.id !== id));
      setAllTasks(prev => prev.filter(t => t.projectId !== id));
      if (currentProjectId === id) {
        setCurrentProjectId(projects.find(p => p.id !== id)?.id || '');
      }
    }
  };

  const syncParentRollups = (allTasks: Task[], parentId: string | null): Task[] => {
    if (!parentId) return allTasks;

    const children = allTasks.filter(t => t.parentId === parentId);
    if (children.length === 0) return allTasks;

    // Period rollup: min(startDate), max(endDate)
    let minStart = children[0].startDate;
    let maxEnd = children[0].endDate;

    // Effort rollup: sum(children.workEffort)
    let totalEffort = 0;

    for (const child of children) {
      if (child.startDate && child.startDate < minStart) minStart = child.startDate;
      if (child.endDate && child.endDate > maxEnd) maxEnd = child.endDate;
      const effort = typeof child.workEffort === 'number' && Number.isFinite(child.workEffort) ? child.workEffort : 0;
      totalEffort += effort;
    }

    const parent = allTasks.find(t => t.id === parentId);
    if (!parent) return allTasks;

    const parentEffort = typeof parent.workEffort === 'number' && Number.isFinite(parent.workEffort) ? parent.workEffort : undefined;
    const shouldUpdate =
      parent.startDate !== minStart ||
      parent.endDate !== maxEnd ||
      parentEffort !== totalEffort;

    const updatedTasks = shouldUpdate
      ? allTasks.map(t =>
          t.id === parentId ? { ...t, startDate: minStart, endDate: maxEnd, workEffort: totalEffort } : t
        )
      : allTasks;

    return syncParentRollups(updatedTasks, parent.parentId);
  };

  const recomputeProjectRollups = (allTasks: Task[], projectId: string): Task[] => {
    if (!projectId || projectId === 'all') return allTasks;

    const projectTasks = allTasks.filter(t => t.projectId === projectId);
    if (projectTasks.length === 0) return allTasks;

    const taskMap = new Map(projectTasks.map(t => [t.id, t] as const));
    const hasChildren = new Set<string>();
    for (const t of projectTasks) {
      if (t.parentId && taskMap.has(t.parentId)) hasChildren.add(t.parentId);
    }
    if (hasChildren.size === 0) return allTasks;

    const depthMemo = new Map<string, number>();
    const getDepth = (id: string): number => {
      const cached = depthMemo.get(id);
      if (cached !== undefined) return cached;
      const t = taskMap.get(id);
      if (!t || !t.parentId || !taskMap.has(t.parentId)) {
        depthMemo.set(id, 0);
        return 0;
      }
      const d = getDepth(t.parentId) + 1;
      depthMemo.set(id, d);
      return d;
    };

    const parentIds = Array.from(hasChildren).sort((a, b) => getDepth(b) - getDepth(a));
    let next = allTasks;
    for (const pid of parentIds) {
      next = syncParentRollups(next, pid);
    }
    return next;
  };

  // One-time migration/safety: ensure stored parent rows reflect children (period/effort).
  useEffect(() => {
    const projectIds = Array.from(new Set(allTasks.map(t => t.projectId))).filter(Boolean) as string[];
    let rolled = allTasks;
    for (const pid of projectIds) {
      rolled = recomputeProjectRollups(rolled, pid);
    }
    if (rolled !== allTasks) setAllTasks(rolled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTask = (newTask: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string) => {
    saveHistory();
    const task: Task = {
      ...newTask,
      id: uuidv4(),
      projectId: currentProjectId === 'all' ? (projects[0]?.id || '') : currentProjectId
    };
    setAllTasks((prev) => {
      let nextTasks: Task[];
      if (insertAfterId) {
        const index = prev.findIndex(t => t.id === insertAfterId);
        if (index !== -1) {
          const newTasks = [...prev];
          newTasks.splice(index + 1, 0, task);
          nextTasks = newTasks;
        } else {
          nextTasks = [...prev, task];
        }
      } else {
        nextTasks = [...prev, task];
      }
      return syncParentRollups(nextTasks, task.parentId);
    });
    return task.id;
  };

  const updateTask = (id: string, updates: Partial<Task>) => {
    saveHistory();
    setAllTasks((prev) => {
      const task = prev.find(t => t.id === id);
      if (!task) return prev;

      const updatedTask = { ...task, ...updates };
      const nextTasks = prev.map((t) => (t.id === id ? updatedTask : t));

      const affectsRollup =
        Object.prototype.hasOwnProperty.call(updates, 'startDate') ||
        Object.prototype.hasOwnProperty.call(updates, 'endDate') ||
        Object.prototype.hasOwnProperty.call(updates, 'workEffort');

      if (!affectsRollup) return nextTasks;

      const hasChildren = prev.some(t => t.parentId === id && t.projectId === task.projectId);
      // If this task is a parent, its own values must reflect children.
      // Otherwise, sync parent rollups upward.
      return hasChildren ? syncParentRollups(nextTasks, id) : syncParentRollups(nextTasks, task.parentId);
    });
  };

  const deleteTask = (id: string) => {
    saveHistory();
    setAllTasks((prev) => {
      const taskToDelete = prev.find(t => t.id === id);
      if (!taskToDelete) return prev;

      // Recursive helper to get all descendant IDs
      const getAllDescendantIds = (parentId: string, currentList: Task[]): string[] => {
        const children = currentList.filter(t => t.parentId === parentId);
        let ids = children.map(c => c.id);
        children.forEach(child => {
          ids = [...ids, ...getAllDescendantIds(child.id, currentList)];
        });
        return ids;
      };

      const idsToDelete = [id, ...getAllDescendantIds(id, prev)];
      const deleteSet = new Set(idsToDelete);

      const nextTasks = prev.filter((t) => !deleteSet.has(t.id));
      return syncParentRollups(nextTasks, taskToDelete.parentId);
    });
  };

  const moveTask = (id: string, direction: 'up' | 'down') => {
    saveHistory();
    setAllTasks(prev => {
      const projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);

      const task = projectTasks.find(t => t.id === id);
      if (!task) return prev;

      const siblings = projectTasks.filter(t => t.parentId === task.parentId);
      const indexInSiblings = siblings.findIndex(t => t.id === id);

      if (direction === 'up' && indexInSiblings > 0) {
        const siblingAbove = siblings[indexInSiblings - 1];
        const indexA = projectTasks.findIndex(t => t.id === task.id);
        const indexB = projectTasks.findIndex(t => t.id === siblingAbove.id);

        const newProjectTasks = [...projectTasks];
        [newProjectTasks[indexA], newProjectTasks[indexB]] = [newProjectTasks[indexB], newProjectTasks[indexA]];

        return [...otherTasks, ...newProjectTasks];
      }

      if (direction === 'down' && indexInSiblings < siblings.length - 1) {
        const siblingBelow = siblings[indexInSiblings + 1];
        const indexA = projectTasks.findIndex(t => t.id === task.id);
        const indexB = projectTasks.findIndex(t => t.id === siblingBelow.id);

        const newProjectTasks = [...projectTasks];
        [newProjectTasks[indexA], newProjectTasks[indexB]] = [newProjectTasks[indexB], newProjectTasks[indexA]];

        return [...otherTasks, ...newProjectTasks];
      }

      return prev;
    });
  };

  const reorderTask = (id: string, overId: string) => {
    saveHistory();
    setAllTasks(prev => {
      const projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);

      const oldIndex = projectTasks.findIndex(t => t.id === id);
      const newIndex = projectTasks.findIndex(t => t.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newProjectTasks = [...projectTasks];
        const [movedTask] = newProjectTasks.splice(oldIndex, 1);

        newProjectTasks.splice(newIndex, 0, movedTask);
        return [...otherTasks, ...newProjectTasks];
      }
      return prev;
    });
  };

  const indentTask = (id: string) => {
    saveHistory();
    setAllTasks(prev => {
      const projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);

      const task = projectTasks.find(t => t.id === id);
      if (!task) return prev;

      const siblings = projectTasks.filter(t => t.parentId === task.parentId);
      const indexInSiblings = siblings.findIndex(t => t.id === id);

      if (indexInSiblings > 0) {
        const newParent = siblings[indexInSiblings - 1];
        const updatedProjectTasks = projectTasks.map(t => {
          if (t.id === id) return { ...t, parentId: newParent.id };
          if (t.id === newParent.id) return { ...t, expanded: true };
          return t;
        });
        return recomputeProjectRollups([...otherTasks, ...updatedProjectTasks], currentProjectId);
      }
      return prev;
    });
  };

  const outdentTask = (id: string) => {
    saveHistory();
    setAllTasks(prev => {
      const projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);

      const task = projectTasks.find(t => t.id === id);
      if (!task || !task.parentId) return prev;

      const parent = projectTasks.find(t => t.id === task.parentId);
      if (!parent) return prev;

      const newParentId = parent.parentId;

      // Update parentId
      const tempProjectTasks = projectTasks.map(t => {
        if (t.id === id) return { ...t, parentId: newParentId };
        return t;
      });

      return recomputeProjectRollups([...otherTasks, ...tempProjectTasks], currentProjectId);
    });
  };

  const indentTasks = (ids: string[]) => {
    saveHistory();
    setAllTasks(prev => {
      let projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);

      const selectedIds = new Set(ids);
      for (const id of ids) {
        const task = projectTasks.find(t => t.id === id);
        if (!task) continue;

        // Skip if parent is also selected (will move with parent)
        if (task.parentId && selectedIds.has(task.parentId)) continue;

        const siblings = projectTasks.filter(t => t.parentId === task.parentId);
        const indexInSiblings = siblings.findIndex(t => t.id === id);
        if (indexInSiblings > 0) {
          const newParent = siblings[indexInSiblings - 1];
          projectTasks = projectTasks.map(t => {
            if (t.id === id) return { ...t, parentId: newParent.id };
            if (t.id === newParent.id) return { ...t, expanded: true };
            return t;
          });
        }
      }

      return recomputeProjectRollups([...otherTasks, ...projectTasks], currentProjectId);
    });
  };

  const outdentTasks = (ids: string[]) => {
    saveHistory();
    setAllTasks(prev => {
      let projectTasks = prev.filter(t => t.projectId === currentProjectId);
      const otherTasks = prev.filter(t => t.projectId !== currentProjectId);

      const selectedIds = new Set(ids);
      for (const id of ids) {
        const task = projectTasks.find(t => t.id === id);
        if (!task || !task.parentId) continue;

        // Skip if parent is also selected (will move with parent)
        if (selectedIds.has(task.parentId)) continue;

        const parent = projectTasks.find(t => t.id === task.parentId);
        if (!parent) continue;
        const newParentId = parent.parentId;

        projectTasks = projectTasks.map(t =>
          t.id === id ? { ...t, parentId: newParentId } : t
        );
      }

      return recomputeProjectRollups([...otherTasks, ...projectTasks], currentProjectId);
    });
  };

  const toggleExpand = (id: string) => {
    setAllTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, expanded: !t.expanded } : t))
    );
  };

  const expandToLevel = (level: number) => {
    const targetLevel = Math.max(1, Math.floor(level || 1));
    setTreeExpandLevel(targetLevel);
    saveHistory();
    setAllTasks(prev => {
      const relevant = currentProjectId === 'all'
        ? prev
        : prev.filter(t => t.projectId === currentProjectId);
      const relevantIds = new Set(relevant.map(t => t.id));
      const taskMap = new Map(relevant.map(t => [t.id, t]));

      const depthMemo = new Map<string, number>();
      const getDepth = (id: string): number => {
        const cached = depthMemo.get(id);
        if (cached !== undefined) return cached;
        const t = taskMap.get(id);
        if (!t || !t.parentId || !taskMap.has(t.parentId)) {
          depthMemo.set(id, 0);
          return 0;
        }
        const d = getDepth(t.parentId) + 1;
        depthMemo.set(id, d);
        return d;
      };

      const hasChildren = new Set<string>();
      for (const t of relevant) {
        if (t.parentId && taskMap.has(t.parentId)) hasChildren.add(t.parentId);
      }

      return prev.map(t => {
        if (!relevantIds.has(t.id)) return t;
        if (!hasChildren.has(t.id)) return t;
        const nodeLevel = getDepth(t.id) + 1; // 1-based
        const shouldExpand = nodeLevel < targetLevel;
        if (!!t.expanded === shouldExpand) return t;
        return { ...t, expanded: shouldExpand };
      });
    });
  };

  const importTasks = (newTasks: Task[]) => {
    saveHistory();
    // Assign imported tasks to current project
    const tasksWithProject = newTasks.map(t => ({
      ...t,
      projectId: currentProjectId
    }));

    // Remove existing tasks for this project and add new ones
    setAllTasks(prev => {
      const next = [
        ...prev.filter(t => t.projectId !== currentProjectId),
        ...tasksWithProject
      ];
      return recomputeProjectRollups(next, currentProjectId);
    });
  };

  const addTasks = (newTasks: Task[]) => {
    saveHistory();
    const tasksWithProject = newTasks.map(t => ({
      ...t,
      projectId: currentProjectId
    }));
    setAllTasks(prev => recomputeProjectRollups([...prev, ...tasksWithProject], currentProjectId));
  };

  const deleteAllTasks = () => {
    saveHistory();
    if (currentProjectId === 'all') {
      setAllTasks([]);
    } else {
      setAllTasks(prev => prev.filter(t => t.projectId !== currentProjectId));
    }
  };

  const restoreBackup = (data: BackupData) => {
    setProjects(data.projects);
    // Ensure parent levels reflect children (period/effort rollups)
    const projectIds = Array.from(new Set(data.tasks.map(t => t.projectId))).filter(Boolean) as string[];
    let rolled = data.tasks;
    for (const pid of projectIds) {
      rolled = recomputeProjectRollups(rolled, pid);
    }
    setAllTasks(rolled);
    setWbsSettings(data.settings);

    // Ensure current project is valid
    if (data.projects.length > 0) {
      if (!data.projects.find(p => p.id === currentProjectId)) {
        setCurrentProjectId(data.projects[0].id);
      }
    } else {
      setCurrentProjectId('');
    }
  };

  const exportFullBackup = (): BackupData => {
    return {
      version: '1.0',
      projects,
      tasks: allTasks,
      settings: wbsSettings,
      exportDate: new Date().toISOString()
    };
  };

  const mergeBackups = (backups: BackupData[]): { addedProjects: number; addedTasks: number } => {
    const newProjects: Project[] = [];
    const newTasks: Task[] = [];

    for (const backup of backups) {
      // Map old project IDs → new UUIDs
      const projectIdMap = new Map<string, string>();
      for (const project of backup.projects) {
        const newId = uuidv4();
        projectIdMap.set(project.id, newId);
        newProjects.push({ ...project, id: newId });
      }

      // Map old task IDs → new UUIDs
      const taskIdMap = new Map<string, string>();
      for (const task of backup.tasks) {
        taskIdMap.set(task.id, uuidv4());
      }

      // Remap task relationships
      for (const task of backup.tasks) {
        const newProjectId = projectIdMap.get(task.projectId);
        if (!newProjectId) continue; // skip tasks whose project is not in this backup
        newTasks.push({
          ...task,
          id: taskIdMap.get(task.id)!,
          projectId: newProjectId,
          parentId: task.parentId ? (taskIdMap.get(task.parentId) ?? null) : null,
          dependencies: task.dependencies?.map(depId => taskIdMap.get(depId) ?? depId) ?? [],
        });
      }
    }

    setProjects(prev => [...prev, ...newProjects]);
    setAllTasks(prev => [...prev, ...newTasks]);

    if (newProjects.length > 0) {
      setCurrentProjectId(newProjects[0].id);
    }

    return { addedProjects: newProjects.length, addedTasks: newTasks.length };
  };

  return (
    <WBSContext.Provider value={{
      allTasks,
      tasks,
      projects,
      currentProjectId,
      setCurrentProjectId,
      wbsSettings,
      updateWbsSettings,
      treeExpandLevel,
      setTreeExpandLevel,
      addProject,
      updateProject,
      deleteProject,
      addTask,
      addTasks,
      updateTask,
      deleteTask,
      moveTask,
      reorderTask,
      indentTask,
      outdentTask,
      indentTasks,
      outdentTasks,
      toggleExpand,
      expandToLevel,
      importTasks,
      deleteAllTasks,
      wbsMap,
      displayWbsMap,
      restoreBackup,
      mergeBackups,
      exportFullBackup,
      undo,
      canUndo
    }}>
      {children}
    </WBSContext.Provider>
  );
}

export function useWBS() {
  const context = useContext(WBSContext);
  if (!context) {
    throw new Error('useWBS must be used within a WBSProvider');
  }
  return context;
}
