import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '../components/Toast';
import { EXCEL_IMPORT_TOUR_INDEX, EXCEL_IMPORT_TOUR_STEPS } from '../lib/excelImportTourSteps';

interface UseExcelImportTourParams {
  projects: { id: string }[];
  importPreviewOpen: boolean;
  isMoreMenuOpen: boolean;
  setIsMoreMenuOpen: Dispatch<SetStateAction<boolean>>;
  setIsHeaderCollapsed: Dispatch<SetStateAction<boolean>>;
}

/**
 * Excel 샘플 양식 다운로드 → 작성 → 가져오기 따라하기 투어.
 * 메뉴 열림·양식 다운로드·가져오기 미리보기·프로젝트 생성을 감지해 자동 진행한다.
 */
export function useExcelImportTour({
  projects,
  importPreviewOpen,
  isMoreMenuOpen,
  setIsMoreMenuOpen,
  setIsHeaderCollapsed,
}: UseExcelImportTourParams) {
  const { push: pushToast } = useToast();
  const [excelTour, setExcelTour] = useState<{ run: boolean; step: number }>({ run: false, step: 0 });
  const tourBaselineRef = useRef({ projects: 0 });
  const importPreviewWasOpenRef = useRef(false);

  const startExcelImportTour = useCallback(() => {
    tourBaselineRef.current = { projects: projects.length };
    importPreviewWasOpenRef.current = false;
    setIsMoreMenuOpen(false);
    setIsHeaderCollapsed(false);
    setExcelTour({ run: true, step: 0 });
  }, [projects.length, setIsMoreMenuOpen, setIsHeaderCollapsed]);

  const endExcelImportTour = useCallback(
    (mode: 'completed' | 'skipped') => {
      setExcelTour({ run: false, step: 0 });
      importPreviewWasOpenRef.current = false;
      if (mode === 'completed') {
        pushToast('Excel 가져오기 투어를 완료했습니다.', { variant: 'success', durationMs: 4000 });
      } else {
        pushToast('투어를 닫았습니다. ⋮ → 「Excel 가져오기 따라하기」로 다시 시작할 수 있어요.', {
          variant: 'info',
          durationMs: 4500,
        });
      }
    },
    [pushToast],
  );

  const handleExcelTourNext = useCallback(() => {
    setExcelTour((t) => (t.run && t.step < EXCEL_IMPORT_TOUR_STEPS.length - 1 ? { run: true, step: t.step + 1 } : t));
  }, []);

  const notifySampleDownloaded = useCallback(() => {
    setExcelTour((t) =>
      t.run && t.step === EXCEL_IMPORT_TOUR_INDEX.downloadSample ? { run: true, step: EXCEL_IMPORT_TOUR_INDEX.fillExcel } : t,
    );
  }, []);

  // 샘플 다운로드·가져오기 단계에서 메뉴 항목이 보이도록 자동 열기
  useEffect(() => {
    if (!excelTour.run) return;
    if (excelTour.step === EXCEL_IMPORT_TOUR_INDEX.downloadSample || excelTour.step === EXCEL_IMPORT_TOUR_INDEX.importClick) {
      setIsMoreMenuOpen(true);
    }
  }, [excelTour.run, excelTour.step, setIsMoreMenuOpen]);

  // ⋮ 메뉴 열림 감지 → 다음 action 단계로
  useEffect(() => {
    if (!excelTour.run || !isMoreMenuOpen) return;
    const step = excelTour.step;
    if (step === EXCEL_IMPORT_TOUR_INDEX.openMenu) {
      setExcelTour({ run: true, step: EXCEL_IMPORT_TOUR_INDEX.downloadSample });
    } else if (step === EXCEL_IMPORT_TOUR_INDEX.openMenuImport) {
      setExcelTour({ run: true, step: EXCEL_IMPORT_TOUR_INDEX.importClick });
    }
  }, [excelTour.run, excelTour.step, isMoreMenuOpen]);

  // 가져오기 파일 선택 후 미리보기·프로젝트 생성 감지
  useEffect(() => {
    if (!excelTour.run) return;
    const step = excelTour.step;

    if (step === EXCEL_IMPORT_TOUR_INDEX.importClick && importPreviewOpen) {
      setExcelTour({ run: true, step: EXCEL_IMPORT_TOUR_INDEX.importPreview });
    }

    if (step === EXCEL_IMPORT_TOUR_INDEX.importPreview) {
      if (importPreviewOpen) importPreviewWasOpenRef.current = true;
      else if (importPreviewWasOpenRef.current && projects.length > tourBaselineRef.current.projects) {
        importPreviewWasOpenRef.current = false;
        setExcelTour({ run: true, step: EXCEL_IMPORT_TOUR_INDEX.saveDb });
      }
    }
  }, [excelTour.run, excelTour.step, importPreviewOpen, projects.length]);

  return {
    excelTour,
    startExcelImportTour,
    endExcelImportTour,
    handleExcelTourNext,
    notifySampleDownloaded,
  };
}
