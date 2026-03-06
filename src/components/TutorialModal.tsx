import React, { useEffect, useMemo, useRef } from 'react';
import { HelpCircle, X, Keyboard } from 'lucide-react';
import { cn } from '../lib/utils';

interface TutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TocItem = { id: string; label: string };

export function TutorialModal({ isOpen, onClose }: TutorialModalProps) {
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const toc: TocItem[] = useMemo(() => ([
    { id: 'quickstart', label: '빠른 시작' },
    { id: 'projects', label: '프로젝트' },
    { id: 'views', label: '화면(뷰) 구성' },
    { id: 'wbs-table', label: '표(WBS) 편집' },
    { id: 'gantt', label: '간트 차트' },
    { id: 'filters', label: '필터' },
    { id: 'import-export', label: '가져오기/내보내기/백업' },
    { id: 'ai', label: 'AI 프로젝트 분석' },
    { id: 'settings', label: '설정' },
    { id: 'tips', label: '팁 & 주의사항' },
  ]), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key !== 'Escape') return;

      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
        (target as HTMLElement).blur?.();
        return;
      }
      onClose();
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const scrollTo = (id: string) => {
    const el = sectionRefs.current[id];
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
    <section
      ref={(el) => { sectionRefs.current[id] = el; }}
      className="scroll-mt-6"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="h-6 w-1.5 rounded-full bg-blue-600" />
        <h3 className="text-sm font-black text-stone-800">{title}</h3>
      </div>
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        {children}
      </div>
    </section>
  );

  const Kbd = ({ children }: { children: React.ReactNode }) => (
    <kbd className="px-2 py-1 inline-flex items-center justify-center text-[11px] font-black text-slate-700 bg-white border border-slate-200 rounded-lg shadow-sm leading-none">
      {children}
    </kbd>
  );

  const Bullet = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="flex gap-3">
      <div className="mt-1.5 h-2 w-2 rounded-full bg-stone-300 shrink-0" />
      <div className="min-w-0">
        <div className="text-sm font-bold text-stone-800">{title}</div>
        <div className="text-xs text-stone-600 leading-relaxed mt-1">{children}</div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-[var(--color-line)] max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-[var(--color-line)] bg-stone-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-blue-100 p-2 rounded-xl text-blue-700 border border-blue-200">
              <HelpCircle size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="font-black text-lg text-[var(--color-ink)] truncate">사용법 튜토리얼</h2>
              <p className="text-[11px] text-stone-500 font-medium mt-0.5">
                <span className="inline-flex items-center gap-1.5">
                  <Keyboard size={12} className="text-stone-400" />
                  <span>단축키로 열기:</span>
                  <Kbd>F1</Kbd>
                  <span className="text-stone-300">또는</span>
                  <Kbd>?</Kbd>
                  <span className="text-stone-300">(Shift+/)</span>
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-stone-200 rounded-full transition-colors text-stone-500 hover:text-[var(--color-ink)]"
            title="닫기 (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="h-full grid grid-cols-1 lg:grid-cols-[260px_1fr]">
            {/* TOC */}
            <aside className="border-b lg:border-b-0 lg:border-r border-stone-200 bg-stone-50/60 p-4">
              <div className="text-[10px] font-black text-stone-500 uppercase tracking-wider mb-3">목차</div>
              <div className="flex flex-wrap lg:flex-col gap-2">
                {toc.map(item => (
                  <button
                    key={item.id}
                    onClick={() => scrollTo(item.id)}
                    className={cn(
                      "text-left px-3 py-2 rounded-xl border text-xs font-bold transition-colors",
                      "bg-white border-stone-200 text-stone-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="mt-4 text-[10px] text-stone-500 leading-relaxed">
                팁: 튜토리얼을 열어둔 상태에서 스크롤로 내용을 훑어보고, 필요한 부분은 목차로 바로 이동하세요.
              </div>
            </aside>

            {/* Content */}
            <div className="overflow-y-auto p-5 lg:p-6 space-y-6 custom-scrollbar bg-white">
              <Section id="quickstart" title="빠른 시작">
                <div className="space-y-4">
                  <Bullet title="1) 프로젝트 선택">
                    상단의 <b>현재 프로젝트</b> 드롭다운에서 프로젝트를 선택하거나 <b>새 프로젝트</b>를 생성합니다.
                  </Bullet>
                  <Bullet title="2) 작업 추가">
                    우측 상단 <b>새 작업</b> 버튼 또는 표 하단의 <b>새 작업 추가(Enter)</b> 입력 줄을 사용합니다.
                  </Bullet>
                  <Bullet title="3) 구조 만들기(계층)">
                    표에서 행을 선택한 뒤 <Kbd>Tab</Kbd> 으로 <b>들여쓰기</b>, <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd> 으로 <b>내어쓰기</b>를 합니다.
                  </Bullet>
                  <Bullet title="4) 일정 확인">
                    “전체(표+간트)” 뷰에서 표와 간트를 동시에 보며 일정/기간을 맞춥니다.
                  </Bullet>
                </div>
              </Section>

              <Section id="projects" title="프로젝트">
                <div className="space-y-4">
                  <Bullet title="프로젝트 만들기">
                    <b>현재 프로젝트</b> 드롭다운의 <b>새 프로젝트</b>를 클릭합니다.
                  </Bullet>
                  <Bullet title="프로젝트 이름/설명 수정">
                    프로젝트 목록에서 해당 프로젝트 오른쪽의 <b>연필(편집)</b> 버튼을 클릭합니다.
                  </Bullet>
                  <Bullet title="프로젝트 삭제">
                    프로젝트 목록에서 <b>휴지통(삭제)</b>을 클릭합니다. 프로젝트와 소속 작업이 함께 삭제됩니다.
                  </Bullet>
                  <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
                    <b>주의</b>: 프로젝트 삭제는 되돌리기(Undo) 대상이 아니며, 삭제 후 복구가 어렵습니다. 필요 시 먼저 <b>전체 데이터 백업(JSON)</b>을 권장합니다.
                  </div>
                </div>
              </Section>

              <Section id="views" title="화면(뷰) 구성">
                <div className="space-y-4">
                  <Bullet title="대시보드">
                    프로젝트/상태 등 요약을 보고 원하는 화면으로 이동합니다.
                  </Bullet>
                  <Bullet title="전체(표+간트)">
                    표와 간트를 <b>분할 화면</b>으로 보여줍니다. 가운데 구분선을 드래그해 좌/우 비율을 조절할 수 있습니다.
                  </Bullet>
                  <Bullet title="표만 / 간트만 / 칸반">
                    한 가지 화면에 집중해서 편집/확인할 때 사용합니다.
                  </Bullet>
                </div>
              </Section>

              <Section id="wbs-table" title="표(WBS) 편집">
                <div className="space-y-4">
                  <Bullet title="선택 이동 / 다중 선택">
                    행을 클릭해 선택합니다. <Kbd>Ctrl</Kbd>로 다중 선택, <Kbd>Shift</Kbd>로 범위 선택이 가능합니다.
                  </Bullet>
                  <Bullet title="빠른 추가(Enter)">
                    선택된 행이 1개일 때 <Kbd>Enter</Kbd> 를 누르면 <b>같은 레벨 아래</b>에 빠르게 작업을 추가할 수 있습니다.
                  </Bullet>
                  <Bullet title="하위 작업 추가(Insert)">
                    선택된 행이 1개일 때 <Kbd>Insert</Kbd> 를 누르면 <b>하위 작업</b>이 생성됩니다.
                  </Bullet>
                  <Bullet title="이름 빠른 수정(F2)">
                    선택된 행이 1개일 때 <Kbd>F2</Kbd> 로 작업명을 인라인 편집합니다.
                  </Bullet>
                  <Bullet title="계층(들여쓰기/내어쓰기)">
                    <Kbd>Tab</Kbd> / <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd> 으로 구조를 만듭니다. 여러 행을 선택해서 한 번에 적용할 수도 있습니다.
                  </Bullet>
                  <Bullet title="순서 변경">
                    드래그로 순서를 바꾸거나, 선택된 행 1개일 때 <Kbd>Alt</Kbd>+<Kbd>↑</Kbd>/<Kbd>↓</Kbd>로 위/아래로 이동합니다.
                  </Bullet>
                  <Bullet title="복사/붙여넣기">
                    <Kbd>Ctrl</Kbd>+<Kbd>C</Kbd> / <Kbd>Ctrl</Kbd>+<Kbd>V</Kbd>를 지원합니다. 계층 구조와 일부 의존성도 함께 복사됩니다.
                  </Bullet>
                  <Bullet title="되돌리기(Undo)">
                    입력창에 포커스가 없을 때 <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd>로 되돌릴 수 있습니다.
                  </Bullet>
                  <div className="mt-3 rounded-xl bg-stone-50 border border-stone-200 p-3 text-xs text-stone-700 leading-relaxed">
                    <b>레벨 펼치기</b>: <Kbd>Ctrl</Kbd>+<Kbd>Alt</Kbd>+<Kbd>1~9</Kbd> 로 트리를 원하는 레벨까지 한 번에 펼칠 수 있습니다.
                  </div>
                </div>
              </Section>

              <Section id="gantt" title="간트 차트">
                <div className="space-y-4">
                  <Bullet title="바 이동/리사이즈">
                    바를 드래그하면 기간이 이동하고, 바의 좌/우 끝을 드래그하면 시작/종료일을 조정할 수 있습니다.
                  </Bullet>
                  <Bullet title="확대/축소">
                    <Kbd>+</Kbd>/<Kbd>=</Kbd> 로 확대, <Kbd>-</Kbd>/<Kbd>_</Kbd> 로 축소합니다. 화면 우측 상단의 버튼으로도 조절 가능합니다.
                  </Bullet>
                  <Bullet title="표와 선택 동기화">
                    표에서 선택한 행이 간트에서도 강조되고, 간트에서 편집(더블클릭)하면 작업 수정 모달이 열립니다.
                  </Bullet>
                </div>
              </Section>

              <Section id="filters" title="필터">
                <div className="space-y-4">
                  <Bullet title="필터 On/Off">
                    상단의 <b>필터</b> 버튼으로 전체 필터 적용을 켜고 끕니다. Off일 때는 필터가 적용되지 않습니다.
                  </Bullet>
                  <Bullet title="상태/담당자 빠른 필터">
                    필터가 On이면 상단에 상태/담당자 버튼이 나타나며, 클릭으로 즉시 필터링합니다.
                  </Bullet>
                  <Bullet title="초기화">
                    필터가 적용된 상태에서 <b>초기화</b> 버튼으로 조건을 한 번에 해제할 수 있습니다.
                  </Bullet>
                </div>
              </Section>

              <Section id="import-export" title="가져오기/내보내기/백업">
                <div className="space-y-4">
                  <Bullet title="현재 작업 가져오기/내보내기 (Excel)">
                    <b>가져오기</b>에서 Excel을 읽어 현재 프로젝트 작업을 불러오거나, <b>내보내기</b>에서 현재 프로젝트를 Excel로 저장합니다.
                  </Bullet>
                  <Bullet title="전체 데이터 백업 (JSON)">
                    <b>내보내기 → 전체 데이터 백업(JSON)</b>은 프로젝트/작업/설정까지 통째로 저장합니다.
                  </Bullet>
                  <Bullet title="전체 백업 복원 (JSON)">
                    <b>가져오기 → 전체 백업 데이터 가져오기(JSON)</b>는 현재 모든 데이터가 선택한 백업으로 <b>덮어씌워집니다</b>.
                  </Bullet>
                  <Bullet title="프로젝트 추가 가져오기 (JSON)">
                    <b>가져오기 → 프로젝트 추가 가져오기(JSON)</b>는 기존 데이터에 프로젝트를 추가합니다(여러 파일도 합치기 가능).
                  </Bullet>
                </div>
              </Section>

              <Section id="ai" title="AI 프로젝트 분석">
                <div className="space-y-4">
                  <Bullet title="기능 진입">
                    상단의 <b>보라색 반짝이 아이콘</b>을 클릭합니다.
                  </Bullet>
                  <Bullet title="API 키 설정">
                    처음 사용 시 Gemini API 키가 필요합니다. 키는 브라우저(LocalStorage)에만 저장됩니다.
                  </Bullet>
                  <Bullet title="WBS 생성 / 재분석">
                    요구사항 텍스트(또는 파일)를 입력하면 WBS를 생성합니다. 이미 작업이 있다면 <b>현재 작업 재분석</b>으로 구조를 재정렬할 수 있습니다.
                  </Bullet>
                  <Bullet title="선행관계 분석">
                    현재 작업을 기반으로 선행관계를 분석하고, 결과를 작업 의존성으로 적용할 수 있습니다.
                  </Bullet>
                </div>
              </Section>

              <Section id="settings" title="설정">
                <div className="space-y-4">
                  <Bullet title="WBS 설정 열기">
                    상단의 <b>설정(톱니)</b> 버튼을 클릭합니다.
                  </Bullet>
                  <Bullet title="표 컬럼 표시/순서">
                    표에서 보여줄 컬럼을 숨기거나 순서를 바꿀 수 있습니다(작업명은 항상 표시).
                  </Bullet>
                  <Bullet title="상태(명칭/진척도)">
                    상태를 추가/삭제하고, 상태 변경 시 자동으로 적용될 진척도(%)를 설정할 수 있습니다.
                  </Bullet>
                  <Bullet title="프로젝트 시작일">
                    프로젝트 시작일을 바꾸면 해당 프로젝트의 작업 일정이 함께 이동될 수 있습니다.
                  </Bullet>
                </div>
              </Section>

              <Section id="tips" title="팁 & 주의사항">
                <div className="space-y-4">
                  <Bullet title="전체 삭제 버튼">
                    상단의 <b>빨간 휴지통</b>은 (현재 프로젝트 기준) 작업을 모두 삭제합니다. 실행 전 백업을 권장합니다.
                  </Bullet>
                  <Bullet title="정렬/필터 상태에서 구조 변경">
                    정렬/필터가 켜져 있으면 일부 구조 변경(들여쓰기/순서 변경 등)이 제한될 수 있습니다. 구조 작업은 가능하면 필터 Off/정렬 해제 상태에서 진행하세요.
                  </Bullet>
                  <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 leading-relaxed">
                    단축키 목록은 우측의 <b>키보드 아이콘</b>으로 열고 닫을 수 있습니다.
                  </div>
                </div>
              </Section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

