import type { MediaDef, PlayerDef, Settings } from './schema';

// ---------- Compiled content (output of scripts/build-content.ts) ----------

export interface Question {
  /** Stable id, e.g. "r0-c2-q3". */
  id: string;
  value: number;
  prompt: string;
  answer: string;
  accept?: string[];
  notes?: string;
  media?: MediaDef;
  dailyDouble?: boolean;
  clues?: string[];
}

export type Round =
  | { type: 'board'; title: string; categories: { name: string; questions: Question[] }[] }
  | { type: 'fast'; title: string; questions: Question[] }
  | { type: 'whoami'; title: string; values: number[]; questions: Question[] }
  | { type: 'final'; title: string; category: string; question: Question };

export interface Game {
  id: string;
  title: string;
  subtitle?: string;
  players: PlayerDef[];
  settings: Settings;
  rounds: Round[];
}

export interface Content {
  games: Record<string, Game>;
}

// ---------- Live game state (held by the Durable Object) ----------

export interface PlayerState {
  name: string;
  color: string;
  key: string;
  score: number;
}

export interface CurrentQuestion {
  qid: string;
  /** Base value (board/fast) — Who Am I uses the clue ladder instead. */
  value: number;
  dailyDouble: boolean;
  /** Daily Double wager, once entered by the host. */
  wager: number | null;
  /** Who Am I: clues shown so far minus one. Images: reveal step. */
  step: number;
  buzzOpen: boolean;
  /** Epoch ms when the buzz window closes (null = no limit). */
  buzzDeadline: number | null;
  /** Player currently answering. */
  buzzer: number | null;
  /** Epoch ms when the answering player's time is up (visual only). */
  answerDeadline: number | null;
  lockedOut: number[];
  revealed: boolean;
  timeUp: boolean;
  /** Player who answered correctly. */
  answeredBy: number | null;
}

export type FinalStage = 'category' | 'wager' | 'question' | 'reveal';

export interface FinalState {
  stage: FinalStage;
  wagers: (number | null)[];
  results: (boolean | null)[];
}

export type Phase = 'lobby' | 'round-intro' | 'board' | 'question' | 'final' | 'scores' | 'gameover';

export type GameEventKind = 'buzz' | 'correct' | 'wrong' | 'timeup' | 'reveal';

export interface GameState {
  gameId: string | null;
  players: PlayerState[];
  roundIndex: number;
  phase: Phase;
  /** Board question ids already played this game. */
  used: string[];
  /** Index of the current question in a fast / whoami round. */
  seqIndex: number;
  /** Player in control of the board (picks next / answers Daily Doubles). */
  picker: number | null;
  current: CurrentQuestion | null;
  final: FinalState | null;
  /** Host-triggered media command; the display reacts when seq changes. */
  media: { action: 'play' | 'pause' | 'restart'; seq: number } | null;
  /** Last notable event (drives sounds / flashes on the display). */
  event: { kind: GameEventKind; player: number | null; seq: number } | null;
  /** Monotonic counter, bumped on every change. */
  seq: number;
}

// ---------- Actions ----------

export type HostAction =
  | { type: 'loadGame'; gameId: string }
  | { type: 'goToRound'; index: number }
  | { type: 'startRound' }
  | { type: 'select'; qid: string }
  | { type: 'openBuzzers' }
  | { type: 'closeBuzzers' }
  | { type: 'correct' }
  | { type: 'wrong' }
  | { type: 'reveal' }
  | { type: 'nextStep' }
  | { type: 'done' }
  | { type: 'showScores' }
  | { type: 'endGame' }
  | { type: 'adjust'; player: number; delta: number }
  | { type: 'rename'; player: number; name: string }
  | { type: 'setPicker'; player: number }
  | { type: 'setWager'; player?: number; amount: number }
  | { type: 'finalStage'; stage: FinalStage }
  | { type: 'finalMark'; player: number; correct: boolean }
  | { type: 'media'; action: 'play' | 'pause' | 'restart' }
  | { type: 'reset' };

export type DisplayAction = { type: 'buzz'; player: number };

export type SystemAction = { type: 'tick' };

export type Action = HostAction | DisplayAction | SystemAction;

// ---------- Views sent to clients ----------

export type Role = 'display' | 'host';

export interface BoardCellView {
  qid: string;
  value: number;
  used: boolean;
  /** Host only. */
  dailyDouble?: boolean;
  /** Host only: question preview. */
  prompt?: string;
  answer?: string;
}

export interface QuestionView {
  kind: Round['type'];
  category?: string;
  value: number;
  prompt: string;
  media?: MediaDef;
  /** Who Am I clues — display only gets those revealed so far. */
  clues?: string[];
  totalClues?: number;
  /** Only present for the host, or for everyone once revealed. */
  answer?: string;
  accept?: string[];
  notes?: string;
  /** Position within fast / whoami rounds. */
  position?: number;
  total?: number;
}

export interface RoundView {
  index: number;
  count: number;
  type: Round['type'];
  title: string;
  categories?: { name: string; cells: BoardCellView[] }[];
  /** Final round category. */
  category?: string;
  /** Questions in fast / whoami rounds. */
  total?: number;
  remaining?: number;
}

export interface View {
  game: { id: string; title: string; subtitle?: string; settings: Settings } | null;
  round: RoundView | null;
  question: QuestionView | null;
  /** Host only: available games for the lobby. */
  games?: { id: string; title: string }[];
}

export type ServerMessage =
  | { t: 'state'; state: GameState; view: View; now: number; canUndo: boolean }
  | { t: 'error'; message: string }
  | { t: 'pong'; now: number };

export type ClientMessage =
  | { t: 'action'; action: HostAction | DisplayAction }
  | { t: 'undo' }
  | { t: 'ping' };
