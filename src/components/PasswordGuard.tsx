import React, { useState, useEffect } from 'react';
import { Lock, ArrowRight } from 'lucide-react';

export function PasswordGuard({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
    const [password, setPassword] = useState('');
    const [error, setError] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem('wbs-auth');
        if (saved === 'true') {
            setIsAuthenticated(true);
        } else {
            setIsAuthenticated(false);
        }
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (password === '6502') {
            localStorage.setItem('wbs-auth', 'true');
            setIsAuthenticated(true);
            setError(false);
        } else {
            setError(true);
            setPassword('');
        }
    };

    if (isAuthenticated === null) return null; // Initial check
    if (isAuthenticated) return <>{children}</>;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-stone-900 overflow-hidden">
            {/* Dynamic Background Elements */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[120px] animate-pulse" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px] animate-pulse delay-700" />

            <div className="relative w-full max-w-md p-8">
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl overflow-hidden group">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-600 opacity-50" />

                    <div className="flex flex-col items-center text-center space-y-6">
                        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform duration-300">
                            <Lock className="text-white w-8 h-8" />
                        </div>

                        <div className="space-y-2">
                            <h1 className="text-2xl font-bold text-white tracking-tight">WBS 매니저</h1>
                            <p className="text-stone-400 text-sm">시스템 보안을 위해 암호를 입력해 주세요.</p>
                        </div>

                        <form onSubmit={handleSubmit} className="w-full space-y-4">
                            <div className="relative">
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        if (error) setError(false);
                                    }}
                                    placeholder="암호 입력"
                                    className={`w-full bg-white/5 border ${error ? 'border-red-500/50 bg-red-500/5' : 'border-white/10 group-focus-within:border-blue-500/50'} text-white rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-center tracking-[0.5em] text-lg font-medium`}
                                    autoFocus
                                />
                                {error && (
                                    <p className="absolute -bottom-6 left-0 right-0 text-red-500 text-[10px] font-bold animate-bounce text-center">
                                        잘못된 암호입니다. 다시 시도해 주세요.
                                    </p>
                                )}
                            </div>

                            <button
                                type="submit"
                                className="w-full bg-white text-stone-900 font-bold py-3.5 rounded-xl hover:bg-stone-100 active:scale-95 transition-all flex items-center justify-center gap-2 group/btn"
                            >
                                진입하기
                                <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                            </button>
                        </form>

                        <div className="pt-4">
                            <p className="text-[10px] text-stone-500 uppercase tracking-widest font-medium">EST. 2024 • GMT WBS ENGINE</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
