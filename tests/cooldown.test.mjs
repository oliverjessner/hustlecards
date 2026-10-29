import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const markup = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
const KEY = 'hustle-cards:v1';
const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

// A small DOM adapter runs the unchanged app IIFE. Assertions use the rendered
// controls and real serialized application state, rather than copied app logic.
class Element {
  constructor(tag = 'div', document = null) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.classes = new Set();
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this._text = '';
    this.style = {
      setProperty: (name, value) => { this.style[name] = value; },
      removeProperty: (name) => { delete this.style[name]; }
    };
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, force) => {
        const enabled = force ?? !this.classes.has(name);
        enabled ? this.classes.add(name) : this.classes.delete(name);
        return enabled;
      }
    };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) { this._text = ''; this.replaceChildren(); parse(value, this); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'disabled') this.disabled = false; if (name === 'hidden') this.hidden = false; }
  matches(selector) {
    if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName.toLowerCase() === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.append(...children); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
  async dispatch(type, extra = {}) { await Promise.all((this.listeners.get(type) ?? []).map(callback => callback({ target: this, preventDefault() {}, ...extra }))); }
  async click() { if (!this.disabled) await this.dispatch('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  get isConnected() { return this.parentElement !== null; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 300, width: 200, height: 300 }; }
}

function parse(html, root) {
  const stack = [root];
  const voidTags = new Set(['meta', 'link', 'br', 'hr', 'input', 'path']);
  for (const part of html.matchAll(/<([^>]+)>|([^<]+)/g)) {
    if (part[2]) { stack.at(-1)._text += part[2]; continue; }
    const token = part[1];
    if (/^[!?]/.test(token)) continue;
    if (token.startsWith('/')) { if (stack.length > 1) stack.pop(); continue; }
    const tag = token.match(/^([\w-]+)/)?.[1];
    if (!tag) continue;
    const element = new Element(tag, root.ownerDocument ?? root);
    for (const attribute of token.slice(tag.length).matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+)))?/g)) {
      element.setAttribute(attribute[1], attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    }
    stack.at(-1).append(element);
    if (!token.endsWith('/') && !voidTags.has(tag)) stack.push(element);
  }
}

function loadApp({ saved = null, now = NOW, storageBlocked = false, locks = true } = {}) {
  const document = new Element('#document');
  document.ownerDocument = document;
  document.getElementById = id => document.querySelector(`#${id}`);
  document.createElement = tag => new Element(tag, document);
  document.visibilityState = 'visible';
  parse(markup, document);
  const store = new Map(saved === null ? [] : [[KEY, typeof saved === 'string' ? saved : JSON.stringify(saved)]]);
  const writes = [];
  const storage = {
    getItem(key) { if (storageBlocked) throw new Error('Storage blocked'); return store.get(key) ?? null; },
    setItem(key, value) { if (storageBlocked) throw new Error('Storage blocked'); store.set(key, value); writes.push(JSON.parse(value)); },
    removeItem(key) { store.delete(key); }
  };
  const events = new Map();
  const intervals = [];
  let currentTime = now;
  class Clock extends Date { static now() { return currentTime; } }
  const window = {
    localStorage: storage,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    addEventListener(type, callback) { if (!events.has(type)) events.set(type, []); events.get(type).push(callback); },
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    clearInterval() {},
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {}
  };
  const context = {
    window, document, navigator: locks ? { locks: { request: typeof locks === 'function' ? locks : async (_name, callback) => callback() } } : {},
    Date: Clock,
    crypto: { randomUUID: () => 'test-deck', getRandomValues(array) { array.fill(0); return array; } },
    getComputedStyle: () => ({ transform: 'none', getPropertyValue: () => '' }),
    setInterval: window.setInterval, clearInterval: window.clearInterval,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    console
  };
  vm.runInNewContext(script, context, { filename: 'src/app.js' });
  return {
    document, storage, store, writes,
    get: id => document.getElementById(id),
    get state() { return JSON.parse(store.get(KEY)); },
    get mode() { return document.getElementById('app').dataset.state; },
    slots: () => document.getElementById('deck').querySelectorAll('.card-slot'),
    buttons: () => document.getElementById('deck').querySelectorAll('.card-button'),
    tick(time) { currentTime = time; intervals.forEach(callback => callback()); },
    emit(type, event = {}) { (events.get(type) ?? []).forEach(callback => callback(event)); }
  };
}

function savedState(lastDrawnAt = NOW, drawnIds = [1]) {
  return { version: 1, drawnIds, lastDrawnId: drawnIds.at(-1), lastDrawnAt, deckId: 'test-deck' };
}

async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }

// These checks deliberately exercise UI events from the complete source script.
test('selection immediately stores its timestamp and blocks extra draws for a full day', async () => {
  const app = loadApp();
  assert.equal(app.buttons().length, 3);
  assert.equal(new Set(app.slots().map(slot => slot.dataset.cardId)).size, 3);
  const [first, second] = app.buttons();
  const selecting = first.click();
  assert.equal(app.state.lastDrawnAt, NOW);
  assert.equal(app.state.drawnIds.length, 1);
  await second.dispatch('click');
  await selecting;
  await flush();
  assert.equal(app.state.drawnIds.length, 1);
  assert.equal(app.mode, 'REVEALED');
  assert.equal(app.get('draw-again').hidden || app.get('reveal-actions').hidden, true);
  await app.get('draw-again').dispatch('click');
  assert.equal(app.mode, 'REVEALED');
  app.tick(NOW + DAY - 1);
  assert.equal(app.get('draw-again').hidden || app.get('reveal-actions').hidden, true);
  app.tick(NOW + DAY);
  assert.equal(app.get('draw-again').hidden, false);
  assert.equal(app.get('reveal-actions').hidden, false);
  await app.get('draw-again').click();
  assert.equal(app.mode, 'IDLE');
  assert.equal(app.buttons().length, 3);
  await app.buttons()[0].click();
  await flush();
  assert.equal(app.state.drawnIds.length, 2);
  assert.equal(app.state.lastDrawnAt, NOW + DAY);
});

test('reload restores the quote and cooldown, while the countdown updates from wall time', () => {
  const app = loadApp({ saved: savedState(NOW), now: NOW + 1000 });
  assert.equal(app.mode, 'REVEALED');
  assert.equal(app.slots()[0].dataset.cardId, '1');
  assert.equal(app.get('draw-again').hidden || app.get('reveal-actions').hidden, true);
  const initialText = app.get('availability-time').textContent;
  app.tick(NOW + 2000);
  assert.notEqual(app.get('availability-time').textContent, initialText);
  app.tick(NOW + DAY);
  assert.equal(app.get('draw-again').hidden, false);
  assert.equal(app.get('reveal-actions').hidden, false);
});

test('legacy saves without a timestamp remain usable; invalid timestamps are repaired', async () => {
  for (const invalid of [undefined, null, -10, '123', 1e30, 8.64e15]) {
    const app = loadApp({ saved: { ...savedState(), lastDrawnAt: invalid } });
    assert.equal(app.state.lastDrawnAt, null);
    assert.equal(app.get('draw-again').hidden, false);
    await app.get('draw-again').click();
    assert.equal(app.mode, 'IDLE');
    assert.ok(app.slots().every(slot => slot.dataset.cardId !== '1'));
  }
});

test('a newer draw in persisted storage is checked again before committing a stale card', async () => {
  const app = loadApp();
  app.storage.setItem(KEY, JSON.stringify(savedState(NOW, [50])));
  await app.buttons()[0].click();
  await flush();
  assert.deepEqual(app.state.drawnIds, [50]);
  assert.equal(app.state.lastDrawnAt, NOW);
  assert.equal(app.mode, 'REVEALED');
  assert.equal(app.slots()[0].dataset.cardId, '50');
});

test('storage events propagate a draw and lock to another open tab', () => {
  const app = loadApp();
  app.storage.setItem(KEY, JSON.stringify(savedState(NOW, [2])));
  app.emit('storage', { key: KEY, storageArea: app.storage });
  assert.equal(app.mode, 'REVEALED');
  assert.equal(app.slots()[0].dataset.cardId, '2');
  assert.equal(app.get('draw-again').hidden || app.get('reveal-actions').hidden, true);
});

test('temporary storage keeps the cooldown for the current session', async () => {
  const app = loadApp({ storageBlocked: true });
  assert.equal(app.get('storage-notice').hidden, false);
  await app.buttons()[0].click();
  await flush();
  assert.equal(app.mode, 'REVEALED');
  assert.equal(app.get('draw-again').hidden || app.get('reveal-actions').hidden, true);
  await app.get('draw-again').dispatch('click');
  assert.equal(app.mode, 'REVEALED');
  app.tick(NOW + DAY);
  await app.get('draw-again').click();
  assert.equal(app.mode, 'IDLE');
  assert.equal(app.slots().length, 3);
});

test('completion can be viewed immediately but a new deck cannot bypass the daily lock', async () => {
  const app = loadApp({ saved: savedState(NOW, Array.from({ length: 50 }, (_, index) => index + 1)) });
  app.store.set('another-app', 'keep');
  assert.equal(app.mode, 'REVEALED');
  await app.get('draw-again').click();
  assert.equal(app.mode, 'COMPLETED');
  assert.equal(app.get('new-deck').hidden, true);
  await app.get('new-deck').dispatch('click');
  assert.equal(app.get('reset-dialog').open, false);
  app.tick(NOW + DAY);
  assert.equal(app.get('new-deck').hidden, false);
  await app.get('new-deck').click();
  assert.equal(app.get('reset-dialog').open, true);
  await app.get('reset-confirm').click();
  assert.equal(app.get('reset-dialog').open, false);
  assert.equal(app.mode, 'IDLE');
  assert.equal(app.buttons().length, 3);
  assert.equal(app.store.has(KEY), false);
  assert.equal(app.store.get('another-app'), 'keep');
});

test('a queued Web Lock checks the latest draw before allowing the waiting selection', async () => {
  let grant;
  const app = loadApp({ locks: (_name, callback) => new Promise(resolve => { grant = () => resolve(callback()); }) });
  const pending = app.buttons()[0].click();
  assert.equal(app.mode, 'ANIMATING');
  assert.equal(app.state.drawnIds.length, 0);
  app.storage.setItem(KEY, JSON.stringify(savedState(NOW, [50])));
  grant();
  await pending;
  await flush();
  assert.deepEqual(app.state.drawnIds, [50]);
  assert.equal(app.mode, 'REVEALED');
  assert.equal(app.slots()[0].dataset.cardId, '50');
});

test('all 50 cards remain reachable without repeats across daily unlocks, including the final two and one', async () => {
  const app = loadApp({ locks: false });
  const seen = new Set();
  for (let count = 0; count < 50; count += 1) {
    assert.equal(app.buttons().length, Math.min(3, 50 - count));
    const id = app.slots()[0].dataset.cardId;
    assert.equal(seen.has(id), false);
    seen.add(id);
    await app.buttons()[0].click();
    await flush();
    assert.equal(app.state.drawnIds.length, count + 1);
    if (count < 49) {
      app.tick(NOW + (count + 1) * DAY);
      await app.get('draw-again').click();
      assert.equal(app.mode, 'IDLE');
    }
  }
  assert.equal(seen.size, 50);
  await app.get('draw-again').click();
  assert.equal(app.mode, 'COMPLETED');
});
