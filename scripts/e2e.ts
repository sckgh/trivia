// End-to-end smoke test: drives the display + host in headless Chromium against a running server.
//
//   npm run dev            # in one terminal (serves on :8787, HOST_PIN from .dev.vars)
//   npm run e2e            # in another; screenshots go to ./e2e-shots (or E2E_OUT)
//
// Env: BASE_URL (default http://localhost:8787), HOST_PIN (default 1234), CHROMIUM_PATH (optional).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const PIN = process.env.HOST_PIN ?? '1234';
const OUT = process.env.E2E_OUT ?? 'e2e-shots';
const ROOM = `E2E${Date.now() % 100000}`;
mkdirSync(OUT, { recursive: true });

const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? '/opt/pw-browsers/chromium' : undefined);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`✖ ${msg}`);
  console.log(`✔ ${msg}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
  const display = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const host = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const shot = (p: Page, name: string) => p.screenshot({ path: join(OUT, `${name}.png`) });

  await display.goto(`${BASE}/display?room=${ROOM}`);
  await display.getByRole('button', { name: /Start display/ }).click();

  await host.goto(`${BASE}/host?room=${ROOM}`);
  await host.getByLabel('Host PIN').fill(PIN);
  await host.getByRole('button', { name: 'Enter' }).click();
  await host.getByRole('button', { name: /Trivia Night/ }).click();
  await host.getByRole('button', { name: /Start round/ }).click();
  await display.waitForSelector('.cell-val');
  await display.waitForTimeout(500);
  await shot(display, '01-board');
  await shot(host, '01-host-board');

  // Board question: two players press almost together — the first press must win.
  await host.locator('.board-cell').first().click();
  await display.waitForSelector('.prompt');
  await host.getByRole('button', { name: 'Open buzzers' }).click();
  await display.waitForSelector('.q-frame.open');
  await shot(display, '02-buzzers-open');
  await display.keyboard.press('2');
  await display.keyboard.press('1');
  await host.getByText(/Blue Team is answering/).waitFor();
  assert(true, 'first buzz (Blue, key 2) wins over a later press (Red, key 1)');
  await display.waitForSelector('.panel.answering');
  await shot(display, '03-answering');
  await shot(host, '03-host-answering');
  assert((await display.locator('.answer-text').count()) === 0, 'display does not show the answer before reveal');

  await host.getByRole('button', { name: /Wrong/ }).click();
  await host.getByText(/Buzzers OPEN/).waitFor();
  assert(true, 'wrong answer reopens buzzers for the others');
  await display.keyboard.press('2'); // locked out
  await display.keyboard.press('3');
  await host.getByText(/Green Team is answering/).waitFor();
  assert(true, 'locked-out player cannot buzz again; next player gets in');
  await host.getByRole('button', { name: /Correct/ }).click();
  await display.waitForSelector('.answer-text');
  await display.waitForTimeout(1500); // let the flash fade
  await shot(display, '04-revealed');
  const scores = await display.locator('.panel-score').allTextContents();
  assert(scores[1] === '-100' && scores[2] === '100', `scores updated on display (${scores.join(', ')})`);

  // Early buzz lockout: pressing before buzzers open locks the player briefly.
  await host.getByRole('button', { name: /Back to board/ }).click();
  await host.locator('.board-cell:not(.used)').nth(1).click(); // Science 100? (first unused in row order)
  await display.waitForSelector('.prompt');
  await display.keyboard.press('4');
  await host.getByRole('button', { name: 'Open buzzers' }).click();
  await display.waitForSelector('.q-frame.open');
  await display.keyboard.press('4');
  await display.waitForTimeout(300);
  assert((await host.getByText(/Gold Team is answering/).count()) === 0, 'early buzz is locked out for a moment');
  await display.keyboard.press('4');
  await host.getByText(/Gold Team is answering/).waitFor();
  assert(true, 'after the lockout the player can buzz');
  await host.getByRole('button', { name: /Correct/ }).click();
  await host.getByRole('button', { name: /Back to board/ }).click();

  // Media question (Saturn image) and audio question.
  await host.locator('.board-cell', { hasText: '200' }).nth(1).click();
  await display.waitForSelector('.media-frame img');
  await display.waitForTimeout(500);
  await shot(display, '05-image');
  await host.getByRole('button', { name: 'Reveal answer' }).click();
  await host.getByRole('button', { name: /Back to board/ }).click();
  await host.locator('.board-cell', { hasText: '100' }).nth(3).click();
  await display.waitForSelector('.eq');
  await host.getByRole('button', { name: /Play/ }).click();
  await display.waitForSelector('.eq.playing', { timeout: 5000 });
  assert(true, 'host can play audio on the display');
  await shot(display, '06-audio');
  await host.getByRole('button', { name: 'Reveal answer' }).click();
  await host.getByRole('button', { name: /Back to board/ }).click();

  // Undo restores the previous state.
  await host.getByRole('button', { name: /Undo/ }).click();
  await host.getByRole('button', { name: /Back to board/ }).waitFor();
  assert(true, 'undo goes back one step');
  await host.getByRole('button', { name: /Back to board/ }).click();

  // 4K render check: same SVG at 3840x2160.
  const big = await (await browser.newContext({ viewport: { width: 3840, height: 2160 } })).newPage();
  await big.goto(`${BASE}/display?room=${ROOM}`);
  await big.getByRole('button', { name: /Start display/ }).click();
  await big.waitForSelector('.cell-val');
  await shot(big, '07-board-4k');

  // Who Am I round.
  await host.getByRole('button', { name: '☰' }).click();
  await host.locator('.menu-group button', { hasText: /^4$/ }).click();
  await host.getByRole('button', { name: /Start round/ }).click();
  await host.getByRole('button', { name: 'Open buzzers' }).click();
  await host.getByRole('button', { name: /Next clue/ }).click();
  await host.getByRole('button', { name: /Next clue/ }).click();
  await display.waitForTimeout(600);
  await shot(display, '08-whoami');
  assert((await display.locator('.clue').count()) === 3, 'who am I shows only revealed clues');

  // Final round.
  await host.getByRole('button', { name: '☰' }).click();
  await host.locator('.menu-group button', { hasText: /^5$/ }).click();
  await host.getByRole('button', { name: /Start round/ }).click();
  await shot(display, '09-final-category');
  await host.getByRole('button', { name: '2 Wagers' }).click();
  await host.locator('.final-table input').nth(2).fill('100');
  await host.locator('.final-table input').nth(2).dispatchEvent('change');
  await host.getByRole('button', { name: '3 Question' }).click();
  await display.waitForSelector('.prompt');
  await host.getByRole('button', { name: '4 Reveal' }).click();
  await host.locator('.final-table tr').nth(3).getByRole('button', { name: '✔' }).click();
  await display.waitForTimeout(1600);
  await shot(display, '10-final-reveal');
  await host.getByRole('button', { name: /Finish game/ }).click();
  await display.waitForSelector('.winner');
  await display.waitForTimeout(800);
  await shot(display, '11-gameover');
  await shot(host, '11-host-gameover');

  await browser.close();
  console.log(`\nAll checks passed. Screenshots in ${OUT}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
