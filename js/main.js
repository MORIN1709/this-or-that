import { createDataSource } from './data-source.js';
import { createQuestionMaker, pairKey } from './questions.js';
import { createGame, StaleRoundError } from './game.js';
import { PREFETCH, CHOICE_FLASH_MS } from './config.js';

const LABELS = { band: 'איזו להקה או אמן?', album: 'איזה אלבום?', song: 'איזה שיר?' };

const { makeQuestion } = createQuestionMaker({ sources: createDataSource() });
const game = createGame({ makeQuestion, pairKey, prefetch: PREFETCH });

const $ = (id) => document.getElementById(id);
const options = [...document.querySelectorAll('button.option')];
let ticket = 0; // bumps on every show(); stale answers and timers check it

function setState(state) {
  document.body.dataset.state = state;
  if (state !== 'question') options.forEach((b) => { b.disabled = true; });
}

function metaLine(item, type) {
  if (type === 'album') return [item.artist, item.year].filter(Boolean).join(' · ');
  if (type === 'song') return item.artist || '';
  return '';
}

function render(q) {
  $('question-label').textContent = LABELS[q.type];
  $('genre').textContent = q.genre;
  [q.a, q.b].forEach((item, i) => {
    const button = options[i];
    button.querySelector('.title').textContent = item.title;
    button.querySelector('.meta').textContent = metaLine(item, q.type);
    button.classList.remove('chosen');
    button.disabled = false;
  });
  setState('question');
}

async function show() {
  const mine = ++ticket;
  setState('loading');
  try {
    const q = await game.next();
    if (mine === ticket) render(q);
  } catch (err) {
    if (mine !== ticket || err instanceof StaleRoundError) return;
    console.warn('Could not load a question:', err);
    setState('error');
  }
}

options.forEach((button) => button.addEventListener('click', () => {
  if (button.disabled) return;
  options.forEach((b) => { b.disabled = true; });
  button.classList.add('chosen');
  const mine = ticket;
  setTimeout(() => { if (mine === ticket) show(); }, CHOICE_FLASH_MS);
}));

$('reset').addEventListener('click', () => { game.reset(); show(); });
$('retry').addEventListener('click', show);

show();
