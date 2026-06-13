import React, { useMemo, useState, useEffect } from 'react';
import { X, Settings2, Plus, Trash2, GripVertical, ArrowUp, ArrowDown, Eye, EyeOff, RotateCcw, Palette } from 'lucide-react';
import { useWBS } from '../context/WBSContext';
import { useAuth } from '../context/AuthContext';
import { useLevelColors, type RgbColor } from '../context/LevelColorsContext';
import { LEVEL_COLORS } from '../lib/levelColors';
import { useWbsTableAutoFormatting } from '../hooks/useWbsTableAutoFormatting';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';
import {
  DASHBOARD_SECTION_IDS,
  DASHBOARD_SECTION_LABELS,
  readDashboardSectionVisibility,
  writeDashboardSectionVisibility,
  resetDashboardSectionVisibility,
  getDefaultDashboardSectionVisibility,
  WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED,
} from '../lib/dashboardSections';
import { resetDashboardSectionLayout } from '../lib/dashboardSectionLayout';
import { ColorPicker } from './ColorPicker';
import { ProjectNameLabel } from './ProjectNameLabel';
import { formatProjectDisplayName, filterProjectsVisibleToViewer } from '../lib/projectKind';
import { TaskStatus } from '../types';

interface WBSSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 로컬 초기화 요청 시 호출. 호출 시 설정 모달을 닫고 상위에서 확인 다이얼로그를 띄우면 됨 */
  onRequestReset?: () => void;
}

const DEFAULT_LEVEL_COLORS: RgbColor[] = [...LEVEL_COLORS];

/** 상태(할 일/진행 중/완료 등)별 색상 프리셋 - Tailwind 클래스 */
const STATUS_COLOR_PRESETS: { value: string; label: string }[] = [
  { value: 'bg-stone-100 border-stone-200', label: '회색' },
  { value: 'bg-zinc-100 border-zinc-200', label: '징크' },
  { value: 'bg-neutral-100 border-neutral-200', label: '뉴트럴' },
  { value: 'bg-[var(--color-bg)] border-[var(--color-line)]', label: '슬레이트' },
  { value: 'bg-sky-50 border-sky-100', label: '스카이' },
  { value: 'bg-blue-50 border-blue-100', label: '파랑' },
  { value: 'bg-indigo-50 border-indigo-100', label: '남색' },
  { value: 'bg-violet-50 border-violet-100', label: '바이올렛' },
  { value: 'bg-purple-50 border-purple-100', label: '퍼플' },
  { value: 'bg-fuchsia-50 border-fuchsia-100', label: '푸시아' },
  { value: 'bg-pink-50 border-pink-100', label: '핑크' },
  { value: 'bg-rose-50 border-rose-100', label: '로즈' },
  { value: 'bg-red-50 border-red-100', label: '빨강' },
  { value: 'bg-orange-50 border-orange-100', label: '오렌지' },
  { value: 'bg-amber-50 border-amber-100', label: '앰버' },
  { value: 'bg-yellow-50 border-yellow-100', label: '옐로우' },
  { value: 'bg-lime-50 border-lime-100', label: '라임' },
  { value: 'bg-green-50 border-green-100', label: '초록' },
  { value: 'bg-emerald-50 border-emerald-100', label: '에메랄드' },
  { value: 'bg-teal-50 border-teal-100', label: '청록' },
  { value: 'bg-cyan-50 border-cyan-100', label: '시안' },
];

/** 커스텀 색상 저장 형식: bg-[#hex] border-[#hex] */
function isCustomStatusColor(value: string): boolean {
  return /^bg-\[#[a-fA-F0-9]{6}\] border-\[#[a-fA-F0-9]{6}\]$/.test(value);
}
function parseCustomStatusColor(value: string): string | null {
  const m = value.match(/border-\[(#[a-fA-F0-9]{6})\]/);
  return m ? m[1] : null;
}
function hexToCustomStatusColor(hex: string): string {
  const rgb = hexToRgb(hex.startsWith('#') ? hex : `#${hex}`);
  if (!rgb) return 'bg-[var(--color-bg)] border-[var(--color-line)]';
  const r = Math.min(255, Math.round(rgb.r * 0.2 + 248));
  const g = Math.min(255, Math.round(rgb.g * 0.2 + 248));
  const b = Math.min(255, Math.round(rgb.b * 0.2 + 248));
  const bgHex = rgbToHex(r, g, b);
  const borderHex = hex.startsWith('#') ? hex : `#${hex}`;
  return `bg-[${bgHex}] border-[${borderHex}]`;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): RgbColor | null {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export function WBSSettingsModal({ isOpen, onClose, onRequestReset }: WBSSettingsModalProps) {
  const { wbsSettings, updateWbsSettings, projects, updateProject, isAdmin } = useWBS();
  const { user } = useAuth();
  const { levelColors, setLevelColors } = useLevelColors();
  // 권한: 전역 설정(WBS prefix, 표 컬럼, 상태/진척도, 색상 등)은 관리자만 수정 가능.
  // 프로젝트별 일정은 본인이 만든 프로젝트(소유자)이거나 관리자일 때만 수정 가능.
  const canEditGlobal = isAdmin;
  const canEditProject = (ownerId?: string | null) => isAdmin || (!!user?.id && ownerId === user.id);

  const projectsShownInSettings = useMemo(() => filterProjectsVisibleToViewer(projects, user?.id), [projects, user?.id]);

  const [prependDisplayWbsToTaskName, setPrependDisplayWbsToTaskName] = useState(wbsSettings.prependDisplayWbsToTaskName === true);
  const [showTableAutoFormattingAdmin, setShowTableAutoFormattingAdmin] = useState(wbsSettings.showTableAutoFormatting !== false);
  const [level1, setLevel1] = useState(wbsSettings.level1Prefix);
  const [level2, setLevel2] = useState(wbsSettings.level2Prefix);
  const [level3, setLevel3] = useState(wbsSettings.level3Prefix);
  const [maxLevel, setMaxLevel] = useState(wbsSettings.maxLevel);
  const [statusConfigs, setStatusConfigs] = useState(wbsSettings.statusConfigs);
  const [projectDates, setProjectDates] = useState<Record<string, string>>({});
  const [projectEndDates, setProjectEndDates] = useState<Record<string, string>>({});
  const [tableColumns, setTableColumns] = useState<{ id: string; visible: boolean }[]>(wbsSettings.tableColumns || []);
  const [customColumns, setCustomColumns] = useState<Array<{ id: string; name: string; projectId?: string }>>(
    wbsSettings.customColumns || [],
  );
  const [levelColorsState, setLevelColorsState] = useState<RgbColor[]>(DEFAULT_LEVEL_COLORS);
  const [activeTab, setActiveTab] = useState<'basic' | 'columns' | 'status' | 'projects' | 'dashboard'>('basic');
  const [dashSectionVis, setDashSectionVis] = useState(() => readDashboardSectionVisibility());

  const { globalAutoFormattingOn, userHidesAutoFormatting, setUserHide } = useWbsTableAutoFormatting(wbsSettings);

  const TABLE_COLUMN_LABELS: Record<string, string> = useMemo(
    () => ({
      wbsId: 'ID',
      name: '작업명',
      startDate: '시작일',
      endDate: '종료일',
      duration: '기간',
      workEffort: '공수(d)',
      assignee: '담당자',
      allocation: '투입율',
      weight: '가중치',
      status: '상태',
      progress: '진척(%)',
      plannedProgress: '계획(%)',
      progressVariance: '진척차이(%p)',
      deliverables: '산출물',
      dependencies: '선행작업',
      actions: '관리',
    }),
    [],
  );

  const DEFAULT_TABLE_COLUMNS = useMemo(
    () => [
      { id: 'wbsId', visible: false },
      { id: 'name', visible: true },
      { id: 'startDate', visible: true },
      { id: 'endDate', visible: true },
      { id: 'duration', visible: true },
      { id: 'workEffort', visible: false },
      { id: 'assignee', visible: true },
      { id: 'allocation', visible: false },
      // 투입율 바로 다음에 가중치
      { id: 'weight', visible: true },
      { id: 'status', visible: true },
      { id: 'plannedProgress', visible: true },
      { id: 'progress', visible: true },
      { id: 'progressVariance', visible: false },
      { id: 'deliverables', visible: false },
      { id: 'dependencies', visible: false },
      { id: 'actions', visible: false },
    ],
    [],
  );

  const normalizedTableColumns = useMemo(() => {
    const incoming = tableColumns && tableColumns.length > 0 ? tableColumns : wbsSettings.tableColumns || DEFAULT_TABLE_COLUMNS;
    const customIds = new Set((customColumns ?? []).map((c) => c.id));
    const seen = new Set<string>();
    const cleaned = incoming
      .filter((c) => c && typeof c.id === 'string')
      .map((c) => ({ id: c.id, visible: c.visible !== false }))
      .filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

    // 사용자 정의 컬럼은 기본 컬럼 뒤에 자동 보강
    for (const cc of customColumns ?? []) {
      if (!cc || !cc.id || seen.has(cc.id)) continue;
      cleaned.push({ id: cc.id, visible: true });
      seen.add(cc.id);
    }

    // Ensure required columns exist (especially name)
    const ensureIds = DEFAULT_TABLE_COLUMNS.map((c) => c.id);
    for (const id of ensureIds) {
      if (seen.has(id)) continue;
      // 가중치는 투입율(allocation) 바로 뒤에 삽입
      const defaultVisible = DEFAULT_TABLE_COLUMNS.find((c) => c.id === id)?.visible ?? true;
      if (id === 'weight') {
        const allocIdx = cleaned.findIndex((c) => c.id === 'allocation');
        if (allocIdx >= 0) {
          cleaned.splice(allocIdx + 1, 0, { id, visible: defaultVisible });
        } else {
          cleaned.push({ id, visible: defaultVisible });
        }
      } else {
        cleaned.push({ id, visible: defaultVisible });
      }
    }

    // 정의가 제거된 사용자 컬럼은 목록에서 제거; name은 항상 표시. 접두어 WBS ID 컬럼은 표에 두지 않음(계층 번호 칸만 사용).
    return cleaned
      .filter((c) => !c.id.startsWith('custom:') || customIds.has(c.id))
      .map((c) => (c.id === 'name' ? { ...c, visible: true } : c))
      .map((c) => (c.id === 'wbsId' ? { ...c, visible: false } : c));
  }, [tableColumns, customColumns, wbsSettings.tableColumns, DEFAULT_TABLE_COLUMNS]);

  /** 설정 UI에만 노출 — 접두어 WBS ID 컬럼은 목록에서 제외(순서 화살표 인덱스와 실제 배열 길이 일치). */
  const tableColumnsSettingsList = useMemo(() => normalizedTableColumns.filter((c) => c.id !== 'wbsId'), [normalizedTableColumns]);

  useEffect(() => {
    if (isOpen) {
      setPrependDisplayWbsToTaskName(wbsSettings.prependDisplayWbsToTaskName === true);
      setShowTableAutoFormattingAdmin(wbsSettings.showTableAutoFormatting !== false);
      setLevel1(wbsSettings.level1Prefix);
      setLevel2(wbsSettings.level2Prefix);
      setLevel3(wbsSettings.level3Prefix);
      setMaxLevel(wbsSettings.maxLevel);
      setStatusConfigs(wbsSettings.statusConfigs);
      setTableColumns(wbsSettings.tableColumns || DEFAULT_TABLE_COLUMNS);
      setCustomColumns(wbsSettings.customColumns || []);
      setLevelColorsState(levelColors && levelColors.length >= 5 ? [...levelColors] : [...DEFAULT_LEVEL_COLORS]);

      const initialStartDates: Record<string, string> = {};
      const initialEndDates: Record<string, string> = {};
      projects.forEach((p) => {
        initialStartDates[p.id] = p.startDate ? p.startDate.slice(0, 10) : '';
        initialEndDates[p.id] = p.endDate ? p.endDate.slice(0, 10) : '';
      });
      setProjectDates(initialStartDates);
      setProjectEndDates(initialEndDates);
      setDashSectionVis(readDashboardSectionVisibility());
    }
    // projects 는 의존성에서 제외: 실시간·동기화로 tasks/프로젝트가 자주 갱신되면 모달을 연 채로
    // 프로젝트 일정 입력란이 초기값으로 되돌아가는 현상을 막음(열 때·설정 변경 시에만 위에서 초기화).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projects: 위 설명
  }, [isOpen, wbsSettings, levelColors]);

  useEffect(() => {
    if (!isOpen) return;
    const sync = () => setDashSectionVis(readDashboardSectionVisibility());
    window.addEventListener(WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED, sync);
    return () => window.removeEventListener(WBS_DASHBOARD_SECTION_VISIBILITY_CHANGED, sync);
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT') {
          target.blur();
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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    // 사용자 정의 컬럼은 일반 회원도 추가/수정/삭제 가능. projectId가 있는 컬럼은 그 프로젝트 전속(엑셀 임포트로 생성된 컬럼)이므로 보존.
    const cleanedCustomColumns = customColumns
      .map((c) => ({ id: c.id, name: c.name.trim(), ...(c.projectId ? { projectId: c.projectId } : {}) }))
      .filter((c) => c.id.startsWith('custom:') && c.name.length > 0);

    // 전역 설정·색상·상태진척도 적용: 관리자만 (UI에서 입력은 disabled 처리되지만 방어적으로 한 번 더 차단)
    if (canEditGlobal) {
      updateWbsSettings({
        showCriticalPath: false,
        prependDisplayWbsToTaskName,
        showTableAutoFormatting: showTableAutoFormattingAdmin,
        level1Prefix: level1.trim(),
        level2Prefix: level2.trim(),
        level3Prefix: level3.trim(),
        maxLevel: Number(maxLevel),
        statusConfigs: statusConfigs,
        // 상태↔진척률 자동 연동 제거: 항상 false로 저장
        linkStatusAndProgress: false,
        tableColumns: normalizedTableColumns,
        customColumns: cleanedCustomColumns,
      });

      setLevelColors(levelColorsState);
    } else {
      // 비관리자: customColumns + 그것을 포함한 tableColumns만 저장 (다른 전역 설정은 변경하지 않음)
      const prevCustomIds = new Set((wbsSettings.customColumns ?? []).map((c) => c.id));
      const nextCustomIds = new Set(cleanedCustomColumns.map((c) => c.id));
      const customChanged =
        prevCustomIds.size !== nextCustomIds.size ||
        [...prevCustomIds].some((id) => !nextCustomIds.has(id)) ||
        cleanedCustomColumns.some((c) => {
          const prev = (wbsSettings.customColumns ?? []).find((p) => p.id === c.id);
          return !prev || prev.name !== c.name;
        });
      if (customChanged) {
        updateWbsSettings({
          customColumns: cleanedCustomColumns,
          tableColumns: normalizedTableColumns,
        });
      }
    }

    // 프로젝트별 일정: 본인 프로젝트 또는 관리자만 반영
    projects.forEach((project) => {
      if (!canEditProject(project.ownerId)) return;
      const startDate = projectDates[project.id] ?? '';
      const endDate = projectEndDates[project.id] ?? '';

      const updates: Record<string, string | undefined> = {};
      const prevStart = (project.startDate || '').slice(0, 10);
      const prevEnd = (project.endDate || '').slice(0, 10);
      if (prevStart !== startDate) {
        updates.startDate = startDate || undefined;
      }
      if (prevEnd !== endDate) {
        updates.endDate = endDate || undefined;
      }

      if (Object.keys(updates).length > 0) {
        updateProject(project.id, updates);
      }
    });

    onClose();
  };

  return (
    <div className={MODAL_BACKDROP_CLASS}>
      <div className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-7xl overflow-hidden max-h-[94vh] flex flex-col rounded-xl')}>
        <div className="flex justify-between items-center p-5 border-b border-[var(--color-line)] bg-[var(--color-bg)]">
          <div className="flex items-center gap-2 text-[var(--color-ink)]">
            <Settings2 size={18} />
            <h2 className="text-lg font-bold">환경설정</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 rounded-full transition-colors text-[var(--color-ink-subdued)] hover:text-[var(--color-ink)]"
          >
            <X size={18} />
          </button>
        </div>

        {!canEditGlobal && (
          <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs flex items-center gap-2">
            <span>
              관리자 전용 설정(WBS 단계·표 컬럼·상태/진척도·색상 등)은 보기만 가능합니다.
              <strong> 본인이 만든 프로젝트의 일정만</strong> 변경할 수 있습니다.
            </span>
          </div>
        )}

        <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 md:px-8 pt-4 border-b border-[var(--color-line)] bg-[var(--color-surface)]/70">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('basic')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                  activeTab === 'basic'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-[var(--shadow-sm)] shadow-indigo-500/30'
                    : 'bg-[var(--color-surface)] text-[var(--color-ink-subdued)] border-[var(--color-line)] hover:bg-[var(--color-bg)]'
                }`}
              >
                기본·WBS·색상
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('columns')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                  activeTab === 'columns'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-[var(--shadow-sm)] shadow-indigo-500/30'
                    : 'bg-[var(--color-surface)] text-[var(--color-ink-subdued)] border-[var(--color-line)] hover:bg-[var(--color-bg)]'
                }`}
              >
                표 컬럼
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('status')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                  activeTab === 'status'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-[var(--shadow-sm)] shadow-indigo-500/30'
                    : 'bg-[var(--color-surface)] text-[var(--color-ink-subdued)] border-[var(--color-line)] hover:bg-[var(--color-bg)]'
                }`}
              >
                상태
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('projects')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                  activeTab === 'projects'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-[var(--shadow-sm)] shadow-indigo-500/30'
                    : 'bg-[var(--color-surface)] text-[var(--color-ink-subdued)] border-[var(--color-line)] hover:bg-[var(--color-bg)]'
                }`}
              >
                프로젝트 기간
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                  activeTab === 'dashboard'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-[var(--shadow-sm)] shadow-indigo-500/30'
                    : 'bg-[var(--color-surface)] text-[var(--color-ink-subdued)] border-[var(--color-line)] hover:bg-[var(--color-bg)]'
                }`}
              >
                대시보드
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            {activeTab === 'basic' && (
              <fieldset disabled={!canEditGlobal} className="space-y-8 m-0 p-0 border-0 min-w-0 disabled:opacity-70">
                {/* WBS ID Settings */}
                <div className="space-y-4">
                  <h3 className="font-bold text-sm text-[var(--color-ink)] border-b border-[var(--color-line)] pb-2">WBS ID 표시 영역</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-[var(--color-ink-subdued)] uppercase tracking-wider mb-1.5">
                        1레벨 접두사 (예: W)
                      </label>
                      <input
                        type="text"
                        value={level1}
                        onChange={(e) => setLevel1(e.target.value)}
                        className="input-field"
                        placeholder="W"
                        maxLength={3}
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-[var(--color-ink-subdued)] uppercase tracking-wider mb-1.5">
                        2레벨 접두사 (예: W)
                      </label>
                      <input
                        type="text"
                        value={level2}
                        onChange={(e) => setLevel2(e.target.value)}
                        className="input-field"
                        placeholder="W"
                        maxLength={3}
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-[var(--color-ink-subdued)] uppercase tracking-wider mb-1.5">
                        3레벨 접두사 (예: T)
                      </label>
                      <input
                        type="text"
                        value={level3}
                        onChange={(e) => setLevel3(e.target.value)}
                        className="input-field"
                        placeholder="T"
                        maxLength={3}
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <label className="block text-[10px] font-bold text-[var(--color-ink-subdued)] uppercase tracking-wider mb-1.5">
                      최대 표시 레벨
                    </label>
                    <select
                      value={maxLevel}
                      onChange={(e) => setMaxLevel(Number(e.target.value))}
                      className="input-field bg-[var(--color-bg)]"
                    >
                      <option value={2}>2 레벨까지만 표시</option>
                      <option value={3}>3 레벨까지만 표시</option>
                      <option value={4}>4 레벨까지만 표시</option>
                      <option value={5}>5 레벨 표기 허용</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                      작업 레벨이 표시 레벨을 초과할 경우 ID가 숨겨집니다.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <input
                      type="checkbox"
                      id="prependDisplayWbsToTaskName"
                      checked={prependDisplayWbsToTaskName}
                      onChange={(e) => setPrependDisplayWbsToTaskName(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="prependDisplayWbsToTaskName" className="text-sm font-medium text-[var(--color-ink)] cursor-pointer">
                      작업명 컬럼에 WBS ID 접두 표시
                    </label>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    작업명 앞에만 &quot;P1 요구사항 정의&quot;처럼 표시용 번호를 붙입니다. 별도의 접두어 ID 컬럼은 쓰지 않으며, 실제
                    저장되는 작업명은 바뀌지 않습니다.
                  </p>

                  <div className="flex items-center gap-3 pt-3 border-t border-[var(--color-line)]/60">
                    <input
                      type="checkbox"
                      id="showTableAutoFormattingAdmin"
                      checked={showTableAutoFormattingAdmin}
                      onChange={(e) => setShowTableAutoFormattingAdmin(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="showTableAutoFormattingAdmin" className="text-sm font-medium text-[var(--color-ink)] cursor-pointer">
                      작업표·간트 자동 서식 사용 (전체)
                    </label>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    상위 행의 레벨 배경, 완료 작업 취소선, 간트 막대의 완료 강조 등입니다. 끄면 모든 사용자에게 적용됩니다. 켜 둔 상태에서
                    개인은 요약 바의 「자동 서식」으로 이 브라우저에서만 숨길 수 있습니다.
                  </p>
                </div>

                {/* 레벨별 색상 */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[var(--color-line)] pb-2">
                    <h3 className="font-bold text-sm text-[var(--color-ink)] flex items-center gap-2">
                      <Palette size={16} />
                      레벨별 색상
                    </h3>
                    <button
                      type="button"
                      onClick={() => setLevelColorsState([...DEFAULT_LEVEL_COLORS])}
                      className="p-1 hover:bg-[var(--color-bg)] text-[var(--color-ink-subdued)] rounded-md transition-colors flex items-center gap-1 text-[10px] font-bold"
                      title="기본값으로 복원"
                    >
                      <RotateCcw size={14} />
                      기본값
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {[1, 2, 3, 4, 5].map((lev) => {
                      const c = levelColorsState[lev - 1] ?? DEFAULT_LEVEL_COLORS[lev - 1];
                      const hex = rgbToHex(c.r, c.g, c.b);
                      return (
                        <div key={lev} className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold text-[var(--color-ink-subdued)]">레벨 {lev}</label>
                          <input
                            type="color"
                            value={hex}
                            onChange={(e) => {
                              const rgb = hexToRgb(e.target.value);
                              if (rgb) {
                                const next = [...levelColorsState];
                                while (next.length < lev) next.push(DEFAULT_LEVEL_COLORS[next.length] ?? { r: 87, g: 83, b: 78 });
                                next[lev - 1] = rgb;
                                setLevelColorsState(next);
                              }
                            }}
                            className="w-full min-h-[44px] h-12 rounded-lg border-2 border-[var(--color-line)] cursor-pointer hover:border-slate-300 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                            title="클릭하여 색상 선택"
                          />
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    작업표·간트 차트에서 레벨별로 적용됩니다. 사용자별로 저장됩니다.
                  </p>
                </div>
              </fieldset>
            )}

            {activeTab === 'columns' && (
              <div className="space-y-8 m-0 p-0 border-0 min-w-0">
                <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]/80 p-4 space-y-2">
                  <h3 className="font-bold text-sm text-[var(--color-ink)]">이 기기에서만</h3>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="wbsUserShowAutoFormat"
                      checked={globalAutoFormattingOn && !userHidesAutoFormatting}
                      disabled={!globalAutoFormattingOn}
                      onChange={(e) => setUserHide(!e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                    />
                    <label
                      htmlFor="wbsUserShowAutoFormat"
                      className={cn(
                        'text-sm cursor-pointer',
                        globalAutoFormattingOn ? 'font-medium text-[var(--color-ink)]' : 'text-slate-400 cursor-not-allowed',
                      )}
                    >
                      자동 서식 표시 (레벨 색·완료 강조)
                    </label>
                  </div>
                  {!globalAutoFormattingOn ? (
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      관리자가 전체 자동 서식을 꺼 두었습니다. 기본 설정은 상단의「기본」탭에서 관리자만 바꿀 수 있습니다.
                    </p>
                  ) : (
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      요약 바의 「자동 서식」버튼과 동일합니다. 이 값은 이 브라우저에만 저장됩니다.
                    </p>
                  )}
                </div>
                {/* 표 필드 표시/순서 — 전역 설정이라 관리자만 수정 가능 */}
                <fieldset disabled={!canEditGlobal} className="m-0 p-0 border-0 min-w-0 space-y-4 disabled:opacity-70">
                  <div className="flex justify-between items-center border-b border-[var(--color-line)] pb-2">
                    <h3 className="font-bold text-sm text-[var(--color-ink)]">표 필드(컬럼) 표시/순서</h3>
                    <button
                      type="button"
                      onClick={() => setTableColumns(DEFAULT_TABLE_COLUMNS)}
                      className="p-1 hover:bg-[var(--color-bg)] text-[var(--color-ink-subdued)] rounded-md transition-colors flex items-center gap-1 text-[10px] font-bold"
                      title="기본값으로 복원"
                    >
                      <RotateCcw size={14} />
                      기본값
                    </button>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {tableColumnsSettingsList.map((col, idx) => {
                      const custom = customColumns.find((c) => c.id === col.id);
                      const label = custom?.name || TABLE_COLUMN_LABELS[col.id] || col.id;
                      const isName = col.id === 'name';
                      return (
                        <div
                          key={col.id}
                          className="flex items-center gap-3 px-3 py-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]"
                        >
                          <div className="text-slate-300 shrink-0">
                            <GripVertical size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-[var(--color-ink)] leading-snug whitespace-normal break-words">
                              {label}
                            </div>
                            <div className="text-[11px] text-[var(--color-ink-subdued)] font-mono leading-snug whitespace-normal break-all">
                              {col.id}
                            </div>
                          </div>
                          {isName ? (
                            <span
                              className="p-1.5 rounded-md shrink-0 text-[var(--color-ink-subdued)]"
                              title="작업명은 항상 표시됩니다."
                              aria-hidden
                            >
                              <Eye size={14} />
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setTableColumns((prev) => (prev || []).map((p) => (p.id === col.id ? { ...p, visible: !p.visible } : p)));
                              }}
                              className="p-1.5 rounded-md transition-colors hover:bg-[var(--color-bg)]"
                              title={col.visible ? '숨기기' : '보이기'}
                            >
                              {col.visible ? (
                                <Eye size={14} className="text-[var(--color-ink-subdued)]" />
                              ) : (
                                <EyeOff size={14} className="text-slate-400" />
                              )}
                            </button>
                          )}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => {
                                setTableColumns((prev) => {
                                  const arr = [...(prev || normalizedTableColumns)];
                                  const i = arr.findIndex((x) => x.id === col.id);
                                  if (i <= 0) return arr;
                                  const next = [...arr];
                                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                                  return next;
                                });
                              }}
                              className="p-1.5 rounded-md hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
                              title="위로"
                            >
                              <ArrowUp size={14} className="text-[var(--color-ink-subdued)]" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === tableColumnsSettingsList.length - 1}
                              onClick={() => {
                                setTableColumns((prev) => {
                                  const arr = [...(prev || normalizedTableColumns)];
                                  const i = arr.findIndex((x) => x.id === col.id);
                                  if (i < 0 || i >= arr.length - 1) return arr;
                                  const next = [...arr];
                                  [next[i], next[i + 1]] = [next[i + 1], next[i]];
                                  return next;
                                });
                              }}
                              className="p-1.5 rounded-md hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
                              title="아래로"
                            >
                              <ArrowDown size={14} className="text-[var(--color-ink-subdued)]" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    WBS 계층 번호(1·1.1)는 항상 표 왼쪽에 표시됩니다. 작업명은 항상 표시됩니다. 숨긴 컬럼은 표/전체 보기에서 즉시
                    반영됩니다.
                  </p>
                </fieldset>

                {/* 사용자 정의 컬럼 — 일반 회원도 추가/수정/삭제 가능 (전역 공유) */}
                <div className="border-t border-[var(--color-line)] pt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-[var(--color-ink)]">사용자 정의 컬럼</p>
                    <button
                      type="button"
                      onClick={() => {
                        const id = `custom:${Date.now()}`;
                        setCustomColumns((prev) => [...prev, { id, name: '새 컬럼' }]);
                        setTableColumns((prev) => [...(prev || []), { id, visible: true }]);
                      }}
                      className="p-1 hover:bg-indigo-50 text-indigo-600 rounded-md transition-colors flex items-center gap-1 text-[10px] font-bold"
                    >
                      <Plus size={14} />
                      컬럼 추가
                    </button>
                  </div>
                  {(customColumns ?? []).length === 0 && (
                    <p className="text-[11px] text-[var(--color-ink-subdued)]">추가된 사용자 정의 컬럼이 없습니다.</p>
                  )}
                  {(customColumns ?? []).map((cc) => (
                    <div key={cc.id} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={cc.name}
                        onChange={(e) => setCustomColumns((prev) => prev.map((x) => (x.id === cc.id ? { ...x, name: e.target.value } : x)))}
                        onKeyDown={(e) => {
                          // Enter가 form submit으로 모달을 닫지 않도록 차단 (다중 컬럼 추가 가능)
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="input-field py-1.5 text-xs"
                        placeholder="컬럼명"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setCustomColumns((prev) => prev.filter((x) => x.id !== cc.id));
                          setTableColumns((prev) => (prev || []).filter((x) => x.id !== cc.id));
                        }}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
                        title="삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {!canEditGlobal && (
                    <p className="text-[10px] text-slate-400 leading-relaxed">※ 사용자 정의 컬럼은 모든 사용자에게 공유됩니다.</p>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'status' && (
              <fieldset disabled={!canEditGlobal} className="space-y-8 m-0 p-0 border-0 min-w-0 disabled:opacity-70">
                {/* Status Name & Progress Settings */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-[var(--color-line)] pb-2">
                    <div className="flex flex-col gap-1">
                      <h3 className="font-bold text-sm text-[var(--color-ink)]">상태 명칭·색상</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const newId = `status-${Date.now()}`;
                        setStatusConfigs([
                          ...statusConfigs,
                          { id: newId, name: '새 상태', progress: 0, color: 'bg-[var(--color-bg)] border-[var(--color-line)]' },
                        ]);
                      }}
                      className="p-1 hover:bg-indigo-50 text-indigo-600 rounded-md transition-colors flex items-center gap-1 text-[10px] font-bold"
                    >
                      <Plus size={14} />
                      상태 추가
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[520px] overflow-y-auto pr-2 custom-scrollbar">
                    {(() => {
                      return (
                        <>
                          {statusConfigs.map((config, index) => {
                            const colorValue =
                              config.color ||
                              STATUS_COLOR_PRESETS.find((p) => p.value.includes('green'))?.value ||
                              'bg-green-50 border-green-100';
                            const isCustom = isCustomStatusColor(colorValue);
                            const customHex = parseCustomStatusColor(colorValue) || '#0ea5e9';
                            return (
                              <React.Fragment key={config.id}>
                                <div className="flex gap-2 items-center group flex-wrap">
                                  <div className="flex-1 min-w-[100px]">
                                    <input
                                      type="text"
                                      value={config.name}
                                      onChange={(e) => {
                                        const newConfigs = [...statusConfigs];
                                        newConfigs[index] = { ...config, name: e.target.value };
                                        setStatusConfigs(newConfigs);
                                      }}
                                      className="input-field py-1.5 text-xs"
                                      placeholder="명칭"
                                    />
                                  </div>
                                  <div className="flex items-center gap-1.5" title="상태 색상">
                                    <span className="text-[10px] font-bold text-[var(--color-ink-subdued)] shrink-0">색상</span>
                                    <select
                                      value={isCustom ? '__custom__' : colorValue}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        const newConfigs = [...statusConfigs];
                                        if (v === '__custom__') {
                                          const prevHex = parseCustomStatusColor(colorValue);
                                          newConfigs[index] = {
                                            ...config,
                                            color: prevHex ? colorValue : hexToCustomStatusColor('#0ea5e9'),
                                          };
                                        } else {
                                          newConfigs[index] = { ...config, color: v };
                                        }
                                        setStatusConfigs(newConfigs);
                                      }}
                                      className="input-field py-1.5 text-xs pr-6 pl-7 w-28"
                                    >
                                      {!isCustom && !STATUS_COLOR_PRESETS.some((p) => p.value === colorValue) && (
                                        <option value={colorValue}>현재</option>
                                      )}
                                      {STATUS_COLOR_PRESETS.map((p) => (
                                        <option key={p.value} value={p.value}>
                                          {p.label}
                                        </option>
                                      ))}
                                      <option value="__custom__">직접 선택…</option>
                                    </select>
                                    {isCustom ? (
                                      <span
                                        className="w-8 h-8 rounded-lg border-2 border-[var(--color-line)] shrink-0"
                                        style={{ backgroundColor: customHex }}
                                        aria-hidden
                                      />
                                    ) : (
                                      <span className={cn('w-5 h-5 rounded border shrink-0', colorValue)} aria-hidden />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={index === 0}
                                      onClick={() => {
                                        if (index <= 0) return;
                                        const next = [...statusConfigs];
                                        [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                        setStatusConfigs(next);
                                      }}
                                      className="p-1.5 rounded-md hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="위로"
                                    >
                                      <ArrowUp size={14} className="text-[var(--color-ink-subdued)]" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={index === statusConfigs.length - 1}
                                      onClick={() => {
                                        if (index >= statusConfigs.length - 1) return;
                                        const next = [...statusConfigs];
                                        [next[index], next[index + 1]] = [next[index + 1], next[index]];
                                        setStatusConfigs(next);
                                      }}
                                      className="p-1.5 rounded-md hover:bg-[var(--color-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
                                      title="아래로"
                                    >
                                      <ArrowDown size={14} className="text-[var(--color-ink-subdued)]" />
                                    </button>
                                  </div>
                                  {statusConfigs.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setStatusConfigs(statusConfigs.filter((_, i) => i !== index));
                                      }}
                                      className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all opacity-0 group-hover:opacity-100"
                                      title="삭제"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                                {isCustom && (
                                  <div className="mt-2 mb-4 pl-2 border-l-2 border-[var(--color-line)]">
                                    <p className="text-[10px] font-bold text-[var(--color-ink-subdued)] mb-1.5">
                                      채도·밝기·색조·RGB로 선택
                                    </p>
                                    <ColorPicker
                                      value={customHex}
                                      onChange={(hex) => {
                                        const newConfigs = [...statusConfigs];
                                        newConfigs[index] = { ...config, color: hexToCustomStatusColor(hex) };
                                        setStatusConfigs(newConfigs);
                                      }}
                                      size={220}
                                    />
                                  </div>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 italic">
                    상태는 표시·완료 판정에만 사용하며, 진척률은 각 작업에서 직접 입력한 값만을 기준으로 계산합니다. (상태 변경 시 진척률
                    자동 설정 기능은 제거되었습니다.)
                  </p>
                </div>
              </fieldset>
            )}

            {activeTab === 'dashboard' && (
              <div className="space-y-6 max-w-xl">
                <div className="space-y-2">
                  <h3 className="font-bold text-sm text-[var(--color-ink)] border-b border-[var(--color-line)] pb-2">
                    대시보드에 표시할 항목
                  </h3>
                  <p className="text-xs text-[var(--color-ink-subdued)] leading-relaxed">
                    체크한 블록만 대시보드에 나타납니다. 기본은{' '}
                    <strong className="font-semibold text-[var(--color-ink-subdued)]">전체현황</strong>,{' '}
                    <strong className="font-semibold text-[var(--color-ink-subdued)]">사업부 현황</strong>,{' '}
                    <strong className="font-semibold text-[var(--color-ink-subdued)]">프로젝트별 현황</strong>이 켜져 있습니다. 투입
                    인원·투입 비율·프로젝트별 WBS 공수는 상단 메뉴의{' '}
                    <strong className="font-semibold text-[var(--color-ink-subdued)]">투입현황</strong>에서 확인·편집합니다. 대시보드는
                    지표·목록 중심이며 WBS 화면 캡처 미리보기는 사용하지 않습니다. 이 기기(브라우저)에만 저장되며, 아래 버튼으로 앱
                    기본값으로 되돌릴 수 있습니다.
                  </p>
                </div>
                <ul className="space-y-2">
                  {DASHBOARD_SECTION_IDS.map((id) => (
                    <li key={id}>
                      <label className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] hover:bg-[var(--color-bg)]/80 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={dashSectionVis[id]}
                          onChange={() => {
                            const next = { ...dashSectionVis, [id]: !dashSectionVis[id] };
                            setDashSectionVis(next);
                            writeDashboardSectionVisibility(next);
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm font-medium text-[var(--color-ink)]">{DASHBOARD_SECTION_LABELS[id]}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="pt-2 border-t border-[var(--color-line)]">
                  <button
                    type="button"
                    onClick={() => {
                      resetDashboardSectionVisibility();
                      resetDashboardSectionLayout();
                      setDashSectionVis(getDefaultDashboardSectionVisibility());
                    }}
                    className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] text-[var(--color-ink)] hover:bg-[var(--color-bg)]"
                  >
                    <RotateCcw size={14} aria-hidden />
                    기본값으로 초기화
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'projects' && (
              <div className="space-y-8">
                {/* Project Start/End Dates Settings */}
                <div className="space-y-4">
                  <h3 className="font-bold text-sm text-[var(--color-ink)] border-b border-[var(--color-line)] pb-2">
                    프로젝트 시작·종료일 관리
                  </h3>
                  <div className="space-y-2 max-h-[420px] overflow-y-auto pr-2 custom-scrollbar">
                    {projectsShownInSettings.map((p) => {
                      const editable = canEditProject(p.ownerId);
                      return (
                        <div
                          key={p.id}
                          className={`flex items-center justify-between gap-3 p-2 border rounded-lg ${
                            editable
                              ? 'bg-[var(--color-surface)] border-[var(--color-line)]'
                              : 'bg-[var(--color-bg)] border-[var(--color-line)]'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <label
                              className="text-xs font-bold text-[var(--color-ink-subdued)] break-words block flex items-center gap-1.5 min-w-0"
                              title={formatProjectDisplayName(p.name, p.projectKind)}
                            >
                              <ProjectNameLabel project={p} name={p.name} className="min-w-0" />
                              {!editable && (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[9px] font-medium text-[var(--color-ink-subdued)] bg-slate-200 px-1.5 py-0.5 rounded shrink-0"
                                  title="본인이 만든 프로젝트가 아니므로 변경할 수 없습니다."
                                >
                                  보기 전용
                                </span>
                              )}
                            </label>
                            <p className="text-[10px] text-slate-400 truncate">
                              작업 일정은 입력값이 우선이며, 프로젝트 기간과 달라도 저장됩니다.
                            </p>
                          </div>
                          <div className="flex-shrink-0 flex items-end gap-2">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[9px] font-semibold text-[var(--color-ink-subdued)]">시작</span>
                              <input
                                type="date"
                                value={projectDates[p.id] || ''}
                                onChange={(e) => setProjectDates({ ...projectDates, [p.id]: e.target.value })}
                                disabled={!editable}
                                className="input-field py-1 text-[11px] h-7 w-28 disabled:bg-[var(--color-bg)] disabled:text-slate-400 disabled:cursor-not-allowed"
                              />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[9px] font-semibold text-[var(--color-ink-subdued)]">종료</span>
                              <input
                                type="date"
                                value={projectEndDates[p.id] || ''}
                                onChange={(e) => setProjectEndDates({ ...projectEndDates, [p.id]: e.target.value })}
                                disabled={!editable}
                                className="input-field py-1 text-[11px] h-7 w-28 disabled:bg-[var(--color-bg)] disabled:text-slate-400 disabled:cursor-not-allowed"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-6 pt-4 flex justify-between items-center gap-3 border-t border-[var(--color-line)] bg-[var(--color-surface)] sticky bottom-0">
            {/* 로컬 초기화: 관리자/일반 사용자 모두 숨김 처리 (실수 방지). onRequestReset prop은 호환을 위해 유지하되 UI에는 노출하지 않는다. */}
            <div className="flex items-center gap-2" />
            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} className="btn-ghost">
                취소
              </button>
              <button type="submit" className="btn-primary">
                적용하기
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
