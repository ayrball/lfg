import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { emailRedirectUrl, signInWithGoogle } from '../lib/native';

export function Login({ embedded = false }: { embedded?: boolean }) {
  const [mode, setMode] = useState<'signin' | 'signup'>(embedded ? 'signup' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: name.trim() }, emailRedirectTo: emailRedirectUrl() },
      });
      if (error) setError(error.message);
      else if (!data.session) setInfo('Check your email to confirm your account, then sign in.');
    }
    setBusy(false);
  }

  async function google() {
    const { error } = await signInWithGoogle();
    if (error) setError(error.message);
  }

  return (
    <div className={embedded ? 'auth auth--embedded' : 'auth'}>
      {!embedded && (
        <div className="auth__hero">
          <img src="/logo.svg" alt="" width={64} height={64} />
          <h1>Pickup</h1>
          <p>Find a game near you — or host one and fill it in minutes.</p>
        </div>
      )}
      <div className="card">
        <div className="segmented">
          <button aria-pressed={mode === 'signin'} onClick={() => setMode('signin')}>
            Sign in
          </button>
          <button aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>
            Create account
          </button>
        </div>
        <form className="form" onSubmit={submit}>
          {mode === 'signup' && (
            <label>
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoComplete="nickname" />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>
          {error && <p className="error">{error}</p>}
          {info && <p className="notice">{info}</p>}
          <button className="btn btn--primary btn--block" disabled={busy}>
            {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="divider">or</div>
        <button className="btn btn--outline btn--block" onClick={google}>
          Continue with Google
        </button>
      </div>
    </div>
  );
}
