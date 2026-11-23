'use strict';

const LOOKS = {
  hall: {
    title: 'Hall', number: '01', loop: '84', video: 'hall.webm', poster: 'hall-day.jpg', accent: '#6f8db0',
    description: 'A concrete hall with a light slot in the wall, through one full day: daylight, golden hour, dusk, night and dawn.'
  },
  'smoke-signal': {
    title: 'Smoke Signal', number: '02', loop: '60', video: 'smoke-signal.webm', poster: 'smoke-signal.jpg', accent: '#e2441f',
    description: 'Fluid smoke, slice glitches, RGB split, neon washes, rain, scanlines and grain. Unofficial Cyberpunk 2077 fan art; not approved or endorsed by CD PROJEKT RED.'
  },
  'living-water': {
    title: 'Living Water', number: '03', loop: '55', video: 'living-water.webm', poster: 'living-water.jpg', accent: '#f28c28',
    description: 'Koi swimming under a water surface, with refraction, caustic light, ripple rings and drifting motes. Built into every app as the first look.'
  },
  'the-surge': {
    title: 'The Surge', number: '04', loop: '32', video: 'the-surge.webm', poster: 'the-surge.jpg', accent: '#a99cff',
    description: 'An ink-drawn boy wreathed in white fire, with floating rocks, rising dust and drifting ash.'
  },
  embers: {
    title: 'Embers', number: '05', loop: '32', video: 'embers.webm', poster: 'embers.jpg', accent: '#ff6847',
    description: 'Warm sparks lifting off the floor of a dark red forest.'
  },
  'avenue-flow': {
    title: 'Avenue Flow', number: '06', loop: '20', video: 'avenue-flow.webm', poster: 'avenue-flow.jpg', accent: '#55b7af',
    description: 'A city at dusk from above, with traffic streaming along a long avenue. Choose Weak, Medium or Strong twinkle in the app.'
  },
  'night-wind': {
    title: 'Night Wind', number: '07', loop: '16', video: 'night-wind.webm', poster: 'night-wind.jpg', accent: '#e3cb6a',
    description: 'An ink-drawn witch under the moon, her cape billowing as wind lines streak past.'
  },
  'window-seat': {
    title: 'Window Seat', number: '08', loop: '35', video: 'window-seat.webm', poster: 'window-seat.jpg', accent: '#9cc878',
    description: 'Pixel art of a rainy city window at night. A black cat hops onto the sill, watches the city, stretches and wanders off along the desk.'
  },
  circuit: {
    title: 'Circuit', number: '09', loop: '56', video: 'circuit.webm', poster: 'circuit.jpg', accent: '#38a6dc',
    description: 'A circuit board draws itself trace by trace behind small blue tracer lights, then lets them take it back.'
  },
  'under-the-wave': {
    title: 'Under the Wave', number: '10', loop: '28', video: 'under-the-wave.webm', poster: 'under-the-wave.jpg', accent: '#85a7e8',
    description: 'A great wave builds and breaks over a little schooner, which capsizes, rights herself and sails on. Frame and color options are available in the apps.'
  },
  'hand-in-hand': {
    title: 'Hand in Hand', number: '11', loop: '16.5', video: 'hand-in-hand.webm', poster: 'hand-in-hand.jpg', accent: '#b5aa58',
    description: 'A giant in a diving suit and the little girl whose hand he holds skip across old paper, ink flying at every landing.'
  },
  'blue-visitor': {
    title: 'Blue Visitor', number: '12', loop: '32', video: 'blue-visitor.webm', poster: 'blue-visitor.jpg', accent: '#7ac9ed',
    description: 'A blue butterfly settles on her finger. She turns to stare at you; when it flies off, she looks back at her empty hand.'
  },
  'saint-marianne': {
    title: 'Saint Marianne', number: '13', loop: '24', video: 'saint-marianne.webm', poster: 'saint-marianne.jpg', accent: '#e8c43c',
    description: 'Marianne in her yellow vest, painted as a saint: a sunburst twinkles behind her head, sooty blue, white and red smoke rolls around her, and the vest flaps in the wind.'
  }
};

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const hero = document.querySelector('.hero');
const heroVideo = document.querySelector('#hero-video');
const previewImages = [...document.querySelectorAll('[data-animated]')];
const player = document.querySelector('#player');
const playerVideo = document.querySelector('#player-video');
let heroVisible = true;
let previewObserver;

function setStatic(image) {
  if (image.getAttribute('src') !== image.dataset.static) image.src = image.dataset.static;
}

function watchPreviews() {
  previewObserver?.disconnect();
  previewImages.forEach(setStatic);
  if (motionPreference.matches || player.open || !('IntersectionObserver' in window)) return;
  previewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const image = entry.target;
      if (entry.isIntersecting) {
        if (image.getAttribute('src') !== image.dataset.animated) image.src = image.dataset.animated;
      } else {
        setStatic(image);
      }
    }
  }, { rootMargin: '160px 0px', threshold: 0.05 });
  previewImages.forEach((image) => previewObserver.observe(image));
}

function syncHeroPlayback() {
  if (motionPreference.matches || document.hidden || !heroVisible || player.open) {
    heroVideo.pause();
  } else {
    heroVideo.play().catch(() => {});
  }
}

if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    heroVisible = entry.isIntersecting;
    syncHeroPlayback();
  }, { threshold: 0.05 }).observe(hero);
}

document.addEventListener('visibilitychange', syncHeroPlayback);
motionPreference.addEventListener('change', () => {
  heroVideo.autoplay = !motionPreference.matches;
  syncHeroPlayback();
  watchPreviews();
});
heroVideo.autoplay = !motionPreference.matches;
syncHeroPlayback();
watchPreviews();

const filterButtons = [...document.querySelectorAll('[data-filter]')];
const cards = [...document.querySelectorAll('.look-card')];
const filterStatus = document.querySelector('#filter-status');

filterButtons.forEach((button) => {
  const filter = button.dataset.filter;
  const count = cards.filter((card) => filter === 'all' || card.dataset.categories.split(' ').includes(filter)).length;
  button.querySelector('span').textContent = count;
  button.addEventListener('click', () => {
    let visible = 0;
    filterButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    cards.forEach((card) => {
      const show = filter === 'all' || card.dataset.categories.split(' ').includes(filter);
      card.hidden = !show;
      if (show) visible += 1;
    });
    filterStatus.textContent = `${visible} ${visible === 1 ? 'look' : 'looks'} shown.`;
    watchPreviews();
  });
});

function stopPlayer() {
  if (player.open) return;
  playerVideo.pause();
  playerVideo.removeAttribute('src');
  playerVideo.removeAttribute('poster');
  playerVideo.load();
  document.body.classList.remove('is-player-open');
  syncHeroPlayback();
  watchPreviews();
}

if (typeof player.showModal === 'function') {
  document.querySelectorAll('[data-look]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const look = LOOKS[link.dataset.look];
      if (!look) return;
      event.preventDefault();
      player.style.setProperty('--accent', look.accent);
      document.querySelector('#player-kicker').textContent = `${look.number} / ${look.loop}-SECOND LOOP`;
      document.querySelector('#player-title').textContent = look.title;
      document.querySelector('#player-description').textContent = look.description;
      const source = document.querySelector('#player-source');
      source.href = look.video;
      source.setAttribute('aria-label', `Open the original ${look.title} recording in a new tab`);
      playerVideo.poster = look.poster;
      playerVideo.src = look.video;
      playerVideo.muted = true;
      playerVideo.setAttribute('aria-label', `${look.title} video recording`);
      player.showModal();
      document.body.classList.add('is-player-open');
      syncHeroPlayback();
      watchPreviews();
      playerVideo.play().catch(() => {});
    });
  });

  document.querySelector('.player__close').addEventListener('click', () => player.close());
  player.addEventListener('click', (event) => {
    if (event.target === player) player.close();
  });
  player.addEventListener('close', stopPlayer);
}

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    window.setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  });
});
