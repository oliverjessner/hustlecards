(() => {
  'use strict';

  const STORAGE_KEY = 'hustle-cards:v1';
  // Keep the original key so existing offline exports migrate in place.
  const VERSION = 2;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_DRAW_TIMESTAMP = 8.64e15 - DAY_MS;
  const MODES = Object.freeze({ IDLE: 'IDLE', ANIMATING: 'ANIMATING', REVEALED: 'REVEALED', COMPLETED: 'COMPLETED' });
  const CARDS = Object.freeze([
    'Work in silence. Let success make the noise.',
    'Nobody cares. Work harder.',
    'Dream big. Work bigger.',
    'Outwork yesterday.',
    "The grind doesn't stop when you're tired.",
    'Be obsessed or be average.',
    'While they sleep, you build.',
    'Less talking. More doing.',
    'Your future is built after hours.',
    'Stay hungry. Stay relentless.',
    'Build assets, not excuses.',
    'Make money, not noise.',
    'Wealth is built, not wished for.',
    'Stop chasing paychecks. Start building empires.',
    'Your income follows your impact.',
    'Think bigger than your bank account.',
    'Work for freedom, not applause.',
    'Invest in yourself. Collect the returns.',
    'Success is expensive. Pay the price.',
    "The goal isn't to look rich. It's to be free.",
    'Discipline beats motivation every time.',
    'Consistency creates what motivation imagines.',
    "Show up. Even when nobody's watching.",
    'Your habits are your future.',
    'Comfort kills ambition.',
    'Do it tired. Do it scared. Just do it.',
    "Results don't negotiate with excuses.",
    'Win the morning. Own the day.',
    'Small wins compound into big victories.',
    'Be stronger than your excuses.',
    'Average is a choice.',
    "You weren't born to play small.",
    "Your only competition is yesterday's you.",
    'Think like an owner. Execute like a machine.',
    'Make your vision louder than your doubts.',
    "Don't wait for opportunity. Manufacture it.",
    'Be the person your future self needs.',
    'Pressure creates diamonds. Persistence creates legends.',
    "If your dreams don't scare you, aim higher.",
    'Become undeniable.',
    'No shortcuts. No excuses. No limits.',
    'They see the results. They never saw the sacrifice.',
    "Build something they can't ignore.",
    'Stop asking for permission to succeed.',
    "Your comfort zone doesn't pay dividends.",
    'Execute first. Celebrate later.',
    'Turn rejection into revenue.',
    "Don't chase the competition. Change the game.",
    'Make progress your addiction.',
    'The best revenge is building a life you love.'
  ].map((quote, index) => Object.freeze({ id: index + 1, quote, rarity: 'standard' })));
  const $ = (id) => document.getElementById(id);
  const ui = {
    app: $('app'), deck: $('deck'), intro: $('intro'),
    actions: $('reveal-actions'), again: $('draw-again'), completion: $('completion'),
    againLabel: $('draw-again-label') ?? $('draw-again'), newDeck: $('new-deck'),
    availability: $('draw-availability'), availabilityLabel: $('availability-label'),
    availabilityTime: $('availability-time'), notice: $('storage-notice'), live: $('live-status'),
    dialog: $('reset-dialog'), cancel: $('reset-cancel'), confirm: $('reset-confirm'),
    drawView: $('draw-view'), collection: $('collection-view'), openCollection: $('open-collection'),
    closeCollection: $('collection-close'), collectionTitle: $('collection-title'),
    progress: $('collection-progress'), meter: $('collection-meter'),
    gallery: $('collection-gallery'), grid: $('collection-grid'),
    detail: $('collection-detail'), detailBack: $('detail-back'), detailCard: $('detail-card')
  };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mouseHover = window.matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const coarsePointer = window.matchMedia('(any-pointer: coarse)');
  const activeAnimations = new Set();
  const randomWord = new Uint32Array(1);
  let storage = null;
  let storageAvailable = true;
  let mode = MODES.IDLE;
  let view = 'deck';
  let collectionScroll = 0;
  let collectionFocus = null;
  let collectionReturnFocus = null;
  let operation = 0;
  let resetFocus = null;
  let resetting = false;
  let mouseTiltSlot = null;
  let orientationSlot = null;
  let orientationOrigin = null;
  let orientationPrevious = null;
  let orientationGeneration = 0;
  let orientationPermissions = [];
  let tiltSuspended = false;

  function newDeckId() {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function emptyState() {
    return { version: VERSION, drawnIds: [], discoveredIds: [], lastDrawnId: null, lastDrawnAt: null, deckId: newDeckId(), deckGeneration: 0 };
  }

  function validIds(ids) {
    return Array.isArray(ids) ? [...new Set(ids.filter((id) => Number.isInteger(id) && id >= 1 && id <= CARDS.length))] : [];
  }

  function discoveries(...groups) {
    return [...new Set(groups.flat())].sort((a, b) => a - b);
  }

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || ![1, VERSION].includes(raw.version) || !Array.isArray(raw.drawnIds)) return null;
    const drawnIds = validIds(raw.drawnIds);
    const validDeckId = typeof raw.deckId === 'string' && raw.deckId.length > 0 && raw.deckId.length < 100;
    if (raw.version === VERSION && !validDeckId) return null;
    return {
      version: VERSION,
      drawnIds,
      discoveredIds: discoveries(drawnIds, validIds(raw.discoveredIds)),
      lastDrawnId: drawnIds.includes(raw.lastDrawnId) ? raw.lastDrawnId : drawnIds.at(-1) ?? null,
      lastDrawnAt: Number.isSafeInteger(raw.lastDrawnAt) && raw.lastDrawnAt > 0 && raw.lastDrawnAt <= MAX_DRAW_TIMESTAMP ? raw.lastDrawnAt : null,
      deckId: validDeckId ? raw.deckId : 'legacy',
      deckGeneration: Number.isSafeInteger(raw.deckGeneration) && raw.deckGeneration >= 0 ? raw.deckGeneration : 0
    };
  }

  function parseState(value) {
    try { return sanitize(JSON.parse(value)); } catch { return null; }
  }

  function temporaryStorage() {
    storageAvailable = false;
    ui.notice.hidden = false;
    ui.notice.textContent = 'Temporary deck · This browser cannot save your progress.';
  }

  let state = emptyState();
  try {
    storage = window.localStorage;
    const saved = storage.getItem(STORAGE_KEY);
    state = parseState(saved) ?? state;
    // Probe the actual write permission and repair malformed state using only our own key.
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    temporaryStorage();
  }

  function persist() {
    if (!storageAvailable) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { temporaryStorage(); }
  }

  function latestStoredState() {
    if (!storageAvailable) return state;
    try {
      const saved = storage.getItem(STORAGE_KEY);
      // Deletion or a malformed cross-tab write must not erase an active deck,
      // lifetime discoveries, or the daily lock. Resets write a valid new deck.
      const incoming = parseState(saved);
      if (incoming === null) persist();
      return incoming ?? state;
    } catch {
      temporaryStorage();
      return state;
    }
  }

  function mergeState(incoming) {
    const discoveredIds = discoveries(state.discoveredIds, incoming.discoveredIds);
    if (incoming.deckId !== state.deckId || incoming.deckGeneration !== state.deckGeneration) {
      const staleGeneration = incoming.deckGeneration < state.deckGeneration;
      const staleDraw = incoming.deckGeneration === state.deckGeneration && (incoming.lastDrawnAt ?? 0) < (state.lastDrawnAt ?? 0);
      const current = staleGeneration || staleDraw ? state : incoming;
      return { ...current, discoveredIds };
    }
    const newest = (state.lastDrawnAt ?? 0) > (incoming.lastDrawnAt ?? 0) ? state : incoming;
    return { ...newest, drawnIds: discoveries(state.drawnIds, incoming.drawnIds), discoveredIds };
  }

  function randomBelow(limit) {
    if (globalThis.crypto?.getRandomValues) {
      // Rejection sampling avoids the bias of reducing all 32-bit values modulo limit.
      const ceiling = 0x100000000 - (0x100000000 % limit);
      do { globalThis.crypto.getRandomValues(randomWord); } while (randomWord[0] >= ceiling);
      return randomWord[0] % limit;
    }
    return Math.floor(Math.random() * limit);
  }

  function nextCards() {
    const available = CARDS.filter((card) => !state.drawnIds.includes(card.id));
    // A partial Fisher–Yates shuffle samples and assigns positions in one unbiased pass.
    for (let i = 0; i < Math.min(3, available.length); i += 1) {
      const j = i + randomBelow(available.length - i);
      [available[i], available[j]] = [available[j], available[i]];
    }
    return available.slice(0, 3);
  }

  function announce(text) {
    ui.live.textContent = text;
  }

  function setMode(nextMode) {
    if (nextMode !== MODES.REVEALED) resetCardTilts();
    mode = nextMode;
    ui.app.dataset.state = mode;
    ui.deck.setAttribute('aria-busy', String(mode === MODES.ANIMATING));
    ui.deck.setAttribute('aria-label', mode === MODES.IDLE ? 'Choose a face-down card' : mode === MODES.ANIMATING ? 'Revealing your selected card' : 'Your revealed card');
    ui.completion.hidden = mode !== MODES.COMPLETED;
    ui.deck.hidden = mode === MODES.COMPLETED;
    ui.intro.hidden = mode === MODES.COMPLETED;
    ui.openCollection.disabled = mode === MODES.ANIMATING;
    updateAvailability();
    syncOrientationTilt();
  }

  function isAvailable() {
    return state.lastDrawnAt === null || Date.now() >= state.lastDrawnAt + DAY_MS;
  }

  function updateAvailability() {
    const ready = isAvailable();
    const exhausted = state.drawnIds.length === CARDS.length;
    ui.availability.dataset.available = String(ready);
    ui.availabilityLabel.textContent = ready ? (exhausted ? 'Collection complete' : 'Your next card is ready') : 'Next card in';
    ui.availabilityTime.hidden = ready;
    // This timer deliberately has no live region: seconds must not interrupt a screen reader.
    ui.availabilityTime.setAttribute('aria-live', 'off');
    if (!ready) {
      const deadline = state.lastDrawnAt + DAY_MS;
      const totalSeconds = Math.ceil(Math.max(0, deadline - Date.now()) / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      ui.availabilityTime.textContent = [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
      const date = new Date(deadline);
      // A maliciously large, but safe-integer timestamp still locks the deck without crashing date formatting.
      if (Number.isFinite(date.getTime())) {
        ui.availabilityTime.dateTime = date.toISOString();
        ui.availabilityTime.title = date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
      } else {
        ui.availabilityTime.removeAttribute('datetime');
        ui.availabilityTime.title = 'Your next card is available 24 hours after your saved draw time.';
      }
    } else {
      ui.availabilityTime.textContent = '';
      ui.availabilityTime.removeAttribute('datetime');
      ui.availabilityTime.removeAttribute('title');
    }
    ui.againLabel.textContent = exhausted ? 'COMPLETE DECK' : 'DRAW AGAIN';
    ui.actions.hidden = mode !== MODES.REVEALED || (!ready && !exhausted);
    ui.newDeck.hidden = !ready;
    ui.newDeck.disabled = !ready;
    if (mode === MODES.IDLE) {
      ui.deck.querySelectorAll('.card-button').forEach((button) => { button.disabled = !ready; });
    }
  }

  const emblem = `<svg class="card-emblem" viewBox="0 0 160 184" fill="none" aria-hidden="true">
    <path d="M80 5 151 46v92L80 179 9 138V46Z" stroke="currentColor" stroke-width=".7"/>
    <path d="m80 19 59 34v78l-59 34-59-34V53Z" stroke="currentColor" stroke-width=".5"/>
    <path d="m80 35 45 57-45 57-45-57Z" stroke="currentColor" stroke-width="1"/>
    <path d="M80 5v30m0 114v30M9 46l26 46-26 46m142-92-26 46 26 46M21 53l118 78M139 53 21 131" stroke="currentColor" stroke-width=".5"/>
    <path d="M57 111V73h8v15h30V73h8v38h-8V96H65v15Z" fill="currentColor"/>
    <path d="m80 48 3 6-3 6-3-6Zm0 76 3 6-3 6-3-6Z" fill="currentColor"/>
  </svg>`;

  function frontMarkup() {
    return `<span class="card-face card-front" aria-hidden="true">
      <span class="card-front-top"><span>THE MINDSET COLLECTION</span><span class="card-number"></span></span>
      <span class="card-quote-wrap"><span class="quote-mark" aria-hidden="true">“</span><span class="card-quote" role="blockquote"></span></span>
      <span class="card-front-rule"></span>
      <span class="card-front-bottom"><span>HUSTLE CARDS</span><span class="card-front-symbol" aria-hidden="true">✦</span></span>
    </span>`;
  }

  function collectionCard(card) {
    const item = document.createElement('li');
    item.className = 'collection-item';
    const discovered = state.discoveredIds.includes(card.id);
    const face = document.createElement(discovered ? 'button' : 'div');
    face.className = `collection-card ${discovered ? 'is-discovered' : 'is-locked'}`;
    face.dataset.cardId = String(card.id);
    face.dataset.rarity = card.rarity;
    if (discovered) {
      face.setAttribute('type', 'button');
      face.setAttribute('aria-label', `View card ${card.id} of ${CARDS.length}. ${card.quote}`);
      face.innerHTML = frontMarkup();
      fillQuote(face, card, { loading: 'lazy', portrait: view === 'collection' });
      face.addEventListener('click', () => openDetail(card.id));
    } else {
      face.setAttribute('role', 'img');
      face.setAttribute('aria-label', `Card ${card.id} of ${CARDS.length}. Locked.`);
      // There is deliberately no front, quote, title, or quote-bearing label here.
      face.innerHTML = `<span class="card-face card-back" aria-hidden="true"><span class="card-back-inner">
        <span class="collection-lock-number">Nº ${String(card.id).padStart(2, '0')}</span>
        ${emblem}<span class="card-back-title">HUSTLE</span><span class="card-back-subtitle">C A R D S</span>
        <span class="collection-lock-status">LOCKED</span>
      </span></span>`;
    }
    item.append(face);
    return item;
  }

  function galleryButton(id) {
    return [...ui.grid.querySelectorAll('.is-discovered')].find((button) => button.dataset.cardId === String(id));
  }

  function mountCollectionPortraits() {
    for (const button of ui.grid.querySelectorAll('.is-discovered')) {
      const card = CARDS.find((entry) => entry.id === Number(button.dataset.cardId));
      if (card) mountPortrait(button, card, 'lazy');
    }
  }

  let renderedDiscoveries = null;
  function renderCollection() {
    const count = state.discoveredIds.length;
    ui.progress.textContent = `${count} OF ${CARDS.length} DISCOVERED`;
    ui.meter.value = count;
    ui.meter.setAttribute('aria-valuetext', `${count} of ${CARDS.length} discovered`);
    const signature = state.discoveredIds.join(',');
    if (signature === renderedDiscoveries) return;
    const focusedId = document.activeElement?.closest('.is-discovered')?.dataset.cardId;
    const scroll = ui.collection.scrollTop;
    // Keep existing unlocked faces and their images mounted. Another tab unlocking
    // a card must not replace loaded portraits or disturb the reader's focus.
    const existing = new Map([...ui.grid.querySelectorAll('.collection-card')].map((face) => [Number(face.dataset.cardId), face]));
    for (const card of CARDS) {
      const face = existing.get(card.id);
      if (!face) ui.grid.append(collectionCard(card));
      else if (face.classList.contains('is-locked') && state.discoveredIds.includes(card.id)) {
        face.parentElement.replaceChildren(...collectionCard(card).children);
      }
    }
    renderedDiscoveries = signature;
    if (view === 'collection' && focusedId) galleryButton(focusedId)?.focus({ preventScroll: true });
    ui.collection.scrollTop = scroll;
  }

  function setView(nextView) {
    view = nextView;
    ui.app.dataset.view = view;
    ui.drawView.hidden = view !== 'deck';
    ui.collection.hidden = view === 'deck';
    ui.gallery.hidden = view === 'detail';
    ui.detail.hidden = view !== 'detail';
    if (view === 'collection') mountCollectionPortraits();
    if (view === 'deck' && mode === MODES.REVEALED) {
      const card = CARDS.find((entry) => entry.id === state.lastDrawnId);
      const slot = ui.deck.querySelector('.card-slot');
      if (card && slot) mountPortrait(slot, card, 'eager');
    }
    resetCardTilts();
    syncOrientationTilt();
  }

  function openCollection() {
    if (view !== 'deck' || mode === MODES.ANIMATING || ui.dialog.open) return;
    refreshFromStorage();
    collectionReturnFocus = document.activeElement;
    renderCollection();
    setView('collection');
    ui.collection.scrollTop = collectionScroll;
    ui.collectionTitle.focus({ preventScroll: true });
  }

  function closeCollection() {
    if (view === 'deck') return;
    if (view === 'collection') collectionScroll = ui.collection.scrollTop;
    setView('deck');
    ui.detailCard.replaceChildren();
    if (collectionReturnFocus?.isConnected) collectionReturnFocus.focus({ preventScroll: true });
    else ui.openCollection.focus({ preventScroll: true });
  }

  function openDetail(id) {
    if (view !== 'collection' || !state.discoveredIds.includes(id)) return;
    const card = CARDS.find((entry) => entry.id === id);
    if (!card) return;
    collectionScroll = ui.collection.scrollTop;
    collectionFocus = id;
    ui.detailCard.dataset.cardId = String(id);
    ui.detailCard.dataset.rarity = card.rarity;
    ui.detailCard.setAttribute('aria-label', `Card ${id} of ${CARDS.length}. ${card.quote}`);
    ui.detailCard.innerHTML = frontMarkup();
    fillQuote(ui.detailCard, card);
    ui.detailCard.querySelector('.card-front').setAttribute('aria-hidden', 'false');
    setView('detail');
    ui.collection.scrollTop = 0;
    ui.detailCard.focus({ preventScroll: true });
  }

  function closeDetail() {
    if (view !== 'detail') return;
    setView('collection');
    ui.detailCard.replaceChildren();
    ui.collection.scrollTop = collectionScroll;
    (galleryButton(collectionFocus) ?? ui.collectionTitle).focus({ preventScroll: true });
  }

  function resetCardTilt(slot) {
    if (mouseTiltSlot === slot) mouseTiltSlot = null;
    if (orientationSlot === slot) {
      orientationOrigin = null;
      orientationPrevious = null;
    }
    slot.classList.remove('is-tilting');
    slot.style.removeProperty('--tilt-x');
    slot.style.removeProperty('--tilt-y');
    slot.style.removeProperty('--tilt-shift-x');
    slot.style.removeProperty('--tilt-shift-y');
  }

  function resetCardTilts() {
    mouseTiltSlot = null;
    orientationOrigin = null;
    orientationPrevious = null;
    ui.deck.querySelectorAll('.card-slot').forEach(resetCardTilt);
  }

  function applyCardTilt(slot, horizontal, vertical) {
    const x = Math.max(-1, Math.min(1, horizontal));
    const y = Math.max(-1, Math.min(1, vertical));
    slot.style.setProperty('--tilt-x', `${(-y * 14).toFixed(2)}deg`);
    slot.style.setProperty('--tilt-y', `${(x * 14).toFixed(2)}deg`);
    slot.style.setProperty('--tilt-shift-x', `${(x * 8).toFixed(2)}px`);
    slot.style.setProperty('--tilt-shift-y', `${(y * 8).toFixed(2)}px`);
    slot.classList.add('is-tilting');
  }

  function screenAngle() {
    const angle = window.screen?.orientation?.angle;
    const fallback = Number.isFinite(window.orientation) ? window.orientation : 0;
    return (((Number.isFinite(angle) ? angle : fallback) % 360) + 360) % 360;
  }

  function angleDifference(angle, origin) {
    return ((angle - origin + 540) % 360) - 180;
  }

  function handleDeviceOrientation(event) {
    if (!orientationSlot || view !== 'deck' || mode !== MODES.REVEALED || tiltSuspended || document.hidden || reducedMotion.matches || mouseTiltSlot) return;
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    const pose = { beta: event.beta, gamma: event.gamma, angle: screenAngle() };
    // Calibrate in the user's current grip. Euler branch changes should recenter,
    // rather than suddenly throwing the card to the opposite edge.
    const jumped = orientationPrevious && (Math.abs(angleDifference(pose.beta, orientationPrevious.beta)) > 45 || Math.abs(angleDifference(pose.gamma, orientationPrevious.gamma)) > 45);
    if (!orientationOrigin || pose.angle !== orientationOrigin.angle || jumped) {
      resetCardTilt(orientationSlot);
      orientationOrigin = pose;
      orientationPrevious = pose;
      return;
    }
    orientationPrevious = pose;
    const beta = angleDifference(pose.beta, orientationOrigin.beta);
    const gamma = angleDifference(pose.gamma, orientationOrigin.gamma);
    const radians = pose.angle * Math.PI / 180;
    // Sensor axes follow the device's natural orientation, even in landscape.
    applyCardTilt(orientationSlot,
      (gamma * Math.cos(radians) - beta * Math.sin(radians)) / 20,
      (beta * Math.cos(radians) + gamma * Math.sin(radians)) / 20);
  }

  function stopOrientationTilt() {
    orientationGeneration += 1;
    for (const permission of orientationPermissions) permission.removeEventListener?.('change', resetTiltInputs);
    orientationPermissions = [];
    if (orientationSlot) {
      window.removeEventListener('deviceorientation', handleDeviceOrientation);
      resetCardTilt(orientationSlot);
    }
    orientationSlot = null;
    orientationOrigin = null;
    orientationPrevious = null;
  }

  function canUseOrientationTilt() {
    return window.isSecureContext && window.DeviceOrientationEvent && (coarsePointer.matches || navigator.maxTouchPoints > 0)
      && view === 'deck' && mode === MODES.REVEALED && !document.hidden && !tiltSuspended && !reducedMotion.matches;
  }

  async function syncOrientationTilt() {
    stopOrientationTilt();
    if (!canUseOrientationTilt()) return;
    const generation = orientationGeneration;
    // Never request permission. Newer browsers may expose requestPermission even
    // when sensors are already allowed: query that state silently instead.
    if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      if (!navigator.permissions?.query) return;
      let permissions;
      try {
        permissions = await Promise.all(['accelerometer', 'gyroscope'].map((name) => navigator.permissions.query({ name })));
      } catch { return; }
      if (generation !== orientationGeneration || !canUseOrientationTilt()) return;
      orientationPermissions = permissions;
      for (const permission of permissions) permission.addEventListener?.('change', resetTiltInputs);
      if (!permissions.every((permission) => permission.state === 'granted')) return;
    }
    orientationSlot = ui.deck.querySelector('.card-slot');
    if (orientationSlot) window.addEventListener('deviceorientation', handleDeviceOrientation, { passive: true });
  }

  function cardElement(card, index, total, revealed = false) {
    const slot = document.createElement('div');
    slot.className = 'card-slot';
    slot.dataset.cardId = String(card.id);
    slot.dataset.position = total === 1 ? 'single' : total === 2 ? ['pair-left', 'pair-right'][index] : ['left', 'center', 'right'][index];
    slot.innerHTML = `<div class="card-float"><button class="card-button" type="button" aria-label="Draw card ${index + 1} of ${total}">
      <span class="card-rotor">
        <span class="card-face card-back" aria-hidden="true">
          <span class="card-back-inner">
            <span class="card-corner" data-corner="tl">✦</span><span class="card-corner" data-corner="tr">✦</span>
            <span class="card-corner" data-corner="bl">✦</span><span class="card-corner" data-corner="br">✦</span>
            <span class="card-back-label">THE MINDSET COLLECTION</span>
            ${emblem}
            <span class="card-back-title">HUSTLE</span><span class="card-back-subtitle">C A R D S</span>
            <span class="card-back-edition"><span>EST.</span><span>MMXXVI</span></span>
          </span>
        </span>
        ${frontMarkup()}
      </span>
    </button></div>`;
    const button = slot.querySelector('.card-button');
    button.addEventListener('click', () => draw(card, slot));
    button.addEventListener('pointermove', (event) => {
      if (view !== 'deck' || mode !== MODES.IDLE || event.pointerType === 'touch' || reducedMotion.matches) return;
      const rect = button.getBoundingClientRect();
      button.style.setProperty('--pointer-x', `${((event.clientX - rect.left) / rect.width) * 100}%`);
      button.style.setProperty('--pointer-y', `${((event.clientY - rect.top) / rect.height) * 100}%`);
    });
    button.addEventListener('pointerleave', () => {
      button.style.removeProperty('--pointer-x');
      button.style.removeProperty('--pointer-y');
    });
    // The slot stays still while its visual child tilts, keeping pointer coordinates stable.
    // Listen here because the revealed card's button is disabled after drawing.
    slot.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      if (view !== 'deck' || mode !== MODES.REVEALED || !mouseHover.matches || reducedMotion.matches || tiltSuspended || document.hidden) {
        resetCardTilt(slot);
        return;
      }
      const rect = slot.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      mouseTiltSlot = slot;
      orientationOrigin = null;
      orientationPrevious = null;
      applyCardTilt(slot, (event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
    });
    const leavePointer = (event) => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') return;
      resetCardTilt(slot);
    };
    slot.addEventListener('pointerleave', leavePointer);
    slot.addEventListener('pointercancel', leavePointer);
    if (revealed) {
      fillQuote(slot, card, { portrait: view === 'deck' });
      finishCard(slot, card);
    }
    return slot;
  }

  function mountPortrait(slot, card, loading) {
    if (!card.portrait || !state.discoveredIds.includes(card.id)) return;
    const front = slot.querySelector('.card-front');
    if (!front || front.querySelector('.card-portrait')) return;
    front.classList.add('has-portrait');
    front.prepend(window.HustlePortraits.create(card.portrait, { loading }));
  }

  function fillQuote(slot, card, { loading = 'eager', portrait = true } = {}) {
    const quote = slot.querySelector('.card-quote');
    quote.textContent = card.quote;
    quote.classList.toggle('quote-long', card.quote.length > 42);
    slot.querySelector('.card-number').textContent = `Nº ${String(card.id).padStart(2, '0')} / 50`;
    if (portrait) mountPortrait(slot, card, loading);
  }

  function finishCard(slot, card) {
    slot.classList.add('is-chosen', 'is-revealed');
    slot.querySelector('.card-front').setAttribute('aria-hidden', 'false');
    const button = slot.querySelector('.card-button');
    button.disabled = true;
    button.setAttribute('aria-label', `Card ${card.id} of ${CARDS.length}. ${card.quote}`);
  }

  function cancelAnimations() {
    operation += 1;
    for (const animation of activeAnimations) animation.cancel();
    activeAnimations.clear();
  }

  function animate(element, keyframes, options) {
    if (!element.animate || reducedMotion.matches) return Promise.resolve();
    const animation = element.animate(keyframes, options);
    activeAnimations.add(animation);
    return animation.finished.catch(() => {}).finally(() => {
      activeAnimations.delete(animation);
      animation.cancel();
    });
  }

  function renderRound(focus = false) {
    cancelAnimations();
    if (!isAvailable() && state.lastDrawnId !== null && state.drawnIds.length < CARDS.length) {
      restoreLastCard();
      return;
    }
    const cards = nextCards();
    ui.deck.replaceChildren();
    if (cards.length === 0) {
      setMode(MODES.COMPLETED);
      announce("You've drawn them all. 50 cards. 50 reminders to keep going.");
      if (focus && view === 'deck') {
        (ui.newDeck.hidden ? ui.openCollection : ui.newDeck).focus({ preventScroll: true });
      }
      return;
    }
    cards.forEach((card, index) => ui.deck.append(cardElement(card, index, cards.length)));
    setMode(MODES.IDLE);
    if (focus && view === 'deck' && isAvailable()) ui.deck.querySelector('.card-button').focus({ preventScroll: true });
  }

  function restoreLastCard() {
    cancelAnimations();
    const lastCard = CARDS.find((card) => card.id === state.lastDrawnId);
    if (!lastCard) return renderRound();
    ui.deck.replaceChildren(cardElement(lastCard, 0, 1, true));
    setMode(MODES.REVEALED);
    if (view === 'deck') announce(`Your last card, number ${lastCard.id}. ${lastCard.quote}`);
  }

  async function draw(card, selected) {
    if (view !== 'deck' || mode !== MODES.IDLE || !isAvailable()) return;
    setMode(MODES.ANIMATING);
    const token = ++operation;
    ui.deck.querySelectorAll('.card-button').forEach((button) => { button.disabled = true; });

    const commitSelection = () => {
      if (token !== operation) return false;
      state = mergeState(latestStoredState());
      // Recheck the actual clock inside the shared lock; stale tabs and queued clicks cannot bypass a cooldown.
      if (!isAvailable()) {
        if (state.lastDrawnId !== null) restoreLastCard();
        else setMode(MODES.IDLE);
        return false;
      }
      // A second tab may have selected this card since the current fan was dealt.
      if (state.drawnIds.includes(card.id)) {
        renderRound(true);
        announce('That card was drawn in another tab. Choose a fresh card.');
        return false;
      }
      state.drawnIds = discoveries(state.drawnIds, [card.id]);
      state.discoveredIds = discoveries(state.discoveredIds, [card.id]);
      state.lastDrawnId = card.id;
      state.lastDrawnAt = Date.now();
      persist(); // Save before any reveal animation, even when the tab closes mid-flip.
      renderCollection();
      updateAvailability();
      fillQuote(selected, card);
      return true;
    };

    let committed;
    if (navigator.locks?.request && storageAvailable) {
      try { committed = await navigator.locks.request(STORAGE_KEY, commitSelection); }
      catch { committed = commitSelection(); }
    } else {
      committed = commitSelection();
    }
    if (!committed || token !== operation) return;

    const slots = [...ui.deck.querySelectorAll('.card-slot')];
    const origin = getComputedStyle(selected).transform;
    const revealScale = getComputedStyle(ui.deck).getPropertyValue('--reveal-scale').trim() || '1.06';
    const destination = `translate3d(-50%, -50%, 50px) rotate(0deg) scale(${revealScale})`;
    selected.classList.add('is-chosen');
    const animations = [];
    for (const [index, slot] of slots.entries()) {
      if (slot === selected) continue;
      const from = getComputedStyle(slot).transform;
      const direction = index < slots.indexOf(selected) ? -1 : 1;
      slot.classList.add('is-dismissed');
      animations.push(animate(slot, [
        { transform: from, opacity: 1 },
        { transform: `${from === 'none' ? '' : from} translate3d(${direction * 190}px, 24px, -100px) rotate(${direction * 12}deg)`, opacity: 0 }
      ], { duration: 500, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' }));
    }
    animations.push(animate(selected, [
      { transform: origin },
      { transform: destination, offset: 0.78 },
      { transform: destination }
    ], { duration: 850, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' }));
    const rotor = selected.querySelector('.card-rotor');
    // The CSS final pose is installed beneath the animation, avoiding a snap on finish.
    selected.classList.add('is-revealed');
    animations.push(animate(rotor, [
      { transform: 'rotateY(0deg)' },
      { transform: 'rotateY(180deg)' }
    ], { duration: 800, delay: 300, easing: 'cubic-bezier(.45, .05, .2, 1)', fill: 'both' }));
    await Promise.all(animations);
    if (token !== operation) return;
    for (const slot of slots) if (slot !== selected) slot.remove();
    finishCard(selected, card);
    setMode(MODES.REVEALED);
    announce(`Card ${card.id} of ${CARDS.length}. ${card.quote}`);
    if (view !== 'deck') return;
    if (!ui.actions.hidden) ui.again.focus({ preventScroll: true });
    else {
      selected.tabIndex = -1;
      selected.focus({ preventScroll: true });
    }
  }

  function openReset() {
    if (view !== 'deck' || mode !== MODES.COMPLETED || ui.dialog.open) return;
    state = mergeState(latestStoredState());
    updateAvailability();
    if (!isAvailable() || state.drawnIds.length !== CARDS.length) return;
    resetFocus = document.activeElement;
    ui.dialog.showModal();
    ui.cancel.focus();
  }

  function closeReset() {
    ui.dialog.close();
    if (resetFocus?.isConnected) resetFocus.focus({ preventScroll: true });
  }

  ui.again.addEventListener('click', () => {
    if (view === 'deck' && mode === MODES.REVEALED) {
      state = mergeState(latestStoredState());
      if (!isAvailable() && state.drawnIds.length < CARDS.length) {
        updateAvailability();
        return;
      }
      renderRound(true);
      if (mode === MODES.IDLE) announce('A fresh choice. Choose your card.');
    }
  });
  ui.openCollection.addEventListener('click', openCollection);
  ui.closeCollection.addEventListener('click', closeCollection);
  ui.detailBack.addEventListener('click', closeDetail);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || ui.dialog.open || view === 'deck') return;
    event.preventDefault();
    if (view === 'detail') closeDetail();
    else closeCollection();
  });
  ui.newDeck.addEventListener('click', openReset);
  ui.cancel.addEventListener('click', closeReset);
  ui.dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeReset();
  });
  ui.dialog.addEventListener('click', (event) => {
    if (event.target !== ui.dialog) return;
    const rect = ui.dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeReset();
  });
  ui.confirm.addEventListener('click', async () => {
    if (!ui.dialog.open || resetting) return;
    resetting = true;
    ui.confirm.disabled = true;
    const commitReset = () => {
      if (!ui.dialog.open) return;
      state = mergeState(latestStoredState());
      // Reset is only available after the daily lock expires, including stale confirmation dialogs.
      if (!isAvailable() || state.drawnIds.length !== CARDS.length) {
        closeReset();
        restoreLastCard();
        return;
      }
      cancelAnimations();
      const { discoveredIds, deckGeneration } = state;
      state = { ...emptyState(), discoveredIds, deckGeneration: deckGeneration + 1 };
      persist();
      renderCollection();
      ui.dialog.close();
      renderRound(true);
      announce('A new deck. All 50 cards are waiting.');
    };
    try {
      if (navigator.locks?.request && storageAvailable) {
        try { await navigator.locks.request(STORAGE_KEY, commitReset); }
        catch { commitReset(); }
      } else commitReset();
    } finally {
      resetting = false;
      ui.confirm.disabled = false;
    }
  });

  function refreshFromStorage() {
    const incoming = latestStoredState();
    const merged = mergeState(incoming);
    const changed = merged.deckId !== state.deckId || merged.deckGeneration !== state.deckGeneration || merged.lastDrawnId !== state.lastDrawnId || merged.lastDrawnAt !== state.lastDrawnAt || merged.drawnIds.join(',') !== state.drawnIds.join(',');
    state = merged;
    // Reconcile monotonic discoveries (including stale tabs from earlier decks).
    // Compare canonical arrays to avoid storage-event ping-pong between tabs.
    if (JSON.stringify(merged) !== JSON.stringify(incoming)) persist();
    renderCollection();
    if (!changed) {
      updateAvailability();
      return;
    }
    if (ui.dialog.open) closeReset();
    cancelAnimations();
    if (state.lastDrawnId === null) renderRound();
    else if (mode === MODES.COMPLETED && state.drawnIds.length === CARDS.length) setMode(MODES.COMPLETED);
    else restoreLastCard();
  }

  window.addEventListener('storage', (event) => {
    if (!storageAvailable || event.storageArea !== storage || (event.key !== STORAGE_KEY && event.key !== null)) return;
    refreshFromStorage();
  });
  function resumeTilts() {
    tiltSuspended = false;
    refreshFromStorage();
    syncOrientationTilt();
  }

  function suspendTilts() {
    tiltSuspended = true;
    stopOrientationTilt();
    resetCardTilts();
  }

  function resetTiltInputs() {
    resetCardTilts();
    syncOrientationTilt();
  }

  window.addEventListener('focus', resumeTilts);
  window.addEventListener('blur', suspendTilts);
  window.addEventListener('pageshow', resumeTilts);
  window.addEventListener('pagehide', suspendTilts);
  window.addEventListener('orientationchange', resetTiltInputs);
  window.screen?.orientation?.addEventListener?.('change', resetTiltInputs);
  reducedMotion.addEventListener('change', resetTiltInputs);
  mouseHover.addEventListener('change', resetTiltInputs);
  coarsePointer.addEventListener('change', resetTiltInputs);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopOrientationTilt();
      resetCardTilts();
    } else {
      refreshFromStorage();
      syncOrientationTilt();
    }
  });
  window.setInterval(updateAvailability, 1000);

  setView('deck');
  renderCollection();
  if (state.lastDrawnId !== null) restoreLastCard();
  else renderRound();
})();
