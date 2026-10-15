import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameState } from '../../shared/types';
import { roomFromUrl, useRoom, useTicker } from '../common/socket';
import { sounds, unlockAudio } from '../common/sounds';
import { Board, FinalScene, H, Header, Lobby, QuestionScene, RoundIntro, Scoreboard, Scores, W } from './scenes';

const BINDINGS_KEY = 'trivia.buzzers';

function loadBindings(): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(BINDINGS_KEY) ?? 'null');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function saveBindings(b: string[] | null) {
  try {
    if (b) localStorage.setItem(BINDINGS_KEY, JSON.stringify(b));
    else localStorage.removeItem(BINDINGS_KEY);
  } catch {
    /* storage unavailable */
  }
}

function matches(binding: string, e: KeyboardEvent): boolean {
  return binding === e.code || binding.toLowerCase() === e.key.toLowerCase();
}

export function App() {
  const room = roomFromUrl();
  const { snapshot, status, send } = useRoom(room, 'display');
  const [started, setStarted] = useState(false);
  const [setup, setSetup] = useState<{ index: number; keys: string[] } | null>(null);
  const [bindings, setBindings] = useState<string[] | null>(loadBindings);
  const [testFlash, setTestFlash] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<{ kind: string; player: number | null; seq: number } | null>(null);
  const [mediaPlaying, setMediaPlaying] = useState(false);

  const state = snapshot?.state;
  const view = snapshot?.view;
  const live = useRef<{ state?: GameState; bindings: string[] | null; setup: typeof setup }>({ bindings, setup });
  live.current = { state, bindings, setup };
  const lockUntil = useRef<number[]>([]);

  const cur = state?.current;
  const timing = !!(cur && (cur.buzzOpen || cur.answerDeadline));
  const tick = useTicker(timing, 100);
  const now = tick + (snapshot?.offset ?? 0);

  // ---- Buzzer input ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const { state: s, bindings: b, setup: su } = live.current;
      if (su) {
        e.preventDefault();
        if (e.key === 'Escape') return setSetup(null);
        const keys = [...su.keys, e.code || e.key];
        const total = s?.players.length || 4;
        if (keys.length >= total) {
          saveBindings(keys);
          setBindings(keys);
          setSetup(null);
          sounds.correct();
        } else {
          setSetup({ index: su.index + 1, keys });
          sounds.test();
        }
        return;
      }
      if (!s) return;
      const keys = s.players.map((p, i) => b?.[i] ?? p.key);
      const player = keys.findIndex((k) => matches(k, e));
      if (player < 0) return;
      e.preventDefault();
      const c = s.current;
      const t = performance.now();
      if (s.phase === 'question' && c && !c.revealed) {
        if (c.buzzOpen) {
          if ((lockUntil.current[player] ?? 0) > t) return;
          send({ t: 'action', action: { type: 'buzz', player } });
        } else if (c.buzzer === null && !c.dailyDouble) {
          // Jumped the gun: brief lockout, like the real thing.
          const ms = snapshot?.view.game?.settings.earlyBuzzLockoutMs ?? 250;
          lockUntil.current[player] = t + ms;
        }
        return;
      }
      // Outside a question: button test.
      setTestFlash(player);
      sounds.test();
      setTimeout(() => setTestFlash((f) => (f === player ? null : f)), 400);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send]);

  // ---- Sounds & flashes ----
  const lastEvent = useRef<number>(-1);
  useEffect(() => {
    const ev = state?.event;
    if (!ev || ev.seq === lastEvent.current) return;
    const first = lastEvent.current === -1;
    lastEvent.current = ev.seq;
    if (first) return; // don't replay on (re)connect
    sounds[ev.kind]?.();
    if (ev.kind === 'correct' || ev.kind === 'wrong') {
      setOverlay(ev);
      setTimeout(() => setOverlay((o) => (o?.seq === ev.seq ? null : o)), 1400);
    }
  }, [state?.event?.seq]);

  const wasOpen = useRef(false);
  useEffect(() => {
    const open = !!cur?.buzzOpen;
    if (open && !wasOpen.current) sounds.open();
    wasOpen.current = open;
  }, [cur?.buzzOpen]);

  useEffect(() => {
    setMediaPlaying(false);
    setOverlay(null);
  }, [cur?.qid]);

  // ---- Start (needed for sound + fullscreen) ----
  const start = async () => {
    unlockAudio();
    setStarted(true);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* not allowed — fine */
    }
    try {
      await (navigator as Navigator & { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock?.request('screen');
    } catch {
      /* not supported */
    }
  };

  let scene = null;
  if (state && view) {
    const props = { state, view, now, mediaPlaying, onMediaPlaying: setMediaPlaying, room };
    switch (state.phase) {
      case 'lobby':
        scene = <Lobby view={view} room={room} />;
        break;
      case 'round-intro':
        scene = <RoundIntro view={view} />;
        break;
      case 'board':
        scene = <Board view={view} />;
        break;
      case 'question':
        scene = <QuestionScene {...props} />;
        break;
      case 'final':
        scene = <FinalScene {...props} />;
        break;
      case 'scores':
        scene = <Scores state={state} gameOver={false} />;
        break;
      case 'gameover':
        scene = <Scores state={state} gameOver />;
        break;
    }
  }

  const ovPlayer = overlay?.player != null ? state?.players[overlay.player] : null;

  return (
    <div class={`stage ${started ? "started" : ""}`} onDblClick={() => setStarted(false)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" class="screen" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="bg" cx="50%" cy="35%" r="75%">
            <stop offset="0%" stop-color="#1c3aa9" />
            <stop offset="60%" stop-color="#0a1550" />
            <stop offset="100%" stop-color="#040824" />
          </radialGradient>
          <pattern id="dots" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="20" r="1.6" fill="#ffffff" opacity="0.06" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#bg)" />
        <rect width={W} height={H} fill="url(#dots)" />
        {view && state?.phase !== 'lobby' && <Header view={view} />}
        <g key={`${state?.phase}-${state?.roundIndex}-${cur?.qid ?? ''}`} class="scene">
          {scene ?? (
            <text x={W / 2} y={H / 2} text-anchor="middle" class="sub">
              Connecting…
            </text>
          )}
        </g>
        {state && <Scoreboard state={state} flash={testFlash} />}
        {overlay && (
          <g class={`flash ${overlay.kind}`}>
            <rect width={W} height={H} class="flash-bg" />
            <text x={W / 2} y={H / 2 - 10} text-anchor="middle" class="flash-text">
              {overlay.kind === 'correct' ? 'CORRECT!' : '✖'}
            </text>
            {ovPlayer && (
              <text x={W / 2} y={H / 2 + 110} text-anchor="middle" class="flash-sub">
                {ovPlayer.name}
              </text>
            )}
          </g>
        )}
        {status !== 'open' && (
          <g>
            <circle cx={W - 30} cy={30} r={10} fill="#ff4d5e" />
          </g>
        )}
      </svg>

      {!started && (
        <div class="start">
          <h1>{view?.game?.title ?? 'Trivia'} — Display</h1>
          <p>
            Room <b>{room}</b> · {status === 'open' ? 'connected' : status}
          </p>
          <button class="big" onClick={start}>
            ▶ Start display
          </button>
          <p class="small">Starts full screen and enables sound. Buzzers are read from this computer's keyboard input.</p>
          <div class="row">
            <button onClick={() => setSetup({ index: 0, keys: [] })}>Set up buzzers</button>
            {bindings && (
              <button
                onClick={() => {
                  saveBindings(null);
                  setBindings(null);
                }}
              >
                Use default keys
              </button>
            )}
          </div>
          {state && (
            <p class="small">
              Keys: {state.players.map((p, i) => `${p.name} = ${bindings?.[i] ?? p.key}`).join(' · ')}
            </p>
          )}
        </div>
      )}

      {setup && (
        <div class="start setup">
          <h1>Buzzer setup</h1>
          <p class="big-text">
            Press the button for <b>{state?.players[setup.index]?.name ?? `Player ${setup.index + 1}`}</b>
          </p>
          <p class="small">
            {setup.index + 1} of {state?.players.length || 4} · Esc to cancel
          </p>
        </div>
      )}
    </div>
  );
}
