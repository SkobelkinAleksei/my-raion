import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import Button from '@/shared/ui/Button';
import Card from '@/shared/ui/Card';
import Container from '@/shared/ui/Container';
import { theme } from '@/shared/ui/theme';
import { apiUrl } from '@/shared/lib/runtime';

interface SignInProps {
    setPage: (page: string) => void;
    onOpenLegal?: (doc: 'privacy' | 'rules') => void;
}

export default function SignIn({ setPage, onOpenLegal }: SignInProps) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [error, setError] = useState('');

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        try {
            const res = await fetch(apiUrl('/api/v1/social/auth/login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username.trim().toLowerCase(), password })
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                if (data.errorCode === 'EMAIL_NOT_VERIFIED') {
                    try {
                        sessionStorage.setItem('myraion.verifyEmail', username.trim().toLowerCase());
                    } catch {
                        /* ignore */
                    }
                    setPage('verify-email');
                    return;
                }
                if (res.status >= 500) {
                    throw new Error('Нет связи с сервером. Обновите страницу или проверьте Wi‑Fi.');
                }
                throw new Error(data.detail || 'Неверный Email или пароль');
            }

            const data = await res.json();
            localStorage.setItem('token', data.token);
            if (data.refreshToken) {
                localStorage.setItem('refreshToken', data.refreshToken);
            }
            window.location.href = '/';
        } catch (err: any) {
            setError(err.message);
        }
    };

    return (
        <div className={`min-h-screen min-h-dvh ${theme.surface.page} flex items-center justify-center py-12 px-4`}>
            <Container className="max-w-sm w-full">
                <div className="text-center mb-6">
                    <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Вход в сеть</h1>
                </div>

                <Card className="shadow-xl">
                    <form onSubmit={handleLogin} className="space-y-4">
                        {error && (
                            <div className="p-3 text-xs bg-red-50 text-red-600 rounded-xl border border-red-100 font-medium">
                                {error}
                            </div>
                        )}

                        <div>
                            <label className="text-xs font-semibold text-slate-600 mb-1 block">Email</label>
                            <div className="relative">
                                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                                <input
                                    type="email"
                                    placeholder="name@example.com"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    className={`w-full pl-10 pr-4 py-3 text-sm bg-slate-50 border ${theme.surface.border} ${theme.radius.btn} focus:outline-none focus:ring-2 ${theme.accent.ring} focus:bg-white transition text-slate-900 placeholder:text-slate-400 min-h-11`}
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <div className="flex items-baseline justify-between mb-1 gap-3">
                                <label className="text-xs font-semibold text-slate-600">Пароль</label>
                                <button
                                    type="button"
                                    onClick={() => setPage('forgot-password')}
                                    className={`${theme.accent.text} text-xs font-semibold hover:underline bg-transparent border-none p-0 cursor-pointer shrink-0`}
                                >
                                    Забыли пароль?
                                </button>
                            </div>
                            <div className="relative">
                                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                                <input
                                    type={showPass ? 'text' : 'password'}
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    className={`w-full pl-10 pr-10 py-3 text-sm bg-slate-50 border ${theme.surface.border} ${theme.radius.btn} focus:outline-none focus:ring-2 ${theme.accent.ring} focus:bg-white transition text-slate-900 placeholder:text-slate-400 min-h-11`}
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPass(!showPass)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                                >
                                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>

                        <Button type="submit" variant="primary" className="w-full mt-2 min-h-11">
                            Войти
                        </Button>

                        <p className="text-center text-xs text-slate-500 mt-4">
                            Ещё нет аккаунта?{' '}
                            <button
                                type="button"
                                onClick={() => setPage('register')}
                                className={`${theme.accent.text} font-bold hover:underline bg-transparent border-none p-0 cursor-pointer focus:outline-none`}
                            >
                                Создать аккаунт
                            </button>
                        </p>
                        <p className="text-center text-[11px] text-slate-400 mt-3 leading-relaxed">
                            <button
                                type="button"
                                onClick={() => onOpenLegal?.('rules')}
                                className="hover:text-[#5C4B7A] underline underline-offset-2 bg-transparent border-none p-0 cursor-pointer"
                            >
                                Правила
                            </button>
                            {' · '}
                            <button
                                type="button"
                                onClick={() => onOpenLegal?.('privacy')}
                                className="hover:text-[#5C4B7A] underline underline-offset-2 bg-transparent border-none p-0 cursor-pointer"
                            >
                                Политика конфиденциальности
                            </button>
                        </p>
                    </form>
                </Card>
            </Container>
        </div>
    );
}
