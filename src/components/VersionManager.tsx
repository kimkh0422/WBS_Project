import React from 'react';
import { X, History, Tag, Clock, CheckCircle2 } from 'lucide-react';

interface VersionHistory {
    version: string;
    date: string;
    changes: string[];
}

const HISTORY_DATA: VersionHistory[] = [
    {
        version: '1.2.0',
        date: '2026-03-06',
        changes: [
            'UI 한글화 (메뉴, 툴팁, 모달 등)',
            '프로젝트 선택 UI 개선 (가독성 강화)',
            '로고 디자인 조정 및 새로고침 기능 추가',
            '단축키 사이드바 표시/숨김 옵션 추가',
            '하단 푸터 구성 및 라이선스 정보 추가'
        ]
    },
    {
        version: '1.1.0',
        date: '2026-03-05',
        changes: [
            '상태 명칭 커스텀 기능 추가',
            '상태별 자동 진척도 연동 시스템 구현',
            '칸반 보드 내 카드 삭제 및 이름 수정 기능',
            '전체 프로젝트 보기 모드 추가'
        ]
    },
    {
        version: '1.0.0',
        date: '2026-03-01',
        changes: [
            'WBS 매니저 최초 런칭',
            'WBS 목록 및 간트 차트 연동',
            'AI 작업 분석 및 자동 생성 기능',
            'Excel/JSON 데이터 가져오기 및 내보내기'
        ]
    }
];

interface VersionManagerProps {
    isOpen: boolean;
    onClose: () => void;
    currentVersion: string;
}

export function VersionManager({ isOpen, onClose, currentVersion }: VersionManagerProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[80vh]">
                <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <History size={18} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-stone-800">버전 히스토리</h2>
                            <p className="text-[11px] text-stone-400 font-medium">현재 버전: v{currentVersion}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-stone-200 rounded-full text-stone-400 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin">
                    {HISTORY_DATA.map((item, index) => (
                        <div key={item.version} className="relative pl-8">
                            {/* Timeline Connector */}
                            {index !== HISTORY_DATA.length - 1 && (
                                <div className="absolute left-[11px] top-6 bottom-[-32px] w-[2px] bg-stone-100" />
                            )}

                            {/* Version Point */}
                            <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-white border-4 border-blue-500 z-10 box-border" />

                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <span className="text-sm font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                        v{item.version}
                                    </span>
                                    <div className="flex items-center gap-1.5 text-stone-400">
                                        <Clock size={12} />
                                        <span className="text-xs font-medium">{item.date}</span>
                                    </div>
                                </div>

                                <ul className="space-y-2.5">
                                    {item.changes.map((change, cIndex) => (
                                        <li key={cIndex} className="flex items-start gap-2.5 text-stone-600 text-[13px] leading-relaxed group">
                                            <CheckCircle2 size={14} className="mt-0.5 text-stone-200 group-hover:text-emerald-400 transition-colors shrink-0" />
                                            <span>{change}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-4 bg-stone-50 border-t border-stone-100 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-stone-800 hover:bg-stone-900 text-white rounded-xl text-sm font-bold transition-all active:scale-95 shadow-lg shadow-stone-200"
                    >
                        확인
                    </button>
                </div>
            </div>
        </div>
    );
}
