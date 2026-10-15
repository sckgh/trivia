import { describe, expect, it } from 'vitest';
import { compileContent } from '../scripts/build-content';
import { initialState, reduce } from '../src/shared/game';
import type { Action, Content, GameState } from '../src/shared/types';
import { buildView } from '../src/shared/view';

const content: Content = {
  games: {
    t: {
      id: 't',
      title: 'Test',
      players: [
        { name: 'A', color: '#ff0000', key: '1' },
        { name: 'B', color: '#00ff00', key: '2' },
        { name: 'C', color: '#0000ff', key: '3' },
      ],
      settings: { buzzSeconds: 10, answerSeconds: 5, wrongPenalty: true, earlyBuzzLockoutMs: 250 },
      rounds: [
        {
          type: 'board',
          title: 'R1',
          categories: [
            {
              name: 'Cat',
              questions: [
                { id: 'q1', value: 100, prompt: 'P1', answer: 'A1' },
                { id: 'q2', value: 200, prompt: 'P2', answer: 'A2', dailyDouble: true },
              ],
            },
          ],
        },
        { type: 'fast', title: 'Fast', questions: [{ id: 'f1', value: 50, prompt: 'F1', answer: 'FA1' }, { id: 'f2', value: 50, prompt: 'F2', answer: 'FA2' }] },
        { type: 'whoami', title: 'Who', values: [500, 300, 100], questions: [{ id: 'w1', value: 500, prompt: 'Who am I?', answer: 'Me', clues: ['c1', 'c2', 'c3', 'c4'] }] },
        { type: 'final', title: 'Final', category: 'Stuff', question: { id: 'fin', value: 0, prompt: 'FP', answer: 'FA' } },
      ],
    },
  },
};

let clock = 1_000_000;
function run(s: GameState, ...actions: Action[]): GameState {
  for (const a of actions) s = reduce(content, s, a, (clock += 10));
  return s;
}
const start = () => run(initialState(), { type: 'loadGame', gameId: 't' }, { type: 'startRound' });

describe('board round', () => {
  it('first buzz wins and later buzzes are ignored', () => {
    let s = run(start(), { type: 'select', qid: 'q1' }, { type: 'openBuzzers' });
    s = run(s, { type: 'buzz', player: 1 }, { type: 'buzz', player: 0 });
    expect(s.current?.buzzer).toBe(1);
    expect(s.event?.kind).toBe('buzz');
  });

  it('ignores buzzes before buzzers open', () => {
    const s = run(start(), { type: 'select', qid: 'q1' }, { type: 'buzz', player: 0 });
    expect(s.current?.buzzer).toBeNull();
  });

  it('correct adds points, gives control, reveals', () => {
    const s = run(start(), { type: 'select', qid: 'q1' }, { type: 'openBuzzers' }, { type: 'buzz', player: 2 }, { type: 'correct' });
    expect(s.players[2].score).toBe(100);
    expect(s.picker).toBe(2);
    expect(s.current?.revealed).toBe(true);
    expect(s.current?.answeredBy).toBe(2);
  });

  it('wrong deducts, locks out and reopens for the others', () => {
    let s = run(start(), { type: 'select', qid: 'q1' }, { type: 'openBuzzers' }, { type: 'buzz', player: 0 }, { type: 'wrong' });
    expect(s.players[0].score).toBe(-100);
    expect(s.current?.buzzOpen).toBe(true);
    s = run(s, { type: 'buzz', player: 0 });
    expect(s.current?.buzzer).toBeNull(); // locked out
    s = run(s, { type: 'buzz', player: 1 }, { type: 'wrong' }, { type: 'buzz', player: 2 }, { type: 'wrong' });
    expect(s.current?.revealed).toBe(true); // everyone out
    expect(s.current?.buzzOpen).toBe(false);
  });

  it('buzz window times out on tick', () => {
    let s = run(start(), { type: 'select', qid: 'q1' }, { type: 'openBuzzers' });
    s = reduce(content, s, { type: 'tick' }, clock + 5_000);
    expect(s.current?.buzzOpen).toBe(true);
    s = reduce(content, s, { type: 'tick' }, clock + 11_000);
    expect(s.current?.timeUp).toBe(true);
    expect(s.current?.revealed).toBe(true);
  });

  it('done marks question used and moves to scores when the board is cleared', () => {
    let s = run(start(), { type: 'select', qid: 'q1' }, { type: 'reveal' }, { type: 'done' });
    expect(s.phase).toBe('board');
    expect(s.used).toEqual(['q1']);
    expect(() => run(s, { type: 'select', qid: 'q1' })).toThrow();
    s = run(s, { type: 'select', qid: 'q2' }, { type: 'reveal' }, { type: 'done' });
    expect(s.phase).toBe('scores');
  });

  it('daily double: picker answers for their wager, no buzzers', () => {
    let s = run(start(), { type: 'setPicker', player: 1 }, { type: 'select', qid: 'q2' });
    expect(s.current?.dailyDouble).toBe(true);
    expect(s.current?.buzzer).toBe(1);
    expect(() => run(s, { type: 'openBuzzers' })).toThrow();
    s = run(s, { type: 'setWager', amount: 750 }, { type: 'wrong' });
    expect(s.players[1].score).toBe(-750);
    expect(s.current?.revealed).toBe(true);
  });
});

describe('other rounds', () => {
  it('fast round steps through questions then shows scores', () => {
    let s = run(start(), { type: 'goToRound', index: 1 }, { type: 'startRound' });
    expect(s.current?.qid).toBe('f1');
    s = run(s, { type: 'openBuzzers' }, { type: 'buzz', player: 0 }, { type: 'correct' }, { type: 'done' });
    expect(s.players[0].score).toBe(50);
    expect(s.current?.qid).toBe('f2');
    s = run(s, { type: 'reveal' }, { type: 'done' });
    expect(s.phase).toBe('scores');
  });

  it('who am I: value drops per clue, no penalty for wrong', () => {
    let s = run(start(), { type: 'goToRound', index: 2 }, { type: 'startRound' }, { type: 'openBuzzers' });
    s = run(s, { type: 'buzz', player: 0 }, { type: 'wrong' });
    expect(s.players[0].score).toBe(0);
    s = run(s, { type: 'nextStep' }, { type: 'nextStep' }, { type: 'nextStep' });
    expect(() => run(s, { type: 'nextStep' })).toThrow();
    s = run(s, { type: 'buzz', player: 1 }, { type: 'correct' });
    expect(s.players[1].score).toBe(100); // last value repeats
  });

  it('final: wagers capped at score; re-marking reverses', () => {
    let s = run(start(), { type: 'adjust', player: 0, delta: 300 }, { type: 'goToRound', index: 3 }, { type: 'startRound' });
    expect(s.phase).toBe('final');
    s = run(s, { type: 'setWager', player: 0, amount: 1000 });
    expect(s.final?.wagers[0]).toBe(300);
    s = run(s, { type: 'finalMark', player: 0, correct: true });
    expect(s.players[0].score).toBe(600);
    s = run(s, { type: 'finalMark', player: 0, correct: false });
    expect(s.players[0].score).toBe(0);
  });
});

describe('views', () => {
  it('display never sees the answer before reveal', () => {
    let s = run(start(), { type: 'select', qid: 'q1' });
    expect(buildView(content, s, 'display').question?.answer).toBeUndefined();
    expect(buildView(content, s, 'host').question?.answer).toBe('A1');
    expect(JSON.stringify(buildView(content, s, 'display'))).not.toContain('A2');
    s = run(s, { type: 'reveal' });
    expect(buildView(content, s, 'display').question?.answer).toBe('A1');
  });

  it('display does not know where the daily doubles are', () => {
    const v = buildView(content, start(), 'display');
    expect(v.round?.categories?.[0].cells.some((c) => c.dailyDouble)).toBe(false);
  });

  it('daily double clue hidden until wager; who am I clues only as revealed', () => {
    let s = run(start(), { type: 'select', qid: 'q2' });
    expect(buildView(content, s, 'display').question?.prompt).toBe('');
    s = run(s, { type: 'setWager', amount: 100 });
    expect(buildView(content, s, 'display').question?.prompt).toBe('P2');

    s = run(start(), { type: 'goToRound', index: 2 }, { type: 'startRound' }, { type: 'nextStep' });
    expect(buildView(content, s, 'display').question?.clues).toEqual(['c1', 'c2']);
    expect(buildView(content, s, 'host').question?.clues).toHaveLength(4);
  });

  it('final prompt hidden from display during category and wager stages', () => {
    let s = run(start(), { type: 'goToRound', index: 3 }, { type: 'startRound' });
    expect(buildView(content, s, 'display').question?.prompt).toBe('');
    s = run(s, { type: 'finalStage', stage: 'question' });
    expect(buildView(content, s, 'display').question?.prompt).toBe('FP');
    expect(buildView(content, s, 'display').question?.answer).toBeUndefined();
  });
});

describe('sample content', () => {
  it('compiles without errors', () => {
    const { errors, content: c } = compileContent(process.cwd());
    expect(errors).toEqual([]);
    expect(Object.keys(c.games).length).toBeGreaterThan(0);
  });
});
