import type { GameState, View } from '../../shared/types';
import { FitText } from './FitText';
import { Media } from './Media';

export const W = 1920;
export const H = 1080;
const MAIN = { x: 40, y: 110, w: 1840, h: 720 };

const ROUND_BLURB: Record<string, string> = {
  board: 'Pick a category — first to buzz answers',
  fast: 'Fast Money — rapid fire, fastest finger first',
  whoami: 'Who Am I? — buzz early for more points',
  final: 'Wager what you dare',
};

export interface SceneProps {
  state: GameState;
  view: View;
  /** Server-synchronised clock (ms). */
  now: number;
  mediaPlaying: boolean;
  onMediaPlaying: (p: boolean) => void;
  room: string;
}

// ---------- Header ----------

export function Header({ view }: { view: View }) {
  return (
    <g>
      <text x={60} y={78} class="hdr-title">
        {view.game?.title ?? 'TRIVIA'}
      </text>
      {view.round && (
        <text x={W - 60} y={78} class="hdr-round" text-anchor="end">
          {view.round.title}
          {view.round.total ? `  ·  ${Math.min(view.round.total, view.round.total - (view.round.remaining ?? 0) + 1)} / ${view.round.total}` : ''}
        </text>
      )}
    </g>
  );
}

// ---------- Scoreboard ----------

export function Scoreboard({ state, flash }: { state: GameState; flash: number | null }) {
  const n = state.players.length;
  if (!n) return null;
  const gap = 24;
  const pw = Math.min(520, (W - 80 - gap * (n - 1)) / n);
  const x0 = (W - (pw * n + gap * (n - 1))) / 2;
  const y = 880;
  const h = 170;
  const cur = state.current;
  return (
    <g>
      {state.players.map((p, i) => {
        const x = x0 + i * (pw + gap);
        const answering = cur?.buzzer === i;
        const locked = !!cur?.lockedOut.includes(i) && !cur.revealed;
        const picking = state.phase === 'board' && state.picker === i;
        const finalRes = state.phase === 'final' && state.final?.stage === 'reveal' ? state.final.results[i] : null;
        return (
          <g class={`panel ${answering ? 'answering' : ''} ${locked ? 'locked' : ''} ${flash === i ? 'test' : ''}`} style={{ '--pc': p.color } as Record<string, string>}>
            <rect x={x} y={y} width={pw} height={h} rx={18} class="panel-bg" />
            <rect x={x} y={y} width={pw} height={14} rx={7} fill={p.color} />
            <FitText x={x + 16} y={y + 22} width={pw - 32} height={56} max={40} fitKey={p.name} className="panel-name">
              {p.name}
            </FitText>
            <text x={x + pw / 2} y={y + 148} text-anchor="middle" class={`panel-score ${p.score < 0 ? 'neg' : ''}`}>
              {p.score.toLocaleString()}
            </text>
            {finalRes !== null && (
              <g class={`final-res ${finalRes ? 'ok' : 'bad'}`}>
                <rect x={x + pw / 2 - 100} y={y - 56} width={200} height={50} rx={25} />
                <text x={x + pw / 2} y={y - 16} text-anchor="middle" class="final-res-text">
                  {finalRes ? '+' : '−'}
                  {(state.final?.wagers[i] ?? 0).toLocaleString()}
                </text>
              </g>
            )}
            {picking && (
              <text x={x + pw / 2} y={y - 14} text-anchor="middle" class="picker">
                ▼ CHOOSING
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

// ---------- Lobby / intro / scores ----------

export function Lobby({ view, room }: { view: View; room: string }) {
  return (
    <g>
      <FitText x={160} y={240} width={1600} height={260} max={190} fitKey={view.game?.title ?? 'lobby'} className="title-xl">
        {view.game?.title ?? 'TRIVIA NIGHT'}
      </FitText>
      <text x={W / 2} y={600} text-anchor="middle" class="sub">
        {view.game?.subtitle ?? 'Waiting for the host…'}
      </text>
      <text x={W / 2} y={720} text-anchor="middle" class="hint">
        Room {room} · Press your buzzer to test it
      </text>
    </g>
  );
}

export function RoundIntro({ view }: { view: View }) {
  const r = view.round;
  if (!r) return null;
  return (
    <g class="intro">
      <text x={W / 2} y={300} text-anchor="middle" class="kicker">
        ROUND {r.index + 1} OF {r.count}
      </text>
      <FitText x={160} y={340} width={1600} height={260} max={210} fitKey={r.title} className="title-xl">
        {r.title}
      </FitText>
      <text x={W / 2} y={700} text-anchor="middle" class="sub">
        {ROUND_BLURB[r.type]}
      </text>
    </g>
  );
}

export function Scores({ state, gameOver }: { state: GameState; gameOver: boolean }) {
  const ranked = state.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...ranked.map((p) => Math.abs(p.score)));
  const top = ranked[0];
  const tie = ranked.length > 1 && ranked[1].score === top.score;
  return (
    <g>
      <text x={W / 2} y={200} text-anchor="middle" class="kicker">
        {gameOver ? 'FINAL SCORES' : 'SCORES'}
      </text>
      {gameOver && (
        <FitText x={160} y={220} width={1600} height={130} max={110} fitKey={top?.name ?? ''} className="winner">
          {tie ? "It's a tie!" : `🏆 ${top?.name} wins!`}
        </FitText>
      )}
      {ranked.map((p, rank) => {
        const y = (gameOver ? 390 : 270) + rank * 120;
        const w = 40 + (900 * Math.max(0, p.score)) / max;
        return (
          <g class="score-row" style={{ animationDelay: `${rank * 120}ms` }}>
            <FitText x={100} y={y + 10} width={540} height={80} max={64} fitKey={p.name} className="score-name" align="right">
              {p.name}
            </FitText>
            <rect x={680} y={y + 10} width={w} height={80} rx={12} fill={p.color} />
            <text x={700 + w} y={y + 72} class="score-val">
              {p.score.toLocaleString()}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ---------- Board ----------

export function Board({ view }: { view: View }) {
  const cats = view.round?.categories ?? [];
  const cols = cats.length;
  const rows = Math.max(...cats.map((c) => c.cells.length));
  const gap = 14;
  const cw = (MAIN.w - gap * (cols - 1)) / cols;
  const hh = 150;
  const ch = (MAIN.h - hh - gap * rows) / rows;
  return (
    <g>
      {cats.map((c, ci) => {
        const x = MAIN.x + ci * (cw + gap);
        return (
          <g>
            <rect x={x} y={MAIN.y} width={cw} height={hh} rx={12} class="cat-bg" />
            <FitText x={x + 12} y={MAIN.y + 8} width={cw - 24} height={hh - 16} max={46} fitKey={c.name} className="cat-name">
              {c.name}
            </FitText>
            {c.cells.map((cell, ri) => {
              const y = MAIN.y + hh + gap + ri * (ch + gap);
              return (
                <g class={`cell ${cell.used ? 'used' : ''}`}>
                  <rect x={x} y={y} width={cw} height={ch} rx={12} class="cell-bg" />
                  {!cell.used && (
                    <text x={x + cw / 2} y={y + ch / 2 + 30} text-anchor="middle" class="cell-val">
                      {cell.value}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

// ---------- Question ----------

function Countdown({ x, y, r, deadline, total, now, color }: { x: number; y: number; r: number; deadline: number; total: number; now: number; color: string }) {
  const left = Math.max(0, deadline - now);
  const frac = total > 0 ? left / total : 0;
  const c = 2 * Math.PI * r;
  return (
    <g class="countdown">
      <circle cx={x} cy={y} r={r} class="cd-track" />
      <circle
        cx={x}
        cy={y}
        r={r}
        stroke={color}
        class="cd-ring"
        stroke-dasharray={c}
        stroke-dashoffset={c * (1 - frac)}
        transform={`rotate(-90 ${x} ${y})`}
      />
      <text x={x} y={y + r * 0.38} text-anchor="middle" class="cd-num" style={{ fontSize: `${r * 1.05}px` }}>
        {Math.ceil(left / 1000)}
      </text>
    </g>
  );
}

export function QuestionScene({ state, view, now, mediaPlaying, onMediaPlaying }: SceneProps) {
  const q = view.question;
  const cur = state.current;
  if (!q || !cur) return null;
  const settings = view.game?.settings;
  const buzzer = cur.buzzer !== null ? state.players[cur.buzzer] : null;
  const answeredBy = cur.answeredBy !== null ? state.players[cur.answeredBy] : null;

  // Daily Double splash before the wager is in.
  if (cur.dailyDouble && cur.wager === null && !cur.revealed) {
    const p = state.players[cur.buzzer ?? state.picker ?? 0];
    return (
      <g class="dd">
        <text x={W / 2} y={470} text-anchor="middle" class="dd-title">
          DAILY DOUBLE!
        </text>
        <text x={W / 2} y={600} text-anchor="middle" class="sub">
          {p?.name}, how much will you wager?
        </text>
      </g>
    );
  }

  const label =
    q.kind === 'board'
      ? `${q.category ?? ''}  ·  ${cur.dailyDouble ? `DAILY DOUBLE · ${q.value}` : q.value}`
      : q.kind === 'whoami'
        ? `FOR ${q.value} POINTS`
        : q.kind === 'final'
          ? (q.category ?? 'FINAL')
          : `${q.value} POINTS`;

  const frameClass = cur.buzzOpen ? 'open' : buzzer ? 'answering' : cur.revealed ? 'revealed' : '';
  const frameColor = buzzer?.color ?? (cur.buzzOpen ? '#3ddc84' : 'transparent');

  const hasMedia = !!q.media && q.kind !== 'whoami';
  const answerH = cur.revealed && q.answer ? 150 : 0;
  const top = MAIN.y + 90;
  const bottom = MAIN.y + MAIN.h - 20 - answerH;

  let body;
  if (q.kind === 'whoami') {
    const clues = q.clues ?? [];
    const lineH = Math.min(110, (bottom - top - 70) / Math.max(1, q.totalClues ?? clues.length));
    body = (
      <g>
        <text x={MAIN.x + 60} y={top + 50} class="whoami-prompt">
          {q.prompt}
        </text>
        {clues.map((c, i) => (
          <g class="clue">
            <text x={MAIN.x + 70} y={top + 80 + i * lineH + lineH * 0.65} class="clue-num">
              {i + 1}
            </text>
            <FitText x={MAIN.x + 140} y={top + 80 + i * lineH} width={MAIN.w - 220} height={lineH - 8} max={58} fitKey={c} align="left" className="clue-text">
              {c}
            </FitText>
          </g>
        ))}
      </g>
    );
  } else if (hasMedia) {
    const mediaH = (bottom - top) * 0.68;
    body = (
      <g>
        <Media
          media={q.media!}
          x={MAIN.x + 80}
          y={top}
          width={MAIN.w - 160}
          height={mediaH}
          step={cur.step}
          revealed={cur.revealed}
          command={state.media}
          playing={mediaPlaying}
          onPlaying={onMediaPlaying}
        />
        <FitText x={MAIN.x + 80} y={top + mediaH + 10} width={MAIN.w - 160} height={bottom - top - mediaH - 10} max={80} fitKey={q.prompt} className="prompt">
          {q.prompt}
        </FitText>
      </g>
    );
  } else if (q.prompt) {
    body = (
      <FitText x={MAIN.x + 100} y={top} width={MAIN.w - 200} height={bottom - top} max={110} fitKey={q.prompt + answerH} className="prompt">
        {q.prompt}
      </FitText>
    );
  }

  return (
    <g>
      <rect x={MAIN.x} y={MAIN.y} width={MAIN.w} height={MAIN.h} rx={24} class={`q-frame ${frameClass}`} style={{ stroke: frameColor }} />
      <FitText x={MAIN.x + 40} y={MAIN.y + 18} width={MAIN.w - 420} height={64} max={52} fitKey={label} align="left" className="q-label">
        {label}
      </FitText>
      {body}
      {cur.revealed && q.answer && (
        <g class="answer">
          <rect x={MAIN.x + 80} y={MAIN.y + MAIN.h - answerH - 10} width={MAIN.w - 160} height={answerH - 10} rx={16} class="answer-bg" />
          <FitText x={MAIN.x + 110} y={MAIN.y + MAIN.h - answerH} width={MAIN.w - 220} height={answerH - 30} max={90} fitKey={q.answer} className="answer-text">
            {answeredBy ? `${q.answer}  ✔ ${answeredBy.name}` : q.answer}
          </FitText>
        </g>
      )}
      {cur.buzzOpen && (
        <g class="pill open">
          <rect x={W - 420} y={MAIN.y + 16} width={240} height={70} rx={35} />
          <text x={W - 300} y={MAIN.y + 66} text-anchor="middle">
            BUZZ IN!
          </text>
        </g>
      )}
      {cur.buzzOpen && cur.buzzDeadline && settings && (
        <Countdown x={W - 110} y={MAIN.y + 52} r={44} deadline={cur.buzzDeadline} total={settings.buzzSeconds * 1000} now={now} color="#3ddc84" />
      )}
      {buzzer && cur.answerDeadline && settings && (
        <Countdown x={W - 110} y={MAIN.y + 52} r={44} deadline={cur.answerDeadline} total={settings.answerSeconds * 1000} now={now} color={buzzer.color} />
      )}
      {buzzer && (
        <g class="pill answering">
          <rect x={W - 720} y={MAIN.y + 16} width={540} height={70} rx={35} style={{ fill: buzzer.color }} />
          <FitText x={W - 700} y={MAIN.y + 20} width={500} height={62} max={46} fitKey={buzzer.name} className="pill-text">
            {buzzer.name}
          </FitText>
        </g>
      )}
      {cur.timeUp && (
        <text x={W / 2} y={MAIN.y + 70} text-anchor="middle" class="timeup">
          TIME'S UP
        </text>
      )}
    </g>
  );
}

// ---------- Final ----------

export function FinalScene(props: SceneProps) {
  const { state, view } = props;
  const f = state.final;
  if (!f) return null;
  if (f.stage === 'category' || f.stage === 'wager') {
    return (
      <g class="intro">
        <text x={W / 2} y={260} text-anchor="middle" class="kicker">
          {view.round?.title?.toUpperCase()}
        </text>
        <text x={W / 2} y={360} text-anchor="middle" class="sub">
          The category is…
        </text>
        <FitText x={160} y={400} width={1600} height={240} max={170} fitKey={view.round?.category ?? ''} className="title-xl">
          {view.round?.category}
        </FitText>
        {f.stage === 'wager' && (
          <text x={W / 2} y={760} text-anchor="middle" class="hint">
            Make your wagers! ({f.wagers.filter((w) => w !== null).length} / {state.players.length} in)
          </text>
        )}
      </g>
    );
  }
  // Question and reveal stages; wager results show above each score panel on reveal.
  return <QuestionScene {...props} />;
}
