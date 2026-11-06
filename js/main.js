import { createDataSource } from './data-source.js';
import { createHill } from './hill.js';
import { CHOICE_FLASH_MS } from './config.js';

const LABELS = { artists: 'איזו להקה או אמן?', albums: 'איזה אלבום?' };

const data = createDataSource();
const $ = (id) => document.getElementById(id);
const options = [...document.querySelectorAll('button.option')];
const skip = $('skip');

let game = null;     // { type, hill }
let lastType = null; // for "try again"
let ticket = 0;      // bumps when a game starts or is abandoned; stale timers and loads check it

function setState(state) {
  document.body.dataset.state = state;
  if (state !== 'question') {
    options.forEach((b) => { b.disabled = true; });
    skip.disabled = true;
  }
}

// A picture; until it loads the previous one stays hidden, and if it can't load the first letter of
// the name is shown instead.
function showPicture(box, item) {
  const img = box.querySelector('img');
  box.querySelector('.initial').textContent = item.title.trim().charAt(0).toUpperCase();
  box.classList.remove('no-image');
  img.onload = () => box.classList.remove('img-pending');
  img.onerror = () => { box.classList.remove('img-pending'); box.classList.add('no-image'); };
  if (item.image) {
    const same = img.getAttribute('src') === item.image;
    box.classList.add('img-pending');
    img.src = item.image;
    // The same picture again fires no new load event; it is already there.
    if (same && img.complete) {
      box.classList.remove('img-pending');
      if (img.naturalWidth === 0) box.classList.add('no-image');
    }
  } else {
    img.removeAttribute('src');
    box.classList.add('no-image');
  }
}

// Start downloading pictures before they are shown, so they come from the browser's cache.
function preload(item) {
  if (!item.image) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = item.image;
}

const metaLine = (item) => (game.type === 'albums' ? [item.artist, item.year].filter(Boolean).join(' · ') : '');

const shuffled = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

// A new game. Challengers come from every genre: the game starts as soon as one genre's list has
// loaded, and the other genres are mixed in in the background (an artist listed in several genres
// shows up once).
async function startGame(type) {
  lastType = type;
  const mine = ++ticket;
  const load = (genre) => (type === 'artists' ? data.bands(genre) : data.albums(genre));
  setState('loading');
  try {
    const genres = shuffled(await data.genres());
    let items = [];
    let next = 0;
    while (items.length < 2 && next < genres.length && next < 5) {
      const genre = genres[next++];
      try {
        items = await load(genre);
      } catch (err) {
        console.warn(`Could not load ${type} of "${genre}":`, err.message);
        items = [];
      }
    }
    if (items.length < 2) throw new Error(`no genre with enough ${type}`);
    if (mine !== ticket) return;
    game = { type, hill: createHill(items) };
    render();
    for (const genre of genres.slice(next)) {
      try {
        const more = await load(genre);
        if (mine !== ticket) return;
        game.hill.add(more);
      } catch (err) {
        console.warn(`Could not load ${type} of "${genre}":`, err.message);
      }
    }
  } catch (err) {
    if (mine !== ticket) return;
    console.warn('Could not start a game:', err);
    setState('error');
  }
}

function render() {
  const { hill, type } = game;
  $('question-label').textContent = LABELS[type];
  hill.pair.forEach((item, side) => {
    const button = options[side];
    button.querySelector('.title').textContent = item.title;
    button.querySelector('.meta').textContent = metaLine(item);
    showPicture(button, item);
    button.classList.toggle('king', hill.kingSide === side);
    button.classList.remove('chosen');
    button.disabled = false;
  });
  hill.upcoming(2).forEach(preload);
  skip.disabled = false;
  setState('question');
}

function showEnd() {
  const { hill } = game;
  const box = document.querySelector('.winner');
  box.querySelector('.title').textContent = hill.winner.title;
  box.querySelector('.meta').textContent = metaLine(hill.winner);
  showPicture(box, hill.winner);
  setState('end');
}

// After a short pause (so a double tap counts once), apply a move and show what comes next.
function afterPause(move) {
  options.forEach((b) => { b.disabled = true; });
  skip.disabled = true;
  const mine = ticket;
  setTimeout(() => {
    if (mine !== ticket) return;
    move();
    if (game.hill.done) showEnd();
    else render();
  }, CHOICE_FLASH_MS);
}

options.forEach((button, side) => button.addEventListener('click', () => {
  if (button.disabled) return;
  button.classList.add('chosen');
  afterPause(() => game.hill.choose(side));
}));

skip.addEventListener('click', () => {
  if (skip.disabled) return;
  afterPause(() => game.hill.skip());
});

function backToStart() {
  ticket += 1;
  game = null;
  setState('start');
}

document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => startGame(b.dataset.type)));
$('reset').addEventListener('click', backToStart);
$('new-game').addEventListener('click', backToStart);
$('retry').addEventListener('click', () => startGame(lastType));

setState('start');
