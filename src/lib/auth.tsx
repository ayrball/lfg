import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile, UserSettings } from './types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  settings: UserSettings | null;
  /** Set when the profile couldn't be loaded (e.g. offline, or the Supabase project is paused). */
  loadError: string | null;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (s: Session | null) => {
    setLoadError(null);
    if (!s) {
      setProfile(null);
      setSettings(null);
      return;
    }
    const [p, st] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).single(),
      supabase.from('user_settings').select('*').eq('user_id', s.user.id).single(),
    ]);
    const err = p.error ?? st.error;
    if (err) setLoadError(err.message || 'Could not reach the server');
    setProfile((p.data as Profile) ?? null);
    setSettings((st.data as UserSettings) ?? null);

    // Keep the timezone current so quiet hours use the user's local time.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (st.data && tz && (st.data as UserSettings).timezone !== tz) {
      void supabase.from('user_settings').update({ timezone: tz }).eq('user_id', s.user.id);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await load(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Defer DB calls out of the auth callback (supabase-js recommendation).
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setTimeout(() => void load(s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const refresh = useCallback(() => load(session), [load, session]);

  return (
    <AuthContext.Provider value={{ loading, session, profile, settings, loadError, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
