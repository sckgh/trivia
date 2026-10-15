import { useEffect, useRef, useState } from 'preact/hooks';
import type { ClientMessage, GameState, Role, ServerMessage, View } from '../../shared/types';

export interface Snapshot {
  state: GameState;
  view: View;
  canUndo: boolean;
  /** serverTime - clientTime, for countdowns. */
  offset: number;
}

export type Status = 'connecting' | 'open' | 'closed' | 'denied';

export interface Connection {
  snapshot: Snapshot | null;
  status: Status;
  error: string | null;
  send: (msg: ClientMessage) => void;
}

/** WebSocket to a room, with automatic reconnection and keep-alive. */
export function useRoom(room: string | null, role: Role, pin?: string): Connection {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!room) return;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      setStatus('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const qs = new URLSearchParams({ role });
      if (pin) qs.set('pin', pin);
      const ws = new WebSocket(`${proto}://${location.host}/api/room/${encodeURIComponent(room)}/ws?${qs}`);
      wsRef.current = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        retry = 0;
        setStatus('open');
        setError(null);
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 20000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.t === 'state') {
          setSnapshot((prev) =>
            prev && prev.state.seq > msg.state.seq && prev.state.gameId === msg.state.gameId
              ? prev
              : { state: msg.state, view: msg.view, canUndo: msg.canUndo, offset: msg.now - Date.now() },
          );
        } else if (msg.t === 'error') {
          setError(msg.message);
          setTimeout(() => setError((e) => (e === msg.message ? null : e)), 4000);
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (stopped) return;
        // A host connection refused before opening is almost always a wrong PIN.
        if (!opened && role === 'host' && retry >= 1) {
          setStatus('denied');
          return;
        }
        setStatus('closed');
        retry++;
        timer = setTimeout(connect, Math.min(5000, 300 * 2 ** retry));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, [room, role, pin]);

  const send = (msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  return { snapshot, status, error, send };
}

/** Re-render every `ms` while `active` (for countdowns). */
export function useTicker(active: boolean, ms = 100): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

export function roomFromUrl(): string {
  const q = new URLSearchParams(location.search).get('room');
  return (q || 'MAIN').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16) || 'MAIN';
}
