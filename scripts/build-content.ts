// Validates everything in content/ and compiles it into src/generated/content.json,
// which is bundled into the Worker (so answers are never served as public files).
//
//   npm run validate   -> check only, prints every problem found
//   npm run content    -> check and write the compiled file
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodError } from 'zod';
import { GameSchema, RoundSchema, type MediaDef, type RoundDef } from '../src/shared/schema';
import type { Content, Game, Question, Round } from '../src/shared/types';

export function compileContent(root: string): { content: Content; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const contentDir = join(root, 'content');
  const mediaDir = join(root, 'public', 'media');

  const readJson = (file: string): unknown => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      errors.push(`${rel(file)}: invalid JSON — ${(e as Error).message}`);
      return undefined;
    }
  };
  const rel = (file: string) => file.replace(root + '/', '');
  const zodErrors = (file: string, err: ZodError) => {
    for (const issue of err.issues) errors.push(`${rel(file)}: ${issue.path.join('.') || '(root)'} — ${issue.message}`);
  };
  const checkMedia = (where: string, m: MediaDef | undefined) => {
    if (!m || /^https?:\/\//.test(m.src)) return;
    const file = join(mediaDir, m.src);
    if (!existsSync(file)) errors.push(`${where}: media file not found: public/media/${m.src}`);
    if (m.start !== undefined && m.end !== undefined && m.end <= m.start) errors.push(`${where}: media end must be after start`);
    if (m.reveal && m.type !== 'image') errors.push(`${where}: "reveal" only works with images`);
  };

  // Rounds
  const rounds = new Map<string, RoundDef>();
  const roundsDir = join(contentDir, 'rounds');
  for (const f of existsSync(roundsDir) ? readdirSync(roundsDir).filter((x) => x.endsWith('.json')).sort() : []) {
    const file = join(roundsDir, f);
    const data = readJson(file);
    if (data === undefined) continue;
    const parsed = RoundSchema.safeParse(data);
    if (!parsed.success) {
      zodErrors(file, parsed.error);
      continue;
    }
    rounds.set(basename(f, '.json'), parsed.data);
    const r = parsed.data;
    const where = (s: string) => `${rel(file)}: ${s}`;
    if (r.type === 'board') {
      r.categories.forEach((c, ci) => {
        const values = c.questions.map((q) => q.value);
        if (new Set(values).size !== values.length) warnings.push(where(`category "${c.name}" has duplicate values`));
        c.questions.forEach((q, qi) => checkMedia(where(`categories.${ci}.questions.${qi}`), q.media));
      });
      const dd = r.categories.flatMap((c) => c.questions).filter((q) => q.dailyDouble).length;
      if (dd > 3) warnings.push(where(`${dd} Daily Doubles — usually 1 or 2 per board`));
    } else if (r.type === 'final') {
      checkMedia(where('question'), r.question.media);
    } else {
      r.questions.forEach((q, qi) => checkMedia(where(`questions.${qi}`), q.media));
    }
  }

  // Games
  const games: Record<string, Game> = {};
  const gamesDir = join(contentDir, 'games');
  const gameFiles = existsSync(gamesDir) ? readdirSync(gamesDir).filter((x) => x.endsWith('.json')).sort() : [];
  if (gameFiles.length === 0) errors.push('content/games: no game files found');
  for (const f of gameFiles) {
    const file = join(gamesDir, f);
    const data = readJson(file);
    if (data === undefined) continue;
    const parsed = GameSchema.safeParse(data);
    if (!parsed.success) {
      zodErrors(file, parsed.error);
      continue;
    }
    const g = parsed.data;
    const id = basename(f, '.json');
    const keys = g.players.map((p) => p.key.toLowerCase());
    if (new Set(keys).size !== keys.length) errors.push(`${rel(file)}: two players share the same buzzer key`);
    const compiled: Round[] = [];
    g.rounds.forEach((name, ri) => {
      const r = rounds.get(name);
      if (!r) {
        errors.push(`${rel(file)}: rounds.${ri} — no such round file content/rounds/${name}.json`);
        return;
      }
      compiled.push(compileRound(r, ri));
    });
    games[id] = { id, title: g.title, subtitle: g.subtitle, players: g.players, settings: g.settings, rounds: compiled };
  }

  return { content: { games }, errors, warnings };
}

function compileRound(r: RoundDef, ri: number): Round {
  const base = (q: Omit<Question, 'id' | 'value'>, id: string, value: number): Question => ({ ...q, id, value });
  switch (r.type) {
    case 'board':
      return {
        type: 'board',
        title: r.title,
        categories: r.categories.map((c, ci) => ({
          name: c.name,
          questions: c.questions.map((q, qi) => base(q, `r${ri}-c${ci}-q${qi}`, q.value)),
        })),
      };
    case 'fast':
      return {
        type: 'fast',
        title: r.title,
        questions: r.questions.map((q, qi) => base(q, `r${ri}-q${qi}`, q.value ?? r.value)),
      };
    case 'whoami':
      return {
        type: 'whoami',
        title: r.title,
        values: r.values,
        questions: r.questions.map((q, qi) => base(q, `r${ri}-q${qi}`, r.values[0])),
      };
    case 'final':
      return { type: 'final', title: r.title, category: r.category, question: base(r.question, `r${ri}-final`, 0) };
  }
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(import.meta.url), '../..');
  const checkOnly = process.argv.includes('--check');
  const { content, errors, warnings } = compileContent(root);
  for (const w of warnings) console.warn(`⚠  ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`✖  ${e}`);
    console.error(`\n${errors.length} problem(s) found in content/. Nothing was written.`);
    process.exit(1);
  }
  const summary = Object.values(content.games)
    .map((g) => `  • ${g.id}: "${g.title}" — ${g.rounds.length} rounds (${g.rounds.map((r) => r.type).join(', ')})`)
    .join('\n');
  if (!checkOnly) {
    mkdirSync(join(root, 'src', 'generated'), { recursive: true });
    writeFileSync(join(root, 'src', 'generated', 'content.json'), JSON.stringify(content));
  }
  console.log(`✔  Content OK${checkOnly ? '' : ' → src/generated/content.json'}\n${summary}`);
}
