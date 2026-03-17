import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useWBS } from '../context/WBSContext';
import { FilterState, Task } from '../types';
import { TaskModal } from './TaskModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ZoomIn, ZoomOut, Maximize2, Hand, Plus, ArrowUpToLine, ArrowDownToLine, Pencil, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';

const NODE_W = 200;
const NODE_H = 38;
const GAP_X = 44;
const GAP_Y = 14;
const TOGGLE_W = 20;
/** 노드 세로 간격 확대로 가독성 향상 */
const MIN_NODE_GAP_Y = 18;

/** 트리형 레이아웃: 중심(상단) → 주요 토픽(가로 한 줄) → 하위 토픽(세로 열) */
const TREE_START_Y = 40;
const TREE_CENTER_X = 480;
const TREE_GAP_X = 24;

interface TreeNode {
  task: Task;
  children: TreeNode[];
}

interface PosNode {
  task: Task;
  x: number;
  y: number;
  depth: number;
  /** -1: 왼쪽, 1: 오른쪽 (중심 기준). 레이아웃 방향용 */
  side: number;
  kids: PosNode[];
}

interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  curved: boolean;
  /** 중심→1단계 가지 등 주요 연결선 스타일용 */
  isMainBranch?: boolean;
  /** 트리형 연결선: 부모 하단 → 세로 → 가로 → 세로 → 자식 상단 (SVG path d) */
  treePath?: string;
}

/** 배열 순서를 형제 순서로 사용 (드래그로 위치 이동 반영) */
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

/** 알마인드 스타일: 중심 노드 → 좌우 주요 토픽 → 곡선으로 하위 토픽 */
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
      return {
        root: { task: node.task, x, y, depth: 0, side: 0, kids: [] },
        bottom: yStart + NODE_H,
      };
    }
    const n = effectiveChildren.length;
    const leftCount = Math.ceil(n / 2);
    const rightCount = n - leftCount;
    const leftKids: PosNode[] = [];
    const rightKids: PosNode[] = [];
    let leftY = y;
    let rightY = y;
    for (let i = 0; i < n; i++) {
      const isLeft = i < leftCount;
      const yPos = isLeft ? leftY : rightY;
      const { root: kr, bottom } = layoutAlmind(
        node.children[i],
        1,
        isLeft ? -1 : 1,
        yPos,
        collapsedIds
      );
      if (isLeft) {
        leftKids.push(kr);
        leftY = bottom + MIN_NODE_GAP_Y;
      } else {
        rightKids.push(kr);
        rightY = bottom + MIN_NODE_GAP_Y;
      }
    }
    const kids = [...leftKids, ...rightKids];
    const maxBottom = Math.max(
      leftKids.length ? leftY - MIN_NODE_GAP_Y : y,
      rightKids.length ? rightY - MIN_NODE_GAP_Y : y
    );
    return {
      root: { task: node.task, x, y, depth: 0, side: 0, kids },
      bottom: Math.max(maxBottom, y + NODE_H),
    };
  }

  const x = ALMIND_CENTER_X + side * depth * ALMIND_BRANCH_DX;
  if (effectiveChildren.length === 0) {
    return {
      root: { task: node.task, x, y: yStart, depth, side, kids: [] },
      bottom: yStart + NODE_H,
    };
  }

  // 부모를 자식들 위에 배치해 겹침 방지: 자식은 (yStart + NODE_H + MIN_NODE_GAP_Y)부터 배치
  const childYStart = yStart + NODE_H + MIN_NODE_GAP_Y;
  let curY = childYStart;
  const kids: PosNode[] = [];
  for (const c of node.children) {
    const { root: kr, bottom } = layoutAlmind(c, depth + 1, side, curY, collapsedIds);
    kids.push(kr);
    curY = bottom + MIN_NODE_GAP_Y;
  }
  curY -= MIN_NODE_GAP_Y;
  return {
    root: { task: node.task, x, y: yStart, depth, side, kids },
    bottom: curY,
  };
}

/** 다중 루트 시 전체를 중앙 근처에 배치 */
function layoutAlmindForest(
  forest: TreeNode[],
  collapsedIds: Set<string>
): { roots: PosNode[]; width: number; height: number } {
  if (forest.length === 0) return { roots: [], width: 400, height: 200 };
  if (forest.length === 1) {
    const { root } = layoutAlmind(forest[0], 0, 0, ALMIND_CENTER_Y, collapsedIds);
    const nodes = flattenPos(root);
    let w = 0,
      h = 0;
    for (const n of nodes) {
      w = Math.max(w, n.x + NODE_W + 80);
      h = Math.max(h, n.y + NODE_H + 40);
    }
    return { roots: [root], width: w, height: h };
  }
  const roots: PosNode[] = [];
  const step = ALMIND_BRANCH_DX * 0.8;
  const startX = ALMIND_CENTER_X - ((forest.length - 1) / 2) * step;
  let maxBottom = 0;
  for (let i = 0; i < forest.length; i++) {
    const { root, bottom } = layoutAlmind(
      forest[i],
      0,
      i < forest.length / 2 ? -1 : 1,
      ALMIND_CENTER_Y + (i - (forest.length - 1) / 2) * 60,
      collapsedIds
    );
    root.x = startX + i * step;
    root.y = ALMIND_CENTER_Y;
    roots.push(root);
    const nodes = flattenPos(root);
    for (const n of nodes) {
      if (n.depth > 0) {
        n.x = root.x + n.side * n.depth * ALMIND_BRANCH_DX;
        if (n.depth === 1) n.y = root.y + (n.y - ALMIND_CENTER_Y);
      }
    }
    maxBottom = Math.max(maxBottom, bottom);
  }
  const allNodes = roots.flatMap(flattenPos);
  let w = 0,
    h = 0;
  for (const n of allNodes) {
    w = Math.max(w, n.x + NODE_W + 80);
    h = Math.max(h, n.y + NODE_H + 40);
  }
  return { roots, width: w, height: Math.max(h, maxBottom) };
}

/** depth 2 이상: 부모 아래 세로 열로 배치 (같은 x) */
function layoutVerticalColumn(
  node: TreeNode,
  depth: number,
  parentX: number,
  startY: number,
  collapsedIds: Set<string>
): { root: PosNode; maxY: number } {
  const isCollapsed = collapsedIds.has(node.task.id);
  const effectiveChildren = isCollapsed ? [] : node.children;
  const root: PosNode = { task: node.task, x: parentX, y: startY, depth, side: 0, kids: [] };

  if (effectiveChildren.length === 0) {
    return { root, maxY: startY + NODE_H };
  }

  let curY = startY + NODE_H + MIN_NODE_GAP_Y;
  let maxY = startY + NODE_H;
  for (const c of node.children) {
    const sub = layoutVerticalColumn(c, depth + 1, parentX, curY, collapsedIds);
    root.kids.push(sub.root);
    curY = sub.maxY + MIN_NODE_GAP_Y;
    maxY = Math.max(maxY, sub.maxY);
  }
  return { root, maxY };
}

/** 이미지 스타일: 중심(상단) → 주요 토픽(가로 한 줄) → 하위 토픽(세로 열) */
function layoutTreeForest(
  forest: TreeNode[],
  collapsedIds: Set<string>
): { roots: PosNode[]; width: number; height: number } {
  if (forest.length === 0) return { roots: [], width: 400, height: 200 };

  const rootNode = forest[0];
  const rootY = TREE_START_Y;
  const rootX = TREE_CENTER_X - NODE_W / 2;
  const root: PosNode = { task: rootNode.task, x: rootX, y: rootY, depth: 0, side: 0, kids: [] };

  const rootCollapsed = collapsedIds.has(rootNode.task.id);
  const depth1Children = rootCollapsed ? [] : rootNode.children;
  const n1 = depth1Children.length;

  if (n1 === 0) {
    const allNodes = flattenPos(root);
    let w = 0, h = 0;
    for (const n of allNodes) {
      w = Math.max(w, n.x + NODE_W + 80);
      h = Math.max(h, n.y + NODE_H + 60);
    }
    return { roots: [root], width: w, height: h };
  }

  const rowWidth = n1 * NODE_W + (n1 - 1) * TREE_GAP_X;
  const startX = TREE_CENTER_X - rowWidth / 2;
  const rowY = rootY + NODE_H + MIN_NODE_GAP_Y;
  let maxHeight = rowY + NODE_H;

  for (let i = 0; i < n1; i++) {
    const child = depth1Children[i];
    const cx = startX + i * (NODE_W + TREE_GAP_X);
    const posChild = layoutVerticalColumn(child, 1, cx, rowY, collapsedIds);
    root.kids.push(posChild.root);
    maxHeight = Math.max(maxHeight, posChild.maxY);
  }

  const allNodes = flattenPos(root);
  let w = 0, h = 0;
  for (const n of allNodes) {
    w = Math.max(w, n.x + NODE_W + 80);
    h = Math.max(h, n.y + NODE_H + 60);
  }
  return { roots: [root], width: w, height: Math.max(h, maxHeight) + 40 };
}

/** 트리형 연결선: 부모 하단 중앙 → 세로 → 가로 → 세로 → 자식 상단 중앙 */
function collectEdgesTree(root: PosNode): Edge[] {
  const edges: Edge[] = [];
  const parentCx = root.x + NODE_W / 2;
  const parentBottom = root.y + NODE_H;
  for (const k of root.kids) {
    const childCx = k.x + NODE_W / 2;
    const childTop = k.y;
    const midY = (parentBottom + childTop) / 2;
    const treePath = `M ${parentCx} ${parentBottom} L ${parentCx} ${midY} L ${childCx} ${midY} L ${childCx} ${childTop}`;
    edges.push({
      x1: parentCx,
      y1: parentBottom,
      x2: childCx,
      y2: childTop,
      curved: false,
      isMainBranch: root.depth === 0,
      treePath,
    });
    edges.push(...collectEdgesTree(k));
  }
  return edges;
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

/** 트리 이동용: 부모·이전/다음 형제·첫 자식 ID */
function getTreeNav(
  tasks: Task[],
  taskId: string
): { parentId: string | null; prevSiblingId: string | null; nextSiblingId: string | null; firstChildId: string | null } {
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

/** id가 ancestorId의 자손인지 (자신 포함) */
function isDescendant(tasks: Task[], ancestorId: string, id: string): boolean {
  let current: string | null = id;
  while (current) {
    if (current === ancestorId) return true;
    const task = tasks.find((t) => t.id === current);
    current = task?.parentId ?? null;
  }
  return false;
}

function flattenPos(root: PosNode): PosNode[] {
  const out: PosNode[] = [root];
  for (const k of root.kids) out.push(...flattenPos(k));
  return out;
}

function collectEdges(root: PosNode): Edge[] {
  const edges: Edge[] = [];
  const cy = root.y + NODE_H / 2;
  const fromX =
    root.depth === 0
      ? 0
      : root.side < 0
        ? root.x
        : root.x + NODE_W;
  if (root.depth === 0) {
    for (const k of root.kids) {
      const x1 = k.side < 0 ? root.x : root.x + NODE_W;
      const x2 = k.side < 0 ? k.x + NODE_W : k.x;
      const y2 = k.y + NODE_H / 2;
      edges.push({ x1, y1: cy, x2, y2, curved: false, isMainBranch: true });
      edges.push(...collectEdges(k));
    }
  } else {
    for (const k of root.kids) {
      const x2 = k.side < 0 ? k.x + NODE_W : k.x;
      const y2 = k.y + NODE_H / 2;
      const curved = root.depth === 1 && k.depth === 2;
      edges.push({ x1: fromX, y1: cy, x2, y2, curved, isMainBranch: root.depth === 1 && k.depth === 2 });
      edges.push(...collectEdges(k));
    }
  }
  return edges;
}

interface MindMapViewProps {
  filters: FilterState;
}

/** 알마인드 스타일 레벨별 색상: 중심=초록, 주요=파랑, 하위=하늘, 하위하위=회색 */
const ALMIND_LEVEL_FILL: Record<number, string> = {
  0: '#22c55e',
  1: '#3b82f6',
  2: '#7dd3fc',
  3: '#e5e7eb',
};
const ALMIND_LEVEL_STROKE: Record<number, string> = {
  0: '#16a34a',
  1: '#2563eb',
  2: '#0ea5e9',
  3: '#9ca3af',
};
const STROKE: Record<string, string> = {
  todo: '#d6d3d1',
  'in-progress': '#7dd3fc',
  blocked: '#fca5a5',
  done: '#6ee7b7',
};

export function MindMapView({ filters }: MindMapViewProps) {
  const { tasks, addTask, updateTask, deleteTask, reorderTask, currentProjectId, projects, wbsMap } = useWBS();
  const filterId = React.useId().replace(/:/g, '');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const scopedTasks = useMemo(() => {
    let list = tasks;
    if (filters.projectIds !== 'all') {
      const set = new Set(filters.projectIds);
      list = list.filter((t) => t.projectId && set.has(t.projectId));
    }
    return list;
  }, [tasks, filters.projectIds]);

  const forest = useMemo(() => buildForest(scopedTasks), [scopedTasks]);

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const transformRef = useRef({ pan: { x: 0, y: 0 }, scale: 1, nodes: [] as PosNode[] });
  const justDraggedRef = useRef(false);

  const toggleCollapsed = useCallback((taskId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const { nodes, edges, width, height } = useMemo(() => {
    if (forest.length === 0) {
      return { nodes: [] as PosNode[], edges: [] as Edge[], width: 400, height: 200 };
    }
    const { roots, width: w, height: h } = layoutTreeForest(forest, collapsedIds);
    const allNodes = roots.flatMap(flattenPos);
    const allEdges = roots.flatMap(collectEdgesTree);
    return { nodes: allNodes, edges: allEdges, width: w, height: h };
  }, [forest, collapsedIds]);

  transformRef.current = { pan, scale, nodes };

  const projectLabel = useMemo(() => {
    if (filters.projectIds === 'all') {
      const p = projects.find((x) => x.id === currentProjectId);
      return p?.name ?? '프로젝트';
    }
    if (filters.projectIds.length === 1) {
      return projects.find((x) => x.id === filters.projectIds[0])?.name ?? '프로젝트';
    }
    return `${filters.projectIds.length}개 프로젝트`;
  }, [filters.projectIds, projects, currentProjectId]);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setScale((s) => Math.min(2.5, Math.max(0.35, s + delta)));
    },
    []
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', prevent, { passive: false });
    return () => el.removeEventListener('wheel', prevent);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (draggingNodeId) return;
    setDragging(true);
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      if (draggingNodeId) return;
      const d = dragRef.current;
      setPan({ x: d.panX + e.clientX - d.x, y: d.panY + e.clientY - d.y });
    };
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, draggingNodeId]);

  // 노드 드래그: 마우스 이동 시 드롭 타깃 갱신, 마우스 업 시 부모 변경
  useEffect(() => {
    if (!draggingNodeId) {
      setDropTargetId(null);
      return;
    }
    const container = containerRef.current;
    const clientToSvg = (clientX: number, clientY: number) => {
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const { pan, scale } = transformRef.current;
      const sx = (clientX - rect.left - pan.x) / scale;
      const sy = (clientY - rect.top - pan.y) / scale;
      return { sx, sy };
    };
    const getNodeAt = (sx: number, sy: number): PosNode | null => {
      const { nodes } = transformRef.current;
      for (const n of nodes) {
        if (n.task.id === draggingNodeId) continue;
        if (sx >= n.x && sx <= n.x + NODE_W && sy >= n.y && sy <= n.y + NODE_H) return n;
      }
      return null;
    };
    const onMove = (e: MouseEvent) => {
      const pt = clientToSvg(e.clientX, e.clientY);
      if (!pt) return;
      const node = getNodeAt(pt.sx, pt.sy);
      setDropTargetId(node ? node.task.id : null);
    };
    const onUp = (e: MouseEvent) => {
      justDraggedRef.current = true;
      const pt = clientToSvg(e.clientX, e.clientY);
      if (pt) {
        const node = getNodeAt(pt.sx, pt.sy);
        if (node) {
          const targetId = node.task.id;
          if (targetId !== draggingNodeId && !isDescendant(scopedTasks, draggingNodeId, targetId)) {
            const dragged = scopedTasks.find((t) => t.id === draggingNodeId);
            const target = scopedTasks.find((t) => t.id === targetId);
            const sameParent =
              dragged && target && (dragged.parentId ?? null) === (target.parentId ?? null);
            if (sameParent) {
              reorderTask(draggingNodeId, targetId);
            } else {
              updateTask(draggingNodeId, { parentId: targetId });
            }
          }
        }
      }
      setDraggingNodeId(null);
      setDropTargetId(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingNodeId, scopedTasks, updateTask, reorderTask]);

  const fitView = useCallback(() => {
    const el = containerRef.current;
    if (!el || nodes.length === 0) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const pad = 48;
    const sx = (w - pad * 2) / width;
    const sy = (h - pad * 2) / height;
    const s = Math.min(1.2, Math.max(0.4, Math.min(sx, sy)));
    setScale(s);
    setPan({ x: (w - width * s) / 2, y: (h - height * s) / 2 });
  }, [width, height, nodes.length]);

  const focusContainer = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  // 확대/축소·팬은 사용자 조작만 반영. 자동 fit 비활성화.

  // 노드가 처음 나타날 때 캔버스에 포커스해 키보드 조작 가능하게
  const hasFocusedRef = useRef(false);
  useEffect(() => {
    if (nodes.length > 0 && !hasFocusedRef.current) {
      hasFocusedRef.current = true;
      focusContainer();
    }
    if (nodes.length === 0) hasFocusedRef.current = false;
  }, [nodes.length, focusContainer]);

  const handleSave = (taskData: Omit<Task, 'id'> | Partial<Task>) => {
    if (editingTask) updateTask(editingTask.id, taskData);
  };

  const selectedTask = selectedTaskId
    ? (scopedTasks.find((t) => t.id === selectedTaskId) ?? null)
    : null;
  const projectId = currentProjectId === 'all' ? projects[0]?.id : currentProjectId;
  const project = projects.find((p) => p.id === projectId);

  const addChildTask = useCallback(() => {
    if (!selectedTask) return;
    const targetProjectId = selectedTask.projectId;
    const project = projects.find((p) => p.id === targetProjectId);
    const start = selectedTask.startDate || project?.startDate || new Date().toISOString().slice(0, 10);
    const end = selectedTask.endDate || project?.endDate || start;
    addTask(
      {
        parentId: selectedTask.id,
        name: '새 하위 작업',
        startDate: start,
        endDate: end,
        progress: 0,
        assignee: '',
        status: 'todo',
      },
      undefined,
      targetProjectId
    );
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.delete(selectedTask.id);
      return next;
    });
  }, [selectedTask, projects, addTask]);

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
    const newParentId = siblings[idx - 1].id;
    updateTask(selectedTask.id, { parentId: newParentId });
  }, [selectedTask, scopedTasks, updateTask]);

  const openDetailEdit = useCallback(() => {
    if (selectedTask) setEditingTask(selectedTask);
  }, [selectedTask]);

  // 알마인드식 키보드: ← 부모, → 자식/다음형제, ↑ 이전 형제, ↓ 다음 형제, Tab 자식, Shift+Tab 부모
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (nodes.length === 0) return;
      if (!selectedTaskId) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'Tab') {
          e.preventDefault();
          setSelectedTaskId(nodes[0].task.id);
        }
        return;
      }
      const nav = getTreeNav(scopedTasks, selectedTaskId);

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (nav.parentId) setSelectedTaskId(nav.parentId);
          return;
        case 'ArrowRight':
          e.preventDefault();
          if (nav.firstChildId) setSelectedTaskId(nav.firstChildId);
          else if (nav.nextSiblingId) setSelectedTaskId(nav.nextSiblingId);
          return;
        case 'ArrowUp':
          e.preventDefault();
          if (nav.prevSiblingId) setSelectedTaskId(nav.prevSiblingId);
          return;
        case 'ArrowDown':
          e.preventDefault();
          if (nav.nextSiblingId) setSelectedTaskId(nav.nextSiblingId);
          return;
        case 'Tab':
          e.preventDefault();
          if (e.shiftKey) {
            if (nav.parentId) setSelectedTaskId(nav.parentId);
          } else {
            if (nav.firstChildId) setSelectedTaskId(nav.firstChildId);
            else addChildTask();
          }
          return;
        case 'Home':
          e.preventDefault();
          setSelectedTaskId(nodes[0].task.id);
          return;
        case 'End':
          e.preventDefault();
          setSelectedTaskId(nodes[nodes.length - 1].task.id);
          return;
        case ' ':
          e.preventDefault();
          if (hasChildrenInForest(forest, selectedTaskId)) toggleCollapsed(selectedTaskId);
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
            if (selectedTask) {
              setEditingTask(selectedTask);
              setDeleteOpen(true);
            }
          }
          return;
        default:
          if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            addChildTask();
          }
          break;
      }
    },
    [
      nodes,
      scopedTasks,
      selectedTaskId,
      selectedTask,
      forest,
      toggleCollapsed,
      openDetailEdit,
      addChildTask,
    ]
  );

  return (
    <div className="flex flex-col h-full min-h-0 bg-gradient-to-br from-slate-50 via-white to-violet-50/40">
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-slate-200/80 bg-white/90 backdrop-blur-sm">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-800 truncate">트리 — {projectLabel}</h2>
          <p className="text-[11px] text-slate-500">위→아래 계층 · ← 부모 → 자식/형제 ↑↓ 형제 · Tab 자식 Shift+Tab 부모 · Space 접기/펼치기 · Enter 편집 · Del 삭제 · Esc 선택 해제</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(2.5, s + 0.15))}
            className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            title="확대"
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.35, s - 0.15))}
            className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            title="축소"
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            onClick={fitView}
            className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            title="화면에 맞추기"
          >
            <Maximize2 size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div
          ref={containerRef}
          tabIndex={0}
          role="application"
          aria-label="WBS 트리 캔버스. 키보드로 노드 이동·편집 가능"
          className={cn(
            'flex-1 min-h-0 overflow-hidden outline-none',
            draggingNodeId ? 'cursor-grabbing' : dragging ? 'cursor-grabbing' : 'cursor-grab'
          )}
          onWheel={onWheel}
          onMouseDown={(e) => {
            onMouseDown(e);
            focusContainer();
          }}
          onKeyDown={onKeyDown}
        >
          {nodes.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2 p-8">
              <Hand size={32} className="opacity-40" />
              <p className="text-sm font-medium">표시할 작업이 없습니다.</p>
              <p className="text-xs text-center max-w-sm">프로젝트를 선택하거나 작업을 추가하면 WBS가 트리로 표시됩니다.</p>
            </div>
          ) : (
            <svg width="100%" height="100%" className="touch-none select-none">
              <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
                {edges.map((e, i) => (
                  <path
                    key={i}
                    d={e.treePath ?? (e.curved ? `M ${e.x1} ${e.y1} C ${e.x1 + (e.x2 - e.x1) * 0.5} ${e.y1}, ${e.x2 - (e.x2 - e.x1) * 0.5} ${e.y2}, ${e.x2} ${e.y2}` : `M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}`)}
                    fill="none"
                    stroke={e.isMainBranch ? '#64748b' : '#94a3b8'}
                    strokeWidth={(e.isMainBranch ? 2 : 1.25) / scale}
                    strokeOpacity={e.isMainBranch ? 0.9 : 0.75}
                    className="pointer-events-none"
                  />
                ))}
                {nodes.map((n) => {
                  const hasKids = hasChildrenInForest(forest, n.task.id);
                  const isCollapsed = collapsedIds.has(n.task.id);
                  const isSelected = selectedTaskId === n.task.id;
                  const isDragging = draggingNodeId === n.task.id;
                  const isDropTarget = dropTargetId === n.task.id;
                  const wbsId = wbsMap.get(n.task.id) ?? '';
                  const nodeContentW = hasKids ? NODE_W - TOGGLE_W : NODE_W;
                  return (
                    <g
                      key={n.task.id}
                      transform={`translate(${n.x},${n.y})`}
                      className="cursor-pointer"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        focusContainer();
                      }}
                    >
                      {/* 펼치기/접기 토글 */}
                      {hasKids && (
                        <g
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapsed(n.task.id);
                          }}
                          className="fill-slate-500 hover:fill-slate-700"
                        >
                          <rect x={0} y={0} width={TOGGLE_W} height={NODE_H} rx={6} fill="transparent" />
                          {isCollapsed ? (
                            <path d="M6 5 L14 12 L6 19" fill="none" stroke="rgb(100 116 139)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none" transform="translate(2, 2)" />
                          ) : (
                            <path d="M5 6 L12 14 L19 6" fill="none" stroke="rgb(100 116 139)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none" transform="translate(2, 2)" />
                          )}
                        </g>
                      )}
                      {/* 노드 박스 + WBS + 텍스트 (드래그로 이동, 클릭 시 선택) */}
                      <g
                        transform={hasKids ? `translate(${TOGGLE_W},0)` : ''}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          setDraggingNodeId(n.task.id);
                        }}
                        onClick={() => {
                          if (justDraggedRef.current) {
                            justDraggedRef.current = false;
                            return;
                          }
                          setSelectedTaskId(n.task.id);
                        }}
                      >
                        <rect
                          width={nodeContentW}
                          height={NODE_H}
                          rx={8}
                          stroke={
                            isDropTarget
                              ? '#22c55e'
                              : isSelected
                                ? (ALMIND_LEVEL_STROKE[n.depth] ?? ALMIND_LEVEL_STROKE[3])
                                : (ALMIND_LEVEL_STROKE[n.depth] ?? ALMIND_LEVEL_STROKE[3] ?? STROKE[n.task.status])
                          }
                          strokeWidth={isDropTarget ? 2.5 : isSelected ? 2.5 : 1.5}
                          strokeDasharray={isDropTarget ? '4 2' : undefined}
                          fill={
                            isDropTarget
                              ? 'rgb(240 253 244)'
                              : (ALMIND_LEVEL_FILL[n.depth] ?? ALMIND_LEVEL_FILL[3] ?? 'white')
                          }
                          filter={isDragging ? undefined : n.depth === 0 ? `url(#mmShadowStrong-${filterId})` : `url(#mmShadow-${filterId})`}
                          opacity={isDragging ? 0.85 : 1}
                        />
                        {wbsId && (
                          <text
                            x={8}
                            y={NODE_H / 2 + 4}
                            className="pointer-events-none font-mono font-medium"
                            style={{
                              fontSize: n.depth <= 1 ? 11 : 10,
                              fill: n.depth === 0 ? 'rgb(30 41 59)' : 'rgb(100 116 139)',
                            }}
                          >
                            {wbsId}
                          </text>
                        )}
                        <text
                          x={wbsId ? 40 : 10}
                          y={NODE_H / 2 + 4}
                          className="pointer-events-none fill-slate-800"
                          style={{
                            fontSize: n.depth === 0 ? 14 : n.depth === 1 ? 13 : 12,
                            fontWeight: n.depth === 0 ? 700 : n.depth === 1 ? 600 : 500,
                          }}
                        >
                          {(n.task.name || '(이름 없음)').length > 22
                            ? `${(n.task.name || '').slice(0, 20)}…`
                            : n.task.name || '(이름 없음)'}
                        </text>
                        {n.task.isMilestone && (
                          <circle
                            cx={nodeContentW - 12}
                            cy={NODE_H / 2}
                            r={4}
                            className="fill-amber-400"
                          />
                        )}
                      </g>
                    </g>
                  );
                })}
                <defs>
                  <filter id={`mmShadow-${filterId}`} x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.1" floodColor="#64748b" />
                  </filter>
                  <filter id={`mmShadowStrong-${filterId}`} x="-30%" y="-30%" width="160%" height="160%">
                    <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodOpacity="0.15" floodColor="#475569" />
                  </filter>
                </defs>
              </g>
            </svg>
          )}
        </div>

        {/* 오른쪽 세부 패널 (알마인드 스타일) */}
        {selectedTaskId && selectedTask && (
          <div className="w-72 shrink-0 border-l border-slate-200 bg-white/95 backdrop-blur-sm flex flex-col min-h-0">
            <div className="shrink-0 px-3 py-2 border-b border-slate-100 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">선택한 작업</h3>
                <p className="mt-1 text-sm font-bold text-slate-800 break-words">{selectedTask.name || '(이름 없음)'}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTaskId(null)}
                className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 shrink-0"
                title="패널 닫기"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 text-xs text-slate-600 space-y-2">
              <div>
                <span className="text-slate-400">상태</span>
                <span className="ml-2 font-medium">{selectedTask.status}</span>
              </div>
              <div>
                <span className="text-slate-400">기간</span>
                <span className="ml-2">{selectedTask.startDate || '-'} ~ {selectedTask.endDate || '-'}</span>
              </div>
              {selectedTask.description && (
                <div>
                  <span className="text-slate-400 block mb-1">설명</span>
                  <p className="text-slate-600 whitespace-pre-wrap break-words">{selectedTask.description}</p>
                </div>
              )}
            </div>
            <div className="shrink-0 p-2 border-t border-slate-100 space-y-1">
              <button
                type="button"
                onClick={openDetailEdit}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium"
              >
                <Pencil size={14} />
                세부 편집 (팝업)
              </button>
              <button
                type="button"
                onClick={addChildTask}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-800 text-xs font-medium"
              >
                <Plus size={14} />
                하위 목록 추가
              </button>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={levelUp}
                  disabled={!selectedTask.parentId}
                  title="레벨 올리기 (부모와 형제로)"
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none text-slate-600 text-xs"
                >
                  <ArrowUpToLine size={14} />
                  올리기
                </button>
                <button
                  type="button"
                  onClick={levelDown}
                  disabled={!selectedTask.parentId || scopedTasks.filter((t) => t.parentId === selectedTask.parentId).length <= 1}
                  title="이전 형제의 하위로"
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:pointer-events-none text-slate-600 text-xs"
                >
                  <ArrowDownToLine size={14} />
                  내리기
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingTask(selectedTask);
                  setDeleteOpen(true);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium"
              >
                <Trash2 size={14} />
                삭제
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
          if (editingTask) {
            deleteTask(editingTask.id);
            if (selectedTaskId === editingTask.id) setSelectedTaskId(null);
          }
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
