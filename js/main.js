import { createDataSource } from './data-source.js';
import { createQuestionMaker, pairKey } from './questions.js';
import { createGame, StaleRoundError } from './game.js';
import { PREFETCH, CHOICE_FLASH_MS } from './config.js';

const LABELS = { band: 'איזו להקה או אמן?', album: 'איזה אלבום?', song: 'איזה שיר?' };

const maker = createQuestionMaker({ sources: createDataSource() });

// Start downloading a question's pictures as soon as it is prepared, so they are ready (and in the
// browser's cache) by the time it is shown.
function preloadPictures(q) {
  for (const item of [q.a, q.b]) {
    if (!item.image) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = item.image;
  }
  return q;
}

const game = createGame({ makeQuestion: async () => preloadPictures(await maker.makeQuestion()), pairKey, prefetch: PREFETCH });

const $ = (id) => document.getElementById(id);
const options = [...document.querySelectorAll('button.option')];
let ticket = 0; // bumps on every show(); stale answers and timers check it

const skip = $('skip');

function setState(state) {
  document.body.dataset.state = state;
  if (state !== 'question') {
    options.forEach((b) => { b.disabled = true; });
    skip.disabled = true;
  }
}

function metaLine(item, type) {
  if (type === 'album') return [item.artist, item.year].filter(Boolean).join(' · ');
  if (type === 'song') return item.artist || '';
  return '';
}

// The picture of an option; until it loads the previous one stays hidden, and if it can't load the
// first letter of the name is shown instead.
function showPicture(button, item) {
  const img = button.querySelector('img');
  button.querySelector('.initial').textContent = item.title.trim().charAt(0).toUpperCase();
  button.classList.remove('no-image');
  img.onload = () => button.classList.remove('img-pending');
  img.onerror = () => { button.classList.remove('img-pending'); button.classList.add('no-image'); };
  if (item.image) {
    const same = img.getAttribute('src') === item.image;
    button.classList.add('img-pending');
    img.src = item.image;
    // The same picture again fires no new load event; it is already there.
    if (same && img.complete) {
      button.classList.remove('img-pending');
      if (img.naturalWidth === 0) button.classList.add('no-image');
    }
  } else {
    img.removeAttribute('src');
    button.classList.add('no-image');
  }
}

function render(q) {
  $('question-label').textContent = LABELS[q.type];
  $('genre').textContent = q.genre;
  [q.a, q.b].forEach((item, i) => {
    const button = options[i];
    button.querySelector('.title').textContent = item.title;
    button.querySelector('.meta').textContent = metaLine(item, q.type);
    showPicture(button, item);
    button.classList.remove('chosen');
    button.disabled = false;
  });
  skip.disabled = false;
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
  skip.disabled = true;
  button.classList.add('chosen');
  const mine = ticket;
  setTimeout(() => { if (mine === ticket) show(); }, CHOICE_FLASH_MS);
}));

// "עבור": next question without choosing. Same short pause as a choice, so a double tap skips once.
skip.addEventListener('click', () => {
  if (skip.disabled) return;
  options.forEach((b) => { b.disabled = true; });
  skip.disabled = true;
  const mine = ticket;
  setTimeout(() => { if (mine === ticket) show(); }, CHOICE_FLASH_MS);
});

$('reset').addEventListener('click', () => { game.reset(); show(); });
$('retry').addEventListener('click', show);

show();
