import React, { useEffect, useMemo } from 'react';
import { X, History, Clock, CheckCircle2 } from 'lucide-react';

interface VersionHistory {
    version: string;
    date: string;
    changes: string[];
}

function parseSemverLike(version: string): number[] {
    // "0.3.13" -> [0,3,13] (missing parts => 0). Non-numeric => 0.
    const parts = String(version)
        .trim()
        .replace(/^v/i, '')
        .split('.')
        .map((p) => {
            const n = Number.parseInt(p, 10);
            return Number.isFinite(n) ? n : 0;
        });
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
}

function compareSemverDesc(a: string, b: string): number {
    const av = parseSemverLike(a);
    const bv = parseSemverLike(b);
    for (let i = 0; i < 3; i += 1) {
        if (av[i] !== bv[i]) return bv[i] - av[i];
    }
    return 0;
}

function parseDateMaybe(value: string): number {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

function getHistoryData(): VersionHistory[] {
    try {
        const parsed = JSON.parse(__APP_CHANGELOG_JSON__) as VersionHistory[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
        /* fallback */
    }
    // docs/변경이력_주요기능.md 와 동일한 목록 (주입 실패 시 표시)
    return [
        { version: '0.3.0', date: '2026-03-17', changes: ['투입 현황·대시보드에서 인원별로 프로젝트당 몇 M/D(공수)가 투입되었는지 확인할 수 있습니다.'] },
        { version: '0.3.13', date: '2026-03-18', changes: ['로그인만 하면 관리자 승인 없이도 서버(DB)에 자동 저장·동기화됩니다.', 'Ctrl+S 즉시 반영·첫 접속 동기화는 동일합니다.'] },
        { version: '0.3.12', date: '2026-03-18', changes: ['DB 동기화 버튼을 없애고, 승인 사용자는 편집 후 자동으로 서버에 반영됩니다. 다른 편집자 변경은 Realtime으로 표시됩니다.', 'Ctrl+S는 대기 없이 즉시 서버 반영입니다.', '첫 접속 시 전체 맞춤 동기화(토스트)는 그대로입니다.'] },
        { version: '0.2.4', date: '2026-03-15', changes: ['마인드맵으로 WBS를 왼쪽에서 오른쪽 가지 형태로 볼 수 있고, 노드를 클릭해 편집·드래그로 이동·Ctrl+휠로 확대/축소할 수 있습니다.', '필터 바에서 프로젝트를 여러 개 선택해 한 화면에 함께 볼 수 있습니다.', 'DB 동기화가 끝나면 업로드/내려받기 건수가 토스트로 표시됩니다.'] },
        { version: '0.2.3', date: '2026-03-13', changes: ['DB 동기화 중 단계별 문구와 진행 막대(%)를 볼 수 있습니다.', 'DB 동기화 시 업로드 후 서버에서 다시 받아 로컬과 맞춰 주어, 다른 기기·협업 시에도 최신 내용을 반영할 수 있습니다.', '비밀번호 관리자 모드에서도 회원을 삭제할 수 있습니다.'] },
        { version: '0.2.0', date: '2026-03-10', changes: ['로그인·프로젝트 공유(멤버 초대 링크)를 사용할 수 있습니다.', '프로필을 관리하고, 관리자로 전체 프로젝트를 조회할 수 있습니다.', '공수를 0.5일·1.5일처럼 소수로 입력할 수 있습니다.', '프로필 이름·레벨별 색상을 설정할 수 있습니다.'] },
        { version: '0.1.0', date: '2026-03-06', changes: ['메뉴·툴팁·모달이 한글로 표시됩니다.', '프로젝트 선택 화면 가독성이 개선되었습니다.', '로고·새로고침, 단축키 사이드바 표시/숨김, 푸터·라이선스 정보를 사용할 수 있습니다.', '상태 이름을 바꾸고 상태별 진척도가 자동 반영됩니다.', '칸반에서 카드 이름 수정·삭제와 전체 프로젝트 보기를 할 수 있습니다.', 'AI 작업 분석/자동 생성, Excel/JSON 가져오기·내보내기를 사용할 수 있습니다.'] }
    ];
}

const HISTORY_DATA = getHistoryData();

interface VersionManagerProps {
    isOpen: boolean;
    onClose: () => void;
    currentVersion: string;
}

export function VersionManager({ isOpen, onClose, currentVersion }: VersionManagerProps) {
    if (!isOpen) return null;

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const commitDateText = (() => {
        try {
            const d = new Date(__APP_COMMIT_DATE__);
            if (Number.isNaN(d.getTime())) return __APP_COMMIT_DATE__;
            return d.toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            });
        } catch {
            return __APP_COMMIT_DATE__;
        }
    })();

    const commitDateFullText = (() => {
        try {
            const d = new Date(__APP_COMMIT_DATE__);
            if (Number.isNaN(d.getTime())) return __APP_COMMIT_DATE__;
            return d.toLocaleString('ko-KR', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        } catch {
            return __APP_COMMIT_DATE__;
        }
    })();

    const historySorted = useMemo(() => {
        const data = [...HISTORY_DATA];
        data.sort((a, b) => {
            // Prefer version desc; if same, date desc; then stable by original text
            const byVer = compareSemverDesc(a.version, b.version);
            if (byVer !== 0) return byVer;
            const byDate = parseDateMaybe(b.date) - parseDateMaybe(a.date);
            if (byDate !== 0) return byDate;
            return String(b.version).localeCompare(String(a.version), 'en');
        });
        return data;
    }, []);

    const currentVersionKey = String(currentVersion).trim().replace(/^v/i, '');

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
            role="dialog"
            aria-modal="true"
            aria-label="버전 히스토리"
            onMouseDown={(e) => {
                // backdrop click => close
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[85vh]"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <History size={18} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-stone-800">버전 히스토리</h2>
                            <p className="text-[11px] text-stone-400 font-medium">현재 버전: v{currentVersion}</p>
                            <p className="text-[11px] text-stone-400 font-medium" title={commitDateFullText}>수정일: {commitDateText}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-stone-200 rounded-full text-stone-400 transition-colors"
                        aria-label="닫기"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin">
                    {historySorted.map((item, index) => {
                        const isCurrent = String(item.version).trim().replace(/^v/i, '') === currentVersionKey;
                        return (
                        <div key={item.version} className="relative pl-8">
                            {/* Timeline Connector */}
                            {index !== historySorted.length - 1 && (
                                <div className="absolute left-[11px] top-6 bottom-[-32px] w-[2px] bg-stone-100" />
                            )}

                            {/* Version Point */}
                            <div
                                className={[
                                    'absolute left-0 top-1 w-6 h-6 rounded-full bg-white border-4 z-10 box-border',
                                    isCurrent ? 'border-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]' : 'border-blue-500',
                                ].join(' ')}
                                aria-hidden
                            />

                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <span
                                        className={[
                                            'text-sm font-black px-2 py-0.5 rounded border',
                                            isCurrent ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : 'text-blue-600 bg-blue-50 border-blue-100',
                                        ].join(' ')}
                                    >
                                        v{item.version}
                                    </span>
                                    {isCurrent && (
                                        <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                            현재
                                        </span>
                                    )}
                                    <div className="flex items-center gap-1.5 text-stone-400">
                                        <Clock size={12} />
                                        <span className="text-xs font-medium">{item.date}</span>
                                    </div>
                                </div>

                                <ul className="space-y-2.5">
                                    {item.changes.map((change, cIndex) => (
                                        <li key={cIndex} className="flex items-start gap-2.5 text-stone-600 text-[13px] leading-relaxed group">
                                            <CheckCircle2 size={14} className="mt-0.5 text-stone-200 group-hover:text-emerald-400 transition-colors shrink-0" />
                                            <span>{change.replace(/\*\*(.*?)\*\*/g, '$1')}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )})}
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
