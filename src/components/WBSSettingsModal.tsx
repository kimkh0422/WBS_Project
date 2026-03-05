import React, { useState, useEffect } from 'react';
import { X, Settings2 } from 'lucide-react';
import { useWBS } from '../context/WBSContext';

interface WBSSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function WBSSettingsModal({ isOpen, onClose }: WBSSettingsModalProps) {
    const { wbsSettings, updateWbsSettings } = useWBS();

    const [level1, setLevel1] = useState(wbsSettings.level1Prefix);
    const [level2, setLevel2] = useState(wbsSettings.level2Prefix);
    const [level3, setLevel3] = useState(wbsSettings.level3Prefix);
    const [maxLevel, setMaxLevel] = useState(wbsSettings.maxLevel);

    useEffect(() => {
        if (isOpen) {
            setLevel1(wbsSettings.level1Prefix);
            setLevel2(wbsSettings.level2Prefix);
            setLevel3(wbsSettings.level3Prefix);
            setMaxLevel(wbsSettings.maxLevel);
        }
    }, [isOpen, wbsSettings]);

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
            level1Prefix: level1.trim(),
            level2Prefix: level2.trim(),
            level3Prefix: level3.trim(),
            maxLevel: Number(maxLevel),
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200 border border-[var(--color-line)]">
                <div className="flex justify-between items-center p-5 border-b border-[var(--color-line)] bg-stone-50">
                    <div className="flex items-center gap-2 text-[var(--color-ink)]">
                        <Settings2 size={18} />
                        <h2 className="text-lg font-bold">WBS ID 표시 설정</h2>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-stone-200 rounded-full transition-colors text-stone-500 hover:text-[var(--color-ink)]">
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSave} className="p-6 space-y-5">
                    <div className="space-y-4">
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
                            <p className="text-[10px] text-stone-400 mt-1">예: W1, W2</p>
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
                            <p className="text-[10px] text-stone-400 mt-1">예: W1.1, W1.2</p>
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
                            <p className="text-[10px] text-stone-400 mt-1">예: T1.1.1, T1.1.2</p>
                        </div>

                        <div className="pt-2">
                            <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1.5">최대 표시 레벨</label>
                            <select
                                value={maxLevel}
                                onChange={(e) => setMaxLevel(Number(e.target.value))}
                                className="input-field bg-stone-50"
                            >
                                <option value={2}>2 레벨까지만 표시</option>
                                <option value={3}>3 레벨까지만 표시 (기본값)</option>
                                <option value={4}>4 레벨까지만 표시</option>
                                <option value={5}>5 레벨 표기 허용</option>
                            </select>
                            <p className="text-[10px] text-stone-400 mt-1">이 레벨보다 깊은 하위 작업은 ID가 표시되지 않습니다.</p>
                        </div>
                    </div>

                    <div className="pt-4 flex justify-end gap-3 border-t border-[var(--color-line)] mt-2">
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
                </form>
            </div>
        </div>
    );
}
