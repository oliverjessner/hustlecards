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
    this.scrollTop = 0;
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
  focus(options) { this.focusOptions = options; this.ownerDocument.activeElement = this; }
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

function loadApp({
  saved = null, now = NOW, storageBlocked = false, locks = true,
  reducedMotion = true, mouseHover = true, coarsePointer = false, maxTouchPoints = 0,
  secureContext = true, orientationAvailable = true, permissionRequired = false,
  screenAngle = 0, legacyOrientation = 0, sensorPermissions = null, permissionQuery = null
} = {}) {
  const document = new Element('#document');
  document.ownerDocument = document;
  document.getElementById = id => document.querySelector(`#${id}`);
  document.createElement = tag => new Element(tag, document);
  document.visibilityState = 'visible';
  document.hidden = false;
  parse(markup, document);
  const store = new Map(saved === null ? [] : [[KEY, typeof saved === 'string' ? saved : JSON.stringify(saved)]]);
  const writes = [];
  const storage = {
    getItem(key) { if (storageBlocked) throw new Error('Storage blocked'); return store.get(key) ?? null; },
    setItem(key, value) { if (storageBlocked) throw new Error('Storage blocked'); store.set(key, value); writes.push(JSON.parse(value)); },
    removeItem(key) { store.delete(key); }
  };
  function eventTarget() {
    const events = new Map();
    return {
      addEventListener(type, callback) {
        if (!events.has(type)) events.set(type, new Set());
        events.get(type).add(callback);
      },
      removeEventListener(type, callback) { events.get(type)?.delete(callback); },
      emit(type, event = {}) { [...(events.get(type) ?? [])].forEach(callback => callback(event)); },
      listenerCount(type) { return events.get(type)?.size ?? 0; }
    };
  }
  const windowEvents = eventTarget();
  const intervals = [];
  function mediaQuery(matches) {
    const listeners = [];
    return {
      matches,
      addEventListener(type, callback) { if (type === 'change') listeners.push(callback); },
      setMatches(value) { this.matches = value; listeners.forEach(callback => callback({ matches: value })); }
    };
  }
  const media = {
    reducedMotion: mediaQuery(reducedMotion), mouseHover: mediaQuery(mouseHover),
    coarsePointer: mediaQuery(coarsePointer)
  };
  const screenOrientation = { ...eventTarget(), angle: screenAngle };
  const screen = screenAngle === null ? {} : { orientation: screenOrientation };
  let permissionRequests = 0;
  const DeviceOrientationEvent = orientationAvailable ? function DeviceOrientationEvent() {} : undefined;
  if (permissionRequired && DeviceOrientationEvent) {
    DeviceOrientationEvent.requestPermission = () => {
      permissionRequests += 1;
      throw new Error('A decorative effect must never request sensor permission');
    };
  }
  const permissionStatuses = new Map(Object.entries(sensorPermissions ?? {}).map(([name, state]) => [name, { ...eventTarget(), state }]));
  const permissionQueries = [];
  const permissions = sensorPermissions || permissionQuery ? {
    async query(descriptor) {
      permissionQueries.push(descriptor.name);
      const status = permissionStatuses.get(descriptor.name);
      if (permissionQuery) return permissionQuery(descriptor, status);
      if (!status) throw new TypeError('Unsupported permission name');
      return status;
    }
  } : undefined;
  let currentTime = now;
  class Clock extends Date { static now() { return currentTime; } }
  const window = {
    localStorage: storage,
    isSecureContext: secureContext,
    DeviceOrientationEvent,
    screen,
    orientation: legacyOrientation,
    matchMedia: query => query === '(prefers-reduced-motion: reduce)' ? media.reducedMotion
      : query === '(any-pointer: coarse)' ? media.coarsePointer : media.mouseHover,
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    clearInterval() {},
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {}
  };
  const context = {
    window, document, screen, navigator: {
      maxTouchPoints, permissions,
      ...(locks ? { locks: { request: typeof locks === 'function' ? locks : async (_name, callback) => callback() } } : {})
    },
    Date: Clock,
    crypto: { randomUUID: () => 'test-deck', getRandomValues(array) { array.fill(0); return array; } },
    getComputedStyle: () => ({ transform: 'none', getPropertyValue: () => '' }),
    setInterval: window.setInterval, clearInterval: window.clearInterval,
    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout,
    console
  };
  vm.runInNewContext(script, context, { filename: 'src/app.js' });
  return {
    document, storage, store, writes, media,
    permissionQueries,
    get permissionRequests() { return permissionRequests; },
    permissionListenerCount(name) { return permissionStatuses.get(name)?.listenerCount('change') ?? 0; },
    setPermission(name, state) {
      const status = permissionStatuses.get(name);
      if (!status) throw new Error(`Unknown permission: ${name}`);
      status.state = state;
      status.emit('change');
    },
    get: id => document.getElementById(id),
    get state() { return JSON.parse(store.get(KEY)); },
    get mode() { return document.getElementById('app').dataset.state; },
    slots: () => document.getElementById('deck').querySelectorAll('.card-slot'),
    buttons: () => document.getElementById('deck').querySelectorAll('.card-button'),
    tick(time) { currentTime = time; intervals.forEach(callback => callback()); },
    emit: windowEvents.emit,
    listenerCount: windowEvents.listenerCount,
    orient(beta, gamma) { windowEvents.emit('deviceorientation', { beta, gamma }); },
    rotate(angle) {
      if (screen.orientation) { screenOrientation.angle = angle; screenOrientation.emit('change'); }
      else { window.orientation = angle; windowEvents.emit('orientationchange'); }
    },
    async setHidden(hidden) {
      document.hidden = hidden;
      document.visibilityState = hidden ? 'hidden' : 'visible';
      await document.dispatch('visibilitychange');
    }
  };
}

function savedState(lastDrawnAt = NOW, drawnIds = [1]) {
  return { version: 1, drawnIds, lastDrawnId: drawnIds.at(-1), lastDrawnAt, deckId: 'test-deck' };
}

async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }

function assertNeutralCard(slot) {
  assert.equal(slot.classList.contains('is-tilting'), false);
  assert.equal(slot.style['--tilt-x'], undefined);
  assert.equal(slot.style['--tilt-y'], undefined);
  assert.equal(slot.style['--tilt-shift-x'], undefined);
  assert.equal(slot.style['--tilt-shift-y'], undefined);
}

test('drawn and restored cards visibly tilt and drift toward the mouse within bounded ranges', async () => {
  for (const saved of [null, savedState()]) {
    const app = loadApp({ saved, reducedMotion: false });
    const slot = app.slots()[0];
    const move = (clientX, clientY) => slot.dispatch('pointermove', { pointerType: 'mouse', clientX, clientY });
    if (saved === null) {
      await move(180, 30);
      assertNeutralCard(slot);
      await app.buttons()[0].click();
      await flush();
    }
    assert.equal(app.mode, 'REVEALED');
    assert.equal(app.buttons()[0].disabled, true);
    const stateBefore = JSON.stringify(app.state);
    await move(180, 30);
    assert.equal(slot.classList.contains('is-tilting'), true);
    assert.ok(parseFloat(slot.style['--tilt-x']) > 6);
    assert.ok(parseFloat(slot.style['--tilt-y']) > 6);
    assert.ok(parseFloat(slot.style['--tilt-shift-x']) > 0);
    assert.ok(parseFloat(slot.style['--tilt-shift-y']) < 0);
    await move(20, 270);
    assert.ok(parseFloat(slot.style['--tilt-x']) < -6);
    assert.ok(parseFloat(slot.style['--tilt-y']) < -6);
    assert.ok(parseFloat(slot.style['--tilt-shift-x']) < 0);
    assert.ok(parseFloat(slot.style['--tilt-shift-y']) > 0);
    await move(100, 150);
    assert.equal(Math.abs(parseFloat(slot.style['--tilt-x'])), 0);
    assert.equal(Math.abs(parseFloat(slot.style['--tilt-y'])), 0);
    assert.equal(Math.abs(parseFloat(slot.style['--tilt-shift-x'])), 0);
    assert.equal(Math.abs(parseFloat(slot.style['--tilt-shift-y'])), 0);
    await move(10_000, -10_000);
    assert.equal(parseFloat(slot.style['--tilt-x']), 14);
    assert.equal(parseFloat(slot.style['--tilt-y']), 14);
    assert.equal(parseFloat(slot.style['--tilt-shift-x']), 8);
    assert.equal(parseFloat(slot.style['--tilt-shift-y']), -8);
    await slot.dispatch('pointerleave');
    assertNeutralCard(slot);
    assert.equal(JSON.stringify(app.state), stateBefore);
  }
});

test('touch, pen, coarse pointers and reduced motion leave the revealed card still', async () => {
  for (const [options, pointerType] of [
    [{ reducedMotion: false }, 'touch'],
    [{ reducedMotion: false }, 'pen'],
    [{ reducedMotion: false, mouseHover: false }, 'mouse'],
    [{ reducedMotion: true }, 'mouse']
  ]) {
    const app = loadApp({ saved: savedState(), ...options });
    const slot = app.slots()[0];
    await slot.dispatch('pointermove', { pointerType, clientX: 180, clientY: 30 });
    assertNeutralCard(slot);
  }
});

test('card tilt resets when pointer, window, visibility or media settings change', async () => {
  const resets = [
    app => app.slots()[0].dispatch('pointerleave'),
    app => app.slots()[0].dispatch('pointercancel'),
    app => app.emit('blur'),
    app => { app.document.hidden = true; return app.document.dispatch('visibilitychange'); },
    app => app.media.reducedMotion.setMatches(true),
    app => app.media.mouseHover.setMatches(false)
  ];
  for (const reset of resets) {
    const app = loadApp({ saved: savedState(), reducedMotion: false });
    const slot = app.slots()[0];
    await slot.dispatch('pointermove', { pointerType: 'mouse', clientX: 180, clientY: 30 });
    assert.equal(slot.classList.contains('is-tilting'), true);
    await reset(app);
    assertNeutralCard(slot);
  }
});

function loadMobileApp(options = {}) {
  return loadApp({ saved: savedState(), reducedMotion: false, mouseHover: false, coarsePointer: true, ...options });
}

test('mobile orientation calibrates drawn and restored cards without changing saved progress', async () => {
  for (const saved of [null, savedState()]) {
    const app = loadMobileApp({ saved });
    if (saved === null) {
      assert.equal(app.listenerCount('deviceorientation'), 0);
      await app.buttons()[0].click();
      await flush();
    }
    const slot = app.slots()[0];
    const before = JSON.stringify(app.state);
    const writesBefore = app.writes.length;
    assert.equal(app.listenerCount('deviceorientation'), 1);
    app.orient(40, -5);
    assertNeutralCard(slot);
    app.orient(50, 5);
    assert.equal(parseFloat(slot.style['--tilt-x']), -7);
    assert.equal(parseFloat(slot.style['--tilt-y']), 7);
    assert.equal(parseFloat(slot.style['--tilt-shift-x']), 4);
    assert.equal(parseFloat(slot.style['--tilt-shift-y']), 4);
    app.orient(60, 15);
    assert.equal(parseFloat(slot.style['--tilt-x']), -14);
    assert.equal(parseFloat(slot.style['--tilt-y']), 14);
    app.orient(80, 35);
    assert.equal(parseFloat(slot.style['--tilt-x']), -14);
    assert.equal(parseFloat(slot.style['--tilt-y']), 14);
    assert.equal(parseFloat(slot.style['--tilt-shift-x']), 8);
    assert.equal(parseFloat(slot.style['--tilt-shift-y']), 8);
    assert.equal(app.permissionRequests, 0);
    assert.equal(JSON.stringify(app.state), before);
    assert.equal(app.writes.length, writesBefore);
  }
});

test('mobile effects never request permissions and stay off in unsupported environments', () => {
  for (const options of [
    { permissionRequired: true }, { secureContext: false }, { orientationAvailable: false },
    { coarsePointer: false, maxTouchPoints: 0 }, { reducedMotion: true }
  ]) {
    const app = loadMobileApp(options);
    assert.equal(app.listenerCount('deviceorientation'), 0);
    app.orient(40, 0);
    app.orient(50, 10);
    assertNeutralCard(app.slots()[0]);
    assert.equal(app.permissionRequests, 0);
  }
  const touchWithMouse = loadMobileApp({ coarsePointer: false, maxTouchPoints: 5, mouseHover: true });
  assert.equal(touchWithMouse.listenerCount('deviceorientation'), 1);
  touchWithMouse.orient(40, 0);
  touchWithMouse.orient(40, 10);
  assert.equal(parseFloat(touchWithMouse.slots()[0].style['--tilt-y']), 7);
});

test('mobile browsers with a permission API use already granted sensor access without requesting it', async () => {
  const app = loadMobileApp({
    permissionRequired: true,
    sensorPermissions: { accelerometer: 'granted', gyroscope: 'granted' }
  });
  assert.equal(app.listenerCount('deviceorientation'), 0);
  await flush();
  assert.equal(app.listenerCount('deviceorientation'), 1);
  assert.deepEqual([...app.permissionQueries].sort(), ['accelerometer', 'gyroscope']);
  assert.equal(app.permissionListenerCount('accelerometer'), 1);
  assert.equal(app.permissionListenerCount('gyroscope'), 1);
  app.orient(40, 0);
  assertNeutralCard(app.slots()[0]);
  app.orient(40, 10);
  assert.equal(parseFloat(app.slots()[0].style['--tilt-y']), 7);
  assert.equal(app.permissionRequests, 0);
});

test('prompt, denied, failed or unavailable permission queries never trigger a permission request', async () => {
  for (const options of [
    { sensorPermissions: { accelerometer: 'granted', gyroscope: 'prompt' } },
    { sensorPermissions: { accelerometer: 'denied', gyroscope: 'granted' } },
    { sensorPermissions: { accelerometer: 'granted', gyroscope: 'denied' } },
    { permissionQuery: async () => { throw new TypeError('Sensor permission query unsupported'); } },
    { sensorPermissions: null }
  ]) {
    const app = loadMobileApp({ permissionRequired: true, ...options });
    await flush();
    assert.equal(app.listenerCount('deviceorientation'), 0);
    app.orient(40, 0);
    app.orient(40, 10);
    assertNeutralCard(app.slots()[0]);
    assert.equal(app.permissionRequests, 0);
  }
});

test('a pending sensor permission check cannot restart tilt after blur or a round change', async () => {
  for (const stop of [
    app => app.emit('blur'),
    app => { app.tick(NOW + DAY); return app.get('draw-again').click(); }
  ]) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const app = loadMobileApp({
      permissionRequired: true,
      sensorPermissions: { accelerometer: 'granted', gyroscope: 'granted' },
      permissionQuery: async (_descriptor, status) => { await gate; return status; }
    });
    assert.equal(app.listenerCount('deviceorientation'), 0);
    await stop(app);
    release();
    await flush();
    assert.equal(app.listenerCount('deviceorientation'), 0);
    assert.equal(app.permissionListenerCount('accelerometer'), 0);
    assert.equal(app.permissionListenerCount('gyroscope'), 0);
    assertNeutralCard(app.slots()[0]);
    assert.equal(app.permissionRequests, 0);
  }
});

test('mobile tilt follows silent permission changes and releases permission observers on blur', async () => {
  const app = loadMobileApp({
    permissionRequired: true,
    sensorPermissions: { accelerometer: 'granted', gyroscope: 'granted' }
  });
  await flush();
  app.orient(40, 0);
  app.orient(40, 10);
  assert.equal(app.slots()[0].classList.contains('is-tilting'), true);
  app.setPermission('gyroscope', 'denied');
  await flush();
  assert.equal(app.listenerCount('deviceorientation'), 0);
  assertNeutralCard(app.slots()[0]);
  app.setPermission('gyroscope', 'granted');
  await flush();
  assert.equal(app.listenerCount('deviceorientation'), 1);
  app.orient(50, 5);
  assertNeutralCard(app.slots()[0]);
  app.orient(50, 15);
  assert.equal(parseFloat(app.slots()[0].style['--tilt-y']), 7);
  app.emit('blur');
  assert.equal(app.listenerCount('deviceorientation'), 0);
  assert.equal(app.permissionListenerCount('accelerometer'), 0);
  assert.equal(app.permissionListenerCount('gyroscope'), 0);
  assertNeutralCard(app.slots()[0]);
  assert.equal(app.permissionRequests, 0);
});

test('invalid orientation samples cannot calibrate or poison a mobile card', () => {
  const app = loadMobileApp();
  const slot = app.slots()[0];
  for (const [beta, gamma] of [[null, 0], [0, null], [NaN, 0], [0, Infinity], [undefined, 5]]) {
    app.orient(beta, gamma);
    assertNeutralCard(slot);
  }
  app.orient(40, 0);
  assertNeutralCard(slot);
  app.orient(40, 10);
  const pose = slot.style['--tilt-y'];
  app.orient(50, NaN);
  assert.equal(slot.style['--tilt-y'], pose);
  app.orient(40, 15);
  assert.equal(parseFloat(slot.style['--tilt-y']), 10.5);
});

test('mobile tilt follows screen axes in both landscape directions and legacy orientation', () => {
  for (const legacy of [false, true]) {
    for (const [angle, tiltX, tiltY, shiftX, shiftY] of [
      [0, 0, 7, 4, 0], [90, -7, 0, 0, 4],
      [180, 0, -7, -4, 0], [270, 7, 0, 0, -4]
    ]) {
      const app = loadMobileApp(legacy ? { screenAngle: null, legacyOrientation: angle } : { screenAngle: angle });
      const slot = app.slots()[0];
      app.orient(40, 0);
      app.orient(40, 10);
      for (const [property, expected] of Object.entries({ '--tilt-x': tiltX, '--tilt-y': tiltY, '--tilt-shift-x': shiftX, '--tilt-shift-y': shiftY })) {
        assert.ok(Math.abs(parseFloat(slot.style[property]) - expected) < 0.01, `${angle}° ${property}`);
      }
      app.rotate((angle + 90) % 360);
      assertNeutralCard(slot);
      app.orient(45, 5);
      assertNeutralCard(slot);
      app.orient(45, 15);
      assert.equal(slot.classList.contains('is-tilting'), true);
    }
  }
});

test('mobile calibration handles angle wrap and recalibrates sensor discontinuities', () => {
  const app = loadMobileApp();
  const slot = app.slots()[0];
  app.orient(175, 0);
  app.orient(-175, 0);
  assert.equal(parseFloat(slot.style['--tilt-x']), -7);
  app.orient(-100, 0);
  assertNeutralCard(slot);
  app.orient(-90, 0);
  assert.equal(parseFloat(slot.style['--tilt-x']), -7);
});

test('mobile sensors stop and recalibrate across visibility, focus, media and round changes', async () => {
  const lifecycles = [
    [app => app.setHidden(true), app => app.setHidden(false)],
    [app => app.emit('blur'), app => app.emit('focus')],
    [app => app.emit('pagehide'), app => app.emit('pageshow')],
    [app => app.media.reducedMotion.setMatches(true), app => app.media.reducedMotion.setMatches(false)],
    [app => app.media.coarsePointer.setMatches(false), app => app.media.coarsePointer.setMatches(true)]
  ];
  for (const [stop, resume] of lifecycles) {
    const app = loadMobileApp();
    const slot = app.slots()[0];
    app.orient(40, 0);
    app.orient(50, 10);
    assert.equal(slot.classList.contains('is-tilting'), true);
    await stop(app);
    assert.equal(app.listenerCount('deviceorientation'), 0);
    assertNeutralCard(slot);
    app.orient(70, 20);
    assertNeutralCard(slot);
    await resume(app);
    assert.equal(app.listenerCount('deviceorientation'), 1);
    app.orient(70, 20);
    assertNeutralCard(slot);
    app.orient(75, 25);
    assert.equal(slot.classList.contains('is-tilting'), true);
  }
  const app = loadMobileApp();
  app.tick(NOW + DAY);
  await app.get('draw-again').click();
  assert.equal(app.mode, 'IDLE');
  assert.equal(app.listenerCount('deviceorientation'), 0);
  await app.buttons()[0].click();
  await flush();
  assert.equal(app.listenerCount('deviceorientation'), 1);
  app.orient(70, 20);
  assertNeutralCard(app.slots()[0]);
});

test('touch leaves sensor tilt intact while real mouse interaction temporarily takes priority', async () => {
  const app = loadMobileApp({ mouseHover: true });
  const slot = app.slots()[0];
  app.orient(40, 0);
  app.orient(40, 10);
  const sensorPose = slot.style['--tilt-y'];
  for (const pointerType of ['touch', 'pen']) {
    await slot.dispatch('pointermove', { pointerType, clientX: 180, clientY: 30 });
    await slot.dispatch('pointerleave', { pointerType });
    assert.equal(slot.style['--tilt-y'], sensorPose);
  }
  await slot.dispatch('pointermove', { pointerType: 'mouse', clientX: 20, clientY: 270 });
  const mousePose = slot.style['--tilt-y'];
  assert.ok(parseFloat(mousePose) < 0);
  app.orient(40, 20);
  assert.equal(slot.style['--tilt-y'], mousePose);
  await slot.dispatch('pointerleave', { pointerType: 'mouse' });
  app.orient(40, 20);
  assertNeutralCard(slot);
  app.orient(40, 30);
  assert.equal(parseFloat(slot.style['--tilt-y']), 7);
});

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
  assert.deepEqual(app.state.drawnIds, []);
  assert.deepEqual(app.state.discoveredIds, Array.from({ length: 50 }, (_, index) => index + 1));
  assert.equal(app.state.lastDrawnId, null);
  assert.equal(app.state.lastDrawnAt, null);
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

function collectionState({ drawnIds = [1], discoveredIds = drawnIds, lastDrawnAt = NOW, ...rest } = {}) {
  return { ...savedState(lastDrawnAt, drawnIds), version: 2, discoveredIds, deckGeneration: 0, ...rest };
}

function collectionCards(app) {
  return app.get('collection-grid').querySelectorAll('.collection-card');
}

function collectionCard(app, id) {
  return collectionCards(app).find(card => card.dataset.cardId === String(id));
}

test('collection renders all 50 numbered locked cards in ID order without quote content or labels', async () => {
  const app = loadApp();
  await app.get('open-collection').click();
  assert.equal(app.get('app').dataset.view, 'collection');
  assert.equal(app.get('draw-view').hidden, true);
  assert.equal(app.get('collection-view').hidden, false);
  assert.equal(app.get('collection-view').tagName, 'MAIN');
  const cards = collectionCards(app);
  assert.equal(cards.length, 50);
  assert.deepEqual(cards.map(card => Number(card.dataset.cardId)), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.equal(app.get('collection-grid').querySelectorAll('.card-quote').length, 0);
  assert.equal(app.get('collection-grid').querySelectorAll('.card-front').length, 0);
  for (const [index, card] of cards.entries()) {
    assert.equal(card.classList.contains('is-locked'), true);
    assert.notEqual(card.tagName, 'BUTTON');
    assert.match(card.getAttribute('aria-label'), new RegExp(`Card ${index + 1} of 50.*Locked`, 'i'));
    assert.match(card.textContent, /LOCKED/);
    assert.equal(card.getAttribute('tabindex'), null);
  }
  assert.equal(app.get('collection-progress').textContent, '0 OF 50 DISCOVERED');
  assert.equal(Number(app.get('collection-meter').value), 0);
});

test('v1 migration retains all valid previous draws, deck and cooldown and discovers those cards', async () => {
  const app = loadApp({ saved: { ...savedState(NOW, [7, 2, 7, 50, '3', 0, 51, -1]), lastDrawnId: 2 } });
  assert.equal(app.state.version, 2);
  assert.deepEqual(app.state.drawnIds, [7, 2, 50]);
  assert.deepEqual(app.state.discoveredIds, [2, 7, 50]);
  assert.equal(app.state.deckId, 'test-deck');
  assert.equal(app.state.lastDrawnId, 2);
  assert.equal(app.state.lastDrawnAt, NOW);
  await app.get('open-collection').click();
  assert.equal(app.get('collection-progress').textContent, '3 OF 50 DISCOVERED');
  assert.equal(collectionCard(app, 2).tagName, 'BUTTON');
  assert.equal(collectionCard(app, 2).classList.contains('is-discovered'), true);
  assert.equal(collectionCard(app, 2).querySelector('.card-quote').textContent, 'Nobody cares. Work harder.');
  assert.equal(collectionCard(app, 3).querySelector('.card-quote'), null);
});

test('v2 repairs duplicate, malformed and missing discovery IDs while always retaining valid current draws', async () => {
  for (const discoveredIds of [[9, 9, 2, 50, '4', 0, 51, null], undefined, 'broken', null]) {
    const app = loadApp({ saved: collectionState({ drawnIds: [4, 2], discoveredIds }) });
    assert.deepEqual(app.state.drawnIds, [4, 2]);
    assert.deepEqual(app.state.discoveredIds, Array.isArray(discoveredIds) ? [2, 4, 9, 50] : [2, 4]);
    await app.get('open-collection').click();
    assert.equal(collectionCard(app, 4).classList.contains('is-discovered'), true);
    assert.equal(collectionCard(app, 1).classList.contains('is-locked'), true);
  }
});

test('malformed stored JSON and unsupported state safely start with a locked collection', async () => {
  for (const saved of ['{not-json', 'null', '[]', '{"version":999,"drawnIds":[1]}', '{"version":2,"drawnIds":"broken"}']) {
    const app = loadApp({ saved });
    assert.deepEqual(app.state.drawnIds, []);
    assert.deepEqual(app.state.discoveredIds, []);
    await app.get('open-collection').click();
    assert.equal(collectionCards(app).length, 50);
    assert.equal(app.get('collection-grid').querySelectorAll('.is-discovered').length, 0);
  }
});

test('a draw saves the lifetime unlock before reveal and the discovered miniature survives reload', async () => {
  const app = loadApp();
  const chosenId = Number(app.slots()[0].dataset.cardId);
  const drawing = app.buttons()[0].click();
  assert.deepEqual(app.state.discoveredIds, [chosenId]);
  assert.equal(app.get('open-collection').disabled, true);
  await app.get('open-collection').dispatch('click');
  assert.equal(app.get('collection-view').hidden, true);
  await drawing;
  await flush();
  assert.equal(app.get('open-collection').disabled, false);
  const restored = loadApp({ saved: app.state });
  await restored.get('open-collection').click();
  assert.equal(restored.get('collection-progress').textContent, '1 OF 50 DISCOVERED');
  assert.equal(Number(restored.get('collection-meter').value), 1);
  assert.equal(collectionCard(restored, chosenId).classList.contains('is-discovered'), true);
  assert.ok(collectionCard(restored, chosenId).querySelector('.card-quote').textContent.length > 0);
  assert.equal(collectionCards(restored).filter(card => card.classList.contains('is-locked')).length, 49);
});

test('gallery and detail browsing never draw, write progress or change the 24-hour cooldown', async () => {
  const app = loadApp({ saved: collectionState({ drawnIds: [1], discoveredIds: [1, 5] }) });
  const before = app.state;
  const writeCount = app.writes.length;
  const deck = app.slots()[0];
  await app.get('open-collection').click();
  await collectionCard(app, 5).click();
  assert.equal(app.get('app').dataset.view, 'detail');
  assert.equal(app.get('collection-gallery').hidden, true);
  assert.equal(app.get('collection-detail').hidden, false);
  assert.equal(app.get('detail-card').querySelector('.card-quote').textContent, "The grind doesn't stop when you're tired.");
  await app.get('draw-again').dispatch('click');
  await app.get('new-deck').dispatch('click');
  await app.buttons()[0].dispatch('click');
  assert.equal(app.mode, 'REVEALED');
  assert.equal(app.get('reset-dialog').open, false);
  await app.get('detail-back').click();
  await app.get('collection-close').click();
  assert.equal(app.get('app').dataset.view, 'deck');
  assert.equal(app.slots()[0], deck);
  assert.deepEqual(app.state, before);
  assert.equal(app.writes.length, writeCount);
  assert.equal(app.get('reveal-actions').hidden, true);
  app.tick(NOW + DAY - 1);
  assert.equal(app.get('reveal-actions').hidden, true);
  app.tick(NOW + DAY);
  assert.equal(app.get('reveal-actions').hidden, false);
});

test('opening collection preserves an available card fan and hidden deck controls cannot draw', async () => {
  const app = loadApp({ saved: collectionState({ drawnIds: [], discoveredIds: [45], lastDrawnAt: null }) });
  const fan = app.slots();
  const before = app.state;
  const writeCount = app.writes.length;
  await app.get('open-collection').click();
  await app.buttons()[0].dispatch('click');
  await collectionCard(app, 45).click();
  await app.buttons()[1].dispatch('click');
  await app.get('collection-close').click();
  assert.equal(app.mode, 'IDLE');
  assert.deepEqual(app.slots(), fan);
  assert.deepEqual(app.state, before);
  assert.equal(app.writes.length, writeCount);
});

test('collection suspends hidden deck sensor effects and reduced motion still keeps the card still', async () => {
  const app = loadMobileApp();
  assert.equal(app.listenerCount('deviceorientation'), 1);
  const slot = app.slots()[0];
  app.orient(40, 0);
  app.orient(45, 10);
  assert.equal(slot.classList.contains('is-tilting'), true);
  await app.get('open-collection').click();
  assert.equal(app.listenerCount('deviceorientation'), 0);
  assertNeutralCard(slot);
  await collectionCard(app, 1).click();
  app.orient(60, 20);
  assertNeutralCard(slot);
  assert.equal(app.listenerCount('deviceorientation'), 0);
  app.media.reducedMotion.setMatches(true);
  await app.get('collection-close').click();
  assert.equal(app.listenerCount('deviceorientation'), 0);
  assertNeutralCard(slot);
  app.media.reducedMotion.setMatches(false);
  assert.equal(app.listenerCount('deviceorientation'), 1);
  assert.equal(app.permissionRequests, 0);
});

test('detail back restores the exact gallery scroll and focus, and Escape returns through each view', async () => {
  const app = loadApp({ saved: collectionState({ discoveredIds: [1, 45] }) });
  app.get('open-collection').focus();
  await app.get('open-collection').click();
  assert.equal(app.document.activeElement, app.get('collection-title'));
  app.get('collection-view').scrollTop = 2400;
  const card = collectionCard(app, 45);
  await card.click();
  assert.equal(app.get('collection-view').scrollTop, 0);
  assert.equal(app.document.activeElement, app.get('detail-card'));
  await app.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(app.get('app').dataset.view, 'collection');
  assert.equal(app.get('collection-view').scrollTop, 2400);
  assert.equal(app.document.activeElement, card);
  assert.equal(card.focusOptions.preventScroll, true);
  await app.document.dispatch('keydown', { key: 'Escape' });
  assert.equal(app.get('app').dataset.view, 'deck');
  assert.equal(app.document.activeElement, app.get('open-collection'));
});

test('collection remains accessible after deck completion and retains all lifetime discoveries after reset', async () => {
  const allIds = Array.from({ length: 50 }, (_, i) => i + 1);
  const app = loadApp({ saved: collectionState({ drawnIds: allIds }) });
  await app.get('draw-again').click();
  assert.equal(app.mode, 'COMPLETED');
  assert.equal(app.get('open-collection').disabled, false);
  await app.get('open-collection').click();
  assert.equal(app.get('collection-progress').textContent, '50 OF 50 DISCOVERED');
  assert.equal(collectionCards(app).every(card => card.classList.contains('is-discovered')), true);
  await app.get('collection-close').click();
  app.tick(NOW + DAY);
  await app.get('new-deck').click();
  await app.get('reset-confirm').click();
  assert.equal(app.state.deckGeneration, 1);
  assert.deepEqual(app.state.drawnIds, []);
  assert.deepEqual(app.state.discoveredIds, allIds);
  assert.equal(app.state.lastDrawnId, null);
  assert.equal(app.state.lastDrawnAt, null);
  const restored = loadApp({ saved: app.state, now: NOW + DAY });
  assert.equal(restored.mode, 'IDLE');
  await restored.get('open-collection').click();
  assert.equal(restored.get('collection-progress').textContent, '50 OF 50 DISCOVERED');
});

test('cross-tab draw synchronization unlocks a card in the open gallery without changing its scroll', async () => {
  const app = loadApp({ saved: collectionState({ drawnIds: [], discoveredIds: [1], lastDrawnAt: null }) });
  await app.get('open-collection').click();
  app.get('collection-view').scrollTop = 1800;
  collectionCard(app, 1).focus();
  app.storage.setItem(KEY, JSON.stringify(collectionState({ drawnIds: [2], discoveredIds: [2] })));
  app.emit('storage', { key: KEY, storageArea: app.storage });
  assert.equal(app.get('app').dataset.view, 'collection');
  assert.equal(app.get('collection-view').scrollTop, 1800);
  assert.equal(app.document.activeElement, collectionCard(app, 1));
  assert.deepEqual(app.state.discoveredIds, [1, 2]);
  assert.equal(app.get('collection-progress').textContent, '2 OF 50 DISCOVERED');
  assert.equal(collectionCard(app, 2).classList.contains('is-discovered'), true);
  await app.get('collection-close').click();
  assert.equal(app.mode, 'REVEALED');
  assert.equal(app.get('reveal-actions').hidden, true);
});

test('cross-tab resets preserve lifetime discoveries and old deck events cannot resurrect cleared progress', async () => {
  const app = loadApp({ saved: collectionState({ drawnIds: [1, 3], discoveredIds: [1, 3, 5] }) });
  await app.get('open-collection').click();
  app.storage.setItem(KEY, JSON.stringify(collectionState({ deckId: 'new-deck', deckGeneration: 1, drawnIds: [], discoveredIds: [1, 3], lastDrawnAt: null })));
  app.emit('storage', { key: KEY, storageArea: app.storage });
  assert.deepEqual(app.state.drawnIds, []);
  assert.deepEqual(app.state.discoveredIds, [1, 3, 5]);
  assert.equal(app.state.deckGeneration, 1);
  assert.equal(app.mode, 'IDLE');
  assert.equal(app.get('collection-progress').textContent, '3 OF 50 DISCOVERED');
  app.storage.setItem(KEY, JSON.stringify(collectionState({ drawnIds: [1, 3, 7], discoveredIds: [1, 3, 7], lastDrawnAt: NOW + 1000 })));
  app.emit('storage', { key: KEY, storageArea: app.storage });
  assert.equal(app.state.deckId, 'new-deck');
  assert.equal(app.state.deckGeneration, 1);
  assert.deepEqual(app.state.drawnIds, []);
  assert.deepEqual(app.state.discoveredIds, [1, 3, 5, 7]);
  assert.equal(app.state.lastDrawnAt, null);
});

test('cross-tab discovery updates preserve a visible detail and its return focus and scroll', async () => {
  const app = loadApp({ saved: collectionState({ discoveredIds: [1, 40] }) });
  await app.get('open-collection').click();
  app.get('collection-view').scrollTop = 2100;
  await collectionCard(app, 40).click();
  const detailText = app.get('detail-card').textContent;
  app.storage.setItem(KEY, JSON.stringify(collectionState({ discoveredIds: [1, 2] })));
  app.emit('storage', { key: KEY, storageArea: app.storage });
  assert.equal(app.get('app').dataset.view, 'detail');
  assert.equal(app.get('detail-card').textContent, detailText);
  await app.get('detail-back').click();
  assert.equal(app.get('collection-view').scrollTop, 2100);
  assert.equal(app.document.activeElement, collectionCard(app, 40));
  assert.deepEqual(app.state.discoveredIds, [1, 2, 40]);
});

test('tabs with equal draw sets in a different order converge without repeated storage writes', () => {
  const first = loadApp({ saved: collectionState({ drawnIds: [1, 2], lastDrawnId: 2 }) });
  const second = loadApp({ saved: collectionState({ drawnIds: [2, 1], lastDrawnId: 2 }) });
  let lastCycleWrites = 0;
  for (let cycle = 0; cycle < 4; cycle += 1) {
    lastCycleWrites = 0;
    for (const [source, target] of [[first, second], [second, first]]) {
      target.store.set(KEY, JSON.stringify(source.state));
      const count = target.writes.length;
      target.emit('storage', { key: KEY, storageArea: target.storage });
      lastCycleWrites += target.writes.length - count;
    }
  }
  assert.equal(lastCycleWrites, 0);
  assert.deepEqual([...first.state.drawnIds].sort((a, b) => a - b), [1, 2]);
  assert.deepEqual([...second.state.drawnIds].sort((a, b) => a - b), [1, 2]);
  assert.deepEqual(first.state.discoveredIds, [1, 2]);
  assert.deepEqual(second.state.discoveredIds, [1, 2]);
});

test('malformed or deleted runtime storage never erases discoveries or bypasses an active cooldown', async () => {
  const app = loadApp({ saved: collectionState({ discoveredIds: [1, 4] }) });
  await app.get('open-collection').click();
  const before = app.state;
  for (const value of ['{broken', 'null', '{"version":2,"drawnIds":null}', '{"version":2,"drawnIds":[],"deckId":42}', null]) {
    if (value === null) app.storage.removeItem(KEY);
    else app.store.set(KEY, value);
    app.emit('storage', { key: KEY, storageArea: app.storage });
    assert.equal(app.get('collection-progress').textContent, '2 OF 50 DISCOVERED');
    assert.equal(collectionCard(app, 1).classList.contains('is-discovered'), true);
    assert.equal(collectionCard(app, 4).classList.contains('is-discovered'), true);
    assert.equal(app.get('reveal-actions').hidden, true);
    assert.equal(app.mode, 'REVEALED');
    assert.deepEqual(app.state, before);
  }
});

test('an older different deck at the same generation cannot clear a newer daily lock', () => {
  const app = loadApp({ saved: collectionState({ drawnIds: [3], discoveredIds: [3, 5] }) });
  app.storage.setItem(KEY, JSON.stringify(collectionState({ deckId: 'stale-tab', drawnIds: [], discoveredIds: [2], lastDrawnAt: null })));
  app.emit('storage', { key: KEY, storageArea: app.storage });
  assert.deepEqual(app.state.drawnIds, [3]);
  assert.deepEqual(app.state.discoveredIds, [2, 3, 5]);
  assert.equal(app.state.lastDrawnAt, NOW);
  assert.equal(app.state.deckId, 'test-deck');
  assert.equal(app.get('reveal-actions').hidden, true);
});

test('temporary storage still keeps discovered cards and collection details usable within the session', async () => {
  const app = loadApp({ storageBlocked: true });
  const chosenId = Number(app.slots()[0].dataset.cardId);
  await app.buttons()[0].click();
  await flush();
  await app.get('open-collection').click();
  assert.equal(app.get('collection-progress').textContent, '1 OF 50 DISCOVERED');
  await collectionCard(app, chosenId).click();
  assert.ok(app.get('detail-card').querySelector('.card-quote').textContent.length > 0);
  await app.get('collection-close').click();
  assert.equal(app.get('reveal-actions').hidden, true);
  assert.equal(app.writes.length, 0);
});
