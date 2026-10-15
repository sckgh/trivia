// Builds what each client is allowed to see. The display never receives an
// answer (or the Daily Double locations) before the host reveals it.
import { currentRound, findQuestion } from './game';
import type { BoardCellView, Content, GameState, QuestionView, Role, RoundView, View } from './types';

export function buildView(content: Content, s: GameState, role: Role): View {
  const host = role === 'host';
  const game = s.gameId ? content.games[s.gameId] : undefined;
  const view: View = {
    game: game ? { id: game.id, title: game.title, subtitle: game.subtitle, settings: game.settings } : null,
    round: null,
    question: null,
  };
  if (host) view.games = Object.values(content.games).map((g) => ({ id: g.id, title: g.title }));
  if (!game) return view;

  const round = currentRound(content, s);
  if (!round) return view;

  const rv: RoundView = { index: s.roundIndex, count: game.rounds.length, type: round.type, title: round.title };
  if (round.type === 'board') {
    rv.categories = round.categories.map((c) => ({
      name: c.name,
      cells: c.questions.map((q) => {
        const cell: BoardCellView = { qid: q.id, value: q.value, used: s.used.includes(q.id) };
        if (host) Object.assign(cell, { dailyDouble: !!q.dailyDouble, prompt: q.prompt, answer: q.answer });
        return cell;
      }),
    }));
  } else if (round.type === 'final') {
    rv.category = round.category;
  } else {
    rv.total = round.questions.length;
    rv.remaining = Math.max(0, round.questions.length - s.seqIndex);
  }
  view.round = rv;

  const cur = s.current;
  if (!cur) return view;
  const found = findQuestion(round, cur.qid);
  if (!found) return view;
  const q = found.question;

  // Final round: the display only sees the prompt once the host moves to the question stage.
  // Daily Double: the clue stays hidden until the wager is in.
  const promptHidden =
    (round.type === 'final' && (s.final?.stage === 'category' || s.final?.stage === 'wager')) ||
    (cur.dailyDouble && cur.wager === null && !cur.revealed);
  const showAnswer = host || cur.revealed;

  const qv: QuestionView = {
    kind: round.type,
    category: found.category,
    value: cur.dailyDouble ? (cur.wager ?? 0) : round.type === 'whoami' ? round.values[Math.min(cur.step, round.values.length - 1)] : cur.value,
    prompt: promptHidden && !host ? '' : q.prompt,
    media: promptHidden && !host ? undefined : q.media,
  };
  if (q.clues) {
    qv.clues = host || cur.revealed ? q.clues : q.clues.slice(0, cur.step + 1);
    qv.totalClues = q.clues.length;
  }
  if (showAnswer) qv.answer = q.answer;
  if (host) {
    qv.accept = q.accept;
    qv.notes = q.notes;
  }
  if (round.type === 'fast' || round.type === 'whoami') {
    qv.position = s.seqIndex + 1;
    qv.total = round.questions.length;
  }
  view.question = qv;
  return view;
}
