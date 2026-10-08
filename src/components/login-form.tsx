'use client';

import { useEffect, useState } from 'react';
import { api } from './client-api';
import { Spinner } from './ui';

export function LoginForm({ googleEnabled, initialError }: { googleEnabled: boolean; initialError: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  // disabled until hydrated, so an early tap can't fall back to a native form submit
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { body: { email, password } });
      window.location.href = '/';
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} method="post" action="#" className="card space-y-3 p-4">
        <label className="block">
          <span className="label">ایمیل</span>
          <input className="field ltr" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">رمز عبور</span>
          <input className="field ltr" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <button className="btn-primary w-full" disabled={busy || !ready}>
          {busy && <Spinner />} ورود
        </button>
      </form>
      {googleEnabled && (
        <a href="/api/auth/google" className="btn-ghost w-full">
          ورود با Google (فقط حساب مالک)
        </a>
      )}
    </div>
  );
}
