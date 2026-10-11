import { useEffect, useRef, useState } from 'react';
import { searchPlaces, type PlaceResult } from '../lib/geo';
import type { LatLng } from '../lib/types';

export function PlaceSearch({ near, onSelect }: { near?: LatLng; onSelect: (p: PlaceResult) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const skipNextSearch = useRef(false);

  useEffect(() => {
    const q = query.trim();
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    if (q.length < 3) {
      setResults([]);
      setOpen(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setSearching(true);
      searchPlaces(q, near, ctrl.signal)
        .then((r) => {
          setResults(r);
          setError(null);
          setOpen(true);
        })
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setError(e.message);
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, near?.lat, near?.lng]);

  // Close when clicking or tapping anywhere outside the search box.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function choose(r: PlaceResult) {
    onSelect(r);
    skipNextSearch.current = true;
    setQuery(r.name);
    setOpen(false);
  }

  return (
    <div className="place-search" ref={boxRef}>
      <input
        type="search"
        placeholder="Search a park, court or address…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter') {
            e.preventDefault(); // don't submit the surrounding form
            if (open && results[0]) choose(results[0]);
          }
        }}
        aria-label="Search for a venue"
        aria-expanded={open}
        autoComplete="off"
      />
      {searching && <span className="place-search__spinner" aria-hidden />}
      {error && <p className="field-error">{error}</p>}
      {open && (
        <ul className="place-search__results" role="listbox">
          {results.length === 0 ? (
            <li className="place-search__empty">No places found — try another name, or tap the map.</li>
          ) : (
            results.map((r, i) => (
              <li key={`${r.lat},${r.lng},${i}`}>
                <button type="button" onClick={() => choose(r)}>
                  <strong>{r.name}</strong>
                  <span>{[r.kind, r.address].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
