// Pure game rules. `reduce` never mutates its input and does no I/O, so the
// Durable Object, the tests and (if ever needed) an offline mode can share it.
import type { Action, Content, CurrentQuestion, Game, GameState, Question, Round } from './types';

export function initialState(): GameState {
  return {
    gameId: null,
    players: [],
    roundIndex: 0,
    phase: 'lobby',
    used: [],
    seqIndex: 0,
    picker: null,
    current: null,
    final: null,
    media: null,
    event: null,
    seq: 0,
  };
}

export function currentRound(content: Content, s: GameState): Round | null {
  const game = s.gameId ? content.games[s.gameId] : undefined;
  return game?.rounds[s.roundIndex] ?? null;
}

export function findQuestion(
  round: Round | null,
  qid: string,
): { question: Question; category?: string } | null {
  if (!round) return null;
  switch (round.type) {
    case 'board':
      for (const cat of round.categories) {
        const q = cat.questions.find((x) => x.id === qid);
        if (q) return { question: q, category: cat.name };
      }
      return null;
    case 'fast':
    case 'whoami': {
      const q = round.questions.find((x) => x.id === qid);
      return q ? { question: q } : null;
    }
    case 'final':
      return round.question.id === qid ? { question: round.question, category: round.category } : null;
  }
}

/** Points at stake for the current question right now. */
export function stakeFor(round: Round | null, cur: CurrentQuestion): number {
  if (cur.dailyDouble) return cur.wager ?? 0;
  if (round?.type === 'whoami') return round.values[Math.min(cur.step, round.values.length - 1)];
  return cur.value;
}

function newCurrent(q: Question, dailyDouble = false): CurrentQuestion {
  return {
    qid: q.id,
    value: q.value,
    dailyDouble,
    wager: null,
    step: 0,
    buzzOpen: false,
    buzzDeadline: null,
    buzzer: null,
    answerDeadline: null,
    lockedOut: [],
    revealed: false,
    timeUp: false,
    answeredBy: null,
  };
}

function boardQuestionCount(round: Round): number {
  return round.type === 'board' ? round.categories.reduce((n, c) => n + c.questions.length, 0) : 0;
}

/** Earliest pending deadline the server must wake up for (buzz window). */
export function nextDeadline(s: GameState): number | null {
  const c = s.current;
  return c && c.buzzOpen && c.buzzDeadline ? c.buzzDeadline : null;
}

export class ActionError extends Error {}

export function reduce(content: Content, prev: GameState, action: Action, now: number): GameState {
  const s: GameState = structuredClone(prev);
  const game: Game | undefined = s.gameId ? content.games[s.gameId] : undefined;
  const round = currentRound(content, s);
  const settings = game?.settings;
  const cur = s.current;
  const bump = () => ++s.seq;
  const emit = (kind: NonNullable<GameState['event']>['kind'], player: number | null) => {
    s.event = { kind, player, seq: s.seq + 1 };
  };
  const openBuzzers = (c: CurrentQuestion) => {
    c.buzzOpen = true;
    c.timeUp = false;
    c.buzzDeadline = settings && settings.buzzSeconds > 0 ? now + settings.buzzSeconds * 1000 : null;
  };
  const enterRound = (index: number) => {
    s.roundIndex = index;
    s.phase = 'round-intro';
    s.current = null;
    s.final = null;
    s.seqIndex = 0;
    s.media = null;
  };
  const loadSeq = (r: Round, index: number) => {
    if (r.type !== 'fast' && r.type !== 'whoami') return;
    s.seqIndex = index;
    s.current = index < r.questions.length ? newCurrent(r.questions[index]) : null;
    s.phase = s.current ? 'question' : 'scores';
    s.media = null;
  };

  switch (action.type) {
    case 'loadGame': {
      const g = content.games[action.gameId];
      if (!g) throw new ActionError(`Unknown game "${action.gameId}"`);
      const fresh = initialState();
      fresh.gameId = g.id;
      fresh.players = g.players.map((p) => ({ ...p, score: 0 }));
      fresh.phase = 'round-intro';
      fresh.picker = 0;
      fresh.seq = s.seq + 1;
      return fresh;
    }

    case 'reset': {
      const fresh = initialState();
      fresh.seq = s.seq + 1;
      return fresh;
    }

    case 'goToRound': {
      if (!game) throw new ActionError('No game loaded');
      if (action.index < 0 || action.index >= game.rounds.length) throw new ActionError('No such round');
      enterRound(action.index);
      break;
    }

    case 'startRound': {
      if (!round) throw new ActionError('No game loaded');
      if (round.type === 'board') {
        s.phase = 'board';
        s.current = null;
        // Player with the lowest score picks first in later rounds (Jeopardy convention).
        if (s.roundIndex > 0) {
          const min = Math.min(...s.players.map((p) => p.score));
          s.picker = s.players.findIndex((p) => p.score === min);
        }
      } else if (round.type === 'final') {
        s.phase = 'final';
        s.current = newCurrent(round.question);
        s.final = {
          stage: 'category',
          wagers: s.players.map(() => null),
          results: s.players.map(() => null),
        };
      } else {
        loadSeq(round, 0);
      }
      break;
    }

    case 'select': {
      if (s.phase !== 'board' || round?.type !== 'board') throw new ActionError('Not on the board');
      if (s.used.includes(action.qid)) throw new ActionError('Question already played');
      const found = findQuestion(round, action.qid);
      if (!found) throw new ActionError('Unknown question');
      const dd = !!found.question.dailyDouble;
      s.current = newCurrent(found.question, dd);
      if (dd) s.current.buzzer = s.picker ?? 0;
      s.phase = 'question';
      s.media = null;
      break;
    }

    case 'openBuzzers': {
      if (s.phase !== 'question' || !cur) throw new ActionError('No question in play');
      if (cur.dailyDouble) throw new ActionError('Daily Double — no buzzers');
      if (cur.revealed) throw new ActionError('Answer already revealed');
      cur.buzzer = null;
      cur.answerDeadline = null;
      openBuzzers(cur);
      break;
    }

    case 'closeBuzzers': {
      if (!cur) throw new ActionError('No question in play');
      cur.buzzOpen = false;
      cur.buzzDeadline = null;
      break;
    }

    case 'buzz': {
      // Silently ignore invalid buzzes — they are expected (button mashing).
      if (s.phase !== 'question' || !cur || !cur.buzzOpen || cur.buzzer !== null) return prev;
      if (action.player < 0 || action.player >= s.players.length) return prev;
      if (cur.lockedOut.includes(action.player)) return prev;
      cur.buzzer = action.player;
      cur.buzzOpen = false;
      cur.buzzDeadline = null;
      cur.answerDeadline = settings && settings.answerSeconds > 0 ? now + settings.answerSeconds * 1000 : null;
      emit('buzz', action.player);
      s.media = s.media ? { action: 'pause', seq: s.media.seq + 1 } : null;
      break;
    }

    case 'correct': {
      if (!cur || cur.buzzer === null) throw new ActionError('Nobody is answering');
      const p = cur.buzzer;
      s.players[p].score += stakeFor(round, cur);
      cur.answeredBy = p;
      cur.buzzer = null;
      cur.answerDeadline = null;
      cur.revealed = true;
      cur.buzzOpen = false;
      cur.buzzDeadline = null;
      s.picker = p;
      emit('correct', p);
      break;
    }

    case 'wrong': {
      if (!cur || cur.buzzer === null) throw new ActionError('Nobody is answering');
      const p = cur.buzzer;
      const penalise = cur.dailyDouble || (settings?.wrongPenalty && round?.type !== 'whoami');
      if (penalise) s.players[p].score -= stakeFor(round, cur);
      cur.lockedOut.push(p);
      cur.buzzer = null;
      cur.answerDeadline = null;
      emit('wrong', p);
      const everyoneOut = s.players.every((_, i) => cur.lockedOut.includes(i));
      if (cur.dailyDouble || everyoneOut) {
        cur.revealed = true;
        cur.buzzOpen = false;
        cur.buzzDeadline = null;
      } else {
        openBuzzers(cur); // rebound: everyone else may buzz in
      }
      break;
    }

    case 'reveal': {
      if (!cur) throw new ActionError('No question in play');
      cur.revealed = true;
      cur.buzzOpen = false;
      cur.buzzDeadline = null;
      cur.buzzer = null;
      cur.answerDeadline = null;
      emit('reveal', null);
      break;
    }

    case 'nextStep': {
      if (!cur) throw new ActionError('No question in play');
      const q = findQuestion(round, cur.qid)?.question;
      const max = q?.clues ? q.clues.length - 1 : (q?.media?.reveal ? (q.media.steps ?? 4) : 0);
      if (cur.step >= max) throw new ActionError('Nothing more to reveal');
      cur.step += 1;
      break;
    }

    case 'done': {
      if (!round) throw new ActionError('No game loaded');
      if (round.type === 'board') {
        if (cur && !s.used.includes(cur.qid)) s.used.push(cur.qid);
        s.current = null;
        s.media = null;
        const played = round.categories.flatMap((c) => c.questions).filter((q) => s.used.includes(q.id));
        s.phase = played.length >= boardQuestionCount(round) ? 'scores' : 'board';
      } else if (round.type === 'fast' || round.type === 'whoami') {
        loadSeq(round, s.seqIndex + 1);
      } else {
        s.phase = 'gameover';
      }
      break;
    }

    case 'showScores': {
      s.phase = 'scores';
      break;
    }

    case 'endGame': {
      s.phase = 'gameover';
      s.current = null;
      break;
    }

    case 'adjust': {
      const p = s.players[action.player];
      if (!p) throw new ActionError('No such player');
      p.score += Math.trunc(action.delta);
      break;
    }

    case 'rename': {
      const p = s.players[action.player];
      if (!p) throw new ActionError('No such player');
      const name = action.name.trim().slice(0, 24);
      if (name) p.name = name;
      break;
    }

    case 'setPicker': {
      if (!s.players[action.player]) throw new ActionError('No such player');
      s.picker = action.player;
      if (cur?.dailyDouble && cur.answeredBy === null && !cur.revealed) cur.buzzer = action.player;
      break;
    }

    case 'setWager': {
      const amount = Math.max(0, Math.trunc(action.amount));
      if (s.phase === 'final' && s.final) {
        if (action.player === undefined || !s.players[action.player]) throw new ActionError('Pick a player');
        s.final.wagers[action.player] = Math.min(amount, Math.max(0, s.players[action.player].score));
      } else if (cur?.dailyDouble) {
        cur.wager = amount;
      } else {
        throw new ActionError('Nothing to wager on');
      }
      break;
    }

    case 'finalStage': {
      if (s.phase !== 'final' || !s.final) throw new ActionError('Not in the final round');
      s.final.stage = action.stage;
      if (action.stage === 'reveal' && cur) cur.revealed = true;
      break;
    }

    case 'finalMark': {
      if (!s.final || !s.players[action.player]) throw new ActionError('Not in the final round');
      const was = s.final.results[action.player];
      const wager = s.final.wagers[action.player] ?? 0;
      // Re-marking reverses the previous mark first.
      if (was !== null) s.players[action.player].score -= was ? wager : -wager;
      s.players[action.player].score += action.correct ? wager : -wager;
      s.final.results[action.player] = action.correct;
      emit(action.correct ? 'correct' : 'wrong', action.player);
      break;
    }

    case 'media': {
      s.media = { action: action.action, seq: (s.media?.seq ?? 0) + 1 };
      break;
    }

    case 'tick': {
      if (!cur || !cur.buzzOpen || !cur.buzzDeadline || now < cur.buzzDeadline) return prev;
      cur.buzzOpen = false;
      cur.buzzDeadline = null;
      cur.timeUp = true;
      cur.revealed = true;
      emit('timeup', null);
      break;
    }
  }

  bump();
  return s;
}
