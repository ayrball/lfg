import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib/supabase';
import { reportUser } from '../lib/safety';

const REASONS = ['No-show', 'Rude or aggressive', 'Unsafe play', 'Harassment', 'Spam or scam', 'Other'];

export interface PlayerTarget {
  userId: string;
  name: string;
  messageId?: number;
}

/**
 * Bottom-sheet style dialog with safety actions for another player:
 * report, block, and (for the host) remove from the game.
 */
export function PlayerActions({
  target,
  gameId,
  canRemove,
  isBlocked,
  onClose,
  onBlock,
  onUnblock,
  onRemove,
}: {
  target: PlayerTarget | null;
  gameId: string;
  canRemove: boolean;
  isBlocked: boolean;
  onClose: () => void;
  onBlock: (id: string) => Promise<void>;
  onUnblock: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<'menu' | 'report' | 'done'>('menu');
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (target && !d.open) {
      setView('menu');
      setDetails('');
      setError(null);
      d.showModal();
    }
    if (!target && d.open) d.close();
  }, [target]);

  async function run(fn: () => Promise<void>, close = true) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (close) onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {target && (
        <div className="sheet__body">
          <h2>{target.name}</h2>
          {view === 'menu' && (
            <div className="stack">
              {canRemove && (
                <button
                  className="btn btn--outline btn--danger"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Remove ${target.name} from this game? They won't be able to rejoin.`)) {
                      void run(() => onRemove(target.userId));
                    }
                  }}
                >
                  Remove from game
                </button>
              )}
              <button className="btn btn--outline" disabled={busy} onClick={() => setView('report')}>
                🚩 Report {target.messageId ? 'this message' : 'player'}
              </button>
              {isBlocked ? (
                <button className="btn btn--outline" disabled={busy} onClick={() => run(() => onUnblock(target.userId))}>
                  Unblock
                </button>
              ) : (
                <button
                  className="btn btn--outline"
                  disabled={busy}
                  onClick={() => run(() => onBlock(target.userId))}
                  title="You won't see their messages, and you won't be pinged about games they host"
                >
                  🚫 Block
                </button>
              )}
              <p className="hint">
                Blocking hides their chat messages and stops pings about their games. They aren't told.
              </p>
            </div>
          )}
          {view === 'report' && (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await reportUser({
                    reportedUserId: target.userId,
                    gameId,
                    messageId: target.messageId,
                    reason: details.trim() ? `${reason}: ${details.trim()}` : reason,
                  });
                  setView('done');
                }, false);
              }}
            >
              <label>
                What happened?
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>
                  Details <span className="muted">(optional)</span>
                </span>
                <textarea rows={3} maxLength={400} value={details} onChange={(e) => setDetails(e.target.value)} />
              </label>
              <button className="btn btn--primary" disabled={busy}>
                Send report
              </button>
            </form>
          )}
          {view === 'done' && (
            <div className="stack">
              <p>Thanks — we'll review this report. You can also block them so you don't see them again.</p>
              {!isBlocked && (
                <button className="btn btn--outline" disabled={busy} onClick={() => run(() => onBlock(target.userId))}>
                  🚫 Block {target.name}
                </button>
              )}
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </dialog>
  );
}
