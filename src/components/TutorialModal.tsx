import React, { useEffect, useRef, useState } from 'react';
import { X, BookOpen, ChevronRight, Route } from 'lucide-react';
import { cn } from '../lib/utils';
import { MODAL_BACKDROP_CLASS, MODAL_PANEL_BASE_CLASS } from '../lib/modalChrome';

export interface TutorialSection {
  id: string;
  title: string;
  content: Array<
    | { type: 'paragraph'; text: string }
    | { type: 'list'; items: string[] }
    | { type: 'table'; headers: string[]; rows: string[][] }
    | { type: 'subtitle'; text: string }
  >;
}

const TUTORIAL_SECTIONS: TutorialSection[] = [
  {
    id: 'start',
    title: '1. 시작하기',
    content: [
      { type: 'subtitle', text: '로그인·회원가입' },
      {
        type: 'paragraph',
        text: '앱에 접속하면 로그인 화면이 나타납니다. 이메일과 비밀번호(6자 이상)를 입력해 로그인하거나, "회원가입" 링크로 이름·이메일·비밀번호를 입력해 새 계정을 만듭니다. Google·GitHub 계정으로 로그인할 수도 있습니다.',
      },
      {
        type: 'list',
        items: [
          '가입 직후: 로컬에서만 프로젝트·작업 생성·편집 가능. 서버 동기화는 할 수 없고 안내가 표시됩니다.',
          '관리자 승인 후: 서버 자동 반영·실시간 협업. 등록된 전체 프로젝트 목록 조회, 타인 프로젝트는 멤버/권한이 있을 때만 보기·편집 가능.',
        ],
      },
      { type: 'subtitle', text: '첫 화면 구성' },
      {
        type: 'paragraph',
        text: '상단 왼쪽의 프로젝트 이름(예: ECDIS H/W)을 클릭하면 현재 작업할 프로젝트를 바꿀 수 있고, "전체"를 선택하면 모든 프로젝트의 작업을 한 화면에서 볼 수 있습니다. 새 프로젝트는 그 옆의 「새 프로젝트」 버튼으로 바로 만듭니다. 프로젝트 관리 화면은 Shift+F12로 숨김 메뉴를 켠 뒤 프로젝트 목록 맨 아래에서 열 수 있습니다.',
      },
      {
        type: 'paragraph',
        text: '가운데 네비게이션 탭으로 대시보드, 투입현황, 표만, 간트만, 칸반, 마인드맵, 프로젝트 화면을 전환합니다. 오른쪽에는 필터, 더보기(⋮), 새 작업 버튼이 있습니다.',
      },
    ],
  },
  {
    id: 'projects',
    title: '2. 프로젝트 만들기와 관리',
    content: [
      { type: 'subtitle', text: '프로젝트 생성' },
      {
        type: 'list',
        items: [
          '상단 헤더의 「새 프로젝트」 버튼을 누르고, 이름·PM(필수)·PO(선택)·설명·시작일·종료일을 입력한 뒤 저장합니다. PM/PO는 WBS 작업의「담당자」와 별개이며, 대시보드·프로젝트 목록에서 확인할 수 있습니다.',
          '프로젝트 목록(관리) 화면은 Shift+F12로 숨김 메뉴를 켠 뒤, 프로젝트 이름 클릭 → 목록 맨 아래 「프로젝트 관리」로 엽니다. 카드를 클릭하면 해당 프로젝트가 선택되고, 표/간트 등에서 그 프로젝트의 작업을 편집할 수 있습니다.',
        ],
      },
      { type: 'subtitle', text: '수정·삭제·복사' },
      {
        type: 'paragraph',
        text: '프로젝트 카드의 연필 아이콘으로 이름·설명·기간·투입 인원·주간보고 메타 등을 수정할 수 있습니다. 휴지통으로 삭제하고, "복사"를 누르면 소속 작업까지 포함한 새 프로젝트가 만들어지며 복사본은 내 소유로 등록됩니다.',
      },
      { type: 'subtitle', text: '기간·투입·주간보고' },
      {
        type: 'list',
        items: [
          '프로젝트에 시작일·종료일을 넣으면 요약·투입 집계 등에 참고되며, 작업 일정은 프로젝트와 달라도 입력한 대로 저장됩니다.',
          '투입 인원·투입 비율(%), 월별 투입을 설정하면 "투입현황" 화면에서 프로젝트별·인원별 투입을 한눈에 볼 수 있습니다.',
          '주간보고용 필드(분류, 주관기관, 예산, 기간 표기, 과제명 약어/전체 등)를 두면 주간보고에서 활용할 수 있습니다.',
        ],
      },
    ],
  },
  {
    id: 'tasks',
    title: '3. 작업(WBS) 추가·편집',
    content: [
      { type: 'subtitle', text: '작업 구조·WBS 번호' },
      {
        type: 'paragraph',
        text: '작업은 상위·하위 트리 구조로 관리됩니다. WBS 번호(예: 1.1, 1.2.1)는 레벨별 접두 규칙으로 자동 부여되며, 환경설정에서 접두어·최대 깊이를 변경할 수 있습니다.',
      },
      { type: 'subtitle', text: '작업 추가·레벨 변경' },
      {
        type: 'list',
        items: [
          '작업명 클릭(또는 F2): 표에서 바로 이름 수정 — Enter로 저장·종료. 그 외 표에 포커스가 있을 때 Enter: 같은 레벨 아래 새 작업 추가. Shift+Enter: 같은 레벨 위에 추가.',
          '셀 선택 후 바로 타이핑: 엑셀처럼 편집 모드가 아니어도 영문·숫자를 치면 그 값으로 즉시 편집이 시작됩니다(날짜·공수·진척률·가중치 등). 한글 텍스트는 셀을 클릭하거나 F2를 누른 뒤 입력하세요.',
          'Tab: 선택한 작업을 한 단계 하위 레벨로 내리기. Shift+Tab: 한 단계 상위로 올리기.',
          '작업 행 더블클릭 또는 F2: 작업 편집 창에서 이름·시작일·종료일·담당자·상태·진척률·공수(일)·설명·산출물·체크리스트·선행작업(의존성) 등을 입력.',
        ],
      },
      { type: 'subtitle', text: '순서·복사·삭제·일괄 수정' },
      {
        type: 'list',
        items: [
          'Alt+↑/↓: 표시 순서를 위·아래로 한 칸 이동(정렬·필터가 없을 때). 체크로 여러 행을 고르면 같은 부모 아래에서 연속으로 잡힌 블록마다 한 칸씩 같이 이동합니다. 드래그 앤 드롭으로 순서나 부모를 바꿀 수 있습니다.',
          'Ctrl+C / Ctrl+V: 커서가 값 셀(날짜·공수·담당 등)에 있으면 엑셀처럼 셀 값 복사 → 다른 셀로 이동 후 붙여넣기(체크한 여러 행에는 일괄 적용). 작업명 셀·체크 선택은 작업(및 하위) 단위 복사·붙여넣기. Ctrl+A로 전체 선택 가능.',
          'Delete: 선택한 작업 삭제(하위 포함 여부는 확인 창에서 선택).',
          '여러 작업을 선택한 뒤 표 아래 일괄 수정 바에서 상태·유형(마일스톤·이슈·액션)·담당자·공수·진척률 등을 한 번에 바꿀 수 있습니다.',
        ],
      },
      { type: 'subtitle', text: '선행작업·일정·과부하' },
      {
        type: 'paragraph',
        text: '작업 편집 창에서 "선행작업"을 지정하면 간트 차트에 선으로 연결되고, 일정이 선후 관계에 맞게 반영될 수 있습니다. 인원 투입과 공수를 바탕으로 과부하(일정 충돌)를 파악하고, 기간 연장·투입율 조정으로 완화할 수 있습니다. 간트만 뷰에서는 막대를 드래그해 일정을 직접 바꿀 수 있습니다.',
      },
      { type: 'subtitle', text: '마일스톤·이슈·베이스라인' },
      {
        type: 'paragraph',
        text: '작업을 마일스톤 또는 이슈로 표시할 수 있고, 베이스라인(기준 일정·공수)을 저장해 두면 현재와 차이를 비교할 수 있습니다. 표의 셀은 더블클릭 또는 F2로 바로 수정할 수 있으며(엑셀형), 줄간격(행 높이)은 표 위 슬라이더로 15~64px 범위에서 조정할 수 있습니다.',
      },
    ],
  },
  {
    id: 'views',
    title: '4. 화면(뷰)별 주요 기능',
    content: [
      { type: 'subtitle', text: '표만·간트만' },
      {
        type: 'paragraph',
        text: '표만: 작업 목록만 크게 보기. 컬럼 클릭으로 정렬, 필터와 함께 사용해 빠른 편집·복사·붙여넣기에 적합합니다. 간트만: 일정 막대만 보기. +/−로 확대·축소하고, 막대 드래그로 시작일·종료일을 변경할 수 있습니다.',
      },
      { type: 'subtitle', text: '칸반·마인드맵' },
      {
        type: 'paragraph',
        text: '칸반: 상태별 칸(대기·진행·완료 등)으로 작업 카드를 옮겨 진행 상황을 시각적으로 관리합니다. 카드에서 이름 수정·삭제가 가능합니다. 마인드맵: WBS 계층을 가지 형태로 표시합니다. 노드 클릭으로 편집, 배경 드래그로 캔버스 이동, Ctrl+휠로 확대·축소할 수 있습니다(관리자 등 권한에 따라 비활성화될 수 있음).',
      },
      { type: 'subtitle', text: '대시보드·투입현황·프로젝트' },
      {
        type: 'list',
        items: [
          '대시보드: 프로젝트 수·작업 수·상태별 개수·인원별 현황을 카드로 요약. 카드 클릭 시 해당 조건으로 필터된 표/간트로 이동할 수 있습니다.',
          '투입현황: 프로젝트별·인원별 투입 비율과 공수(M/D)를 표로 확인. 담당자 이름 일괄 변경도 가능합니다.',
          '프로젝트: 프로젝트 카드 목록, 추가·수정·삭제·복사·공유를 한 화면에서 처리합니다.',
        ],
      },
    ],
  },
  {
    id: 'filter',
    title: '5. 필터·정렬',
    content: [
      {
        type: 'paragraph',
        text: '상단 "필터" 버튼을 켜면 표 위에 필터 영역이 나타납니다. 프로젝트를 다중 선택해 여러 프로젝트의 작업을 한 화면에서 볼 수 있고, 상태·담당자·기간으로 목록을 좁힐 수 있습니다.',
      },
      {
        type: 'list',
        items: [
          '상태·담당자·시작일·종료일 조건으로 작업 필터링.',
          '마일스톤만 / 이슈만 / 특정 레벨만 / 기한 지난 작업 / 이번 주 완료 등 옵션으로 더 세게 필터링 가능.',
          '정렬은 컬럼 헤더를 우클릭한 뒤 "이 컬럼으로 정렬"을 선택합니다(WBS·이름·일정·공수·담당자·상태·진척률 등). 헤더를 눌러 열을 고르거나 너비를 조절할 때 의도치 않게 순서가 바뀌지 않도록, 헤더 클릭만으로는 정렬하지 않습니다.',
        ],
      },
    ],
  },
  {
    id: 'import-export',
    title: '6. 가져오기·내보내기·백업',
    content: [
      { type: 'subtitle', text: '가져오기' },
      {
        type: 'list',
        items: [
          '⋮(더보기) → 가져오기에서 Excel(.xlsx) 또는 백업 JSON(.json) 파일을 선택합니다.',
          'Excel: 시트 구조에 맞춰 미리보기가 나옵니다. "기존 프로젝트에 합치기" 또는 "새 프로젝트로 만들기"를 선택해 가져옵니다.',
          'JSON: 이 앱에서 내보낸 백업 파일을 그대로 복원하거나, 여러 파일을 선택해 "다중 병합"할 수 있습니다.',
        ],
      },
      { type: 'subtitle', text: '내보내기' },
      {
        type: 'list',
        items: [
          '⋮ → 내보내기에서 범위(전체 프로젝트 / 선택한 프로젝트만)와 형식(Excel / JSON 백업 / Markdown)을 선택한 뒤 내보내기하면 파일이 다운로드됩니다.',
          '한 번 설정해 두면 "마지막 설정으로 빠른 내보내기"도 가능합니다.',
          '데이터는 브라우저 로컬에 저장되므로, 정기적으로 JSON으로 백업하는 것을 권장합니다. 상단 백업 안내 배너의 "내보내기"로 바로 백업할 수 있습니다.',
        ],
      },
    ],
  },
  {
    id: 'share',
    title: '7. 프로젝트 공유와 협업',
    content: [
      { type: 'subtitle', text: '공유(초대)하기' },
      {
        type: 'list',
        items: [
          '프로젝트 화면에서 공유할 프로젝트 카드의 "공유" 버튼을 누르거나, 표/간트 화면에서 ⋮ → 공유를 선택합니다.',
          '"초대 링크 만들기"를 누르면 링크가 생성됩니다. 이 링크를 팀원에게 보내면 보기 또는 편집 권한 요청을 할 수 있습니다.',
          '회원 목록에서 사용자를 선택해 "편집" 또는 "보기" 권한을 부여할 수 있습니다(소유자 또는 관리자만 가능).',
        ],
      },
      { type: 'subtitle', text: '권한 요청·승인' },
      {
        type: 'paragraph',
        text: '초대 링크로 들어온 사용자는 보기/편집 권한 요청을 보냅니다. 프로젝트 소유자(또는 관리자)는 공유 창의 멤버 목록에서 요청을 "승인" 또는 "거절"할 수 있습니다. 승인되면 해당 프로젝트가 요청자 목록에 보이고, 권한에 따라 보기만 하거나 편집할 수 있습니다.',
      },
    ],
  },
  {
    id: 'sync',
    title: '8. 서버 반영·실시간 협업',
    content: [
      {
        type: 'paragraph',
        text: '편집 내용은 우선 이 브라우저(로컬)에 저장됩니다. 우측 하단 「저장」 버튼 또는 Ctrl+S를 눌러야 서버(DB)에 반영되어 팀원들도 볼 수 있습니다. 같은 프로젝트를 연 다른 사람의 수정은 Supabase Realtime으로 거의 바로 화면에 반영됩니다.',
      },
      {
        type: 'list',
        items: [
          '저장하지 않은 변경이 있으면 우측 하단에 「저장 (Ctrl+S)」 버튼이 나타납니다. 저장하지 않고 창을 닫거나 새로고침하면 경고가 표시됩니다.',
          '첫 접속 시에는 전체 데이터를 서버와 한 번 맞추는 동기화가 진행될 수 있습니다.',
          '미승인 사용자는 로컬에서만 사용합니다.',
        ],
      },
    ],
  },
  {
    id: 'settings',
    title: '9. 환경설정',
    content: [
      {
        type: 'paragraph',
        text: '⋮ → 환경설정에서 다음을 변경할 수 있습니다.',
      },
      {
        type: 'list',
        items: [
          '앱 제목: 상단에 표시되는 앱 이름.',
          '환경설정: 레벨별 접두어(1., 1.1., 1.1.1 등), 최대 깊이.',
          '상태 정의: 작업 상태 이름·색·진척도(%). 예: 할당 0%, 진행중 50%, 완료 100%.',
          '표 컬럼: 표시할 컬럼(WBS ID, 이름, 시작일, 종료일, 공수, 담당자, 투입율, 상태, 진척률, 산출물, 선행작업 등)과 표시 순서.',
          '표 줄바꿈·열 너비 등.',
        ],
      },
    ],
  },
  {
    id: 'shortcuts',
    title: '10. 유용한 단축키',
    content: [
      {
        type: 'table',
        headers: ['구분', '단축키', '동작'],
        rows: [
          ['공통', 'Ctrl+Z', '되돌리기'],
          ['공통', 'Ctrl+Y', '다시 실행'],
          ['공통', 'Ctrl+S', '즉시 서버 반영'],
          ['공통', 'Shift+F12', '숨김 메뉴 표시 전환(투입현황·주간보고·프로젝트 관리 등)'],
          ['공통', 'Alt+1~7', '대시보드~마인드맵 뷰 전환(순서별)'],
          ['공통', 'Ctrl+Alt+1~9', '트리 1~9 레벨까지 펼치기'],
          ['공통', 'Ctrl++ / Ctrl+-', '표·간트 줄 높이 늘리기/줄이기'],
          ['표', '↑ / ↓', '선택한 행 이동'],
          ['표', 'Alt+↑ / Alt+↓', '작업 순서 위/아래 변경'],
          ['표', 'Tab / Shift+Tab', '레벨 한 단계 내리기/올리기'],
          ['표', 'Enter', '인라인 작업명 수정 중이면 편집 종료·저장. 아니면 같은 레벨 아래 새 작업 추가'],
          ['표', 'Shift+Enter', '같은 레벨 위에 새 작업 추가(작업명 입력란에 포커스가 없을 때)'],
          ['표', 'F2', '선택한 작업 인라인 수정(작업명 등)'],
          ['표', 'Delete', '선택한 작업 삭제'],
          ['표', 'Ctrl+C / Ctrl+V', '복사·붙여넣기'],
          ['표', 'Ctrl+A / Esc', '전체 선택 / 선택 해제'],
          ['간트', '+ / -', '확대·축소'],
          ['마인드맵', '드래그 / Ctrl+휠', '캔버스 이동 / 확대·축소'],
        ],
      },
    ],
  },
  {
    id: 'weekly-report-misc',
    title: '11. 주간보고·기타',
    content: [
      { type: 'subtitle', text: '주간보고' },
      {
        type: 'paragraph',
        text: '⋮ → 주간보고에서 기준 주를 선택하면, 담당별·프로젝트별로 금주 한일·차주 계획·이슈가 요약됩니다. 요약 텍스트를 복사해 쓰거나, 링크를 통해 해당 작업으로 바로 이동해 수정할 수 있습니다.',
      },
      { type: 'subtitle', text: '감사 이력·데이터 초기화' },
      {
        type: 'paragraph',
        text: '프로젝트별로 생성·수정·삭제 기록을 시간순으로 조회할 수 있습니다(변경 이력 버튼). ⋮ → 로컬 초기화로 데이터를 비울 수 있으나, 반드시 그 전에 내보내기(JSON)로 백업하세요.',
      },
    ],
  },
];

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 화면 따라하기 투어 시작(데스크톱 전용). App이 모달을 닫고 투어를 실행한다. */
  onStartTour?: () => void;
}

export function TutorialModal({ isOpen, onClose, onStartTour }: TutorialModalProps) {
  const [activeId, setActiveId] = useState(TUTORIAL_SECTIONS[0].id);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !contentRef.current) return;
    const el = sectionRefs.current[activeId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [isOpen, activeId]);

  if (!isOpen) return null;

  const renderBlock = (block: TutorialSection['content'][number], index: number) => {
    switch (block.type) {
      case 'paragraph':
        return (
          <p key={index} className="text-sm text-slate-600 leading-relaxed mb-3">
            {block.text}
          </p>
        );
      case 'subtitle':
        return (
          <h4 key={index} className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-4 mb-2 first:mt-0">
            {block.text}
          </h4>
        );
      case 'list':
        return (
          <ul key={index} className="list-disc list-inside text-sm text-slate-600 space-y-1.5 mb-3">
            {block.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        );
      case 'table':
        return (
          <div key={index} className="overflow-x-auto rounded-lg border border-slate-200 mb-3">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {block.headers.map((h, i) => (
                    <th key={i} className="px-3 py-2 font-semibold text-slate-700">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-slate-100 last:border-0">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2 text-slate-600">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={cn(MODAL_BACKDROP_CLASS, 'z-[100]')}>
      <div
        className={cn(MODAL_PANEL_BASE_CLASS, 'max-w-4xl h-[85vh] flex flex-col overflow-hidden')}
        role="dialog"
        aria-labelledby="tutorial-title"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-indigo-500" />
            <h2 id="tutorial-title" className="text-lg font-bold text-slate-800">
              사용 튜토리얼
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {onStartTour && (
              <button
                type="button"
                onClick={onStartTour}
                className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-xs font-semibold transition-colors"
                title="신규 프로젝트 생성 → 첫 작업 입력 순서를 실제 화면 위에서 단계별로 따라 해 봅니다."
              >
                <Route size={14} /> 화면 따라하기 투어
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="닫기"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          <nav className="w-52 shrink-0 border-r border-slate-200 bg-slate-50/50 overflow-y-auto custom-scrollbar py-2">
            {TUTORIAL_SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={cn(
                  'w-full text-left px-4 py-2.5 flex items-center gap-2 text-sm transition-colors rounded-r-lg',
                  activeId === s.id
                    ? 'bg-indigo-50 text-indigo-700 font-semibold border-l-2 border-indigo-500'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                <ChevronRight size={14} className={activeId === s.id ? 'opacity-100' : 'opacity-0'} />
                <span className="truncate">{s.title}</span>
              </button>
            ))}
          </nav>

          <div ref={contentRef} className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {TUTORIAL_SECTIONS.map((section) => (
              <div
                key={section.id}
                ref={(el) => {
                  sectionRefs.current[section.id] = el;
                }}
                id={`tutorial-${section.id}`}
                className="mb-8"
              >
                <h3 className="text-base font-bold text-slate-800 mb-4 pb-2 border-b border-slate-200">{section.title}</h3>
                <div className="space-y-0">{section.content.map((block, i) => renderBlock(block, i))}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
