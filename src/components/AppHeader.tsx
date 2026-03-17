import React from 'react';
import { cn } from '../lib/utils';
import { ChevronDown, ChevronUp, Tag, Plus, Download, Upload, Settings2, Keyboard, Trash2, RotateCcw, Users, Network, History, Map, Sparkles, FolderPlus, Briefcase, Share2, Copy, Edit, LayoutDashboard, LayoutList, CheckSquare, Target } from 'lucide-react';
import { NavButton } from './NavButton';
import { WbsFilterBar } from './FilterBar';

export interface AppHeaderProps {
  wbsSettings: any;
  isHeaderCollapsed: boolean;
  setIsHeaderCollapsed: (v: boolean) => void;
  requestRefresh: () => void;
  logo: string;
  setIsVersionHistoryOpen: (v: boolean) => void;
  appVersion: string;
  formatCommitDate: (d: string) => string;
  formatCommitDateDateOnly: (d: string) => string;
  appCommitDate: string;
  isProjectDropdownOpen: boolean;
  setIsProjectDropdownOpen: (v: boolean) => void;
  currentProjectId: string;
  currentProject: any;
  user: any;
  effectiveIsAdmin: boolean;
  profileMap: Record<string, string>;
  presenceOthers: any[];
  selectProject: (id: string) => void;
  allTasks: any[];
  projectsSortedByName: any[];
  taskCountByProject: Record<string, number>;
  isAdmin: boolean;
  myEditableProjectIds: string[];
  setIsShareOpen: (v: boolean) => void;
  copyProject: (id: string) => void;
  setEditingProject: (p: any) => void;
  setIsProjectModalOpen: (v: boolean) => void;
  setProjectToDelete: (p: any) => void;
  setIsDeleteProjectConfirmOpen: (v: boolean) => void;
  setAuditLogProjectId: (id: string) => void;
  setIsAuditLogOpen: (v: boolean) => void;
  setView: (v: any) => void;
  undo: () => void;
  canUndo: boolean;
  redo: () => void;
  canRedo: boolean;
  hiddenViews: Set<string>;
  view: string;
  navigateWithTip: (v: any) => void;
  filterOn: boolean;
  setFilterOn: (v: boolean | ((prev: boolean) => boolean)) => void;
  tipOnce: (key: string, msg: string) => void;
  isDbSyncing: boolean;
  executeDbSync: (scope: any) => void;
  hasLocalChangesSinceSync: boolean;
  dbSyncStep: any;
  currentUserDisplay: string;
  signOut: () => void;
  isMoreMenuOpen: boolean;
  setIsMoreMenuOpen: (v: boolean) => void;
  isAIBusy: boolean;
  setIsAIModalOpen: (v: boolean) => void;
  setIsWeeklyReportOpen: (v: boolean) => void;
  handleImportClick: () => void;
  setIsExportModalOpen: (v: boolean) => void;
  setIsSettingsModalOpen: (v: boolean) => void;
  isShortcutsVisible: boolean;
  setIsShortcutsVisible: (v: boolean) => void;
  setIsMembersModalOpen: (v: boolean) => void;
  setIsResetConfirmOpen: (v: boolean) => void;
  setIsDeleteChoiceOpen: (v: boolean) => void;
  canEditCurrentProject: boolean;
  setIsModalOpen: (v: boolean) => void;
  isDemoBannerDismissed?: boolean;
  setIsDemoBannerDismissed?: (v: boolean) => void;
  isBackupBannerDismissed?: boolean;
  setIsBackupBannerDismissed?: (v: boolean) => void;
}

export function AppHeader({
  wbsSettings,
  isHeaderCollapsed,
  setIsHeaderCollapsed,
  requestRefresh,
  logo,
  setIsVersionHistoryOpen,
  appVersion,
  formatCommitDate,
  formatCommitDateDateOnly,
  appCommitDate,
  isProjectDropdownOpen,
  setIsProjectDropdownOpen,
  currentProjectId,
  currentProject,
  user,
  effectiveIsAdmin,
  profileMap,
  presenceOthers,
  selectProject,
  allTasks,
  projectsSortedByName,
  taskCountByProject,
  isAdmin,
  myEditableProjectIds,
  setIsShareOpen,
  copyProject,
  setEditingProject,
  setIsProjectModalOpen,
  setProjectToDelete,
  setIsDeleteProjectConfirmOpen,
  setAuditLogProjectId,
  setIsAuditLogOpen,
  setView,
  undo,
  canUndo,
  redo,
  canRedo,
  hiddenViews,
  view,
  navigateWithTip,
  filterOn,
  setFilterOn,
  tipOnce,
  isDbSyncing,
  executeDbSync,
  hasLocalChangesSinceSync,
  dbSyncStep,
  currentUserDisplay,
  signOut,
  isMoreMenuOpen,
  setIsMoreMenuOpen,
  isAIBusy,
  setIsAIModalOpen,
  setIsWeeklyReportOpen,
  handleImportClick,
  setIsExportModalOpen,
  setIsSettingsModalOpen,
  isShortcutsVisible,
  setIsShortcutsVisible,
  setIsMembersModalOpen,
  setIsResetConfirmOpen,
  setIsDeleteChoiceOpen,
  canEditCurrentProject,
  setIsModalOpen
}: AppHeaderProps) {
  return (
    <header className={cn("bg-white/90 backdrop-blur-xl border-b border-slate-200/60 z-50 safe-top transition-all duration-200", isHeaderCollapsed ? "py-2 px-3 md:py-3 md:px-6" : "px-4 md:px-6 py-3")} style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)' }}>
      {/* 모바일 접힌 상태: 최소 바 */}
      <div className={cn("flex md:hidden items-center justify-between gap-2", !isHeaderCollapsed && "hidden")}>
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" onClick={requestRefresh} className="shrink-0">
            <img src={logo} alt="GMT Logo" className="w-14 h-14 object-contain" />
          </button>
          <span className="font-bold text-sm truncate">{wbsSettings.appTitle}</span>
        </div>
        <button
          onClick={() => setIsHeaderCollapsed(false)}
          className="p-2.5 -mr-1 rounded-lg hover:bg-stone-100 text-stone-500 shrink-0"
          title="메뉴 펼치기"
        >
          <ChevronDown size={20} />
        </button>
      </div>
      {/* 전체 헤더: 모바일에서 접혀 있으면 숨김 */}
      <div className={cn("flex flex-col md:flex-row justify-between items-start md:items-center gap-4", isHeaderCollapsed && "hidden md:flex")}>
        <div className="flex items-center gap-4">
          <div
            className="flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
            onClick={requestRefresh}
            title="새로고침: 페이지를 다시 불러와 최신 데이터를 확인합니다."
          >
            <img src={logo} alt="GMT Logo" className="w-16 h-16 object-contain" />
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-xl font-bold tracking-tight leading-none">{wbsSettings.appTitle}</h1>
              <button
                onClick={() => {
                  setIsVersionHistoryOpen(true);
                  if(tipOnce) tipOnce('menu.version', '버전 정보를 클릭하면 변경 이력(버전 히스토리)을 확인할 수 있어요.');
                }}
                className="text-[10px] font-mono text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 px-2 py-0.5 rounded-md transition-all flex items-center gap-1.5 group"
                title={`버전 정보 (수정일: ${formatCommitDate(appCommitDate)})`}
              >
                <Tag size={10} className="text-slate-300 group-hover:text-indigo-400" />
                <span>v{appVersion}</span>
                <span className="hidden 2xl:inline text-[10px] text-slate-300 group-hover:text-indigo-300 font-medium">
                  · 수정일 {formatCommitDateDateOnly(appCommitDate)}
                </span>
              </button>
            </div>

            <div className="relative mt-1 group">
              <button
                data-tourid="tour-project"
                onClick={() => {
                  setIsProjectDropdownOpen(!isProjectDropdownOpen);
                  if(tipOnce) tipOnce('menu.project', '현재 프로젝트를 바꾸거나 새 프로젝트를 추가할 수 있어요.');
                }}
                className="flex items-center gap-2 px-2.5 py-2 hover:bg-slate-50 rounded-xl transition-all border border-transparent hover:border-slate-200/80"
                title="프로젝트 선택: 작업을 관리할 프로젝트를 선택하거나 새 프로젝트를 만듭니다."
              >
                <div className="flex flex-col items-start">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none mb-1">프로젝트</span>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">
                    <span className="max-w-[140px] sm:max-w-[200px] truncate">{currentProjectId === 'all' ? '전체 프로젝트' : (currentProject?.name || '프로젝트 선택')}</span>
                    <ChevronDown size={14} className={cn("text-slate-400 transition-transform duration-200", isProjectDropdownOpen && "rotate-180")} />
                  </div>
                  {currentProject?.ownerId && (currentProject.ownerId === user?.id || effectiveIsAdmin) && (
                    <span className="text-[9px] text-slate-400 truncate max-w-[200px] mt-0.5" title={currentProject.ownerId ? (profileMap[currentProject.ownerId] ?? currentProject.ownerId) : undefined}>
                      {currentProject.ownerId === user?.id ? '내 프로젝트' : (currentProject.ownerId ? (profileMap[currentProject.ownerId] ?? '다른 사용자') : '소유자 없음')}
                    </span>
                  )}
                </div>
              </button>
              {presenceOthers && presenceOthers.length > 0 && currentProjectId !== 'all' && (
                <div
                  className="absolute left-0 top-full mt-1 flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-200/80 text-amber-800 text-xs"
                  title="다른 사용자가 이 프로젝트를 보고 있습니다. 동시에 수정하면 충돌할 수 있어 저장 후 새로고침됩니다."
                >
                  <Users size={12} className="shrink-0 text-amber-600" />
                  <span className="font-medium">
                    {presenceOthers.length}명이 보고 있음:
                  </span>
                  <span className="truncate max-w-[180px]" title={presenceOthers.map((o: any) => o.displayName).join(', ')}>
                    {presenceOthers.map((o:any) => o.displayName).join(', ')}
                  </span>
                </div>
              )}
              {isProjectDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsProjectDropdownOpen(false)}></div>
                  <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl border border-slate-200/80 overflow-hidden z-50 dropdown-menu" style={{ boxShadow: 'var(--shadow-xl)' }}>
                    <div className="p-1">
                      <div className="px-3 py-2 text-[10px] font-bold uppercase text-stone-400 tracking-wider" title="선택한 프로젝트의 작업만 표시합니다. 전체를 선택하면 모든 프로젝트를 한눈에 볼 수 있어요.">프로젝트 목록</div>
                      <div
                        className={cn(
                          "px-3 py-2 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors",
                          currentProjectId === 'all' ? "bg-stone-100 font-medium" : "text-stone-600 hover:bg-stone-50"
                        )}
                        onClick={() => {
                          selectProject('all');
                          setIsProjectDropdownOpen(false);
                        }}
                        title="모든 프로젝트의 작업을 한 화면에서 확인합니다."
                      >
                        <span className="truncate flex-1">전체</span>
                        {allTasks.length > 0 && (
                          <span className="text-[10px] text-stone-400 shrink-0">({allTasks.length}개)</span>
                        )}
                      </div>
                      <div className="h-px bg-stone-100 my-1 mx-2" />
                      {projectsSortedByName.map(project => (
                        <div
                          key={project.id}
                          className={cn(
                            "px-3 py-2 text-sm rounded-lg cursor-pointer flex justify-between items-center group/item transition-colors",
                            currentProjectId === project.id ? "bg-stone-100 font-medium" : "text-stone-600 hover:bg-stone-50"
                          )}
                          onClick={() => {
                            selectProject(project.id);
                            setIsProjectDropdownOpen(false);
                          }}
                        >
                          <div className="truncate flex-1 min-w-0 flex flex-col">
                            <span className="truncate flex items-center gap-1.5">
                              {project.name}
                              {(taskCountByProject[project.id] ?? 0) > 0 && (
                                <span className="text-[10px] text-stone-400 shrink-0">
                                  ({taskCountByProject[project.id] ?? 0}개)
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {(isAdmin || myEditableProjectIds.includes(project.id)) && (
                              <>
                                <button onClick={(e) => { e.stopPropagation(); setIsShareOpen(true); setIsProjectDropdownOpen(false); }} className="text-stone-400 hover:text-teal-600 p-1 rounded" title="프로젝트 공유"><Share2 size={12} /></button>
                                <button onClick={(e) => { e.stopPropagation(); copyProject(project.id); setIsProjectDropdownOpen(false); }} className="text-stone-400 hover:text-blue-600 p-1 rounded" title="프로젝트 복사"><Copy size={12} /></button>
                                <button onClick={(e) => { e.stopPropagation(); setEditingProject(project); setIsProjectModalOpen(true); setIsProjectDropdownOpen(false); }} className="text-stone-400 hover:text-[var(--color-ink)] p-1 rounded" title="프로젝트 편집"><Edit size={12} /></button>
                                {projectsSortedByName.length > 1 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setProjectToDelete(project);
                                      setIsProjectDropdownOpen(false);
                                      setIsDeleteProjectConfirmOpen(true);
                                    }}
                                    className="text-stone-400 hover:text-red-500 p-1 rounded"
                                    title="프로젝트 삭제"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); setAuditLogProjectId(project.id); setIsAuditLogOpen(true); setIsProjectDropdownOpen(false); }} className="text-stone-400 hover:text-amber-600 p-1 rounded" title="변경 이력"><History size={12} /></button>
                          </div>
                        </div>
                      ))}
                      <div className="border-t border-[var(--color-line)] my-1"></div>
                      <button onClick={() => { setEditingProject(null); setIsProjectModalOpen(true); setIsProjectDropdownOpen(false); }} className="w-full text-left px-3 py-2 text-sm text-[var(--color-accent)] hover:bg-blue-50 rounded-lg flex items-center gap-2 transition-colors" title="새 프로젝트를 생성합니다.">
                        <FolderPlus size={14} /> 새 프로젝트
                      </button>
                      <button onClick={() => { setIsProjectDropdownOpen(false); setView('projects'); }} className="w-full text-left px-3 py-2 text-sm text-stone-500 hover:bg-stone-50 rounded-lg flex items-center gap-2 transition-colors" title="프로젝트 관리 페이지로 이동합니다.">
                        <Briefcase size={14} /> 프로젝트 관리
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 items-center w-full md:w-auto overflow-x-auto overflow-y-visible md:overflow-visible pb-1 -mb-1 md:pb-0 md:mb-0">
          {/* 툴바: 되돌리기 / 다시실행 */}
          <div className="flex items-center gap-0.5 mr-1">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="icon-btn text-slate-500 hover:text-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title="실행 취소 (Ctrl+Z)"
            >
              <History size={16} /> {/* Replace Undo2 */}
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="icon-btn text-slate-500 hover:text-[var(--color-ink)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              title="다시 실행 (Ctrl+Shift+Z)"
            >
              <RotateCcw size={16} /> {/* Replace Redo2 */}
            </button>
          </div>
          <div className="toolbar-divider hidden md:block" />
          {/* 모바일: 가로 스크롤 탭 바 (아이콘+텍스트), 데스크톱: 기존 pill 영역 */}
          <div className="flex bg-slate-100/70 p-1 rounded-xl border border-slate-200/60 overflow-x-auto overflow-y-visible md:overflow-visible shrink-0 min-w-0 scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent gap-0.5">
            {!hiddenViews.has('dashboard') && (
              <NavButton active={view === 'dashboard'} onClick={() => navigateWithTip('dashboard')} icon={<LayoutDashboard size={14} />} label="대시보드" title="프로젝트·상태·인원별 현황을 한눈에 보는 요약 화면입니다." tourId="tour-nav-dashboard" />
            )}
            {!hiddenViews.has('allocation') && (
              <NavButton active={view === 'allocation'} onClick={() => navigateWithTip('allocation')} icon={<Users size={14} />} label="투입현황" title="프로젝트별·인원별 투입 비율을 한눈에 확인합니다." tourId="tour-nav-allocation" />
            )}
            <NavButton active={view === 'list'} onClick={() => navigateWithTip('list')} icon={<LayoutList size={14} />} label="표+간트" title="표와 간트를 나란히 보며 작업을 편집하고 일정을 확인합니다. 가운데 바를 드래그해 폭을 조절할 수 있어요." tourId="tour-nav-list" />
            <NavButton active={view === 'table'} onClick={() => navigateWithTip('table')} icon={<CheckSquare size={14} />} label="표만" title="작업 목록을 표 형태로만 보기. 빠른 편집·정렬·복사·붙여넣기에 적합합니다." tourId="tour-nav-table" />
            <NavButton active={view === 'gantt'} onClick={() => navigateWithTip('gantt')} icon={<Target size={14} />} label="간트만" title="일정 막대를 드래그해 날짜를 조정하고, 선후관계·크리티컬 패스를 확인합니다." tourId="tour-nav-gantt" />
            <NavButton active={view === 'kanban'} onClick={() => navigateWithTip('kanban')} icon={<Map size={14} />} label="칸반" title="상태별 칸으로 작업을 옮기며 진행 상황을 시각적으로 관리합니다." tourId="tour-nav-kanban" />
          </div>

          <div className="toolbar-divider" />

          {/* Filter On/Off Toggle */}
          <button
            data-tourid="tour-filter"
            onClick={() => {
              setFilterOn(v => !v);
              if(tipOnce) tipOnce('menu.filter', '필터를 켜면 상태/담당자/기간으로 작업을 좁혀 볼 수 있어요.');
            }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all shrink-0",
              filterOn
                ? "bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/25"
                : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700"
            )}
            title={filterOn ? "필터 끄기" : "필터 켜기"}
          >
            <Settings2 size={14} /> {/* Replace Filter */}
            <span className="hidden sm:inline">필터</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md", filterOn ? "bg-white/20" : "bg-slate-100 text-slate-400")}>{filterOn ? "On" : "Off"}</span>
          </button>

          {/* DB Sync Toggle Button / Sync Status icon. Reused from context...*/}
          <button
            type="button"
            onClick={() => {
              if (isDbSyncing) return;
              executeDbSync('all');
              if (tipOnce) tipOnce('menu.dbSync', 'DB 동기화는 로컬↔서버를 맞추는 동작입니다. 여러 명이 함께 쓸 때는 작업 후 동기화를 권장합니다.');
            }}
            disabled={isDbSyncing}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-all shrink-0",
              isDbSyncing
                ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                : hasLocalChangesSinceSync
                  ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-800"
            )}
            title={
              isDbSyncing
                ? (dbSyncStep?.msg ? `동기화 중: ${dbSyncStep.msg}` : '동기화 중...')
                : hasLocalChangesSinceSync
                  ? '로컬 변경사항이 있습니다. DB 동기화로 서버와 맞추세요.'
                  : 'DB 동기화'
            }
          >
            <Upload size={14} />
            <span className="hidden sm:inline">DB 동기화</span>
            {isDbSyncing ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/40">
                {typeof dbSyncStep?.pct === 'number' ? `${Math.round(dbSyncStep.pct)}%` : '...'}
              </span>
            ) : hasLocalChangesSinceSync ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-200/60">
                필요
              </span>
            ) : null}
          </button>

          <div className="toolbar-divider" />

          <button
            data-tourid="tour-new-task"
            onClick={() => {
              if (!canEditCurrentProject) return;
              setIsModalOpen(true);
              if(tipOnce) tipOnce('menu.newTask', '새 작업을 추가합니다. 표 화면에서는 Enter로도 빠르게 추가할 수 있어요.');
            }}
            disabled={!canEditCurrentProject}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title={canEditCurrentProject ? '새 작업 추가' : '보기 권한만 있어 편집할 수 없습니다'}
          >
            <Plus size={15} /> <span>새 작업</span>
          </button>
          
          <button
            onClick={() => setIsHeaderCollapsed(true)}
            className="md:hidden p-2.5 rounded-lg text-stone-500 hover:bg-stone-100 transition-colors"
            title="메뉴 접어서 표 넓게 보기"
          >
            <ChevronUp size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
