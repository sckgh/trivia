import { useEffect, useState } from 'preact/hooks';
import type { HostAction, PlayerState, View } from '../../shared/types';
import type { GameState } from '../../shared/types';
import { useRoom, useTicker } from '../common/socket';

const AUTH_KEY = 'trivia.host';

interface Auth {
  room: string;
  pin: string;
}

function loadAuth(): Auth | null {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function App() {
  const [auth, setAuth] = useState<Auth | null>(loadAuth);
  if (!auth) return <Login onLogin={setAuth} />;
  return (
    <Console
      auth={auth}
      onLogout={() => {
        try {
          localStorage.removeItem(AUTH_KEY);
        } catch {
          /* ignore */
        }
        setAuth(null);
      }}
    />
  );
}

function Login({ onLogin }: { onLogin: (a: Auth) => void }) {
  const params = new URLSearchParams(location.search);
  const [room, setRoom] = useState(params.get('room')?.toUpperCase() ?? 'MAIN');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/pin', { method: 'POST', body: JSON.stringify({ pin }) }).catch(() => null);
    setBusy(false);
    if (!res) return setError('Could not reach the server');
    if (res.status === 403) return setError('Wrong PIN');
    if (!res.ok) return setError((await res.text()) || 'Server error');
    const a = { room: room.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16) || 'MAIN', pin };
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(a));
    } catch {
      /* ignore */
    }
    onLogin(a);
  };

  return (
    <form class="login" onSubmit={submit}>
      <h1>Host console</h1>
      <label>
        Room code
        <input value={room} onInput={(e) => setRoom((e.target as HTMLInputElement).value.toUpperCase())} maxLength={16} autoCapitalize="characters" />
      </label>
      <label>
        Host PIN
        <input type="password" inputMode="numeric" value={pin} onInput={(e) => setPin((e.target as HTMLInputElement).value)} autoFocus />
      </label>
      {error && <p class="error">{error}</p>}
      <button class="btn primary big" disabled={busy}>
        {busy ? 'Checking…' : 'Enter'}
      </button>
      <p class="muted">
        Open the display at <code>/display?room={room || 'MAIN'}</code> on the projector PC.
      </p>
    </form>
  );
}

type Send = (a: HostAction) => void;

function Console({ auth, onLogout }: { auth: Auth; onLogout: () => void }) {
  const { snapshot, status, error, send: raw } = useRoom(auth.room, 'host', auth.pin);
  const send: Send = (action) => raw({ t: 'action', action });
  const undo = () => raw({ t: 'undo' });
  const [menu, setMenu] = useState(false);

  const state = snapshot?.state;
  const view = snapshot?.view;

  // Keyboard shortcuts (for a host on a laptop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (!state) return;
      const c = state.current;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') return (e.preventDefault(), undo());
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!c) return;
      if (k === ' ' && !c.buzzOpen && c.buzzer === null && !c.revealed && !c.dailyDouble) send({ type: 'openBuzzers' });
      else if (k === 'c' && c.buzzer !== null) send({ type: 'correct' });
      else if (k === 'x' && c.buzzer !== null) send({ type: 'wrong' });
      else if (k === 'r' && !c.revealed) send({ type: 'reveal' });
      else if (k === 'n' && c.revealed && state.phase === 'question') send({ type: 'done' });
      else if (k === 'p') send({ type: 'media', action: 'play' });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (status === 'denied') {
    return (
      <div class="login">
        <p class="error">Could not join room {auth.room}. Check the PIN.</p>
        <button class="btn big" onClick={onLogout}>
          Back
        </button>
      </div>
    );
  }
  if (!state || !view) return <div class="login muted">Connecting to room {auth.room}…</div>;

  return (
    <div class="console">
      <header class="topbar">
        <span class={`dot ${status}`} title={status} />
        <div class="where">
          <b>{view.game?.title ?? 'No game loaded'}</b>
          <span>
            Room {auth.room}
            {view.round ? ` · ${view.round.title} (${view.round.index + 1}/${view.round.count})` : ''}
          </span>
        </div>
        <button class="btn" disabled={!snapshot.canUndo} onClick={undo} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button class="btn" onClick={() => setMenu(!menu)} aria-expanded={menu}>
          ☰
        </button>
      </header>
      {menu && <Menu state={state} view={view} send={send} close={() => setMenu(false)} onLogout={onLogout} room={auth.room} />}
      {error && <div class="toast">{error}</div>}

      <main class="layout">
        <section class="primary">
          <Phase state={state} view={view} send={send} now={Date.now() + snapshot.offset} />
        </section>
        <aside class="side">
          <Players state={state} send={send} />
          <p class="muted keys">Keys: Space open buzzers · C correct · X wrong · R reveal · N next · P play · Ctrl+Z undo</p>
        </aside>
      </main>
    </div>
  );
}

function Menu({ state, view, send, close, onLogout, room }: { state: GameState; view: View; send: Send; close: () => void; onLogout: () => void; room: string }) {
  const act = (a: HostAction) => {
    send(a);
    close();
  };
  const display = `${location.origin}/display?room=${room}`;
  return (
    <div class="menu">
      {view.round && (
        <div class="menu-group">
          <b>Jump to round</b>
          {Array.from({ length: view.round.count }, (_, i) => (
            <button class={`btn ${i === state.roundIndex ? 'current' : ''}`} onClick={() => act({ type: 'goToRound', index: i })}>
              {i + 1}
            </button>
          ))}
        </div>
      )}
      <div class="menu-group">
        {state.gameId && <button class="btn" onClick={() => act({ type: 'showScores' })}>Show scores</button>}
        {state.gameId && <button class="btn" onClick={() => act({ type: 'endGame' })}>End game</button>}
        <button
          class="btn danger"
          onClick={() => confirm('Reset the room and return to the lobby? Scores will be lost (Undo can restore).') && act({ type: 'reset' })}
        >
          Reset room
        </button>
        <button class="btn" onClick={onLogout}>
          Log out
        </button>
      </div>
      <p class="muted">
        Display URL: <a href={display} target="_blank" rel="noreferrer">{display}</a>
      </p>
    </div>
  );
}

// ---------------- Phase panels ----------------

function Phase({ state, view, send, now }: { state: GameState; view: View; send: Send; now: number }) {
  const round = view.round;
  switch (state.phase) {
    case 'lobby':
      return (
        <div class="card">
          <h2>Choose a game</h2>
          <div class="list">
            {(view.games ?? []).map((g) => (
              <button class="btn big" onClick={() => send({ type: 'loadGame', gameId: g.id })}>
                {g.title} <small>({g.id})</small>
              </button>
            ))}
          </div>
        </div>
      );
    case 'round-intro':
      return (
        <div class="card center">
          <p class="muted">
            Round {(round?.index ?? 0) + 1} of {round?.count}
          </p>
          <h2>{round?.title}</h2>
          <button class="btn primary huge" onClick={() => send({ type: 'startRound' })}>
            Start round ▶
          </button>
        </div>
      );
    case 'board':
      return <BoardPanel state={state} view={view} send={send} />;
    case 'question':
      return <QuestionPanel state={state} view={view} send={send} now={now} />;
    case 'final':
      return <FinalPanel state={state} view={view} send={send} />;
    case 'scores': {
      const hasNext = round && round.index + 1 < round.count;
      return (
        <div class="card center">
          <h2>Scores on screen</h2>
          {hasNext ? (
            <button class="btn primary huge" onClick={() => send({ type: 'goToRound', index: round.index + 1 })}>
              Next round ▶
            </button>
          ) : (
            <button class="btn primary huge" onClick={() => send({ type: 'endGame' })}>
              Finish game 🏆
            </button>
          )}
          {round?.type === 'board' && (
            <button class="btn" onClick={() => send({ type: 'startRound' })}>
              Back to board
            </button>
          )}
        </div>
      );
    }
    case 'gameover':
      return (
        <div class="card center">
          <h2>Game over</h2>
          {state.gameId && (
            <button class="btn primary big" onClick={() => send({ type: 'loadGame', gameId: state.gameId! })}>
              Play again (reset scores)
            </button>
          )}
          <button class="btn" onClick={() => send({ type: 'reset' })}>
            Back to lobby
          </button>
        </div>
      );
  }
}

function BoardPanel({ state, view, send }: { state: GameState; view: View; send: Send }) {
  const cats = view.round?.categories ?? [];
  const rows = Math.max(...cats.map((c) => c.cells.length));
  return (
    <div class="card">
      <div class="picker-row">
        <span class="muted">In control:</span>
        {state.players.map((p, i) => (
          <button class={`chip ${state.picker === i ? 'on' : ''}`} style={{ '--pc': p.color } as Record<string, string>} onClick={() => send({ type: 'setPicker', player: i })}>
            {p.name}
          </button>
        ))}
      </div>
      <div class="board" style={{ gridTemplateColumns: `repeat(${cats.length}, minmax(0, 1fr))` }}>
        {cats.map((c) => (
          <div class="board-cat">{c.name}</div>
        ))}
        {Array.from({ length: rows }, (_, r) =>
          cats.map((c) => {
            const cell = c.cells[r];
            if (!cell) return <div />;
            return (
              <button
                class={`board-cell ${cell.used ? 'used' : ''}`}
                disabled={cell.used}
                title={`${cell.prompt}\n→ ${cell.answer}`}
                onClick={() => send({ type: 'select', qid: cell.qid })}
              >
                {cell.value}
                {cell.dailyDouble && <span class="dd-star">★</span>}
              </button>
            );
          }),
        )}
      </div>
      <p class="muted">★ = Daily Double. Tap a value to show it on screen.</p>
    </div>
  );
}

function Status({ state, now }: { state: GameState; now: number }) {
  const c = state.current!;
  const secs = (d: number | null) => (d ? Math.max(0, Math.ceil((d - now) / 1000)) : null);
  if (c.buzzer !== null) {
    const p = state.players[c.buzzer];
    const s = secs(c.answerDeadline);
    return (
      <div class="status answering" style={{ background: p.color }}>
        {p.name} is answering{s !== null ? ` · ${s}s` : ''}
      </div>
    );
  }
  if (c.buzzOpen) {
    const s = secs(c.buzzDeadline);
    return <div class="status open">Buzzers OPEN{s !== null ? ` · ${s}s` : ''}</div>;
  }
  if (c.timeUp) return <div class="status closed">Time's up</div>;
  if (c.revealed) {
    const by = c.answeredBy !== null ? state.players[c.answeredBy].name : null;
    return <div class="status closed">{by ? `✔ ${by} got it` : 'Answer revealed'}</div>;
  }
  return <div class="status closed">Buzzers closed — read the question, then open</div>;
}

function QuestionPanel({ state, view, send, now }: { state: GameState; view: View; send: Send; now: number }) {
  const c = state.current!;
  const q = view.question;
  useTicker(c.buzzOpen || c.answerDeadline !== null, 250);
  const [wager, setWager] = useState('');
  if (!q) return null;

  const isMedia = q.media && (q.media.type === 'audio' || q.media.type === 'video');
  const steps = q.clues ? q.clues.length - 1 : q.media?.reveal ? (q.media.steps ?? 4) : 0;
  const canStep = !c.revealed && c.step < steps;
  const locked = c.lockedOut.map((i) => state.players[i]?.name).filter(Boolean);
  const ddPlayer = c.dailyDouble ? state.players[c.buzzer ?? state.picker ?? 0] : null;
  const isBoard = q.kind === 'board';

  return (
    <div class="card">
      <div class="q-meta">
        <span>
          {q.category ? `${q.category} · ` : ''}
          {c.dailyDouble ? `DAILY DOUBLE (wager ${c.wager ?? '—'})` : `${q.value} pts`}
        </span>
        {q.position && (
          <span>
            {q.position} / {q.total}
          </span>
        )}
      </div>
      <p class="q-prompt">{q.prompt}</p>
      {q.clues && (
        <ol class="clues">
          {q.clues.map((cl, i) => (
            <li class={i <= c.step ? 'shown' : ''}>{cl}</li>
          ))}
        </ol>
      )}
      <div class="answer-box">
        <span class="muted">Answer</span>
        <b>{q.answer}</b>
        {q.accept?.length ? <small>Also accept: {q.accept.join(', ')}</small> : null}
        {q.notes && <small>📝 {q.notes}</small>}
      </div>

      {q.media && (
        <div class="media-row">
          <span class="muted">
            {q.media.type}: {q.media.src}
          </span>
          {isMedia && (
            <>
              <button class="btn" onClick={() => send({ type: 'media', action: 'play' })}>▶ Play</button>
              <button class="btn" onClick={() => send({ type: 'media', action: 'pause' })}>⏸ Pause</button>
              <button class="btn" onClick={() => send({ type: 'media', action: 'restart' })}>⏮ Restart</button>
            </>
          )}
        </div>
      )}

      {c.dailyDouble && c.wager === null && !c.revealed && ddPlayer && (
        <form
          class="wager"
          onSubmit={(e) => {
            e.preventDefault();
            if (wager !== '') send({ type: 'setWager', amount: Number(wager) });
          }}
        >
          <span>
            Wager for <b>{ddPlayer.name}</b> (score {ddPlayer.score}):
          </span>
          <input type="number" min={0} inputMode="numeric" value={wager} onInput={(e) => setWager((e.target as HTMLInputElement).value)} />
          <button class="btn primary">Set wager</button>
          <div class="picker-row">
            <span class="muted">Answering:</span>
            {state.players.map((p, i) => (
              <button type="button" class={`chip ${c.buzzer === i ? 'on' : ''}`} style={{ '--pc': p.color } as Record<string, string>} onClick={() => send({ type: 'setPicker', player: i })}>
                {p.name}
              </button>
            ))}
          </div>
        </form>
      )}

      <Status state={state} now={now} />
      {locked.length > 0 && !c.revealed && <p class="muted">Locked out: {locked.join(', ')}</p>}

      <div class="actions">
        {c.buzzer !== null && !(c.dailyDouble && c.wager === null) ? (
          <>
            <button class="btn good huge" onClick={() => send({ type: 'correct' })}>
              ✔ Correct
            </button>
            <button class="btn bad huge" onClick={() => send({ type: 'wrong' })}>
              ✖ Wrong
            </button>
          </>
        ) : !c.revealed && !c.dailyDouble ? (
          c.buzzOpen ? (
            <button class="btn huge" onClick={() => send({ type: 'closeBuzzers' })}>
              Close buzzers
            </button>
          ) : (
            <button class="btn primary huge" onClick={() => send({ type: 'openBuzzers' })}>
              Open buzzers
            </button>
          )
        ) : null}
        {canStep && (
          <button class="btn big" onClick={() => send({ type: 'nextStep' })}>
            {q.clues ? `Next clue (${c.step + 2}/${q.clues.length})` : 'Reveal more of the picture'}
          </button>
        )}
        {!c.revealed && (
          <button class="btn big" onClick={() => send({ type: 'reveal' })}>
            Reveal answer
          </button>
        )}
        {c.revealed && (
          <button class="btn primary huge" onClick={() => send({ type: 'done' })}>
            {isBoard ? 'Back to board ▶' : q.position && q.total && q.position >= q.total ? 'End of round ▶' : 'Next question ▶'}
          </button>
        )}
      </div>
    </div>
  );
}

function FinalPanel({ state, view, send }: { state: GameState; view: View; send: Send }) {
  const f = state.final!;
  const q = view.question;
  const stages = ['category', 'wager', 'question', 'reveal'] as const;
  return (
    <div class="card">
      <div class="q-meta">
        <span>Final · {view.round?.category}</span>
      </div>
      <div class="stepper">
        {stages.map((s) => (
          <button class={`btn ${f.stage === s ? 'current' : ''}`} onClick={() => send({ type: 'finalStage', stage: s })}>
            {s === 'category' ? '1 Category' : s === 'wager' ? '2 Wagers' : s === 'question' ? '3 Question' : '4 Reveal'}
          </button>
        ))}
      </div>
      {q && (
        <>
          <p class="q-prompt">{q.prompt}</p>
          <div class="answer-box">
            <span class="muted">Answer</span>
            <b>{q.answer}</b>
            {q.accept?.length ? <small>Also accept: {q.accept.join(', ')}</small> : null}
          </div>
        </>
      )}
      <table class="final-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Score</th>
            <th>Wager</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {state.players.map((p, i) => (
            <tr>
              <td>
                <span class="swatch" style={{ background: p.color }} /> {p.name}
              </td>
              <td>{p.score}</td>
              <td>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, p.score)}
                  inputMode="numeric"
                  value={f.wagers[i] ?? ''}
                  disabled={f.results[i] !== null}
                  onChange={(e) => send({ type: 'setWager', player: i, amount: Number((e.target as HTMLInputElement).value) })}
                />
              </td>
              <td class="nowrap">
                <button class={`btn good ${f.results[i] === true ? 'current' : ''}`} onClick={() => send({ type: 'finalMark', player: i, correct: true })}>
                  ✔
                </button>
                <button class={`btn bad ${f.results[i] === false ? 'current' : ''}`} onClick={() => send({ type: 'finalMark', player: i, correct: false })}>
                  ✖
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted">Wagers are capped at each player's score. Players with 0 or less can still play for pride.</p>
      <div class="actions">
        <button class="btn primary huge" onClick={() => send({ type: 'endGame' })}>
          Finish game 🏆
        </button>
      </div>
    </div>
  );
}

function Players({ state, send }: { state: GameState; send: Send }) {
  const [step, setStep] = useState(100);
  if (!state.players.length) return null;
  return (
    <div class="card players">
      <div class="players-head">
        <h3>Scores</h3>
        <label class="muted">
          Adjust by{' '}
          <select value={step} onChange={(e) => setStep(Number((e.target as HTMLSelectElement).value))}>
            {[50, 100, 200, 500, 1000].map((v) => (
              <option value={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      {state.players.map((p: PlayerState, i: number) => (
        <div class="player" style={{ '--pc': p.color } as Record<string, string>}>
          <button
            class="pname"
            title="Rename"
            onClick={() => {
              const name = prompt('Player name', p.name);
              if (name) send({ type: 'rename', player: i, name });
            }}
          >
            {state.picker === i ? '★ ' : ''}
            {p.name}
          </button>
          <span class={`pscore ${p.score < 0 ? 'neg' : ''}`}>{p.score}</span>
          <button class="btn" aria-label={`Subtract ${step} from ${p.name}`} onClick={() => send({ type: 'adjust', player: i, delta: -step })}>
            −
          </button>
          <button class="btn" aria-label={`Add ${step} to ${p.name}`} onClick={() => send({ type: 'adjust', player: i, delta: step })}>
            +
          </button>
        </div>
      ))}
    </div>
  );
}
