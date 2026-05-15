import type { ReactNode } from 'react';
import { BookOpen, FolderKanban, LayoutGrid, Search, Share2, Sparkles } from 'lucide-react';
import { PermissionGuidePanel } from './PermissionGuidePanel';

function Section({ id, icon, title, children }: { id: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <div className="flex items-center gap-2 mb-3 text-slate-800">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
          {icon}
        </span>
        <h2 className="text-sm font-bold tracking-tight">{title}</h2>
      </div>
      <div className="pl-0 sm:pl-10 space-y-2 text-[13px] text-slate-600 leading-relaxed">{children}</div>
    </section>
  );
}

export function UserGuidePage() {
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-gradient-to-b from-slate-50/80 to-white">
      <div className="max-w-2xl mx-auto px-4 py-8 pb-24 md:pb-10 space-y-10">
        <header className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-100">
            <BookOpen size={14} aria-hidden />
            사용 안내
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">주요 사용 방법</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            프로젝트와 작업(WBS)을 한곳에서 관리합니다. 아래 순서대로 읽으면 처음 쓰기에도 수월합니다.
          </p>
        </header>

        <Section id="start" icon={<Sparkles size={16} />} title="시작하기">
          <ul className="list-disc pl-5 space-y-1.5 marker:text-indigo-400">
            <li>
              상단에서 <b>프로젝트</b>를 선택합니다. &quot;전체&quot;를 고르면 여러 프로젝트 작업을 한 화면에서 볼 수 있습니다.
            </li>
            <li>
              <b>표 · 간트 · 칸반</b> 탭으로 보는 방식만 바꿀 뿐, 같은 데이터입니다. 용도에 맞게 전환하세요.
            </li>
            <li>로그인·Supabase 연동 시 변경 사항은 서버에 반영되며, 다른 편집자에게도 실시간으로 전달될 수 있습니다.</li>
          </ul>
        </Section>

        <Section id="views" icon={<LayoutGrid size={16} />} title="화면(뷰) 전환">
          <ul className="list-disc pl-5 space-y-1.5 marker:text-indigo-400">
            <li>
              <b>대시보드</b>: 프로젝트·상태·기간 등 요약을 카드 형태로 확인합니다.
            </li>
            <li>
              <b>표</b>: 행 단위로 빠르게 입력·정렬·복사·붙여넣기하기 좋습니다.
            </li>
            <li>
              <b>간트</b>: 일정 막대를 드래그해 기간을 조정하고 흐름을 봅니다.
            </li>
            <li>
              <b>칸반</b>: 상태별 칸으로 작업을 옮기며 진행을 관리합니다.
            </li>
            <li>
              프로젝트 드롭다운의 <b>프로젝트 관리</b>에서 목록 편집·복제·삭제 등을 할 수 있습니다.
            </li>
          </ul>
        </Section>

        <Section id="filter-search" icon={<Search size={16} />} title="필터 · 검색">
          <ul className="list-disc pl-5 space-y-1.5 marker:text-indigo-400">
            <li>
              헤더의 <b>필터</b>를 켜면 프로젝트·상태·담당자·기간 등으로 작업 범위를 좁힐 수 있습니다.
            </li>
            <li>
              <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-semibold text-slate-700">Ctrl</kbd>
              <span className="mx-0.5">+</span>
              <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-semibold text-slate-700">K</kbd> 로{' '}
              <b>검색</b> 모달을 열어 작업·프로젝트로 바로 이동할 수 있습니다.
            </li>
          </ul>
        </Section>

        <Section id="collab" icon={<Share2 size={16} />} title="공유 · 가져오기 ·보내기">
          <ul className="list-disc pl-5 space-y-1.5 marker:text-indigo-400">
            <li>
              프로젝트 메뉴의 <b>공유</b>에서 멤버 초대·보기/편집 권한을 설정합니다.
            </li>
            <li>
              우측 상단 <b>⋯ 더보기</b>의 <b>가져오기</b>·<b>보내기</b>로 Excel·JSON 등 파일을 주고받을 수 있습니다. 가져오기는 편집 권한이
              있는 프로젝트에서만 사용할 수 있습니다.
            </li>
          </ul>
        </Section>

        <Section id="tips" icon={<FolderKanban size={16} />} title="단축키 · 설정">
          <ul className="list-disc pl-5 space-y-1.5 marker:text-indigo-400">
            <li>
              더보기 메뉴의 <b>단축키</b>에서 화면별 키 조합을 확인합니다. (
              <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-semibold text-slate-700">Shift</kbd>
              <span className="mx-0.5">+</span>
              <kbd className="px-1 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-semibold text-slate-700">?</kbd> 로
              패널을 열 수 있습니다.)
            </li>
            <li>
              <b>환경설정</b>에서 상태·진척도, 표 컬럼 표시 순서 등을 바꿀 수 있습니다.
            </li>
          </ul>
        </Section>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <PermissionGuidePanel />
        </div>
      </div>
    </div>
  );
}
