import React, { useState } from 'react';
import { Activity, KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import type { AuthUser } from '../types/index.js';
import { api } from '../services/api.js';

interface LoginViewProps {
  configured: boolean;
  onLogin: (user: AuthUser) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ configured, onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await api.login(email, password);
      onLogin(response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="rounded-xl bg-cyan-950 p-2.5 text-cyan-300"><Activity className="h-6 w-6" /></div>
          <div>
            <h1 className="text-lg font-bold text-white">IndustrialTwin sign in</h1>
            <p className="text-xs text-slate-400">Use your project account to open the control-room demo.</p>
          </div>
        </div>

        {!configured ? (
          <div className="rounded-lg border border-amber-700 bg-amber-950/50 p-4 text-sm text-amber-100">
            <div className="mb-2 flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" />Set up the first admin account</div>
            <p className="text-xs leading-relaxed">Add <code>AUTH_ADMIN_EMAIL</code> and <code>AUTH_ADMIN_PASSWORD</code> to your local <code>.env</code> file, then restart the app. Use a password with at least 12 characters. The app stores a salted password hash, not the password itself.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-xs font-semibold text-slate-300">Email
              <input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500" />
            </label>
            <label className="block text-xs font-semibold text-slate-300">Password
              <input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500" />
            </label>
            {error && <p role="alert" className="rounded border border-rose-800 bg-rose-950/50 p-2 text-xs text-rose-200">{error}</p>}
            <button disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-cyan-500 disabled:opacity-50">
              <LogIn className="h-4 w-4" />{isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        <div className="mt-5 border-t border-slate-800 pt-4 text-[11px] text-slate-400">
          <div className="mb-2 flex items-center gap-1.5 text-slate-300"><ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />Role-based demo access</div>
          Operator monitors and injects simulated faults · Engineer reviews work orders · Admin manages accounts.
        </div>
      </section>
    </main>
  );
};
