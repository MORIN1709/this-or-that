import { createDataSource } from './data-source.js';
import { createHill } from './hill.js';
import { CHOICE_FLASH_MS } from './config.js';

const LABELS = { artists: 'איזו להקה או אמן?', albums: 'איזה אלבום?' };

const data = createDataSource();
const $ = (id) => document.getElementById(id);
const options = [...document.querySelectorAll('button.option')];
const skip = $('skip');

let game = null;     // { type, genre, hill }
let lastType = null; // for "try again"
let ticket = 0;      // bumps when a game starts or is abandoned; stale timers and loads check it

function setState(state) {
  document.body.dataset.state = state;
  if (state !== 'question') {
    options.forEach((b) => { b.disabled = true; });
    skip.disabled = true;
  }
}

const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

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

// A new game: one random sub-genre whose list loads and has at least two items.
async function startGame(type) {
  lastType = type;
  const mine = ++ticket;
  setState('loading');
  try {
    const genres = await data.genres();
    let items = [];
    let genre = null;
    for (let attempt = 0; attempt < 5 && items.length < 2; attempt++) {
      genre = pickRandom(genres);
      try {
        items = type === 'artists' ? await data.bands(genre) : await data.albums(genre);
      } catch (err) {
        console.warn(`Could not load ${type} of "${genre}":`, err.message);
        items = [];
      }
    }
    if (items.length < 2) throw new Error(`no genre with enough ${type}`);
    if (mine !== ticket) return;
    game = { type, genre, hill: createHill(items) };
    render();
  } catch (err) {
    if (mine !== ticket) return;
    console.warn('Could not start a game:', err);
    setState('error');
  }
}

function render() {
  const { hill, type, genre } = game;
  $('question-label').textContent = LABELS[type];
  $('genre').textContent = genre;
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
  const { hill, genre } = game;
  const box = document.querySelector('.winner');
  $('end-genre').textContent = genre;
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
