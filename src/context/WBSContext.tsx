import React, { createContext, useContext, useState, useEffect } from 'react';
import { Task, Project, MOCK_TASKS, MOCK_PROJECTS } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { BackupData } from '../lib/export';

export interface WBSSettings {
  level1Prefix: string;
  level2Prefix: string;
  level3Prefix: string;
  maxLevel: number;
}

interface WBSContextType {
  tasks: Task[];
  projects: Project[];
  currentProjectId: string;
  setCurrentProjectId: (id: string) => void;
  wbsSettings: WBSSettings;
  updateWbsSettings: (settings: Partial<WBSSettings>) => void;
  addProject: (name: string, description?: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  addTask: (task: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string) => string;
  addTasks: (tasks: Task[]) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, direction: 'up' | 'down') => void;
  indentTask: (id: string) => void;
  outdentTask: (id: string) => void;
  toggleExpand: (id: string) => void;
  reorderTask: (id: string, overId: string) => void;
  importTasks: (tasks: Task[]) => void;
  deleteAllTasks: () => void;
  wbsMap: Map<string, string>;
  restoreBackup: (data: BackupData) => void;
  exportFullBackup: () => BackupData;
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

  const [wbsSettings, setWbsSettings] = useState<WBSSettings>(() => {
    const saved = localStorage.getItem('wbs-settings');
    return saved ? JSON.parse(saved) : {
      level1Prefix: 'W',
      level2Prefix: 'W',
      level3Prefix: 'T',
      maxLevel: 3,
    };
  });

  // Derived state for current project's tasks
  const tasks = allTasks.filter(t => t.projectId === currentProjectId);

  // Generate WBS Map (ID to prefix string like "W1.1")
  const wbsMap = React.useMemo(() => {
    const map = new Map<string, string>();
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

        let finalDisplayId = wbsId;
        if (depth > maxLevel) {
          finalDisplayId = '';
        }

        map.set(child.id, finalDisplayId);
        buildWbs(child.id, wbsId, depth + 1);
      });
    };
    buildWbs(null, '', 1);
    return map;
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

  const addProject = (name: string, description?: string) => {
    const newProject: Project = {
      id: uuidv4(),
      name,
      description
    };
    setProjects(prev => [...prev, newProject]);
    setCurrentProjectId(newProject.id);
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
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

  const addTask = (newTask: Omit<Task, 'id' | 'projectId'>, insertAfterId?: string) => {
    const task: Task = {
      ...newTask,
      id: uuidv4(),
      projectId: currentProjectId
    };
    setAllTasks((prev) => {
      if (insertAfterId) {
        const index = prev.findIndex(t => t.id === insertAfterId);
        if (index !== -1) {
          const newTasks = [...prev];
          newTasks.splice(index + 1, 0, task);
          return newTasks;
        }
      }
      return [...prev, task];
    });
    return task.id;
  };

  const updateTask = (id: string, updates: Partial<Task>) => {
    setAllTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  };

  const deleteTask = (id: string) => {
    setAllTasks((prev) => prev.filter((t) => t.id !== id && t.parentId !== id));
  };

  const moveTask = (id: string, direction: 'up' | 'down') => {
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
        return [...otherTasks, ...updatedProjectTasks];
      }
      return prev;
    });
  };

  const outdentTask = (id: string) => {
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

      // Reorder to be after the old parent
      const taskIndex = tempProjectTasks.findIndex(t => t.id === id);
      const taskObj = tempProjectTasks[taskIndex];
      tempProjectTasks.splice(taskIndex, 1);

      const parentIndex = tempProjectTasks.findIndex(t => t.id === parent.id);
      tempProjectTasks.splice(parentIndex + 1, 0, taskObj);

      return [...otherTasks, ...tempProjectTasks];
    });
  };

  const toggleExpand = (id: string) => {
    setAllTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, expanded: !t.expanded } : t))
    );
  };

  const importTasks = (newTasks: Task[]) => {
    // Assign imported tasks to current project
    const tasksWithProject = newTasks.map(t => ({
      ...t,
      projectId: currentProjectId
    }));

    // Remove existing tasks for this project and add new ones
    setAllTasks(prev => [
      ...prev.filter(t => t.projectId !== currentProjectId),
      ...tasksWithProject
    ]);
  };

  const addTasks = (newTasks: Task[]) => {
    const tasksWithProject = newTasks.map(t => ({
      ...t,
      projectId: currentProjectId
    }));
    setAllTasks(prev => [...prev, ...tasksWithProject]);
  };

  const deleteAllTasks = () => {
    setAllTasks(prev => prev.filter(t => t.projectId !== currentProjectId));
  };

  const restoreBackup = (data: BackupData) => {
    setProjects(data.projects);
    setAllTasks(data.tasks);
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

  return (
    <WBSContext.Provider value={{
      tasks,
      projects,
      currentProjectId,
      setCurrentProjectId,
      wbsSettings,
      updateWbsSettings,
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
      toggleExpand,
      importTasks,
      deleteAllTasks,
      wbsMap,
      restoreBackup,
      exportFullBackup
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
