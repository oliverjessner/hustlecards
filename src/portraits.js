(() => {
  'use strict';

  const PORTRAIT_PATH = /^(?:\.\/)?assets\/legendary\/[a-z0-9][a-z0-9_-]*\.webp$/;
  const failedPaths = new Set();

  function isPortraitPath(value) {
    return typeof value === 'string' && PORTRAIT_PATH.test(value);
  }

  function dimension(value, fallback) {
    return Number.isInteger(value) && value > 0 && value <= 4096 ? value : fallback;
  }

  // Only call for visible, discovered cards. A face-down card never needs an img.
  function create(portrait, { loading = 'lazy', decorative = true } = {}) {
    const layer = document.createElement('span');
    layer.className = 'card-portrait';
    if (decorative) layer.setAttribute('aria-hidden', 'true');
    const src = isPortraitPath(portrait?.src) ? `./${portrait.src.replace(/^\.\//, '')}` : null;
    if (!src || failedPaths.has(src)) {
      layer.classList.add('is-failed');
      return layer;
    }

    const image = document.createElement('img');
    image.className = 'card-portrait-image';
    image.setAttribute('alt', decorative ? '' : typeof portrait.alt === 'string' ? portrait.alt : '');
    image.setAttribute('width', String(dimension(portrait.width, 600)));
    image.setAttribute('height', String(dimension(portrait.height, 900)));
    image.setAttribute('decoding', 'async');
    image.setAttribute('loading', loading === 'eager' ? 'eager' : 'lazy');
    image.setAttribute('fetchpriority', loading === 'eager' ? 'high' : 'low');
    image.addEventListener('load', () => { layer.classList.add('is-loaded'); }, { once: true });
    image.addEventListener('error', () => {
      failedPaths.add(src);
      layer.classList.remove('is-loaded');
      layer.classList.add('is-failed');
      image.hidden = true;
    }, { once: true });
    layer.append(image);
    // Keep the stable relative URL intact: the browser handles HTTP caching.
    // Set src last, after loading hints and listeners, to avoid premature loads.
    image.setAttribute('src', src);
    return layer;
  }

  window.HustlePortraits = Object.freeze({ create, isPortraitPath });
})();
