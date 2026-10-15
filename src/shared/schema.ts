// Content schema for questions, rounds and games (the JSON files in /content).
// Used by scripts/build-content.ts to validate content before it is bundled into the Worker.
import { z } from 'zod';

export const MediaSchema = z
  .object({
    type: z.enum(['image', 'audio', 'video']),
    /** Path under public/media (e.g. "round1/flag.svg") or a full https:// URL. */
    src: z.string().min(1),
    /** Images only: start hidden and reveal step by step when the host presses "Reveal more". */
    reveal: z.enum(['blur', 'zoom']).optional(),
    /** Number of reveal steps for blur/zoom (default 4). */
    steps: z.number().int().min(1).max(10).optional(),
    /** Audio/video: clip start and end in seconds. */
    start: z.number().min(0).optional(),
    end: z.number().positive().optional(),
    /** Optional caption / alt text. */
    alt: z.string().optional(),
  })
  .strict();

const QuestionBase = {
  /** Question text shown on screen. */
  prompt: z.string().min(1),
  /** Answer shown to the host, and on screen once revealed. */
  answer: z.string().min(1),
  /** Other acceptable answers (host only). */
  accept: z.array(z.string()).optional(),
  /** Notes for the host: pronunciation, extra facts, sources (host only). */
  notes: z.string().optional(),
  media: MediaSchema.optional(),
};

export const BoardQuestionSchema = z
  .object({
    ...QuestionBase,
    value: z.number().int().positive(),
    /** Jeopardy-style Daily Double: only the picking player answers, after wagering. */
    dailyDouble: z.boolean().optional(),
  })
  .strict();

export const FastQuestionSchema = z
  .object({ ...QuestionBase, value: z.number().int().positive().optional() })
  .strict();

export const WhoAmIQuestionSchema = z
  .object({
    ...QuestionBase,
    prompt: z.string().min(1).default('Who am I?'),
    /** Clues revealed one at a time; points drop with each clue. */
    clues: z.array(z.string().min(1)).min(2),
  })
  .strict();

export const BoardRoundSchema = z
  .object({
    type: z.literal('board'),
    title: z.string().min(1),
    categories: z
      .array(
        z
          .object({
            name: z.string().min(1),
            questions: z.array(BoardQuestionSchema).min(1).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

export const FastRoundSchema = z
  .object({
    type: z.literal('fast'),
    title: z.string().min(1),
    /** Points for each question unless the question sets its own. */
    value: z.number().int().positive().default(100),
    questions: z.array(FastQuestionSchema).min(1),
  })
  .strict();

export const WhoAmIRoundSchema = z
  .object({
    type: z.literal('whoami'),
    title: z.string().min(1),
    /** Points available after clue 1, clue 2, … (last value repeats). */
    values: z.array(z.number().int().positive()).min(1).default([500, 400, 300, 200, 100]),
    questions: z.array(WhoAmIQuestionSchema).min(1),
  })
  .strict();

export const FinalRoundSchema = z
  .object({
    type: z.literal('final'),
    title: z.string().min(1).default('Final Round'),
    category: z.string().min(1),
    question: z.object(QuestionBase).strict(),
  })
  .strict();

export const RoundSchema = z.discriminatedUnion('type', [
  BoardRoundSchema,
  FastRoundSchema,
  WhoAmIRoundSchema,
  FinalRoundSchema,
]);

export const PlayerSchema = z
  .object({
    name: z.string().min(1).max(24),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use a hex colour like #ff3355'),
    /** Key the buzzer sends: a KeyboardEvent.key ("1", "a") or KeyboardEvent.code ("Digit1", "KeyA"). */
    key: z.string().min(1),
  })
  .strict();

export const SettingsSchema = z
  .object({
    /** Seconds players have to buzz once buzzers open (0 = no limit). */
    buzzSeconds: z.number().min(0).default(10),
    /** Seconds a player has to answer after buzzing (countdown on screen; 0 = none). */
    answerSeconds: z.number().min(0).default(5),
    /** Wrong answers lose the question's value (not applied in Who Am I rounds). */
    wrongPenalty: z.boolean().default(true),
    /** Pressing before buzzers open locks that player out for this long (ms). */
    earlyBuzzLockoutMs: z.number().int().min(0).default(250),
  })
  .strict();

export const GameSchema = z
  .object({
    title: z.string().min(1),
    subtitle: z.string().optional(),
    players: z.array(PlayerSchema).min(1).max(4),
    settings: SettingsSchema.default({}),
    /** Round files from content/rounds, in play order (without ".json"). */
    rounds: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type MediaDef = z.infer<typeof MediaSchema>;
export type RoundDef = z.infer<typeof RoundSchema>;
export type GameDef = z.infer<typeof GameSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type PlayerDef = z.infer<typeof PlayerSchema>;
