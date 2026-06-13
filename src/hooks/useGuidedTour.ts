import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '../components/Toast';
import { GUIDED_TOUR_STEPS, TOUR_INDEX } from '../lib/guidedTourSteps';
import type { Task, Project } from '../types';

/** 따라하기 투어 자동 표시 끔 플래그 — 「다시 보지 않기」 선택 또는 완주 시에만 기록. 그냥 닫으면(X·Esc) 다음 접속 때 다시 시작 */
const GUIDED_TOUR_HIDE_KEY = 'wbs.guided-tour.v1.hide';

interface UseGuidedTourParams {
  projects: Project[];
  allTasks: Task[];
  isLoading: boolean;
  hiddenViews: Set<string>;
  isProjectModalOpen: boolean;
  isProjectStatusOnly: boolean;
  setIsProjectDropdownOpen: Dispatch<SetStateAction<boolean>>;
  setIsMoreMenuOpen: Dispatch<SetStateAction<boolean>>;
  setIsHeaderCollapsed: Dispatch<SetStateAction<boolean>>;
}

/**
 * 초보자 따라하기 투어 상태 머신.
 * 신규 프로젝트 생성 → 첫 작업 입력 순서를 실제 화면 위에서 안내(GuidedTour).
 * action 단계는 모달 열림·프로젝트 생성·작업 추가를 감지해 자동 진행한다.
 * WBSApp god 컴포넌트에서 분리 — 동작 동일.
 */
export function useGuidedTour({
  projects,
  allTasks,
  isLoading,
  hiddenViews,
  isProjectModalOpen,
  isProjectStatusOnly,
  setIsProjectDropdownOpen,
  setIsMoreMenuOpen,
  setIsHeaderCollapsed,
}: UseGuidedTourParams) {
  const { push: pushToast } = useToast();
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tour, setTour] = useState<{ run: boolean; step: number }>({ run: false, step: 0 });
  /** 투어 시작 시점의 프로젝트·작업 수 — 생성/추가 감지 기준 */
  const tourBaselineRef = useRef({ projects: 0, tasks: 0 });

  const startGuidedTour = useCallback(() => {
    tourBaselineRef.current = { projects: projects.length, tasks: allTasks.length };
    setIsTutorialOpen(false);
    setIsProjectDropdownOpen(false);
    setIsMoreMenuOpen(false);
    setIsHeaderCollapsed(false); // 접힌 헤더에서는 1단계 대상(프로젝트 메뉴)이 보이지 않음
    setTour({ run: true, step: 0 });
  }, [projects.length, allTasks.length, setIsProjectDropdownOpen, setIsMoreMenuOpen, setIsHeaderCollapsed]);

  /**
   * 투어 종료.
   * - completed: 끝까지 봄 → 다음 접속부터 자동 표시 안 함
   * - never: 「다시 보지 않기」 선택 → 자동 표시 안 함
   * - skipped: X·Esc로 이번만 닫음 → 다음 접속 때 다시 자동 시작
   */
  const endGuidedTour = useCallback(
    (mode: 'completed' | 'skipped' | 'never') => {
      setTour({ run: false, step: 0 });
      if (mode !== 'skipped') {
        try {
          localStorage.setItem(GUIDED_TOUR_HIDE_KEY, '1');
        } catch {
          /* 저장 불가(시크릿 모드 등)면 다음 접속에 다시 자동 노출될 뿐 — 무시 */
        }
      }
      if (mode === 'completed') pushToast('투어 완료! 이제 직접 프로젝트를 채워 보세요.', { variant: 'success', durationMs: 4000 });
      else if (mode === 'never')
        pushToast('투어를 다시 자동 표시하지 않습니다. ⋮ 메뉴 → 「따라하기 투어」로 언제든 볼 수 있어요.', {
          variant: 'info',
          durationMs: 4500,
        });
      else
        pushToast('투어를 닫았습니다. 다음 접속 때 다시 안내해요 — 끄려면 투어의 「다시 보지 않기」를 누르세요.', {
          variant: 'info',
          durationMs: 4500,
        });
    },
    [pushToast],
  );

  /** 안내형(next) 단계의 「다음」 — 마지막 단계의 완료는 GuidedTour의 onFinish가 처리 */
  const handleTourNext = useCallback(() => {
    setTour((t) => (t.run && t.step < GUIDED_TOUR_STEPS.length - 1 ? { run: true, step: t.step + 1 } : t));
  }, []);

  // action 단계 자동 진행: 입력창 열림 → 이름 단계 / 닫힘 → 생성됐으면 작업 단계·취소면 버튼 단계로 복귀 / 작업 추가 → 요령 단계
  useEffect(() => {
    if (!tour.run) return;
    if (tour.step <= TOUR_INDEX.newProject && isProjectModalOpen) {
      setTour({ run: true, step: TOUR_INDEX.fillName });
    } else if ((tour.step === TOUR_INDEX.fillName || tour.step === TOUR_INDEX.createProject) && !isProjectModalOpen) {
      setTour({
        run: true,
        step: projects.length > tourBaselineRef.current.projects ? TOUR_INDEX.addTask : TOUR_INDEX.newProject,
      });
    } else if (tour.step === TOUR_INDEX.addTask && allTasks.length > tourBaselineRef.current.tasks) {
      setTour({ run: true, step: TOUR_INDEX.taskTips });
    }
  }, [tour, isProjectModalOpen, projects.length, allTasks.length]);

  // 데스크톱 접속마다 무조건 자동 시작 — 「다시 보지 않기」를 선택했거나 투어를 완주한 사용자만 제외
  const tourAutoStartCheckedRef = useRef(false);
  useEffect(() => {
    if (isLoading || tourAutoStartCheckedRef.current) return;
    tourAutoStartCheckedRef.current = true;
    if (isProjectStatusOnly || hiddenViews.has('projects')) return;
    if (window.matchMedia('(max-width: 767px)').matches) return; // 모바일은 작업 편집 화면이 잠겨 있어 투어 비대상
    try {
      if (localStorage.getItem(GUIDED_TOUR_HIDE_KEY)) return;
    } catch {
      return;
    }
    const timer = setTimeout(() => startGuidedTour(), 1800);
    return () => clearTimeout(timer);
  }, [isLoading, hiddenViews, startGuidedTour, isProjectStatusOnly]);

  return { isTutorialOpen, setIsTutorialOpen, tour, startGuidedTour, endGuidedTour, handleTourNext };
}
