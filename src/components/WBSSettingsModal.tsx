import React, { useMemo, useState, useEffect } from 'react';
import { X, Settings2, Plus, Trash2, GripVertical, ArrowUp, ArrowDown, Eye, EyeOff, RotateCcw, Palette, AlertTriangle } from 'lucide-react';
import { useWBS } from '../context/WBSContext';
import { useLevelColors, type RgbColor } from '../context/LevelColorsContext';
import { LEVEL_COLORS } from '../lib/levelColors';
import { TaskStatus } from '../types';

interface WBSSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** 로컬 초기화 요청 시 호출. 호출 시 설정 모달을 닫고 상위에서 확인 다이얼로그를 띄우면 됨 */
    onRequestReset?: () => void;
}

const DEFAULT_LEVEL_COLORS: RgbColor[] = [...LEVEL_COLORS];

function rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): RgbColor | null {
    const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export function WBSSettingsModal({ isOpen, onClose, onRequestReset }: WBSSettingsModalProps) {
    const { wbsSettings, updateWbsSettings, projects, updateProject, syncProgressFromStatusConfigs } = useWBS();
    const { levelColors, setLevelColors } = useLevelColors();

    const [appTitle, setAppTitle] = useState(wbsSettings.appTitle);
    const [showCriticalPath, setShowCriticalPath] = useState(wbsSettings.showCriticalPath === true);
    const [wrapTextInCells, setWrapTextInCells] = useState(wbsSettings.wrapTextInCells === true);
    const [level1, setLevel1] = useState(wbsSettings.level1Prefix);
    const [level2, setLevel2] = useState(wbsSettings.level2Prefix);
    const [level3, setLevel3] = useState(wbsSettings.level3Prefix);
    const [maxLevel, setMaxLevel] = useState(wbsSettings.maxLevel);
    const [statusConfigs, setStatusConfigs] = useState(wbsSettings.statusConfigs);
    const [statusApplyMode, setStatusApplyMode] = useState<'none' | 'current' | 'all'>('none');
    const [projectDates, setProjectDates] = useState<Record<string, string>>({});
    const [projectEndDates, setProjectEndDates] = useState<Record<string, string>>({});
    const [tableColumns, setTableColumns] = useState<{ id: string; visible: boolean }[]>(wbsSettings.tableColumns || []);
    const [levelColorsState, setLevelColorsState] = useState<RgbColor[]>(DEFAULT_LEVEL_COLORS);
    const [activeTab, setActiveTab] = useState<'basic' | 'columns' | 'status' | 'projects'>('basic');

    const TABLE_COLUMN_LABELS: Record<string, string> = useMemo(() => ({
        wbsId: 'ID',
        name: '작업명',
        startDate: '시작일',
        endDate: '종료일',
        workEffort: '공수(d)',
        assignee: '담당자',
        allocation: '투입율',
        status: '상태',
        deliverables: '산출물',
        dependencies: '선행작업',
    }), []);

    const DEFAULT_TABLE_COLUMNS = useMemo(() => ([
        { id: 'wbsId', visible: true },
        { id: 'name', visible: true },
        { id: 'startDate', visible: true },
        { id: 'endDate', visible: true },
        { id: 'workEffort', visible: true },
        { id: 'assignee', visible: true },
        { id: 'allocation', visible: true },
        { id: 'status', visible: true },
        { id: 'progress', visible: true },
        { id: 'deliverables', visible: true },
        { id: 'dependencies', visible: true },
    ]), []);

    const normalizedTableColumns = useMemo(() => {
        const incoming = (tableColumns && tableColumns.length > 0) ? tableColumns : (wbsSettings.tableColumns || DEFAULT_TABLE_COLUMNS);
        const seen = new Set<string>();
        const cleaned = incoming
            .filter(c => c && typeof c.id === 'string')
            .map(c => ({ id: c.id, visible: c.visible !== false }))
            .filter(c => {
                if (seen.has(c.id)) return false;
                seen.add(c.id);
                return true;
            });

        // Ensure required columns exist (especially name)
        const ensureIds = DEFAULT_TABLE_COLUMNS.map(c => c.id);
        for (const id of ensureIds) {
            if (!seen.has(id)) cleaned.push({ id, visible: true });
        }

        // Keep name always visible
        return cleaned.map(c => c.id === 'name' ? { ...c, visible: true } : c);
    }, [tableColumns, wbsSettings.tableColumns, DEFAULT_TABLE_COLUMNS]);

    useEffect(() => {
        if (isOpen) {
            setAppTitle(wbsSettings.appTitle);
            setShowCriticalPath(wbsSettings.showCriticalPath === true);
            setWrapTextInCells(wbsSettings.wrapTextInCells === true);
            setLevel1(wbsSettings.level1Prefix);
            setLevel2(wbsSettings.level2Prefix);
            setLevel3(wbsSettings.level3Prefix);
            setMaxLevel(wbsSettings.maxLevel);
            setStatusConfigs(wbsSettings.statusConfigs);
            setStatusApplyMode('none');
            setTableColumns(wbsSettings.tableColumns || DEFAULT_TABLE_COLUMNS);
            setLevelColorsState(levelColors && levelColors.length >= 5 ? [...levelColors] : [...DEFAULT_LEVEL_COLORS]);

            const initialStartDates: Record<string, string> = {};
            const initialEndDates: Record<string, string> = {};
            projects.forEach(p => {
                initialStartDates[p.id] = p.startDate || '';
                initialEndDates[p.id] = p.endDate || '';
            });
            setProjectDates(initialStartDates);
            setProjectEndDates(initialEndDates);
        }
    }, [isOpen, wbsSettings, projects, levelColors]);

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
        updateWbsSettings({
            appTitle: appTitle.trim(),
            showCriticalPath,
            wrapTextInCells,
            level1Prefix: level1.trim(),
            level2Prefix: level2.trim(),
            level3Prefix: level3.trim(),
            maxLevel: Number(maxLevel),
            statusConfigs: statusConfigs,
            tableColumns: normalizedTableColumns,
        });

        setLevelColors(levelColorsState);

        projects.forEach((project) => {
            const startDate = projectDates[project.id] ?? '';
            const endDate = projectEndDates[project.id] ?? '';

            const updates: Partial<typeof project> = {};
            if ((project.startDate || '') !== startDate) {
                (updates as any).startDate = startDate || undefined;
            }
            if ((project.endDate || '') !== endDate) {
                (updates as any).endDate = endDate || undefined;
            }

            if (Object.keys(updates).length > 0) {
                updateProject(project.id, updates);
            }
        });

        if (statusApplyMode === 'current') {
            syncProgressFromStatusConfigs('current');
        } else if (statusApplyMode === 'all') {
            syncProgressFromStatusConfigs('all');
        }

        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-[var(--color-line)] max-h-[94vh] flex flex-col">
                <div className="flex justify-between items-center p-5 border-b border-[var(--color-line)] bg-stone-50">
                    <div className="flex items-center gap-2 text-[var(--color-ink)]">
                        <Settings2 size={18} />
                        <h2 className="text-lg font-bold">WBS 설정</h2>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-stone-200 rounded-full transition-colors text-stone-500 hover:text-[var(--color-ink)]">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSave} className="flex-1 flex flex-col overflow-hidden">
                    <div className="px-6 md:px-8 pt-4 border-b border-[var(--color-line)] bg-white/70">
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => setActiveTab('basic')}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                                    activeTab === 'basic'
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/30'
                                        : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                                }`}
                            >
                                기본·WBS·색상
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('columns')}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                                    activeTab === 'columns'
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/30'
                                        : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                                }`}
                            >
                                표 컬럼
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('status')}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                                    activeTab === 'status'
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/30'
                                        : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                                }`}
                            >
                                상태·진척도
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('projects')}
                                className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                                    activeTab === 'projects'
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/30'
                                        : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-50'
                                }`}
                            >
                                프로젝트 기간
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 md:p-8">
                        {activeTab === 'basic' && (
                            <div className="space-y-8">
                                {/* Application Settings */}
                                <div className="space-y-4">
                                    <h3 className="font-bold text-sm text-[var(--color-ink)] border-b border-stone-200 pb-2 flex items-center gap-2">
                                        기본 설정
                                    </h3>
                                    <div>
                                        <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">웹 타이틀</label>
                                        <input
                                            type="text"
                                            value={appTitle}
                                            onChange={(e) => setAppTitle(e.target.value)}
                                            placeholder="지엠티 프로젝트 매니저"
                                            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                        />
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            id="showCriticalPath"
                                            checked={showCriticalPath}
                                            onChange={(e) => setShowCriticalPath(e.target.checked)}
                                            className="rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <label htmlFor="showCriticalPath" className="text-sm font-medium text-[var(--color-ink)] cursor-pointer">
                                            크리티컬 패스 표시
                                        </label>
                                    </div>
                                    <p className="text-[10px] text-stone-400 leading-relaxed">간트 차트·작업표에서 크리티컬 패스 작업을 빨간색으로 강조합니다.</p>
                                    <div className="flex items-center gap-3 mt-4">
                                        <input
                                            type="checkbox"
                                            id="wrapTextInCells"
                                            checked={wrapTextInCells}
                                            onChange={(e) => setWrapTextInCells(e.target.checked)}
                                            className="rounded border-stone-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <label htmlFor="wrapTextInCells" className="text-sm font-medium text-[var(--color-ink)] cursor-pointer">
                                            셀 텍스트 줄바꿈
                                        </label>
                                    </div>
                                    <p className="text-[10px] text-stone-400 leading-relaxed">켜면 긴 텍스트가 줄바꿈되고, 행 높이가 내용에 맞게 자동으로 늘어납니다. 표·간트 동시 보기에서도 행 높이가 동기화됩니다.</p>
                                </div>

                                {/* WBS ID Settings */}
                                <div className="space-y-4">
                                    <h3 className="font-bold text-sm text-[var(--color-ink)] border-b border-stone-200 pb-2">WBS ID 표시 영역</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">1레벨 접두사 (예: W)</label>
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
                                            <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">2레벨 접두사 (예: W)</label>
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
                                            <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">3레벨 접두사 (예: T)</label>
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
                                        <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">최대 표시 레벨</label>
                                        <select
                                            value={maxLevel}
                                            onChange={(e) => setMaxLevel(Number(e.target.value))}
                                            className="input-field bg-stone-50"
                                        >
                                            <option value={2}>2 레벨까지만 표시</option>
                                            <option value={3}>3 레벨까지만 표시</option>
                                            <option value={4}>4 레벨까지만 표시</option>
                                            <option value={5}>5 레벨 표기 허용</option>
                                        </select>
                                        <p className="text-[10px] text-stone-400 mt-1.5 leading-relaxed">작업 레벨이 표시 레벨을 초과할 경우 ID가 숨겨집니다.</p>
                                    </div>
                                </div>

                                {/* 레벨별 색상 */}
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center border-b border-stone-200 pb-2">
                                        <h3 className="font-bold text-sm text-[var(--color-ink)] flex items-center gap-2">
                                            <Palette size={16} />
                                            레벨별 색상
                                        </h3>
                                        <button
                                            type="button"
                                            onClick={() => setLevelColorsState([...DEFAULT_LEVEL_COLORS])}
                                            className="p-1 hover:bg-stone-100 text-stone-600 rounded-md transition-colors flex items-center gap-1 text-[10px] font-bold"
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
                                                    <label className="text-[10px] font-bold text-stone-500">레벨 {lev}</label>
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
                                                        className="w-full h-9 rounded-lg border border-stone-200 cursor-pointer"
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <p className="text-[10px] text-stone-400 leading-relaxed">작업표·간트 차트에서 레벨별로 적용됩니다. 사용자별로 저장됩니다.</p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'columns' && (
                            <div className="space-y-8">
                                {/* Table Columns */}
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center border-b border-stone-200 pb-2">
                                        <h3 className="font-bold text-sm text-[var(--color-ink)]">표 필드(컬럼) 표시/순서</h3>
                                        <button
                                            type="button"
                                            onClick={() => setTableColumns(DEFAULT_TABLE_COLUMNS)}
                                            className="p-1 hover:bg-stone-100 text-stone-600 rounded-md transition-colors flex items-center gap-1 text-[10px] font-bold"
                                            title="기본값으로 복원"
                                        >
                                            <RotateCcw size={14} />
                                            기본값
                                        </button>
                                    </div>

                                    <div className="flex flex-col gap-2.5">
                                        {normalizedTableColumns.map((col, idx) => {
                                            const label = TABLE_COLUMN_LABELS[col.id] || col.id;
                                            const isName = col.id === 'name';
                                            return (
                                                <div key={col.id} className="flex items-center gap-3 px-3 py-3 rounded-xl border border-stone-200 bg-white">
                                                    <div className="text-stone-300 shrink-0">
                                                        <GripVertical size={14} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-semibold text-stone-800 leading-snug whitespace-normal break-words">{label}</div>
                                                        <div className="text-[11px] text-stone-500 font-mono leading-snug whitespace-normal break-all">{col.id}</div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        disabled={isName}
                                                        onClick={() => {
                                                            setTableColumns(prev => (prev || []).map(p => p.id === col.id ? { ...p, visible: !p.visible } : p));
                                                        }}
                                                        className={`p-1.5 rounded-md transition-colors ${isName ? 'opacity-40 cursor-not-allowed' : 'hover:bg-stone-50'}`}
                                                        title={isName ? '작업명은 항상 표시됩니다.' : (col.visible ? '숨기기' : '보이기')}
                                                    >
                                                        {col.visible ? <Eye size={14} className="text-stone-600" /> : <EyeOff size={14} className="text-stone-400" />}
                                                    </button>
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            disabled={idx === 0}
                                                            onClick={() => {
                                                                setTableColumns(prev => {
                                                                    const arr = [...(prev || normalizedTableColumns)];
                                                                    const i = arr.findIndex(x => x.id === col.id);
                                                                    if (i <= 0) return arr;
                                                                    const next = [...arr];
                                                                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                                                                    return next;
                                                                });
                                                            }}
                                                            className="p-1.5 rounded-md hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                                            title="위로"
                                                        >
                                                            <ArrowUp size={14} className="text-stone-600" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={idx === normalizedTableColumns.length - 1}
                                                            onClick={() => {
                                                                setTableColumns(prev => {
                                                                    const arr = [...(prev || normalizedTableColumns)];
                                                                    const i = arr.findIndex(x => x.id === col.id);
                                                                    if (i < 0 || i >= arr.length - 1) return arr;
                                                                    const next = [...arr];
                                                                    [next[i], next[i + 1]] = [next[i + 1], next[i]];
                                                                    return next;
                                                                });
                                                            }}
                                                            className="p-1.5 rounded-md hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                                            title="아래로"
                                                        >
                                                            <ArrowDown size={14} className="text-stone-600" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <p className="text-[10px] text-stone-400 leading-relaxed">
                                        작업명은 항상 표시됩니다. 숨긴 컬럼은 표/전체 보기에서 즉시 반영됩니다.
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'status' && (
                            <div className="space-y-8">
                                {/* Status Name & Progress Settings */}
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center border-b border-stone-200 pb-2">
                                        <div className="flex flex-col gap-1">
                                            <h3 className="font-bold text-sm text-[var(--color-ink)]">상태 명칭 및 진척도</h3>
                                            <div className="flex flex-wrap items-center gap-3 text-[11px] text-stone-600">
                                                <span className="font-semibold text-stone-500">기존 작업 진척도 적용 범위</span>
                                                <label className="inline-flex items-center gap-1 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        className="h-3.5 w-3.5 text-blue-600 border-stone-300 focus:ring-blue-500"
                                                        checked={statusApplyMode === 'none'}
                                                        onChange={() => setStatusApplyMode('none')}
                                                    />
                                                    <span>변경하지 않음</span>
                                                </label>
                                                <label className="inline-flex items-center gap-1 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        className="h-3.5 w-3.5 text-blue-600 border-stone-300 focus:ring-blue-500"
                                                        checked={statusApplyMode === 'current'}
                                                        onChange={() => setStatusApplyMode('current')}
                                                    />
                                                    <span>현재 프로젝트만</span>
                                                </label>
                                                <label className="inline-flex items-center gap-1 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        className="h-3.5 w-3.5 text-blue-600 border-stone-300 focus:ring-blue-500"
                                                        checked={statusApplyMode === 'all'}
                                                        onChange={() => setStatusApplyMode('all')}
                                                    />
                                                    <span>전체 프로젝트</span>
                                                </label>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const newId = `status-${Date.now()}`;
                                                setStatusConfigs([...statusConfigs, { id: newId, name: '새 상태', progress: 0 }]);
                                            }}
                                            className="p-1 hover:bg-blue-50 text-blue-600 rounded-md transition-colors flex items-center gap-1 text-[10px] font-bold"
                                        >
                                            <Plus size={14} />
                                            상태 추가
                                        </button>
                                    </div>
                                    <div className="space-y-2 max-h-[320px] overflow-y-auto pr-2 custom-scrollbar">
                                        {statusConfigs.map((config, index) => (
                                            <div key={config.id} className="flex gap-2 items-center group">
                                                <div className="flex-1">
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
                                                <div className="w-16 relative">
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max="100"
                                                        value={config.progress}
                                                        onChange={(e) => {
                                                            const newConfigs = [...statusConfigs];
                                                            newConfigs[index] = { ...config, progress: Number(e.target.value) };
                                                            setStatusConfigs(newConfigs);
                                                        }}
                                                        className="input-field py-1.5 text-xs pr-5"
                                                    />
                                                    <span className="absolute right-1.5 top-1.5 text-[9px] text-stone-400 font-bold">%</span>
                                                </div>
                                                {statusConfigs.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setStatusConfigs(statusConfigs.filter((_, i) => i !== index));
                                                        }}
                                                        className="p-1.5 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-all opacity-0 group-hover:opacity-100"
                                                        title="삭제"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-stone-400 mt-1 italic">
                                        작업 상태 변경 시 설정된 진척도가 자동으로 반영됩니다. 위의 옵션을 사용하면 현재 저장 시점의 상태 설정을
                                        기준으로 기존 작업들의 진척도를 한 번에 맞출 수 있습니다.
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'projects' && (
                            <div className="space-y-8">
                                {/* Project Start/End Dates Settings */}
                                <div className="space-y-4">
                                    <h3 className="font-bold text-sm text-[var(--color-ink)] border-b border-stone-200 pb-2">프로젝트 시작·종료일 관리</h3>
                                    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-2 custom-scrollbar">
                                        {projects.map((p) => (
                                            <div key={p.id} className="flex items-center justify-between gap-3 bg-white p-2 border border-stone-100 rounded-lg">
                                                <div className="flex-1 truncate">
                                                    <label className="text-xs font-bold text-stone-600 truncate block" title={p.name}>
                                                        {p.name}
                                                    </label>
                                                    <p className="text-[10px] text-stone-400 truncate">
                                                        WBS 작업은 설정된 기간 범위를 벗어날 수 없습니다.
                                                    </p>
                                                </div>
                                                <div className="flex-shrink-0 flex items-end gap-2">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[9px] font-semibold text-stone-500">시작</span>
                                                        <input
                                                            type="date"
                                                            value={projectDates[p.id] || ''}
                                                            onChange={(e) => setProjectDates({ ...projectDates, [p.id]: e.target.value })}
                                                            className="input-field py-1 text-[11px] h-7 w-28"
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-[9px] font-semibold text-stone-500">종료</span>
                                                        <input
                                                            type="date"
                                                            value={projectEndDates[p.id] || ''}
                                                            onChange={(e) => setProjectEndDates({ ...projectEndDates, [p.id]: e.target.value })}
                                                            className="input-field py-1 text-[11px] h-7 w-28"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="p-6 pt-4 flex justify-between items-center gap-3 border-t border-[var(--color-line)] bg-white sticky bottom-0">
                        <div className="flex items-center gap-2">
                            {onRequestReset && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onClose();
                                        onRequestReset();
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-600 hover:bg-amber-50 rounded-lg border border-amber-200 transition-colors"
                                    title="로컬에 저장된 모든 데이터·설정을 지우고 빈 상태로 되돌립니다."
                                >
                                    <AlertTriangle size={14} />
                                    로컬 초기화
                                </button>
                            )}
                        </div>
                        <div className="flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="btn-ghost"
                            >
                                취소
                            </button>
                            <button
                                type="submit"
                                className="btn-primary"
                            >
                                적용하기
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
