import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useWBS } from '../context/WBSContext';
import { FilterState, Task } from '../types';
import { TaskModal } from './TaskModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ZoomIn, ZoomOut, Maximize2, Hand, Plus, ArrowUpToLine, ArrowDownToLine, Pencil, Trash2, X, ChevronsUpDown, ChevronsDownUp, GitBranch, Network } from 'lucide-react';
import { cn } from '../lib/utils';

const NODE_W = 200;
const NODE_H = 44; // 진행률 바 공간 확보를 위해 높이 증가
const PROJECT_ROOT_H = 52; // 프로젝트 루트 노드는 약간 더 크게
const TOGGLE_W = 20;
const MIN_NODE_GAP_Y = 18;

/** 가상 프로젝트 루트 노드 sentinel ID - 실제 Task가 아님 */
const VIRTUAL_ROOT_ID = '__mindmap_project_root__';

/** 트리형 레이아웃 상수 */
const TREE_START_Y = 40;
const TREE_CENTER_X = 600;
const TREE_H_GAP = 20;  // 형제 노드 간 수평 간격
const TREE_V_GAP = 44;  // 부모-자식 간 수직 간격

/** 알마인드 레이아웃 상수 */
const ALMIND_CENTER_X = 600;
const ALMIND_CENTER_Y = 300;
const ALMIND_BRANCH_DX = 240;

type LayoutMode = 'tree' | 'almind';
type ColorMode = 'depth' | 'status';

interface TreeNode {
  task: Task;
  children: TreeNode[];
}

interface PosNode {
  task: Task;
  x: number;
  y: number;
  depth: number;
  side: number;
  kids: PosNode[];
  /** 실제 렌더 높이 (가상 루트는 PROJECT_ROOT_H, 나머지는 NODE_H) */
  nodeH?: number;
}

interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  curved: boolean;
  isMainBranch?: boolean;
  treePath?: string;
}

/** 배열 순서를 형제 순서로 사용 */
function buildForest(tasks: Task[]): TreeNode[] {
  if (tasks.length === 0) return [];
  const ids = new Set(tasks.map((t) => t.id));
  const orderIndex = new Map<string, number>();
  tasks.forEach((t, i) => orderIndex.set(t.id, i));
  const childrenByParent = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const pid = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    const list = childrenByParent.get(pid) ?? [];
    list.push(t);
    childrenByParent.set(pid, list);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => (orderIndex.get(a.id) ?? 1e9) - (orderIndex.get(b.id) ?? 1e9));
  }
  const roots = childrenByParent.get(null) ?? [];
  function toTree(task: Task): TreeNode {
    const ch = childrenByParent.get(task.id) ?? [];
    return { task, children: ch.map(toTree) };
  }
  return roots.map(toTree);
}

/**
 * 실제 forest 전체를 가상 프로젝트 루트 하나로 감싼다.
 * 가상 루트는 VIRTUAL_ROOT_ID를 가진 최소 Task 객체를 사용하며
 * 렌더링 시 id로 구별해 편집·삭제 등 조작을 막는다.
 */
function wrapWithProjectRoot(forest: TreeNode[], projectId: string, projectName: string): TreeNode[] {
  const today = new Date().toISOString().slice(0, 10);
  const virtualTask: Task = {
    id: VIRTUAL_ROOT_ID,
    projectId,
    parentId: null,
    name: projectName,
    startDate: today,
    endDate: today,
    progress: 0,
    assignee: '',
    status: 'todo',
  };
  return [{ task: virtualTask, children: forest }];
}

// ─── 알마인드 레이아웃 ───────────────────────────────────────────────────────

function layoutAlmind(
  node: TreeNode,
  depth: number,
  side: number,
  yStart: number,
  collapsedIds: Set<string>
): { root: PosNode; bottom: number } {
  const isCollapsed = collapsedIds.has(node.task.id);
  const effectiveChildren = isCollapsed ? [] : node.children;

  if (depth === 0) {
    const x = ALMIND_CENTER_X;
    const y = ALMIND_CENTER_Y;
    if (effectiveChildren.length === 0) {
      return { root: { task: node.task, x, y, depth: 0, side: 0, kids: [] }, bottom: yStart + NODE_H };
    }
    const n = effectiveChildren.length;
    const leftCount = Math.ceil(n / 2);
    const leftKids: PosNode[] = [];
    const rightKids: PosNode[] = [];
    let leftY = y;
    let rightY = y;
    for (let i = 0; i < n; i++) {
      const isLeft = i < leftCount;
      const yPos = isLeft ? leftY : rightY;
      const { root: kr, bottom } = layoutAlmind(node.children[i], 1, isLeft ? -1 : 1, yPos, collapsedIds);
      if (isLeft) { leftKids.push(kr); leftY = bottom + MIN_NODE_GAP_Y; }
      else { rightKids.push(kr); rightY = bottom + MIN_NODE_GAP_Y; }
    }
    const kids = [...leftKids, ...rightKids];
    const maxBottom = Math.max(
      leftKids.length ? leftY - MIN_NODE_GAP_Y : y,
      rightKids.length ? rightY - MIN_NODE_GAP_Y : y
    );
    return { root: { task: node.task, x, y, depth: 0, side: 0, kids }, bottom: Math.max(maxBottom, y + NODE_H) };
  }

  const x = ALMIND_CENTER_X + side * depth * ALMIND_BRANCH_DX;
  if (effectiveChildren.length === 0) {
    return { root: { task: node.task, x, y: yStart, depth, side, kids: [] }, bottom: yStart + NODE_H };
  }
  const childYStart = yStart + NODE_H + MIN_NODE_GAP_Y;
  let curY = childYStart;
  const kids: PosNode[] = [];
  for (const c of node.children) {
    const { root: kr, bottom } = layoutAlmind(c, depth + 1, side, curY, collapsedIds);
    kids.push(kr);
    curY = bottom + MIN_NODE_GAP_Y;
  }
  curY -= MIN_NODE_GAP_Y;
  return { root: { task: node.task, x, y: yStart, depth, side, kids }, bottom: curY };
}

function layoutAlmindForest(
  forest: TreeNode[],
  collapsedIds: Set<string>
): { roots: PosNode[]; width: number; height: number } {
  if (forest.length === 0) return { roots: [], width: 400, height: 200 };
  if (forest.length === 1) {
    const { root } = layoutAlmind(forest[0], 0, 0, ALMIND_CENTER_Y, collapsedIds);
    const nodes = flattenPos(root);
    let w = 0, h = 0;
    for (const n of nodes) { w = Math.max(w, n.x + NODE_W + 80); h = Math.max(h, n.y + NODE_H + 40); }
    return { roots: [root], width: w, height: h };
  }
  const roots: PosNode[] = [];
  const step = ALMIND_BRANCH_DX * 0.8;
  const startX = ALMIND_CENTER_X - ((forest.length - 1) / 2) * step;
  let maxBottom = 0;
  for (let i = 0; i < forest.length; i++) {
    const { root, bottom } = layoutAlmind(
      forest[i], 0,
      i < forest.length / 2 ? -1 : 1,
      ALMIND_CENTER_Y + (i - (forest.length - 1) / 2) * 60,
      collapsedIds
    );
    root.x = startX + i * step;
    root.y = ALMIND_CENTER_Y;
    roots.push(root);
    maxBottom = Math.max(maxBottom, bottom);
  }
  const allNodes = roots.flatMap(flattenPos);
  let w = 0, h = 0;
  for (const n of allNodes) { w = Math.max(w, n.x + NODE_W + 80); h = Math.max(h, n.y + NODE_H + 40); }
  return { roots, width: w, height: Math.max(h, maxBottom) };
}

// ─── 트리형 레이아웃 (형제 수평 배치) ──────────────────────────────────────

/**
 * 서브트리의 총 가로 너비를 재귀적으로 계산한다.
 * 자식이 없으면 NODE_W, 있으면 자식들의 너비 합 + 간격.
 */
function computeSubtreeWidth(node: TreeNode, collapsedIds: Set<string>): number {
  const children = collapsedIds.has(node.task.id) ? [] : node.children;
  if (children.length === 0) return NODE_W;
  const total = children.reduce((s, c) => s + computeSubtreeWidth(c, collapsedIds), 0)
    + (children.length - 1) * TREE_H_GAP;
  return Math.max(NODE_W, total);
}

/**
 * 노드를 centerX 중심으로 y에 배치하고, 자식들을 수평으로 나란히 배치한다.
 * parentNodeH: 부모 노드의 실제 높이 (가상 루트는 PROJECT_ROOT_H)
 */
function layoutTreeNode(
  node: TreeNode,
  depth: number,
  centerX: number,
  y: number,
  collapsedIds: Set<string>,
  nodeH: number = NODE_H
): PosNode {
  const children = collapsedIds.has(node.task.id) ? [] : node.children;
  const posNode: PosNode = {
    task: node.task,
    x: centerX - NODE_W / 2,
    y,
    depth,
    side: 0,
    kids: [],
    nodeH,
  };
  if (children.length === 0) return posNode;

  const childY = y + nodeH + TREE_V_GAP;
  const childWidths = children.map((c) => computeSubtreeWidth(c, collapsedIds));
  const totalW = childWidths.reduce((s, w) => s + w, 0) + (children.length - 1) * TREE_H_GAP;
  let curX = centerX - totalW / 2;
  for (let i = 0; i < children.length; i++) {
    const childCx = curX + childWidths[i] / 2;
    posNode.kids.push(layoutTreeNode(children[i], depth + 1, childCx, childY, collapsedIds));
    curX += childWidths[i] + TREE_H_GAP;
  }
  return posNode;
}

function layoutTreeForest(
  forest: TreeNode[],
  collapsedIds: Set<string>
): { roots: PosNode[]; width: number; height: number } {
  if (forest.length === 0) return { roots: [], width: 400, height: 200 };
  // wrappedForest는 항상 루트 1개 (가상 프로젝트 루트)
  const rootNode = forest[0];
  const root = layoutTreeNode(rootNode, 0, TREE_CENTER_X, TREE_START_Y, collapsedIds, PROJECT_ROOT_H);
  const allNodes = flattenPos(root);
  let w = 0, h = 0;
  for (const n of allNodes) {
    w = Math.max(w, n.x + NODE_W + 80);
    h = Math.max(h, n.y + (n.nodeH ?? NODE_H) + 60);
  }
  return { roots: [root], width: w, height: h };
}

// ─── 엣지 수집 ───────────────────────────────────────────────────────────────

function collectEdgesTree(root: PosNode): Edge[] {
  const edges: Edge[] = [];
  const parentCx = root.x + NODE_W / 2;
  const parentBottom = root.y + (root.nodeH ?? NODE_H);
  for (const k of root.kids) {
    const childCx = k.x + NODE_W / 2;
    const childTop = k.y;
    const midY = (parentBottom + childTop) / 2;
    const treePath = `M ${parentCx} ${parentBottom} L ${parentCx} ${midY} L ${childCx} ${midY} L ${childCx} ${childTop}`;
    edges.push({ x1: parentCx, y1: parentBottom, x2: childCx, y2: childTop, curved: false, isMainBranch: root.depth === 0, treePath });
    edges.push(...collectEdgesTree(k));
  }
  return edges;
}

function collectEdgesAlmind(root: PosNode): Edge[] {
  const edges: Edge[] = [];
  const cy = root.y + NODE_H / 2;
  for (const k of root.kids) {
    if (root.depth === 0) {
      const x1 = k.side < 0 ? root.x : root.x + NODE_W;
      const x2 = k.side < 0 ? k.x + NODE_W : k.x;
      const y2 = k.y + NODE_H / 2;
      edges.push({ x1, y1: cy, x2, y2, curved: false, isMainBranch: true });
    } else {
      const fromX = root.side < 0 ? root.x : root.x + NODE_W;
      const x2 = k.side < 0 ? k.x + NODE_W : k.x;
      const y2 = k.y + NODE_H / 2;
      const curved = root.depth === 1 && k.depth === 2;
      edges.push({ x1: fromX, y1: cy, x2, y2, curved, isMainBranch: false });
    }
    edges.push(...collectEdgesAlmind(k));
  }
  return edges;
}

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function flattenPos(root: PosNode): PosNode[] {
  const out: PosNode[] = [root];
  for (const k of root.kids) out.push(...flattenPos(k));
  return out;
}

function getChildrenInForest(forest: TreeNode[], taskId: string): TreeNode[] | null {
  for (const n of forest) {
    if (n.task.id === taskId) return n.children;
    const ch = getChildrenInForest(n.children, taskId);
    if (ch) return ch;
  }
  return null;
}

function hasChildrenInForest(forest: TreeNode[], taskId: string): boolean {
  const ch = getChildrenInForest(forest, taskId);
  return ch != null && ch.length > 0;
}

function getTreeNav(tasks: Task[], taskId: string) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return { parentId: null, prevSiblingId: null, nextSiblingId: null, firstChildId: null };
  const siblings = tasks.filter((t) => t.parentId === task.parentId);
  const orderIndex = new Map(tasks.map((t, i) => [t.id, i]));
  siblings.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
  const idx = siblings.findIndex((t) => t.id === taskId);
  const children = tasks.filter((t) => t.parentId === taskId).sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
  return {
    parentId: task.parentId ?? null,
    prevSiblingId: idx > 0 ? siblings[idx - 1].id : null,
    nextSiblingId: idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1].id : null,
    firstChildId: children.length > 0 ? children[0].id : null,
  };
}

function isDescendant(tasks: Task[], ancestorId: string, id: string): boolean {
  let current: string | null = id;
  while (current) {
    if (current === ancestorId) return true;
    const task = tasks.find((t) => t.id === current);
    current = task?.parentId ?? null;
  }
  return false;
}

// ─── 색상 ────────────────────────────────────────────────────────────────────

const DEPTH_FILL_LIGHT: Record<number, string> = {
  0: '#1e293b', 1: '#fee2e2', 2: '#ffedd5', 3: '#fef9c3', 4: '#d1fae5', 5: '#dbeafe', 6: '#e0e7ff', 7: '#f3e8ff',
};
const DEPTH_FILL_DARK: Record<number, string> = {
  0: '#0f172a', 1: '#371717', 2: '#3b2008', 3: '#3b2f08', 4: '#052e16', 5: '#172554', 6: '#1e1b4b', 7: '#2e1065',
};
const DEPTH_STROKE_LIGHT: Record<number, string> = {
  0: '#0f172a', 1: '#dc2626', 2: '#ea580c', 3: '#ca8a04', 4: '#059669', 5: '#2563eb', 6: '#4338ca', 7: '#7c3aed',
};
const DEPTH_STROKE_DARK: Record<number, string> = {
  0: '#334155', 1: '#b91c1c', 2: '#c2410c', 3: '#a16207', 4: '#047857', 5: '#1d4ed8', 6: '#3730a3', 7: '#6d28d9',
};
const DEPTH_FILL = new Proxy({} as Record<number, string>, { get: (_, k) => (_isDark() ? DEPTH_FILL_DARK : DEPTH_FILL_LIGHT)[Number(k)] });
const DEPTH_STROKE = new Proxy({} as Record<number, string>, { get: (_, k) => (_isDark() ? DEPTH_STROKE_DARK : DEPTH_STROKE_LIGHT)[Number(k)] });
const STATUS_FILL_LIGHT: Record<string, string> = {
  todo: '#f1f5f9',
  'in-progress': '#dbeafe',
  blocked: '#fee2e2',
  done: '#dcfce7',
};
const STATUS_FILL_DARK: Record<string, string> = {
  todo: '#1e293b',
  'in-progress': '#172554',
  blocked: '#371717',
  done: '#052e16',
};
const STATUS_STROKE_LIGHT: Record<string, string> = {
  todo: '#94a3b8',
  'in-progress': '#3b82f6',
  blocked: '#ef4444',
  done: '#22c55e',
};
const STATUS_STROKE_DARK: Record<string, string> = {
  todo: '#64748b',
  'in-progress': '#2563eb',
  blocked: '#dc2626',
  done: '#16a34a',
};
const _isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
const STATUS_FILL = new Proxy({} as Record<string, string>, { get: (_, k: string) => (_isDark() ? STATUS_FILL_DARK : STATUS_FILL_LIGHT)[k] });
const STATUS_STROKE = new Proxy({} as Record<string, string>, { get: (_, k: string) => (_isDark() ? STATUS_STROKE_DARK : STATUS_STROKE_LIGHT)[k] });
const STATUS_LABEL: Record<string, string> = {
  todo: '예정',
  'in-progress': '진행중',
  blocked: '지연',
  done: '완료',
};

// ─── 컴포넌트 ────────────────────────────────────────────────────────────────

interface MindMapViewProps {
  filters: FilterState;
}

export function MindMapView({ filters }: MindMapViewProps) {
  const { tasks, addTask, updateTask, deleteTask, reorderTask, currentProjectId, projects, wbsMap, canEditCurrentProject } = useWBS();
  const filterId = React.useId().replace(/:/g, '');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // 새 기능 상태
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('tree');
  const [colorMode, setColorMode] = useState<ColorMode>('depth');

  const scopedTasks = useMemo(() => {
    let list = tasks;
    if (filters.projectIds !== 'all') {
      const set = new Set(filters.projectIds);
      list = list.filter((t) => t.projectId && set.has(t.projectId));
    }
    return list;
  }, [tasks, filters.projectIds]);

  const projectId = currentProjectId === 'all' ? projects[0]?.id : currentProjectId;

  const forest = useMemo(() => buildForest(scopedTasks), [scopedTasks]);

  const projectLabel = useMemo(() => {
    if (filters.projectIds === 'all') {
      const p = projects.find((x) => x.id === currentProjectId);
      return p?.name ?? '프로젝트';
    }
    if (filters.projectIds.length === 1) return projects.find((x) => x.id === filters.projectIds[0])?.name ?? '프로젝트';
    return `${filters.projectIds.length}개 프로젝트`;
  }, [filters.projectIds, projects, currentProjectId]);

  /** 프로젝트 루트 노드로 전체 forest를 감싼 트리. 태스크가 없어도 루트는 항상 존재 */
  const wrappedForest = useMemo(() => {
    const pid = projectId ?? '';
    return wrapWithProjectRoot(forest, pid, projectLabel);
  }, [forest, projectId, projectLabel]);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingNodeValue, setEditingNodeValue] = useState('');
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const transformRef = useRef({ pan: { x: 0, y: 0 }, scale: 1, nodes: [] as PosNode[] });
  const justDraggedRef = useRef(false);
  const pendingPanIdRef = useRef<string | null>(null);

  const toggleCollapsed = useCallback((taskId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  }, []);

  // 전체 펼치기 / 접기 (가상 루트 제외)
  const expandAll = useCallback(() => setCollapsedIds(new Set()), []);
  const collapseAll = useCallback(() => {
    const allIds = new Set(scopedTasks.filter((t) => scopedTasks.some((c) => c.parentId === t.id)).map((t) => t.id));
    setCollapsedIds(allIds);
  }, [scopedTasks]);

  const { nodes, edges, width, height } = useMemo(() => {
    if (layoutMode === 'almind') {
      const { roots, width: w, height: h } = layoutAlmindForest(wrappedForest, collapsedIds);
      const allNodes = roots.flatMap(flattenPos);
      const allEdges = roots.flatMap(collectEdgesAlmind);
      return { nodes: allNodes, edges: allEdges, width: w, height: h };
    } else {
      const { roots, width: w, height: h } = layoutTreeForest(wrappedForest, collapsedIds);
      const allNodes = roots.flatMap(flattenPos);
      const allEdges = roots.flatMap(collectEdgesTree);
      return { nodes: allNodes, edges: allEdges, width: w, height: h };
    }
  }, [wrappedForest, collapsedIds, layoutMode]);

  transformRef.current = { pan, scale, nodes };

  // 하위 작업 추가 후 새 노드로 자동 팬
  useEffect(() => {
    const pendingId = pendingPanIdRef.current;
    if (!pendingId) return;
    const node = nodes.find((n) => n.task.id === pendingId);
    if (!node) return;
    pendingPanIdRef.current = null;
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const nodeCx = node.x + NODE_W / 2;
    const nodeCy = node.y + NODE_H / 2;
    setPan({ x: cw / 2 - nodeCx * scale, y: ch / 2 - nodeCy * scale });
  }, [nodes, scale]);

  // ─── 선택 노드 자동 팬 ─────────────────────────────────────────────────────
  const panToNode = useCallback((nodeId: string) => {
    const node = transformRef.current.nodes.find((n) => n.task.id === nodeId);
    const el = containerRef.current;
    if (!node || !el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const nodeCx = node.x + NODE_W / 2;
    const nodeCy = node.y + NODE_H / 2;
    const targetPanX = cw / 2 - nodeCx * transformRef.current.scale;
    const targetPanY = ch / 2 - nodeCy * transformRef.current.scale;
    setPan({ x: targetPanX, y: targetPanY });
  }, []);

  // 인라인 편집 시작 시 input 포커스 + 전체 선택
  useEffect(() => {
    if (editingNodeId && inlineInputRef.current) {
      inlineInputRef.current.focus();
      inlineInputRef.current.select();
    }
  }, [editingNodeId]);

  const startInlineEdit = useCallback((nodeId: string, currentName: string) => {
    setEditingNodeId(nodeId);
    setEditingNodeValue(currentName);
  }, []);

  const saveInlineEdit = useCallback(() => {
    if (!editingNodeId) return;
    const trimmed = editingNodeValue.trim();
    if (trimmed) updateTask(editingNodeId, { name: trimmed });
    setEditingNodeId(null);
  }, [editingNodeId, editingNodeValue, updateTask]);

  const cancelInlineEdit = useCallback(() => {
    setEditingNodeId(null);
  }, []);

  // ─── 줌·팬 ─────────────────────────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+휠: 줌 (마우스 위치 기준)
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? -0.08 : 0.08;
      setScale((s) => {
        const next = Math.min(2.5, Math.max(0.35, s + factor));
        const ratio = next / s;
        setPan((p) => ({ x: mx - (mx - p.x) * ratio, y: my - (my - p.y) * ratio }));
        return next;
      });
    } else {
      // 일반 휠: 팬 (수직/수평 스크롤)
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', prevent, { passive: false });
    return () => el.removeEventListener('wheel', prevent);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || draggingNodeId) return;
    setDragging(true);
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      if (draggingNodeId) return;
      const d = dragRef.current;
      setPan({ x: d.panX + e.clientX - d.x, y: d.panY + e.clientY - d.y });
    };
    const up = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [dragging, draggingNodeId]);

  // ─── 노드 드래그 (부모 변경) ────────────────────────────────────────────────
  useEffect(() => {
    if (!draggingNodeId) { setDropTargetId(null); return; }
    const container = containerRef.current;
    const clientToSvg = (cx: number, cy: number) => {
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const { pan, scale } = transformRef.current;
      return { sx: (cx - rect.left - pan.x) / scale, sy: (cy - rect.top - pan.y) / scale };
    };
    const getNodeAt = (sx: number, sy: number): PosNode | null => {
      for (const n of transformRef.current.nodes) {
        if (n.task.id === draggingNodeId) continue;
        if (n.task.id === VIRTUAL_ROOT_ID) continue; // 프로젝트 루트로는 이동 불가
        const nx = hasChildrenInForest(wrappedForest, n.task.id) ? n.x + TOGGLE_W : n.x;
        if (sx >= nx && sx <= n.x + NODE_W && sy >= n.y && sy <= n.y + NODE_H) return n;
      }
      return null;
    };
    let hasMoved = false;
    const onMove = (e: PointerEvent) => {
      hasMoved = true;
      const pt = clientToSvg(e.clientX, e.clientY);
      if (!pt) return;
      setDropTargetId(getNodeAt(pt.sx, pt.sy)?.task.id ?? null);
    };
    const onUp = (e: PointerEvent) => {
      justDraggedRef.current = hasMoved;
      const pt = clientToSvg(e.clientX, e.clientY);
      if (pt) {
        const node = getNodeAt(pt.sx, pt.sy);
        if (node) {
          const targetId = node.task.id;
          if (targetId !== draggingNodeId && !isDescendant(scopedTasks, draggingNodeId, targetId)) {
            const dragged = scopedTasks.find((t) => t.id === draggingNodeId);
            const target = scopedTasks.find((t) => t.id === targetId);
            const sameParent = dragged && target && (dragged.parentId ?? null) === (target.parentId ?? null);
            if (sameParent) reorderTask(draggingNodeId, targetId);
            else updateTask(draggingNodeId, { parentId: targetId });
          }
        }
      }
      setDraggingNodeId(null);
      setDropTargetId(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  }, [draggingNodeId, scopedTasks, updateTask, reorderTask, wrappedForest]);

  // ─── 화면 맞추기 ───────────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || nodes.length === 0) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const pad = 48;
    const s = Math.min(1.2, Math.max(0.4, Math.min((w - pad * 2) / width, (h - pad * 2) / height)));
    setScale(s);
    setPan({ x: (w - width * s) / 2, y: (h - height * s) / 2 });
  }, [width, height, nodes.length]);

  const focusContainer = useCallback(() => { containerRef.current?.focus({ preventScroll: true }); }, []);

  const hasFocusedRef = useRef(false);
  useEffect(() => {
    if (scopedTasks.length > 0 && !hasFocusedRef.current) { hasFocusedRef.current = true; focusContainer(); }
    if (scopedTasks.length === 0) hasFocusedRef.current = false;
  }, [scopedTasks.length, focusContainer]);

  // ─── 작업 조작 ─────────────────────────────────────────────────────────────
  const handleSave = (taskData: Omit<Task, 'id'> | Partial<Task>) => {
    if (editingTask) updateTask(editingTask.id, taskData);
  };

  const selectedTask = selectedTaskId ? (scopedTasks.find((t) => t.id === selectedTaskId) ?? null) : null;
  const project = projects.find((p) => p.id === projectId);

  const addChildTask = useCallback(() => {
    if (!selectedTask) return;
    const targetProjectId = selectedTask.projectId;
    const proj = projects.find((p) => p.id === targetProjectId);
    const start = selectedTask.startDate || proj?.startDate || new Date().toISOString().slice(0, 10);
    const end = selectedTask.endDate || proj?.endDate || start;
    const newId = addTask({ parentId: selectedTask.id, name: '새 하위 작업', startDate: start, endDate: end, progress: 0, assignee: '', status: 'todo' }, undefined, targetProjectId);
    setCollapsedIds((prev) => { const next = new Set(prev); next.delete(selectedTask.id); return next; });
    setSelectedTaskId(newId);
    pendingPanIdRef.current = newId;
  }, [selectedTask, projects, addTask]);

  // 루트 작업 추가
  const addRootTask = useCallback(() => {
    const targetProjectId = projectId;
    if (!targetProjectId) return;
    const proj = projects.find((p) => p.id === targetProjectId);
    const start = proj?.startDate || new Date().toISOString().slice(0, 10);
    const end = proj?.endDate || start;
    addTask({ parentId: undefined, name: '새 작업', startDate: start, endDate: end, progress: 0, assignee: '', status: 'todo' }, undefined, targetProjectId);
  }, [projectId, projects, addTask]);

  const levelUp = useCallback(() => {
    if (!selectedTask?.parentId) return;
    const parent = scopedTasks.find((t) => t.id === selectedTask.parentId);
    if (!parent) return;
    updateTask(selectedTask.id, { parentId: parent.parentId });
  }, [selectedTask, scopedTasks, updateTask]);

  const levelDown = useCallback(() => {
    if (!selectedTask?.parentId) return;
    const siblings = scopedTasks.filter((t) => t.parentId === selectedTask.parentId);
    const idx = siblings.findIndex((t) => t.id === selectedTask.id);
    if (idx <= 0) return;
    updateTask(selectedTask.id, { parentId: siblings[idx - 1].id });
  }, [selectedTask, scopedTasks, updateTask]);

  const openDetailEdit = useCallback(() => { if (selectedTask) setEditingTask(selectedTask); }, [selectedTask]);

  // ─── 키보드 ────────────────────────────────────────────────────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (editingNodeId) return; // 인라인 편집 중 SVG 키보드 이벤트 무시
    if (nodes.length === 0) return;
    if (!selectedTaskId) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Tab') {
        e.preventDefault();
        // 가상 루트(depth 0)는 건너뛰고 첫 번째 실제 작업 노드 선택
        const firstReal = nodes.find((n) => n.task.id !== VIRTUAL_ROOT_ID);
        const firstId = firstReal?.task.id ?? nodes[0].task.id;
        setSelectedTaskId(firstId);
        panToNode(firstId);
      }
      return;
    }
    // 가상 루트가 선택된 경우 키보드 조작 차단 (클릭 선택 불가이므로 이론상 발생 안 함)
    if (selectedTaskId === VIRTUAL_ROOT_ID) return;
    const nav = getTreeNav(scopedTasks, selectedTaskId);
    const selectAndPan = (id: string | null) => {
      if (!id) return;
      setSelectedTaskId(id);
      panToNode(id);
    };

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        selectAndPan(nav.parentId);
        return;
      case 'ArrowDown':
        e.preventDefault();
        selectAndPan(nav.firstChildId);
        return;
      case 'ArrowLeft': {
        e.preventDefault();
        if (nav.prevSiblingId) {
          selectAndPan(nav.prevSiblingId);
        } else {
          // 형제 없으면 같은 depth의 이전 노드 (다른 서브트리 포함)
          const cur = nodes.find((n) => n.task.id === selectedTaskId);
          if (cur) {
            const sameDepth = nodes.filter((n) => n.depth === cur.depth && n.task.id !== VIRTUAL_ROOT_ID);
            const idx = sameDepth.findIndex((n) => n.task.id === selectedTaskId);
            if (idx > 0) selectAndPan(sameDepth[idx - 1].task.id);
          }
        }
        return;
      }
      case 'ArrowRight': {
        e.preventDefault();
        if (nav.nextSiblingId) {
          selectAndPan(nav.nextSiblingId);
        } else {
          // 형제 없으면 같은 depth의 다음 노드 (다른 서브트리 포함)
          const cur = nodes.find((n) => n.task.id === selectedTaskId);
          if (cur) {
            const sameDepth = nodes.filter((n) => n.depth === cur.depth && n.task.id !== VIRTUAL_ROOT_ID);
            const idx = sameDepth.findIndex((n) => n.task.id === selectedTaskId);
            if (idx < sameDepth.length - 1) selectAndPan(sameDepth[idx + 1].task.id);
          }
        }
        return;
      }
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) selectAndPan(nav.parentId);
        else addChildTask();
        return;
      case 'Home':
        e.preventDefault();
        selectAndPan(nodes.find((n) => n.task.id !== VIRTUAL_ROOT_ID)?.task.id ?? null);
        return;
      case 'End':
        e.preventDefault();
        selectAndPan(nodes[nodes.length - 1].task.id);
        return;
      case ' ':
        e.preventDefault();
        if (hasChildrenInForest(wrappedForest, selectedTaskId)) toggleCollapsed(selectedTaskId);
        return;
      case 'F2':
        e.preventDefault();
        if (selectedTask) startInlineEdit(selectedTask.id, selectedTask.name || '');
        return;
      case 'Enter':
        e.preventDefault();
        openDetailEdit();
        return;
      case 'Escape':
        e.preventDefault();
        setSelectedTaskId(null);
        return;
      case 'Delete':
      case 'Backspace':
        if (!(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) {
          e.preventDefault();
          if (canEditCurrentProject && selectedTask) { setEditingTask(selectedTask); setDeleteOpen(true); }
        }
        return;
      default:
        if (canEditCurrentProject && e.ctrlKey && e.key === 'Enter') { e.preventDefault(); addChildTask(); }
        break;
    }
  }, [nodes, scopedTasks, selectedTaskId, selectedTask, wrappedForest, toggleCollapsed, openDetailEdit, addChildTask, panToNode, startInlineEdit, editingNodeId]);

  // ─── 노드 색상 헬퍼 ────────────────────────────────────────────────────────
  const getNodeFill = (n: PosNode) => {
    if (colorMode === 'status') return STATUS_FILL[n.task.status] ?? STATUS_FILL.todo;
    return DEPTH_FILL[Math.min(n.depth, 7)] ?? DEPTH_FILL[7];
  };
  const getNodeStroke = (n: PosNode) => {
    if (colorMode === 'status') return STATUS_STROKE[n.task.status] ?? STATUS_STROKE.todo;
    return DEPTH_STROKE[Math.min(n.depth, 7)] ?? DEPTH_STROKE[7];
  };

  // 담당자 이니셜 (최대 2글자)
  const getInitials = (name: string) => {
    if (!name) return '';
    const trimmed = name.trim();
    if (trimmed.length <= 2) return trimmed;
    // 영문이면 첫 두 글자, 한글이면 첫 글자
    return /^[a-zA-Z]/.test(trimmed) ? trimmed.slice(0, 2).toUpperCase() : trimmed.slice(0, 1);
  };

  // ─── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: _isDark() ? 'linear-gradient(135deg, #0B1120 0%, #151D2E 50%, #1E1338 100%)' : 'linear-gradient(135deg, #f8fafc 0%, #ffffff 50%, rgba(245,243,255,0.4) 100%)' }}>
      {/* 툴바 */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2 border-b border-slate-200/80 bg-white/90 backdrop-blur-sm flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-800 truncate">
            {layoutMode === 'tree' ? '트리' : '알마인드'} — {projectLabel}
          </h2>
          <p className="text-[10px] text-slate-400">↑ 부모 ↓ 자식 ←→ 형제 · Tab 자식 · Space 접기 · Enter 편집 · Del 삭제</p>
        </div>
        <div className="flex items-center gap-1 shrink-0 flex-wrap">
          {/* 레이아웃 전환 */}
          <button
            type="button"
            onClick={() => setLayoutMode((m) => m === 'tree' ? 'almind' : 'tree')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors',
              layoutMode === 'almind'
                ? 'border-violet-300 bg-violet-50 text-violet-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            )}
            title="레이아웃 전환 (트리 ↔ 알마인드)"
          >
            {layoutMode === 'tree' ? <Network size={13} /> : <GitBranch size={13} />}
            {layoutMode === 'tree' ? '알마인드' : '트리'}
          </button>

          {/* 색상 모드 전환 */}
          <button
            type="button"
            onClick={() => setColorMode((m) => m === 'depth' ? 'status' : 'depth')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors',
              colorMode === 'status'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            )}
            title="색상 모드 전환 (깊이별 ↔ 상태별)"
          >
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: colorMode === 'status' ? '#22c55e' : '#3b82f6' }} />
            {colorMode === 'depth' ? '상태 색상' : '깊이 색상'}
          </button>

          <div className="w-px h-5 bg-slate-200 mx-0.5" />

          {/* 전체 펼치기 */}
          <button
            type="button"
            onClick={expandAll}
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            title="전체 펼치기"
            aria-label="전체 펼치기"
          >
            <ChevronsUpDown size={15} />
          </button>
          {/* 전체 접기 */}
          <button
            type="button"
            onClick={collapseAll}
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            title="전체 접기"
            aria-label="전체 접기"
          >
            <ChevronsDownUp size={15} />
          </button>

          <div className="w-px h-5 bg-slate-200 mx-0.5" />

          {/* 루트 작업 추가 */}
          {canEditCurrentProject && (
          <button
            type="button"
            onClick={addRootTask}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-medium"
            title="루트 작업 추가"
          >
            <Plus size={13} />
            작업 추가
          </button>
          )}

          <div className="w-px h-5 bg-slate-200 mx-0.5" />

          {/* 확대/축소/맞춤 */}
          <button type="button" onClick={() => setScale((s) => Math.min(2.5, s + 0.15))} className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600" title="확대" aria-label="확대"><ZoomIn size={15} /></button>
          <button type="button" onClick={() => setScale((s) => Math.max(0.35, s - 0.15))} className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600" title="축소" aria-label="축소"><ZoomOut size={15} /></button>
          <button type="button" onClick={fitView} className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600" title="화면에 맞추기" aria-label="화면에 맞추기"><Maximize2 size={15} /></button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* 캔버스 */}
        <div
          ref={containerRef}
          tabIndex={0}
          role="application"
          aria-label="WBS 마인드맵 캔버스"
          className={cn(
            'flex-1 min-h-0 overflow-hidden outline-none',
            draggingNodeId ? 'cursor-grabbing' : dragging ? 'cursor-grabbing' : 'cursor-grab'
          )}
          onWheel={onWheel}
          onPointerDown={(e) => { onPointerDown(e); focusContainer(); }}
          onKeyDown={onKeyDown}
        >
          {scopedTasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3 p-8">
              <Hand size={32} className="opacity-40" />
              <p className="text-sm font-medium">표시할 작업이 없습니다.</p>
              {canEditCurrentProject && (
              <button
                type="button"
                onClick={addRootTask}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 text-sm font-medium"
              >
                <Plus size={15} />
                첫 번째 작업 추가
              </button>
              )}
            </div>
          ) : (
            <svg width="100%" height="100%" className="touch-none select-none">
              <defs>
                <filter id={`mmShadow-${filterId}`} x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity={_isDark() ? '0.4' : '0.1'} floodColor={_isDark() ? '#000000' : '#64748b'} />
                </filter>
                <filter id={`mmShadowStrong-${filterId}`} x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodOpacity={_isDark() ? '0.5' : '0.15'} floodColor={_isDark() ? '#000000' : '#475569'} />
                </filter>
              </defs>
              <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
                {/* 엣지 */}
                {edges.map((e, i) => (
                  <path
                    key={i}
                    d={e.treePath
                      ? e.treePath
                      : e.curved
                        ? `M ${e.x1} ${e.y1} C ${e.x1 + (e.x2 - e.x1) * 0.5} ${e.y1}, ${e.x2 - (e.x2 - e.x1) * 0.5} ${e.y2}, ${e.x2} ${e.y2}`
                        : `M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}`}
                    fill="none"
                    stroke={e.isMainBranch ? (_isDark() ? '#475569' : '#64748b') : (_isDark() ? '#334155' : '#94a3b8')}
                    strokeWidth={(e.isMainBranch ? 2 : 1.25) / scale}
                    strokeOpacity={e.isMainBranch ? 0.9 : 0.75}
                    className="pointer-events-none"
                  />
                ))}
                {/* 노드 */}
                {nodes.map((n) => {
                  const isVirtualRoot = n.task.id === VIRTUAL_ROOT_ID;
                  const hasKids = hasChildrenInForest(wrappedForest, n.task.id);
                  const isCollapsed = collapsedIds.has(n.task.id);
                  const isSelected = selectedTaskId === n.task.id;
                  const isDragging = draggingNodeId === n.task.id;
                  const isDropTarget = dropTargetId === n.task.id;
                  const wbsId = isVirtualRoot ? '' : (wbsMap.get(n.task.id) ?? '');
                  const nodeH = isVirtualRoot ? PROJECT_ROOT_H : NODE_H;
                  const nodeContentW = hasKids ? NODE_W - TOGGLE_W : NODE_W;
                  const PROGRESS_H = 4;
                  const TEXT_AREA_H = nodeH - PROGRESS_H;

                  // 가상 루트: 고정 스타일
                  const fill = isVirtualRoot
                    ? (_isDark() ? '#1e293b' : 'white')
                    : isDropTarget ? (_isDark() ? '#052e16' : 'rgb(240 253 244)') : getNodeFill(n);
                  const stroke = isVirtualRoot
                    ? (_isDark() ? '#475569' : '#1e293b')
                    : isDropTarget ? '#22c55e' : isSelected ? '#6366f1' : getNodeStroke(n);

                  const progress = isVirtualRoot ? 0 : (typeof n.task.progress === 'number' ? Math.min(100, Math.max(0, n.task.progress)) : 0);
                  const assigneeInitials = isVirtualRoot ? '' : getInitials(n.task.assignee ?? '');

                  return (
                    <g
                      key={n.task.id}
                      transform={`translate(${n.x},${n.y})`}
                      className={isVirtualRoot ? 'cursor-default' : 'cursor-pointer'}
                      onPointerDown={(e) => { e.stopPropagation(); focusContainer(); }}
                    >
                      {/* 접기/펼치기 토글 (가상 루트는 항상 열려 있음 — 접기 불가) */}
                      {hasKids && !isVirtualRoot && (
                        <g onClick={(e) => { e.stopPropagation(); toggleCollapsed(n.task.id); }} className="fill-slate-500 hover:fill-slate-700">
                          <rect x={0} y={0} width={TOGGLE_W} height={nodeH} rx={6} fill="transparent" />
                          {isCollapsed
                            ? <path d="M6 5 L14 12 L6 19" fill="none" stroke="rgb(100 116 139)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none" transform="translate(2, 2)" />
                            : <path d="M5 6 L12 14 L19 6" fill="none" stroke="rgb(100 116 139)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none" transform="translate(2, 2)" />
                          }
                        </g>
                      )}

                      {/* 노드 본체 */}
                      <g
                        transform={hasKids && !isVirtualRoot ? `translate(${TOGGLE_W},0)` : ''}
                        onPointerDown={(e) => {
                          if (isVirtualRoot) return; // 가상 루트 드래그 불가
                          e.stopPropagation();
                          setDraggingNodeId(n.task.id);
                        }}
                        onClick={() => {
                          if (isVirtualRoot) return;
                          if (justDraggedRef.current) { justDraggedRef.current = false; return; }
                          setSelectedTaskId(n.task.id);
                        }}
                        onDoubleClick={(e) => {
                          if (isVirtualRoot) return;
                          e.stopPropagation();
                          setSelectedTaskId(n.task.id);
                          startInlineEdit(n.task.id, n.task.name || '');
                        }}
                      >
                        <defs>
                          <clipPath id={`clip-${filterId}-${n.task.id}`}>
                            <rect x={0} y={0} width={nodeContentW} height={nodeH} rx={8} />
                          </clipPath>
                        </defs>

                        {/* 배경 */}
                        <rect
                          width={nodeContentW}
                          height={nodeH}
                          rx={isVirtualRoot ? 12 : 8}
                          stroke={stroke}
                          strokeWidth={isVirtualRoot ? 2 : isDropTarget ? 2.5 : isSelected ? 2.5 : 1.5}
                          strokeDasharray={isDropTarget ? '4 2' : undefined}
                          fill={fill}
                          filter={isDragging ? undefined : `url(#mmShadowStrong-${filterId})`}
                          opacity={isDragging ? 0.85 : 1}
                        />

                        {/* 진행률 바 (하단) */}
                        {progress > 0 && (
                          <g clipPath={`url(#clip-${filterId}-${n.task.id})`}>
                            <rect
                              x={0}
                              y={NODE_H - PROGRESS_H}
                              width={nodeContentW}
                              height={PROGRESS_H}
                              fill="rgba(0,0,0,0.06)"
                            />
                            <rect
                              x={0}
                              y={nodeH - PROGRESS_H}
                              width={(nodeContentW * progress) / 100}
                              height={PROGRESS_H}
                              fill={progress === 100 ? '#22c55e' : '#3b82f6'}
                              opacity={0.7}
                            />
                          </g>
                        )}

                        {/* 텍스트 영역 */}
                        <g clipPath={`url(#clip-${filterId}-${n.task.id})`}>
                          {/* WBS ID (가상 루트에는 없음) */}
                          {wbsId && (
                            <text
                              x={8}
                              y={TEXT_AREA_H / 2 + 4}
                              className="pointer-events-none font-mono font-medium"
                              style={{ fontSize: n.depth <= 1 ? 11 : 10, fill: _isDark() ? '#94a3b8' : 'rgb(100 116 139)' }}
                            >
                              {wbsId}
                            </text>
                          )}

                          {/* 작업명 (가상 루트는 흰색 큰 텍스트) */}
                          {(() => {
                            // WBS ID 글자 수에 따라 작업명 시작 x를 동적 계산 (깊이 증가 시 겹침 방지)
                            const wbsCharPx = n.depth <= 1 ? 6.5 : 6;
                            const nameX = wbsId ? Math.max(40, Math.round(8 + wbsId.length * wbsCharPx + 4)) : 12;
                            const raw = n.task.name || '(이름 없음)';
                            const reserveRight = assigneeInitials ? 24 : 0;
                            const availW = nodeContentW - nameX - reserveRight - 8;
                            const charsPerPx = isVirtualRoot ? 9 : 7;
                            const maxLen = Math.max(4, Math.floor(availW / charsPerPx));
                            const label = raw.length > maxLen ? `${raw.slice(0, maxLen - 1)}…` : raw;
                            return (
                              <text
                                x={isVirtualRoot ? nodeContentW / 2 : nameX}
                                y={TEXT_AREA_H / 2 + 5}
                                textAnchor={isVirtualRoot ? 'middle' : 'start'}
                                className="pointer-events-none"
                                style={{
                                  fontSize: isVirtualRoot ? 15 : n.depth === 1 ? 12 : 11,
                                  fontWeight: isVirtualRoot ? 700 : n.depth === 1 ? 600 : 500,
                                  fill: _isDark() ? '#e2e8f0' : '#1e293b',
                                }}
                              >
                                {label}
                              </text>
                            );
                          })()}

                          {/* 담당자 이니셜 배지 (가상 루트 제외) */}
                          {assigneeInitials && (
                            <g>
                              <circle cx={nodeContentW - 14} cy={TEXT_AREA_H / 2} r={10} fill={colorMode === 'status' ? '#6366f1' : '#1d4ed8'} opacity={0.85} />
                              <text x={nodeContentW - 14} y={TEXT_AREA_H / 2 + 4} textAnchor="middle" className="pointer-events-none" style={{ fontSize: 9, fill: 'white', fontWeight: 700 }}>
                                {assigneeInitials}
                              </text>
                            </g>
                          )}
                        </g>

                        {/* 마일스톤 표시 (가상 루트 제외) */}
                        {!isVirtualRoot && n.task.isMilestone && (
                          <circle cx={nodeContentW - (assigneeInitials ? 28 : 12)} cy={nodeH / 2} r={4} className="fill-amber-400 pointer-events-none" />
                        )}

                        {/* 진행률 텍스트 */}
                        {progress > 0 && (
                          <text
                            x={nodeContentW / 2}
                            y={nodeH - PROGRESS_H / 2 + 0.5}
                            textAnchor="middle"
                            className="pointer-events-none"
                            style={{ fontSize: 7, fill: progress > 50 ? 'white' : (_isDark() ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'), fontWeight: 600 }}
                          >
                            {progress}%
                          </text>
                        )}

                        {/* 인라인 편집 오버레이 */}
                        {editingNodeId === n.task.id && (
                          <foreignObject x={0} y={0} width={nodeContentW} height={nodeH}>
                            <input
                              ref={inlineInputRef}
                              value={editingNodeValue}
                              onChange={(e) => setEditingNodeValue(e.target.value)}
                              onBlur={saveInlineEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); saveInlineEdit(); }
                                else if (e.key === 'Escape') { e.preventDefault(); cancelInlineEdit(); }
                                e.stopPropagation();
                              }}
                              style={{
                                width: '100%',
                                height: '100%',
                                padding: '0 10px',
                                fontSize: 11,
                                fontWeight: 500,
                                color: _isDark() ? '#e2e8f0' : '#1e293b',
                                background: _isDark() ? '#1e293b' : 'white',
                                border: 'none',
                                outline: '2.5px solid #6366f1',
                                borderRadius: 8,
                                boxSizing: 'border-box',
                              }}
                            />
                          </foreignObject>
                        )}
                      </g>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>

        {/* 우측 세부 패널 */}
        {selectedTaskId && selectedTask && (
          <div className="w-72 shrink-0 border-l border-slate-200 bg-white/95 backdrop-blur-sm flex flex-col min-h-0">
            <div className="shrink-0 px-3 py-2 border-b border-slate-100 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">선택한 작업</h3>
                <p className="mt-1 text-sm font-bold text-slate-800 break-words">{selectedTask.name || '(이름 없음)'}</p>
              </div>
              <button type="button" onClick={() => setSelectedTaskId(null)} className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 shrink-0" title="패널 닫기" aria-label="패널 닫기">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 text-xs text-slate-600 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 shrink-0">상태</span>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                  style={{ background: STATUS_FILL[selectedTask.status] ?? '#f1f5f9', color: STATUS_STROKE[selectedTask.status] ?? '#94a3b8' }}
                >
                  {STATUS_LABEL[selectedTask.status] ?? selectedTask.status}
                </span>
              </div>
              <div>
                <span className="text-slate-400">기간</span>
                <span className="ml-2">{selectedTask.startDate || '-'} ~ {selectedTask.endDate || '-'}</span>
              </div>
              {selectedTask.assignee && (
                <div>
                  <span className="text-slate-400">담당자</span>
                  <span className="ml-2 font-medium">{selectedTask.assignee}</span>
                </div>
              )}
              {typeof selectedTask.progress === 'number' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-slate-400">진행률</span>
                    <span className="font-medium">{selectedTask.progress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${selectedTask.progress}%`, background: selectedTask.progress === 100 ? '#22c55e' : '#3b82f6' }}
                    />
                  </div>
                </div>
              )}
              {selectedTask.description && (
                <div>
                  <span className="text-slate-400 block mb-1">설명</span>
                  <p className="text-slate-600 whitespace-pre-wrap break-words">{selectedTask.description}</p>
                </div>
              )}
            </div>
            <div className="shrink-0 p-2 border-t border-slate-100 space-y-1">
              <button type="button" onClick={openDetailEdit} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium">
                <Pencil size={14} />세부 편집 (팝업)
              </button>
              <button type="button" onClick={addChildTask} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-800 text-xs font-medium">
                <Plus size={14} />하위 목록 추가
              </button>
              <div className="flex gap-1">
                <button type="button" onClick={levelUp} disabled={!selectedTask.parentId} title="레벨 올리기" className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none text-slate-600 text-xs">
                  <ArrowUpToLine size={14} />올리기
                </button>
                <button type="button" onClick={levelDown} disabled={!selectedTask.parentId || scopedTasks.filter((t) => t.parentId === selectedTask.parentId).length <= 1} title="이전 형제의 하위로" className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none text-slate-600 text-xs">
                  <ArrowDownToLine size={14} />내리기
                </button>
              </div>
              <button type="button" onClick={() => { setEditingTask(selectedTask); setDeleteOpen(true); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium">
                <Trash2 size={14} />삭제
              </button>
            </div>
          </div>
        )}
      </div>

      <TaskModal
        isOpen={!!editingTask}
        onClose={() => setEditingTask(null)}
        onSave={handleSave}
        onDelete={() => setDeleteOpen(true)}
        initialData={editingTask ?? undefined}
        parentOptions={tasks}
        onOpenTask={(t) => setEditingTask(t)}
      />
      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (editingTask) { deleteTask(editingTask.id); if (selectedTaskId === editingTask.id) setSelectedTaskId(null); }
          setDeleteOpen(false);
          setEditingTask(null);
        }}
        title="작업 삭제"
        message="이 작업을 삭제하시겠습니까? 하위 작업도 함께 삭제됩니다."
        confirmLabel="삭제"
        isDanger
      />
    </div>
  );
}
