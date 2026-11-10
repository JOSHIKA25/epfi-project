import React, { useEffect, useState } from 'react';
import { UserPlus, Users, UserX, UserCheck, RefreshCw } from 'lucide-react';
import type { AuthRole, AuthUser } from '../types/index.js';
import { api } from '../services/api.js';

type ManagedUser = AuthUser & { active: boolean; createdAt: number };

export const AdminUsersView: React.FC = () => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AuthRole>('OPERATOR');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setUsers((await api.fetchUsers()).users);
  useEffect(() => { void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Unable to load users.')); }, []);

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(null); setMessage(null);
    try {
      await api.createUser({ email, displayName, role, password });
      setDisplayName(''); setEmail(''); setPassword('');
      await refresh();
      setMessage('Account created. Share its login details with that demo user securely.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally { setBusy(false); }
  };

  const toggleUser = async (user: ManagedUser) => {
    setBusy(true); setError(null); setMessage(null);
    try { await api.setUserActive(user.id, !user.active); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update the account.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-950 p-4 text-slate-100">
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(280px,0.8fr)_1.2fr]">
        <section className="h-fit rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-white"><UserPlus className="h-5 w-5 text-cyan-400" />Create demo account</h2>
          <p className="mb-4 text-xs leading-relaxed text-slate-400">Create a named account for each person reviewing your demonstration.</p>
          <form onSubmit={createUser} className="space-y-3">
            <label className="block text-xs text-slate-300">Display name<input required minLength={2} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" /></label>
            <label className="block text-xs text-slate-300">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" /></label>
            <label className="block text-xs text-slate-300">Role<select value={role} onChange={(event) => setRole(event.target.value as AuthRole)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="OPERATOR">Operator · receives alarms and acknowledges</option><option value="ENGINEER">Engineer · reviews and approves tickets</option><option value="TECHNICIAN">Technician · completes approved maintenance work</option><option value="ADMIN">Admin · manages users and integrations</option></select></label>
            <label className="block text-xs text-slate-300">Temporary password (12+ characters)<input required minLength={12} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm" /></label>
            <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded bg-cyan-600 px-3 py-2 text-sm font-bold text-slate-950 disabled:opacity-50"><UserPlus className="h-4 w-4" />Create account</button>
          </form>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-base font-bold text-white"><Users className="h-5 w-5 text-cyan-400" />Accounts</h2><button onClick={() => void refresh()} className="rounded border border-slate-700 p-2 text-slate-300 hover:bg-slate-800" aria-label="Refresh accounts"><RefreshCw className="h-4 w-4" /></button></div>
          {users.map((user) => (
            <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 py-3">
              <div><div className="text-sm font-semibold text-white">{user.displayName}</div><div className="text-xs text-slate-400">{user.email} · {user.role}</div></div>
              <button disabled={busy} onClick={() => void toggleUser(user)} className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs ${user.active ? 'border-rose-800 text-rose-300 hover:bg-rose-950/50' : 'border-emerald-800 text-emerald-300 hover:bg-emerald-950/50'}`}>
                {user.active ? <><UserX className="h-3.5 w-3.5" />Disable</> : <><UserCheck className="h-3.5 w-3.5" />Enable</>}
              </button>
            </div>
          ))}
          {!users.length && <p className="py-6 text-center text-xs text-slate-500">No accounts found.</p>}
        </section>
        {message && <p role="status" className="rounded border border-emerald-800 bg-emerald-950/50 p-3 text-xs text-emerald-200 lg:col-span-2">{message}</p>}
        {error && <p role="alert" className="rounded border border-rose-800 bg-rose-950/50 p-3 text-xs text-rose-200 lg:col-span-2">{error}</p>}
      </div>
    </div>
  );
};
