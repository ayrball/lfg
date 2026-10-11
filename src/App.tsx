import { lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { supabase, supabaseConfigured } from './lib/supabase';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Welcome } from './pages/Welcome';
import { PublicGame } from './pages/PublicGame';
import { Landing } from './pages/Landing';
import { initNative, isNative } from './lib/native';
import { onNativeNotificationTap, refreshNativePush } from './lib/push';

const Feed = lazy(() => import('./pages/Feed').then((m) => ({ default: m.Feed })));
const HostGame = lazy(() => import('./pages/HostGame').then((m) => ({ default: m.HostGame })));
const EditGame = lazy(() => import('./pages/EditGame').then((m) => ({ default: m.EditGame })));
const GameDetail = lazy(() => import('./pages/GameDetail').then((m) => ({ default: m.GameDetail })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const Notifications = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.Notifications })));

/** Deep links, notification taps and the Android back button (no-ops on the website). */
function NativeBridge() {
  const navigate = useNavigate();
  const { session } = useAuth();
  useEffect(() => {
    const offNative = initNative((path) => navigate(path));
    const offTap = onNativeNotificationTap((path) => navigate(path));
    return () => {
      offNative();
      offTap();
    };
  }, [navigate]);
  useEffect(() => {
    if (session) void refreshNativePush();
  }, [session?.user.id]);
  return null;
}

function Routed() {
  const { loading, session, profile, loadError } = useAuth();
  if (loading) return <div className="splash">Loading…</div>;
  // Signed-out users stay on the URL they opened, so shared game links work
  // after signing in. Game links show a public preview first.
  if (!session) {
    const gameId = window.location.pathname.match(/^\/games\/([0-9a-f-]{36})\/?$/i)?.[1];
    if (gameId) return <PublicGame gameId={gameId} />;
    // The website gets a landing page; the apps go straight to sign-in.
    return isNative || window.location.pathname !== '/' ? <Login /> : <Landing />;
  }
  if (loadError) return <Unreachable message={loadError} />;
  if (profile && !profile.onboarded) return <Welcome />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Feed />} />
        <Route path="host" element={<HostGame />} />
        <Route path="games/:id" element={<GameDetail />} />
        <Route path="games/:id/edit" element={<EditGame />} />
        <Route path="me" element={<Profile />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Unreachable({ message }: { message: string }) {
  const { refresh } = useAuth();
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="auth">
      <div className="card stack">
        <h1>Can't reach Pickup</h1>
        <p className="muted">Check your connection and try again. ({message})</p>
        <button
          className="btn btn--primary"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            await refresh();
            setRetrying(false);
          }}
        >
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
        <button className="btn btn--ghost" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="auth">
      <div className="card">
        <h1>Almost there</h1>
        <p>
          Supabase isn't configured. Copy <code>.env.example</code> to <code>.env.local</code>, fill in{' '}
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_KEY</code>, and restart the dev server.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  if (!supabaseConfigured) return <NotConfigured />;
  return (
    <AuthProvider>
      <BrowserRouter>
        <NativeBridge />
        <Routed />
      </BrowserRouter>
    </AuthProvider>
  );
}
