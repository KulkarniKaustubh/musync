/* musync web client.
   Talks to the musync server (server/ in this repo) that runs inside the Android
   app or standalone. The server owns the room; this file shows it, sends
   actions, and plays the 30-second previews on the host's device. */
(() => {
  'use strict';

  // ---------- music apps and catalogs ----------

  // The app a person listens with. Used to open the full song there.
  const APPS = [
    { id: 'spotify', name: 'Spotify', search: (q) => 'https://open.spotify.com/search/' + encodeURIComponent(q) },
    { id: 'apple', name: 'Apple Music', search: (q) => 'https://music.apple.com/search?term=' + encodeURIComponent(q) },
    { id: 'ytm', name: 'YouTube Music', search: (q) => 'https://music.youtube.com/search?q=' + encodeURIComponent(q) },
    { id: 'tidal', name: 'Tidal', search: (q) => 'https://listen.tidal.com/search?q=' + encodeURIComponent(q) },
    { id: 'amazon', name: 'Amazon Music', search: (q) => 'https://music.amazon.com/search/' + encodeURIComponent(q) },
    { id: 'deezer', name: 'Deezer', search: (q) => 'https://www.deezer.com/search/' + encodeURIComponent(q) },
    { id: 'soundcloud', name: 'SoundCloud', search: (q) => 'https://soundcloud.com/search?q=' + encodeURIComponent(q) },
  ];
  const appOf = (id) => APPS.find((a) => a.id === id) || APPS[0];
  const appName = (id) => appOf(id).name;

  // The public catalogs search and previews come from.
  const CATALOGS = { apple: 'Apple Music', deezer: 'Deezer' };

  /** Where to hear the whole song: the exact track when the person's app is its catalog, otherwise a search there. */
  function fullSongUrl(song, appId) {
    if (appId === song.src && song.url) return song.url;
    return appOf(appId).search(song.title + ' ' + song.artist);
  }

  // ---------- this device ----------

  const store = {
    read() { try { return JSON.parse(localStorage.getItem('musync') || 'null') || {}; } catch (_) { return {}; } },
    write(v) { try { localStorage.setItem('musync', JSON.stringify(v)); } catch (_) { /* private mode */ } },
  };
  const saved = store.read();
  function newToken() {
    const bytes = new Uint8Array(18);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  const device = {
    token: saved.token || newToken(),
    name: saved.name || '',
    app: saved.app || '',
    room: saved.room || '',      // the room to come back to after a reload
    home: saved.home || '',      // where "leave" returns to when this page is another phone's server
    address: saved.address || '', // this phone's Wi-Fi address, typed in by hand when it cannot be detected
    skipSignIn: Array.isArray(saved.skipSignIn) ? saved.skipSignIn : [], // services the host chose not to sign in to
  };
  const persist = () => store.write(device);
  persist();

  // ---------- state ----------

  const ui = {
    view: 'loading',             // loading | landing | setup | room | tv
    setup: { mode: 'start', code: '', busy: false },
    info: { lan: false, canStart: true, addresses: [], port: 0, code: null, local: false },
    me: null,                    // my id in the room
    room: null,                  // latest state from the server
    receivedAt: 0,               // local clock when that state arrived
    online: true,
    listening: false,            // non-hosts can choose to hear the previews too
    needsTap: false,             // the browser wants a tap before it will play sound
    scope: 'all',
    playIn: '',                  // when adding: which of the host phone's services the song should play in
    scrubbing: false,            // the host is dragging through the song
    search: { q: '', loading: false, songs: [], failed: [], error: '' },
    adding: new Set(),
    justAdded: null,
    tvRows: 5,
    notice: '',
  };

  const person = (id) => (ui.room ? ui.room.people.find((p) => p.id === id) : null);
  const nameOf = (id) => (person(id) || {}).name || 'Someone';
  const colorOf = (id) => (person(id) || {}).color || 'sky';
  const isHost = () => !!ui.room && ui.room.hostId === ui.me;
  const isPlayer = () => playback().mode === 'preview' && (isHost() || ui.listening);
  const pickLabel = (id) => (id === ui.me ? 'Your pick' : nameOf(id) + '’s pick');
  const myApp = () => (person(ui.me) || {}).app || device.app || 'spotify';
  // How the room makes sound: "full" means the host's phone plays whole songs in
  // the host's own music app; "setup" means that phone can, once the host has
  // allowed it, and the song waits until then; "preview" means 30-second clips
  // in the browser, used only when the room is not hosted from the phone app.
  const playback = () => (ui.room && ui.room.playback) || { mode: 'preview', app: '', device: false, status: '', detail: '' };
  const fullMode = () => playback().mode === 'full';
  const setupMode = () => playback().mode === 'setup';
  const native = () => window.MusyncNative || null;
  // On the host's phone some music apps play in a web player built into musync
  // ("web"); the rest are driven as installed apps ("app").
  const webSignedIn = (appId) => {
    const n = native();
    try { return n && n.webSignedIn ? n.webSignedIn(appId) : 'none'; } catch (_) { return 'none'; }
  };
  /** The music apps the host's phone can play right now. Empty when the room is not hosted from the phone app. */
  const services = () => playback().services || [];
  const playerKind = (appId) => {
    const n = native();
    try { return n && n.playerKind ? n.playerKind(appId) : 'app'; } catch (_) { return 'app'; }
  };

  // ---------- server ----------

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function api(path, body, opts = {}) {
    let res;
    try {
      res = await fetch((opts.base || '') + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: opts.signal,
        cache: 'no-store',
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new ApiError('Can’t reach the room. Check your Wi-Fi.', 0);
    }
    let data = {};
    try { data = await res.json(); } catch (_) { /* empty body */ }
    if (!res.ok) throw new ApiError(data.error || 'Something went wrong. Try again.', res.status);
    return data;
  }

  const act = (type, extra) =>
    api(`/api/rooms/${ui.room.code}/act`, { token: device.token, type, ...extra })
      .catch((e) => { toast(e.message); throw e; });

  let events = null;
  function connect(code) {
    disconnect();
    events = new EventSource(`/api/rooms/${code}/events?token=${device.token}`);
    events.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      const first = !ui.room;
      ui.me = data.me;
      ui.room = data.state;
      ui.receivedAt = Date.now();
      setOnline(true);
      // Inside the Android app, keep the host's screen on so the room keeps running.
      if (window.MusyncNative && window.MusyncNative.keepAwake) window.MusyncNative.keepAwake(isHost());
      if (ui.view !== 'room' && ui.view !== 'tv') { ui.view = 'room'; render(); } else refresh(first);
      syncPlayer();
    };
    events.onerror = () => {
      setOnline(false);
      // The browser retries on its own. If the server refused us outright, the
      // stream is closed for good: find out why.
      if (events && events.readyState === EventSource.CLOSED) recover(code);
    };
  }
  function disconnect() {
    if (events) { events.close(); events = null; }
  }

  let recovering = false;
  async function recover(code) {
    if (recovering) return;
    recovering = true;
    try {
      await api(`/api/rooms/${code}/join`, { token: device.token, name: device.name, app: device.app });
      connect(code);
    } catch (e) {
      if (e.status === 404) return roomEnded('That room has ended.');
      if (e.status === 409) return roomEnded(e.message);
      setTimeout(() => { recovering = false; if (ui.room && ui.room.code === code) recover(code); }, 2500);
      return;
    }
    recovering = false;
  }

  function roomEnded(message) {
    recovering = false;
    disconnect();
    stopPlayer();
    ui.room = null; ui.me = null;
    device.room = ''; persist();
    ui.notice = message || '';
    goHome();
  }

  function setOnline(on) {
    if (ui.online === on) return;
    ui.online = on;
    const b = $('#banner');
    b.hidden = on;
    b.textContent = on ? '' : 'Reconnecting to the room';
  }

  // ---------- helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const people = (n) => (n === 1 ? '1 person' : n + ' people');
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const svg = (d) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    search: svg('<circle cx="9" cy="9" r="5.5"/><path d="m13.2 13.2 3.8 3.8"/>'),
    up: svg('<path d="M5 12l5-5 5 5"/>'),
    upSolid: svg('<path d="M10 5.5 16 13H4z" fill="currentColor"/>'),
    x: svg('<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>'),
    check: svg('<path d="M4.5 10.5 8 14l7.5-8"/>'),
    back: svg('<path d="M12 4.5 6.5 10l5.5 5.5"/>'),
    invite: svg('<circle cx="8" cy="7" r="3"/><path d="M2.5 16.5c.6-3 2.7-4.5 5.5-4.5 1.2 0 2.2.3 3 .8M15 11v6M12 14h6"/>'),
    play: svg('<path d="M6.5 4.5v11l9-5.5z" fill="currentColor"/>'),
    pause: svg('<path d="M7 4.5v11M13 4.5v11" stroke-width="2.6"/>'),
    skip: svg('<path d="M5 4.5v11l8-5.5z" fill="currentColor"/><path d="M15.5 4.5v11" stroke-width="2.2"/>'),
    sound: svg('<path d="M3.5 8v4H6l4 3.5v-11L6 8z" fill="currentColor"/><path d="M13 7.5c.9.7 1.4 1.5 1.4 2.5s-.5 1.8-1.4 2.5M15 5c1.700 1.300 2.600 3 2.600 5s-.900 3.700-2.600 5"/>'),
    open: svg('<path d="M11 4h5v5M16 4l-7 7M14 11.500V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.500"/>'),
    tv: svg('<rect x="2.5" y="4" width="15" height="10" rx="1.5"/><path d="M7 17h6"/>'),
    copy: svg('<rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M4 12.5v-7A1.5 1.5 0 0 1 5.5 4h7"/>'),
  };

  // Cover art comes from the catalog. If a song has none, or the image fails,
  // an abstract tile drawn from the title stands in.
  function hueOf(song) {
    let h = 0;
    const t = (song.title || '') + (song.artist || '');
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  const SHAPES = [
    (a, b, g) => `<circle cx="24" cy="24" r="17" fill="${a}"/><circle cx="24" cy="24" r="9" fill="${b}"/><circle cx="24" cy="24" r="2.5" fill="${g}"/>`,
    (a, b) => `<rect x="6" y="26" width="8" height="16" fill="${a}"/><rect x="20" y="14" width="8" height="28" fill="${b}"/><rect x="34" y="20" width="8" height="22" fill="${a}"/>`,
    (a, b) => `<path d="M0 48A48 48 0 0 1 48 0v48z" fill="${a}"/><path d="M0 48a26 26 0 0 1 26-26v26z" fill="${b}"/>`,
    (a, b) => `<rect width="24" height="24" fill="${a}"/><circle cx="34" cy="34" r="10" fill="${b}"/>`,
    (a, b) => `<path d="M0 0h48L0 48z" fill="${a}"/><circle cx="33" cy="33" r="7" fill="${b}"/>`,
    (a, b) => `<rect y="10" width="48" height="8" fill="${a}"/><rect y="24" width="48" height="8" fill="${b}"/><rect y="38" width="48" height="4" fill="${a}"/>`,
    (a, b) => `<circle cx="16" cy="24" r="12" fill="${a}"/><circle cx="32" cy="24" r="12" fill="${b}" fill-opacity=".85"/>`,
    (a, b) => `<path d="M24 6l18 36H6z" fill="${a}"/><circle cx="24" cy="31" r="6" fill="${b}"/>`,
  ];
  function tile(song) {
    const hue = hueOf(song);
    const bg = `hsl(${hue} 44% 36%)`, a = `hsl(${(hue + 28) % 360} 62% 66%)`, b = `hsl(${(hue + 320) % 360} 55% 52%)`;
    return `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" fill="${bg}"/>${SHAPES[(hue >> 3) % SHAPES.length](a, b, bg)}</svg>`;
  }
  function cover(song, big) {
    const src = big ? song.artBig || song.art : song.art;
    return `<span class="cover">${tile(song)}${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span>`;
  }
  // A broken image removes itself and the tile underneath shows.
  document.addEventListener('error', (ev) => {
    if (ev.target.tagName === 'IMG' && ev.target.closest('.cover')) ev.target.remove();
  }, true);

  const avatar = (id, size = '') =>
    `<span class="avatar ${size}" data-person="${colorOf(id)}" aria-hidden="true">${esc(nameOf(id).trim().charAt(0))}</span>`;

  let toastTimer;
  function toast(msg, action, onAction) {
    const el = $('#toast');
    const host = document.querySelector('dialog[open]') || document.body;
    if (el.parentNode !== host) host.appendChild(el);
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { el.hidden = true; onAction(); };
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3200);
  }

  /** Opens an outside link: through the Android app when we are inside it, otherwise a new tab. */
  function openOutside(url) {
    if (window.MusyncNative && window.MusyncNative.open) window.MusyncNative.open(url);
    else window.open(url, '_blank', 'noopener');
  }

  // ---------- room codes on a local network ----------

  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  /** A LAN code holds the last two parts of the host's address and a check digit. */
  function decodeLanCode(code) {
    let v = 0;
    for (const ch of code) { const i = ALPHABET.indexOf(ch); if (i < 0) return null; v = v * 32 + i; }
    const c = (v >> 12) & 255, d = (v >> 4) & 255, check = v & 15;
    return check === ((c ^ d ^ (c >> 4) ^ (d >> 4)) & 15) ? { c, d } : null;
  }

  async function probe(base, code) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1800);
    try {
      const r = await api('/api/rooms/' + code, null, { base, signal: ctl.signal });
      return !!r.exists;
    } catch (_) { return false; } finally { clearTimeout(timer); }
  }

  /** Finds the address of the room with this code: this server first, then the local network. */
  async function findRoom(code) {
    if (await probe('', code)) return '';
    if (!ui.info.lan || !ui.info.local) return null;
    const where = decodeLanCode(code);
    if (!where) return null;
    const tries = [];
    for (const mine of ui.info.addresses) {
      const [a, b] = mine.split('.');
      for (let port = 8787; port <= 8791; port++) tries.push(`http://${a}.${b}.${where.c}.${where.d}:${port}`);
    }
    const found = await Promise.all(tries.map((base) => probe(base, code).then((ok) => (ok ? base : null))));
    return found.find(Boolean) || null;
  }

  const onLoopback = () => /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const validAddress = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && ip.split('.').every((n) => +n <= 255) && !/^(127|0|169\.254)\./.test(ip);

  /** The address other phones can reach this one at, or '' when it is not known. */
  function reachableBase() {
    if (!onLoopback()) return location.origin;
    const ip = ui.info.addresses[0] || (validAddress(device.address) ? device.address : '');
    return ip ? `http://${ip}:${ui.info.port || location.port || 8787}` : '';
  }

  /** On a phone the code follows its current address; elsewhere it is the room's own code. */
  function roomCode() {
    if (ui.info.lan && ui.info.code) return ui.info.code;
    if (ui.info.lan && onLoopback() && validAddress(device.address)) return lanCodeFor(device.address);
    return ui.room.code;
  }
  function lanCodeFor(ip) {
    const [, , c, d] = ip.split('.').map(Number);
    let v = (c << 12) | (d << 4) | ((c ^ d ^ (c >> 4) ^ (d >> 4)) & 15), out = '';
    for (let shift = 15; shift >= 0; shift -= 5) out += ALPHABET[(v >> shift) & 31];
    return out;
  }

  /** The link friends open to join. It is never a localhost address: that only works on this phone. */
  function inviteLink() {
    const base = reachableBase();
    return base ? `${base}/#join=${roomCode()}` : '';
  }

  async function refreshInfo() {
    try { ui.info = await api('/api/info'); } catch (_) { /* keep what we have */ }
  }

  // ---------- views ----------

  function landingHTML() {
    return `<main class="landing">
      <div class="landing-main">
        <p class="wordmark">musync</p>
        <h1>One queue for everyone’s music.</h1>
        <p class="landing-lede">Start a room and share the code. Friends add songs from their own phones.</p>
        ${ui.notice ? `<p class="notice" role="status">${esc(ui.notice)}</p>` : ''}
        <div class="landing-actions">
          ${ui.info.canStart ? `<button type="button" class="btn btn-primary btn-block" id="start-room">Start a room</button>
          <p class="divider">or join one</p>` : ''}
          <form id="join-form" novalidate>
            <label class="field-label" for="join-code">Room code or invite link</label>
            <div class="join-row">
              <input class="field" id="join-code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="4 characters" aria-describedby="join-error">
              <button type="submit" class="btn" id="join-submit">Join</button>
            </div>
            <p class="field-error" id="join-error" role="alert" hidden></p>
          </form>
        </div>
        <ol class="steps">
          <li><span><b>Start or join a room</b>${ui.info.lan ? 'Everyone on the same Wi-Fi can join. No account needed.' : 'No account needed. A room is just a code.'}</span></li>
          <li><span><b>Search and add songs</b>Everyone adds to the same queue, and bumps the songs they want sooner.</span></li>
          <li><span><b>Listen together</b>The host’s phone plays each song in full, in the music service the person who picked it uses when the phone has it.</span></li>
        </ol>
      </div>
    </main>`;
  }

  function appOptions(name, selected) {
    return `<div class="options">${APPS.map((s) => `<label class="option${selected === s.id ? ' is-checked' : ''}">
      <span>${esc(s.name)}${playerKind(s.id) === 'web' ? '<small>Plays inside musync on this phone</small>' : ''}</span>
      <input type="radio" name="${name}" value="${s.id}" ${selected === s.id ? 'checked' : ''}>
      <span class="option-mark">${ICON.check}</span></label>`).join('')}</div>`;
  }

  function setupHTML() {
    const joining = ui.setup.mode === 'join';
    return `<main class="setup">
      <div class="setup-top"><button type="button" class="iconbtn" id="setup-back" aria-label="Back">${ICON.back}</button><span class="wordmark">musync</span></div>
      <div><h1>${joining ? 'Join room ' + esc(ui.setup.code) : 'Start a room'}</h1>
        <p class="setup-sub">Two things and you’re in.</p></div>
      <form id="setup-form" novalidate>
        <div>
          <label class="field-label" for="setup-name">Your name</label>
          <input class="field" id="setup-name" maxlength="16" autocomplete="given-name" value="${esc(device.name)}" placeholder="Shown next to the songs you add" aria-describedby="setup-name-error">
          <p class="field-error" id="setup-name-error" role="alert" hidden></p>
        </div>
        <fieldset>
          <legend>Your music app</legend>
          <p class="legend-help">${joining ? 'Your songs play in this service when the host’s phone has it.' : 'Songs play in this service on this phone.'} You can change it later.</p>
          ${appOptions('app', device.app)}
          <p class="field-error" id="setup-app-error" role="alert" hidden></p>
        </fieldset>
        <div class="setup-foot">
          <button type="submit" class="btn btn-primary btn-block" id="setup-submit">${joining ? 'Join room' : 'Start room'}</button>
          <p class="field-error" id="setup-error" role="alert" hidden></p>
        </div>
      </form>
    </main>`;
  }

  function roomHTML() {
    return `<main class="room">
      <header class="roombar" id="roombar">
        <div class="roombar-id">
          <span class="roombar-name" data-slot="roomname"></span>
          <span class="roombar-code">Code <b data-slot="code">${esc(roomCode())}</b></span>
        </div>
        <div class="roombar-actions">
          <button type="button" class="people-btn" id="open-people" data-slot="people"></button>
          <button type="button" class="btn btn-sm" id="open-invite">${ICON.invite}Invite</button>
        </div>
      </header>
      <div class="room-grid">
        <section class="room-col room-col-now" aria-labelledby="now-h">
          <div class="section-head"><h2 id="now-h" data-slot="nowhead"></h2></div>
          <div data-slot="setup"></div>
          <div data-slot="now"></div>
          <div data-slot="after"></div>
        </section>
        <section class="room-col" aria-labelledby="next-h">
          <div class="addbar"><button type="button" class="addbar-btn" id="open-search">${ICON.search}<span>Add a song</span></button></div>
          <div class="section-head"><h2 id="next-h">Up next</h2><span data-slot="count"></span></div>
          <div data-slot="queue"></div>
        </section>
      </div>
    </main>`;
  }

  function tvHTML() {
    return `<main class="tv force-dark">
      <div class="tv-top"><span class="wordmark">musync</span>
        <button type="button" class="btn btn-sm" id="tv-exit">Exit big screen</button></div>
      <div class="tv-grid">
        <section class="tv-now" data-slot="now" aria-label="Now playing"></section>
        <aside class="tv-side">
          <section class="tv-join" aria-label="How to join">
            <div class="qr" id="tv-qr" role="img" aria-label="QR code to join this room"></div>
            <div><h2>Scan to add songs</h2><p>or enter the room code</p>
              <p class="invite-code">${esc(roomCode())}</p></div>
          </section>
          <section class="tv-next" aria-labelledby="tv-next">
            <div class="section-head"><h2 id="tv-next">Up next</h2><span data-slot="count"></span></div>
            <div class="tv-queue" data-slot="queue"></div>
          </section>
        </aside>
      </div>
    </main>`;
  }

  // ---------- live regions ----------

  const eq = (on) => `<span class="eq${on ? ' is-on' : ''}" aria-hidden="true"><i></i><i></i><i></i></span>`;
  function sourceLine(n) {
    if (setupMode()) {
      if (isHost()) return 'Waiting for the step above';
      return `Starts when ${nameOf(ui.room.hostId)} finishes setting up`;
    }
    if (!fullMode()) return '30-second preview';
    const where = `${appName(n.app || playback().app)} on ${isHost() ? 'this phone' : nameOf(ui.room.hostId) + '’s phone'}`;
    const st = playback().status;
    if (st === 'failed' || st === 'needs-open') return `Couldn’t start in ${where}`;
    if (!n.started) return `Starting in ${where}`;
    return `Playing in ${where}`;
  }

  /** Anything the host needs to know or do about playback, shown under the song. */
  function playbackNote() {
    const pb = playback();
    // While a song is starting, the line under the picker's name already says so.
    if (!fullMode() || !pb.detail || pb.status === 'starting') return '';
    const playingIn = (ui.room.now && ui.room.now.app) || pb.app;
    let action = '';
    if (isHost() && native()) {
      if (pb.status === 'needs-open') action = `<button type="button" class="btn btn-sm" id="open-music-app" data-app="${esc(playingIn)}">Open ${esc(appName(playingIn))}</button>`;
      if (pb.status === 'failed' || pb.status === 'needs-open') action += '<button type="button" class="btn btn-sm" id="retry-play">Try again</button>';
      if (pb.status === 'failed' && playerKind(playingIn) === 'web') action += `<button type="button" class="btn btn-sm" data-show-player="${esc(playingIn)}">Show ${esc(appName(playingIn))}</button>`;
    }
    return `<div class="now-note"><p>${esc(pb.detail)}</p>${action ? `<div class="now-actions">${action}</div>` : ''}</div>`;
  }

  /** On the host's phone: the one step needed before songs can play. */
  function setupCardHTML() {
    const pb = playback();
    if (!isHost() || !native() || !pb.device || fullMode() || playerKind(pb.app) === 'web') return '';
    const app = esc(appName(pb.app));
    if (pb.status === 'no-app') {
      return `<div class="card card-step"><b>${app} isn’t on this phone</b>
        <p>musync plays each song in your own music app. Install ${app}, or pick the music app you have.</p>
        <div class="now-actions"><button type="button" class="btn btn-primary" id="change-app">Change app</button></div></div>`;
    }
    return `<div class="card card-step"><b>One step before the music plays</b>
      <p>musync plays whole songs in your ${app} app, from your own account. Android needs your permission before one app may control another’s playback.</p>
      <ol class="howto">
        <li>Tap <b>Allow access</b>.</li>
        <li>Find <b>musync</b> in the list and switch it on.</li>
        <li>Come back here. The song starts by itself.</li>
      </ol>
      <div class="now-actions"><button type="button" class="btn btn-primary" id="grant-access">Allow access</button></div>
      <p class="card-help">Android calls this “notification access”. musync does not read your notifications.</p>
      <p class="card-help">If the switch is greyed out or Android says the setting is restricted: tap the button below, tap the three dots at the top right, tap “Allow restricted settings”, then tap Allow access again.</p>
      <div class="now-actions"><button type="button" class="btn btn-sm" id="open-app-settings">Open musync’s settings</button></div></div>`;
  }

  /** On the host's phone: offer to sign in to a service that is playing signed out. Gone once signed in. */
  function signInCardHTML() {
    const pb = playback();
    if (!isHost() || !native() || !pb.device) return '';
    const id = services().find((a) => playerKind(a) === 'web' && webSignedIn(a) === 'out' && !device.skipSignIn.includes(a));
    if (!id) return '';
    const name = esc(appName(id));
    return `<div class="card"><b>Sign in to ${name}</b>
      <p>${name} is playing signed out, so there may be ads. Sign in to play from your own account.</p>
      <div class="now-actions"><button type="button" class="btn btn-sm btn-primary" data-show-player="${esc(id)}">Sign in</button>
        <button type="button" class="btn btn-sm" data-skip-signin="${esc(id)}">Not now</button></div></div>`;
  }

  function nowHTML() {
    const n = ui.room.now;
    if (ui.view === 'tv') {
      if (!n) return '<div class="tv-idle"><p class="tv-label">Nothing is playing</p><h1 class="tv-title">Scan the code and add the first song.</h1></div>';
      return `<div class="tv-cover">${cover(n.song, true)}</div>
        <div><p class="tv-label">${n.paused ? 'Paused' : 'Now playing'}${eq(!n.paused)}</p>
          <h1 class="tv-title">${esc(n.song.title)}</h1><p class="tv-artist">${esc(n.song.artist)}</p></div>
        <p class="tv-pick">${avatar(n.by)}<span><b>${esc(pickLabel(n.by))}</b>, ${esc(sourceLine(n).replace(/^(30-second)/, 'a $1').replace(/^[A-Z]/, (c) => c.toLowerCase()))}</span></p>
        ${progressHTML()}`;
    }
    if (!n) return '<div class="empty"><b>Nothing is playing</b>The room starts when someone adds a song.</div>';
    const mine = n.by === ui.me;
    const app = myApp();
    const actions = [];
    if (ui.needsTap && isPlayer()) actions.push(`<button type="button" class="btn btn-sm btn-primary" id="tap-sound">${ICON.sound}Turn sound on</button>`);
    if (isHost() && running(n)) actions.push(`<button type="button" class="btn btn-sm" id="toggle-play">${n.paused ? ICON.play + 'Play' : ICON.pause + 'Pause'}</button>`);
    if (isHost() || mine) actions.push(`<button type="button" class="btn btn-sm" id="skip">${ICON.skip}${mine && !isHost() ? 'Skip my song' : 'Skip'}</button>`);
    if (!isHost() && playback().mode === 'preview') actions.push(`<button type="button" class="btn btn-sm" id="toggle-listen" aria-pressed="${ui.listening}">${ICON.sound}${ui.listening ? 'Sound is on' : 'Listen on this device'}</button>`);
    // The host's phone plays the song itself; sending the host to another app would be a detour.
    if (!(isHost() && playback().device)) actions.push(`<button type="button" class="btn btn-sm" id="open-full" data-key="${n.key}">${ICON.open}Open in ${esc(appName(app))}</button>`);
    return `<div class="now" style="--tint: hsl(${hueOf(n.song)} 44% 36%)">
      <div class="now-top">${cover(n.song, true)}
        <div><h3 class="now-title">${esc(n.song.title)}</h3><p class="now-artist">${esc(n.song.artist)}</p></div></div>
      <div class="now-pick">${avatar(n.by)}<div class="now-pick-text"><b>${esc(pickLabel(n.by))}</b><span>${esc(sourceLine(n))}</span></div></div>
      ${progressHTML()}
      ${playbackNote()}
      <div class="now-actions">${actions.join('')}</div>
    </div>`;
  }

  /** The song is audible and its clock is running (not waiting for setup, not still starting). */
  const running = (n) => !!n && !setupMode() && n.started !== false;

  // The host can drag through the song. Everyone else sees the same bar without the handle.
  function progressHTML() {
    const n = ui.room.now, live = running(n);
    const scrub = live && isHost() && ui.view === 'room'
      ? `<input class="scrub" type="range" min="0" max="${n.duration}" step="1000" value="0" data-scrub aria-label="Position in the song">` : '';
    return `<div class="progress${!live && fullMode() ? ' is-starting' : ''}${scrub ? ' has-scrub' : ''}">
      <div class="progress-bar"><div class="progress-track"><div class="progress-fill" data-fill></div></div>${scrub}</div>
      <div class="progress-times num"><span data-elapsed></span><span data-total></span></div></div>`;
  }

  function rowHTML(e) {
    const n = e.bumps.length, title = esc(e.song.title);
    const mine = e.by === ui.me;
    let side;
    if (ui.view === 'tv') {
      side = n ? `<span class="tv-bumps num">${plural(n, 'bump')}</span>` : '<span></span>';
    } else {
      const bumped = e.bumps.includes(ui.me);
      side = `<div class="row-side">
        ${mine || isHost() ? `<button type="button" class="iconbtn" data-remove="${e.key}" aria-label="Remove ${title} from the queue">${ICON.x}</button>` : ''}
        <button type="button" class="bump num" data-bump="${e.key}" aria-pressed="${bumped}"
          aria-label="${bumped ? 'Take back your bump on' : 'Bump'} ${title}. ${plural(n, 'bump')}.">${bumped ? ICON.upSolid : ICON.up}<span>${n}</span></button></div>`;
    }
    return `<li class="row${ui.justAdded === e.song.ref ? ' is-new' : ''}" data-key="${e.key}">${cover(e.song)}
      <div class="row-main"><span class="row-title">${title}</span><span class="row-artist">${esc(e.song.artist)}</span>
        <span class="row-pick">${avatar(e.by, 'avatar-sm')}<b>${esc(mine ? 'You' : nameOf(e.by))}</b>${playback().device && e.app ? `<span>${esc(appName(e.app))}</span>` : ''}</span></div>
      ${side}</li>`;
  }

  function queueHTML() {
    const tv = ui.view === 'tv', q = ui.room.queue;
    if (!q.length) {
      if (!ui.room.now) {
        return tv ? '' : `<div class="empty"><b>The queue is empty</b>Songs line up here as people add them.
          <button type="button" class="btn" data-open-invite>${ICON.invite}Invite friends</button></div>`;
      }
      return tv
        ? '<div class="empty"><b>Nothing queued after this</b>Scan the code to add the next song.</div>'
        : '<div class="empty"><b>Nothing queued after this</b>Add the next song before the room goes quiet.</div>';
    }
    let shown = q.length;
    if (tv) shown = q.length > ui.tvRows ? Math.max(1, ui.tvRows - 1) : q.length;
    const more = q.length - shown;
    return `<ol class="list">${q.slice(0, shown).map(rowHTML).join('')}</ol>${more > 0 ? `<p class="tv-more">and ${plural(more, 'more song')}</p>` : ''}`;
  }

  function peopleBtnHTML() {
    const list = ui.room.people;
    return `<span class="stack">${list.slice(0, 3).map((p) => avatar(p.id)).join('')}</span><span aria-hidden="true">${list.length}</span>
      <span class="visually-hidden">${people(list.length)} in this room. Open the list.</span>`;
  }

  // ---------- rendering ----------

  const app = $('#app');
  const slot = (name) => $(`[data-slot="${name}"]`, app);

  function render() {
    const v = ui.view;
    app.innerHTML = v === 'room' ? roomHTML() : v === 'tv' ? tvHTML() : v === 'setup' ? setupHTML()
      : v === 'landing' ? landingHTML() : '<main class="loading"><p class="wordmark">musync</p></main>';
    document.body.classList.toggle('is-tv', v === 'tv');
    if (v === 'tv') drawQR($('#tv-qr'));
    if (v === 'room' || v === 'tv') refresh(true);
    if (v === 'tv') fitTV();
    if (v === 'room') watchRoombar();
  }

  // Re-render the parts that change while the room is open. Rows that moved slide.
  function refresh(instant) {
    if ((ui.view !== 'room' && ui.view !== 'tv') || !ui.room) return;
    const q = slot('queue');
    const before = new Map();
    if (!instant) q.querySelectorAll('[data-key]').forEach((el) => before.set(el.dataset.key, el.getBoundingClientRect().top));
    const active = document.activeElement;
    const refocus = active && app.contains(active)
      ? (active.dataset.bump ? `[data-bump="${active.dataset.bump}"]` : active.id ? '#' + active.id : null) : null;

    // While the host is dragging through the song, leave the card alone so the drag is not cut off.
    if (!ui.scrubbing) slot('now').innerHTML = nowHTML();
    q.innerHTML = queueHTML();
    slot('count').textContent = ui.room.queue.length ? plural(ui.room.queue.length, 'song') : '';
    if (ui.view === 'room') {
      const n = ui.room.now;
      slot('nowhead').innerHTML = !n ? 'Now playing' : setupMode() ? 'Ready to play' : !running(n) ? 'Up now' : `${n.paused ? 'Paused' : 'Now playing'}${eq(!n.paused)}`;
      slot('people').innerHTML = peopleBtnHTML();
      slot('roomname').textContent = isHost() ? 'Your room' : nameOf(ui.room.hostId) + '’s room';
      slot('code').textContent = roomCode();
      const card = setupCardHTML();
      if (slot('setup').innerHTML !== card) slot('setup').innerHTML = card;
      const after = signInCardHTML();
      if (slot('after').innerHTML !== after) slot('after').innerHTML = after;
    }
    paintProgress(true);

    if (refocus) { const el = $(refocus, app); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); }
    if (!instant && !reducedMotion()) {
      q.querySelectorAll('[data-key]').forEach((el) => {
        const was = before.get(el.dataset.key);
        if (was == null) return;
        const dy = was - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
      });
    }
    ui.justAdded = null;
    if ($('#people-sheet').open) renderPeople();
    if ($('#search-sheet').open && !ui.search.loading) renderResults();
    if (ui.view === 'tv') fitTV();
  }

  /** Where the song is right now, from the server's clock. */
  function position() {
    const n = ui.room && ui.room.now;
    if (!running(n)) return 0;
    return Math.min(n.duration, n.paused ? n.position : n.position + (Date.now() - ui.receivedAt));
  }

  function paintProgress(jump, at) {
    const n = ui.room && ui.room.now, fill = $('[data-fill]', app);
    if (!n || !fill) return;
    const live = running(n);
    const pos = at != null ? at : position();
    if (jump || ui.scrubbing) fill.style.transition = 'none';
    fill.style.transform = 'scaleX(' + (live ? Math.min(1, pos / n.duration) : 0) + ')';
    if (jump) { void fill.offsetWidth; fill.style.transition = ''; }
    const scrub = $('[data-scrub]', app);
    if (scrub && !ui.scrubbing) scrub.value = pos;
    if (scrub) scrub.setAttribute('aria-valuetext', `${clock(pos)} of ${clock(n.duration)}`);
    $('[data-elapsed]', app).textContent = live ? clock(pos) : '';
    $('[data-total]', app).textContent = clock(n.duration);
  }
  setInterval(() => paintProgress(false), 500);

  // The big screen cannot scroll, so show only as many rows as fit.
  function fitTV() {
    if (ui.view !== 'tv') return;
    const box = $('.tv-queue', app), row = $('.tv-queue .row', app);
    if (!box || !row) return;
    const fixed = matchMedia('(min-width: 900px)').matches;
    const rows = fixed ? Math.max(1, Math.floor(box.clientHeight / row.getBoundingClientRect().height)) : 99;
    if (rows !== ui.tvRows) { ui.tvRows = rows; refresh(true); }
  }
  window.addEventListener('resize', fitTV);

  function watchRoombar() {
    const bar = $('#roombar');
    if (bar) bar.classList.toggle('is-stuck', window.scrollY > 4);
  }
  window.addEventListener('scroll', watchRoombar, { passive: true });

  function drawQR(box) {
    if (!box || typeof qrcode !== 'function' || !ui.room) return;
    const link = inviteLink();
    if (!link) { box.hidden = true; return; }
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    box.innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
  }

  // ---------- sound ----------

  // The host's device is the room's speaker. Anyone else can opt in to hear the
  // same preview on their own device, kept in step with the server's clock.
  const player = $('#player');
  let loadedKey = null;

  function stopPlayer() {
    player.pause();
    player.removeAttribute('src');
    loadedKey = null;
  }

  function syncPlayer() {
    const n = ui.room && ui.room.now;
    if (!n || !isPlayer() || !n.song.preview) {
      if (loadedKey) stopPlayer();
      return;
    }
    if (loadedKey !== n.key) {
      loadedKey = n.key;
      player.src = n.song.preview;
      player.currentTime = 0;
    }
    const want = position() / 1000;
    if (Number.isFinite(player.duration) && want >= player.duration) return;
    if (Math.abs(player.currentTime - want) > 1.5) {
      try { player.currentTime = want; } catch (_) { /* not seekable yet */ }
    }
    if (n.paused) { player.pause(); return; }
    if (player.paused) {
      const p = player.play();
      if (p && p.catch) {
        p.then(() => { if (ui.needsTap) { ui.needsTap = false; refresh(true); } })
          .catch((e) => {
            // Browsers block sound until the person taps something.
            if (e && e.name === 'NotAllowedError' && !ui.needsTap) { ui.needsTap = true; refresh(true); }
          });
      }
    }
  }
  setInterval(syncPlayer, 2000);

  player.addEventListener('loadedmetadata', () => {
    const n = ui.room && ui.room.now;
    if (isHost() && n && n.key === loadedKey && Number.isFinite(player.duration)) {
      api(`/api/rooms/${ui.room.code}/act`, { token: device.token, type: 'duration', key: n.key, ms: Math.round(player.duration * 1000) }).catch(() => {});
    }
  });
  player.addEventListener('ended', () => {
    const n = ui.room && ui.room.now;
    if (isHost() && n && n.key === loadedKey) {
      api(`/api/rooms/${ui.room.code}/act`, { token: device.token, type: 'ended', key: n.key }).catch(() => {});
    }
  });

  // Keep the host's screen awake where the browser allows it; the room stops if the phone sleeps.
  let wakeLock = null;
  async function keepAwake() {
    try { if (isHost() && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (_) { /* optional */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

  // ---------- search ----------

  const searchSheet = $('#search-sheet'), input = $('#search-input'), results = $('#results');
  $('.searchbox-icon').innerHTML = ICON.search;
  let searchTimer, searchAbort;

  // Search uses one neutral song index. When the host's phone can play more than
  // one service, the person chooses which one their song plays in.
  function renderChips() {
    const box = $('#scope-chips'), list = services();
    if (list.length < 2) { box.hidden = true; box.innerHTML = ''; ui.playIn = ''; return; }
    if (!list.includes(ui.playIn)) ui.playIn = list.includes(myApp()) ? myApp() : (list.includes(playback().app) ? playback().app : list[0]);
    box.hidden = false;
    box.setAttribute('aria-label', 'Which service plays the song');
    box.innerHTML = '<span class="chips-label">Play in</span>' + list.map((id) =>
      `<button type="button" class="chip" data-play-in="${esc(id)}" aria-pressed="${ui.playIn === id}">${esc(appName(id))}</button>`).join('');
  }

  function queueSearch(now) {
    const q = input.value.trim();
    clearTimeout(searchTimer);
    if (searchAbort) searchAbort.abort();
    ui.search = { q, loading: !!q, songs: [], failed: [], error: '' };
    renderResults();
    if (q.length < 2) { ui.search.loading = false; return renderResults(); }
    searchTimer = setTimeout(runSearch, now ? 0 : 450);
  }

  async function runSearch() {
    const q = ui.search.q, scope = ui.scope;
    searchAbort = new AbortController();
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(q)}&src=${scope}&code=${ui.room.code}&token=${device.token}`, null, { signal: searchAbort.signal });
      if (q !== input.value.trim() || scope !== ui.scope) return;
      ui.search = { q, loading: false, songs: r.songs || [], failed: r.failed || [], error: '' };
    } catch (e) {
      if (e.name === 'AbortError') return;
      ui.search = { q, loading: false, songs: [], failed: [], error: e.message };
    }
    renderResults();
  }

  function renderResults() {
    const s = ui.search, note = $('#search-note');
    input.placeholder = 'Songs or artists';
    note.textContent = s.failed.length && !s.loading && s.songs.length ? 'Some results may be missing. Try again in a moment.' : '';

    if (s.loading) {
      results.innerHTML = Array.from({ length: 6 }, () => '<li class="skel" aria-hidden="true"><i></i><div><i></i><i></i></div></li>').join('');
      return;
    }
    if (s.error) {
      results.innerHTML = `<li class="results-note"><b>Search didn’t work</b>${esc(s.error)}
        <br><button type="button" class="btn btn-sm" id="search-retry">Try again</button></li>`;
      return;
    }
    if (s.q.length < 2) {
      results.innerHTML = `<li class="results-note"><b>Find a song</b>Search by song or artist.
        ${playback().device ? `It plays in full on ${esc(isHost() ? 'this phone' : nameOf(ui.room.hostId) + '’s phone')}, in ${esc(appName(ui.playIn || playback().app))}.` : `The room plays a 30-second preview; open the full song in ${esc(appName(myApp()))} any time.`}</li>`;
      return;
    }
    if (!s.songs.length) {
      results.innerHTML = `<li class="results-note"><b>No results for “${esc(s.q)}”</b>Check the spelling, or try the artist’s name.</li>`;
      return;
    }
    // The two catalogs often both have a song. Show it once, and treat either
    // copy as "in the queue" when the room already has that song.
    const same = (song) => (song.title + '|' + song.artist).toLowerCase();
    const inRoom = new Set(ui.room.queue.map((e) => same(e.song)));
    if (ui.room.now) inRoom.add(same(ui.room.now.song));
    const seen = new Set();
    const songs = s.songs.filter((song) => !seen.has(same(song)) && seen.add(same(song)));
    results.innerHTML = songs.map((song) => {
      let action;
      if (inRoom.has(same(song))) action = `<span class="added">${ICON.check}In queue</span>`;
      else if (ui.adding.has(song.ref)) action = '<button type="button" class="btn btn-sm is-busy" disabled>Adding</button>';
      else action = `<button type="button" class="btn btn-primary btn-sm" data-add="${esc(song.ref)}" aria-label="Add ${esc(song.title)} by ${esc(song.artist)}">Add</button>`;
      const where = song.album || '';
      return `<li class="row">${cover(song)}
        <div class="row-main"><span class="row-title">${esc(song.title)}</span><span class="row-artist">${esc(song.artist)}</span>
          ${where ? `<span class="result-where">${esc(where)}</span>` : ''}</div>
        ${action}</li>`;
    }).join('');
  }

  function openSearch() {
    ui.scope = 'all';
    input.value = '';
    ui.search = { q: '', loading: false, songs: [], failed: [], error: '' };
    renderChips();
    renderResults();
    searchSheet.showModal();
    input.focus();
  }

  async function addSong(ref) {
    ui.adding.add(ref);
    renderResults();
    try {
      const wasEmpty = !ui.room.now;
      const body = { token: device.token, type: 'add', ref };
      if (ui.playIn) body.app = ui.playIn;
      await api(`/api/rooms/${ui.room.code}/act`, body);
      ui.justAdded = ref;
      toast(wasEmpty && !setupMode() ? (ui.playIn ? `Starting in ${appName(ui.playIn)}` : 'Starting now') : 'Added to the queue');
    } catch (e) {
      toast(e.message);
    }
    ui.adding.delete(ref);
    renderResults();
  }

  // ---------- room sheet (invite + people) and app picker ----------

  function renderPeople() {
    const link = inviteLink();
    // No address means friends cannot reach this phone yet. Say so, and never show a localhost link.
    const invite = link ? `
        <div class="invite"><div class="qr" id="invite-qr" role="img" aria-label="QR code to join this room"></div>
          <div><p>Room code</p><p class="invite-code">${esc(roomCode())}</p>
            <button type="button" class="btn btn-sm" id="copy-link">${ICON.copy}Copy invite link</button></div></div>
        <p class="invite-help">${ui.info.lan ? 'Friends on the same Wi-Fi scan the code or open' : 'Friends scan the code or open'} <span class="invite-link">${esc(link)}</span></p>` : `
        <div class="notice"><b>Friends can’t reach this phone yet</b>
          <p>musync couldn’t find this phone’s Wi-Fi address. Connect to Wi-Fi, or turn on your hotspot and have friends join it.</p>
          <button type="button" class="btn btn-sm" id="check-address">Check again</button></div>
        <form id="address-form" class="address-form" novalidate>
          <label class="field-label" for="address-input">Or enter this phone’s Wi-Fi address</label>
          <p class="legend-help">Find it in Settings, Wi-Fi, your network, IP address. It looks like 192.168.1.23.</p>
          <div class="join-row"><input class="field" id="address-input" inputmode="decimal" autocomplete="off" placeholder="192.168.1.23" value="${esc(device.address)}" aria-describedby="address-error">
            <button type="submit" class="btn">Use</button></div>
          <p class="field-error" id="address-error" role="alert" hidden></p>
        </form>`;
    $('#people-body').innerHTML = `
      <section class="sheet-section" aria-labelledby="inv-h"><h3 id="inv-h">Invite</h3>${invite}</section>
      <section class="sheet-section" aria-labelledby="ppl-h"><h3 id="ppl-h">${people(ui.room.people.length)} here</h3>
        <ul>${ui.room.people.map((p) => `<li class="person">${avatar(p.id, 'avatar-lg')}
          <div><span class="person-name">${esc(p.id === ui.me ? p.name + ' (you)' : p.name)}${p.host ? '<span class="tag">Host</span>' : ''}${p.online ? '' : '<span class="tag">Away</span>'}</span>
            <span class="person-app">${esc(appName(p.app))}</span></div>
          ${p.id === ui.me ? '<button type="button" class="btn btn-sm" id="change-app">Change app</button>' : '<span></span>'}</li>`).join('')}</ul>
      </section>
      ${servicesHTML()}
      <div class="sheet-actions">
        <button type="button" class="btn btn-block" id="open-tv">${ICON.tv}Show on a big screen</button>
        <button type="button" class="btn btn-ghost btn-block btn-danger-text" id="leave-room">${isHost() && ui.room.people.length > 1 ? 'Leave and hand over the room' : 'Leave room'}</button>
      </div>`;
    drawQR($('#invite-qr'));
  }
  /** On the host's phone: which services it can play, and signing in to the ones that take an account. */
  function servicesHTML() {
    const list = services();
    if (!isHost() || !native() || !playback().device || !list.length) return '';
    const rows = list.map((id) => {
      const web = playerKind(id) === 'web', signed = web ? webSignedIn(id) : 'none';
      const state = signed === 'in' ? 'Signed in' : signed === 'out' ? 'Playing signed out' : web ? 'No account needed' : 'Plays in the app on this phone';
      const action = signed === 'out' ? `<button type="button" class="btn btn-sm" data-show-player="${esc(id)}">Sign in</button>`
        : signed === 'in' ? `<button type="button" class="btn btn-sm" data-show-player="${esc(id)}">Open</button>` : '<span></span>';
      return `<li class="service"><div><span class="service-name">${esc(appName(id))}</span><span class="service-state">${state}</span></div>${action}</li>`;
    }).join('');
    return `<section class="sheet-section" aria-labelledby="svc-h"><h3 id="svc-h">This phone plays</h3>
      <ul>${rows}</ul>
      <p class="invite-help">A song plays in the service its picker uses when that service is listed here. Otherwise it plays in ${esc(appName(playback().app))}.</p></section>`;
  }
  function openPeople() {
    renderPeople();
    $('#people-sheet').showModal();
    // The phone may have joined Wi-Fi since we last looked.
    refreshInfo().then(() => { if ($('#people-sheet').open) renderPeople(); if (ui.view === 'room') refresh(true); });
  }

  function openAppPicker() {
    $('#service-body').innerHTML = `<p class="setup-sub">Your songs play in this service when the host’s phone has it. “Open in” also uses it.</p>
      <form id="service-form">${appOptions('app-pick', myApp())}
      <button type="submit" class="btn btn-primary btn-block">Use this app</button></form>`;
    $('#service-sheet').showModal();
  }

  // Sheets close on a tap outside, and on a downward swipe from the header.
  document.querySelectorAll('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { const t = $('#toast'); if (t.parentNode !== document.body) document.body.appendChild(t); });
    const head = dlg.querySelector('.sheet-head');
    let startY = null;
    head.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('button, input')) startY = ev.clientY; });
    head.addEventListener('pointermove', (ev) => {
      if (startY == null) return;
      const dy = Math.max(0, ev.clientY - startY);
      dlg.style.transform = dy ? `translateY(${dy}px)` : '';
    });
    const end = (ev) => {
      if (startY == null) return;
      const dy = ev.clientY - startY;
      startY = null; dlg.style.transform = '';
      if (dy > 90) dlg.close();
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  });

  // ---------- navigation ----------

  function go(view) {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    ui.view = view;
    render();
    window.scrollTo(0, 0);
  }

  /** Back to the start screen. If this page belongs to someone else's phone, return to our own. */
  function goHome() {
    try { history.replaceState(null, '', location.pathname); } catch (_) { /* sandboxed */ }
    if (device.home && device.home !== location.origin + '/') {
      const home = device.home;
      device.home = ''; persist();
      location.href = home + (ui.notice ? '#notice=' + encodeURIComponent(ui.notice) : '');
      return;
    }
    go('landing');
  }

  async function leaveRoom() {
    const code = ui.room && ui.room.code;
    disconnect();
    stopPlayer();
    if (code) { try { await api(`/api/rooms/${code}/act`, { token: device.token, type: 'leave' }); } catch (_) { /* gone already */ } }
    ui.room = null; ui.me = null; ui.listening = false;
    device.room = ''; persist();
    ui.notice = '';
    goHome();
  }

  async function enterRoom(mode, code) {
    const body = { token: device.token, name: device.name, app: device.app };
    const r = await api(mode === 'start' ? '/api/rooms' : `/api/rooms/${code}/join`, body);
    device.room = r.code; persist();
    ui.me = r.me; ui.room = r.state; ui.receivedAt = Date.now(); ui.notice = '';
    ui.view = 'room';
    render();
    connect(r.code);
    keepAwake();
    return r;
  }

  // The Android app calls this for the system back button. "1" means the press
  // was used here; "0" lets the app go to the background.
  // The Android app calls this after the person comes back from a service's web player.
  window.musyncRefresh = () => { refresh(true); };

  window.musyncBack = () => {
    const open = document.querySelector('dialog[open]');
    if (open) { open.close(); return '1'; }
    if (ui.view === 'tv') { go('room'); return '1'; }
    if (ui.view === 'setup') { go('landing'); return '1'; }
    return '0'; // from the room, back minimises the app; the room and the music keep going
  };

  // ---------- moving through the song ----------

  const scrubber = (ev) => (ev.target && ev.target.matches && ev.target.matches('[data-scrub]') ? ev.target : null);
  app.addEventListener('pointerdown', (ev) => { if (scrubber(ev)) ui.scrubbing = true; });
  app.addEventListener('input', (ev) => {
    const el = scrubber(ev);
    if (!el) return;
    ui.scrubbing = true;
    paintProgress(false, Number(el.value) || 0);
  });
  app.addEventListener('change', (ev) => {
    const el = scrubber(ev);
    if (!el) return;
    const ms = Number(el.value) || 0, n = ui.room && ui.room.now;
    ui.scrubbing = false;
    if (!n) return;
    // Show the new position at once; the room confirms it a moment later.
    n.position = ms;
    ui.receivedAt = Date.now();
    paintProgress(true);
    act('seek', { ms }).catch((e) => toast(e.message));
  });
  // A press that never moved sends no change; let the card update again.
  document.addEventListener('pointerup', () => {
    if (ui.scrubbing) setTimeout(() => { if (ui.scrubbing) { ui.scrubbing = false; refresh(true); } }, 300);
  });

  // ---------- events ----------

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    const d = t.dataset;

    if ('close' in d) return t.closest('dialog').close();
    if (t.id === 'start-room') { ui.setup = { mode: 'start', code: '', busy: false }; return go('setup'); }
    if (t.id === 'setup-back') return go('landing');

    if (d.bump) return act('bump', { key: d.bump }).catch(() => {});
    if (d.remove) {
      const e = ui.room.queue.find((q) => q.key === d.remove);
      return act('remove', { key: d.remove }).then(() => {
        if (e) toast('Removed ' + e.song.title, 'Undo', () => addSong(e.song.ref));
      }).catch(() => {});
    }
    if (t.id === 'open-search') return openSearch();
    if (t.id === 'open-people' || t.id === 'open-invite' || 'openInvite' in d) return openPeople();
    if (t.id === 'skip') return act('skip', { key: ui.room.now.key }).catch(() => {});
    if (t.id === 'toggle-play') return act(ui.room.now.paused ? 'play' : 'pause').catch(() => {});
    if (t.id === 'toggle-listen') {
      ui.listening = !ui.listening; ui.needsTap = false;
      syncPlayer(); refresh(true);
      return toast(ui.listening ? 'Sound is on for this device' : 'Sound is off for this device');
    }
    if (t.id === 'tap-sound') { ui.needsTap = false; player.play().catch(() => {}); syncPlayer(); return refresh(true); }
    if (t.id === 'grant-access') return native() && native().requestMediaAccess();
    if (d.showPlayer) return native() && native().showWebPlayer && native().showWebPlayer(d.showPlayer);
    if (d.skipSignin) {
      if (!device.skipSignIn.includes(d.skipSignin)) device.skipSignIn.push(d.skipSignin);
      persist();
      return refresh(true);
    }
    if (d.playIn) { ui.playIn = d.playIn; renderChips(); return renderResults(); }
    if (t.id === 'open-app-settings') return native() && native().openAppSettings();
    if (t.id === 'open-music-app') return native() && native().openApp(d.app || playback().app);
    if (t.id === 'retry-play') return act('retry').catch(() => {});
    if (t.id === 'open-full') {
      const n = ui.room.now;
      return n && openOutside(fullSongUrl(n.song, myApp()));
    }

    if (d.scope) { ui.scope = d.scope; renderChips(); return queueSearch(true); }
    if (t.id === 'search-retry') return queueSearch(true);
    if (d.add) return addSong(d.add);

    if (t.id === 'check-address') {
      t.disabled = true; t.textContent = 'Checking';
      return refreshInfo().then(() => {
        renderPeople();
        if (!inviteLink()) toast('Still no Wi-Fi address found');
      });
    }
    if (t.id === 'copy-link') {
      const link = inviteLink();
      const done = () => toast('Invite link copied');
      const fail = () => toast('Couldn’t copy. The link is shown under the code.');
      try { navigator.clipboard.writeText(link).then(done, fail); } catch (_) { fail(); }
      return;
    }
    if (t.id === 'change-app') return openAppPicker();
    if (t.id === 'open-tv') return go('tv');
    if (t.id === 'tv-exit') return go('room');
    if (t.id === 'leave-room') return leaveRoom();
  });

  input.addEventListener('input', () => queueSearch(false));

  // Mark the chosen option with a class as well, for browsers without the CSS :has() selector.
  document.addEventListener('change', (ev) => {
    if (ev.target.type !== 'radio') return;
    const list = ev.target.closest('.options');
    if (list) list.querySelectorAll('.option').forEach((o) => o.classList.toggle('is-checked', o.contains(ev.target)));
  });

  document.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = ev.target.id;

    if (id === 'search-form') return queueSearch(true);

    if (id === 'join-form') {
      const field = $('#join-code'), err = $('#join-error'), btn = $('#join-submit');
      const fail = (msg) => { err.textContent = msg; err.hidden = false; field.setAttribute('aria-invalid', 'true'); field.focus(); };
      const raw = field.value.trim();
      err.hidden = true; field.removeAttribute('aria-invalid');
      if (/^https?:\/\//i.test(raw)) {
        // An invite link: go to that room's own address.
        let url;
        try { url = new URL(raw); } catch (_) { return fail('That link doesn’t look right. Paste the whole invite link.'); }
        const m = /join=([A-Za-z0-9]{4})/.exec(url.hash);
        if (!m) return fail('That link doesn’t include a room. Ask for the invite link again.');
        if (url.origin === location.origin) { ui.setup = { mode: 'join', code: m[1].toUpperCase(), busy: false }; return go('setup'); }
        location.href = `${url.origin}/#join=${m[1].toUpperCase()}&home=${encodeURIComponent(location.origin + '/')}&name=${encodeURIComponent(device.name)}&app=${device.app}`;
        return;
      }
      const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 4) return fail('Room codes are 4 letters or numbers. Check the host’s screen or the invite.');
      btn.disabled = true; btn.textContent = 'Looking';
      const base = await findRoom(code);
      btn.disabled = false; btn.textContent = 'Join';
      if (base === null) {
        return fail(ui.info.lan
          ? 'No room with that code on this Wi-Fi. Check the code, and that you’re on the same network as the host.'
          : 'No room with that code. Check it with the host.');
      }
      if (base === '') { ui.setup = { mode: 'join', code, busy: false }; return go('setup'); }
      location.href = `${base}/#join=${code}&home=${encodeURIComponent(location.origin + '/')}&name=${encodeURIComponent(device.name)}&app=${device.app}`;
      return;
    }

    if (id === 'setup-form') {
      if (ui.setup.busy) return;
      const nameField = $('#setup-name'), nameErr = $('#setup-name-error'), appErr = $('#setup-app-error'), formErr = $('#setup-error');
      const name = nameField.value.trim();
      const picked = ev.target.querySelector('input[name="app"]:checked');
      nameErr.hidden = appErr.hidden = formErr.hidden = true; nameField.removeAttribute('aria-invalid');
      if (!name) {
        nameErr.textContent = 'Enter a name so friends know whose pick it is.';
        nameErr.hidden = false; nameField.setAttribute('aria-invalid', 'true'); nameField.focus();
        return;
      }
      if (!picked) {
        appErr.textContent = 'Choose the app you listen with.';
        appErr.hidden = false; ev.target.querySelector('input[name="app"]').focus();
        return;
      }
      device.name = name; device.app = picked.value; persist();
      const btn = $('#setup-submit'), label = btn.textContent, mode = ui.setup.mode;
      ui.setup.busy = true; btn.disabled = true; btn.classList.add('is-busy');
      btn.textContent = mode === 'start' ? 'Starting' : 'Joining';
      try {
        await enterRoom(mode, ui.setup.code);
        if (mode === 'start') openPeople();
      } catch (e) {
        ui.setup.busy = false;
        const b = $('#setup-submit');
        if (b) { b.disabled = false; b.classList.remove('is-busy'); b.textContent = label; }
        const fe = $('#setup-error');
        if (fe) { fe.textContent = e.message; fe.hidden = false; }
      }
      return;
    }

    if (id === 'address-form') {
      const field = $('#address-input'), err = $('#address-error');
      const ip = field.value.trim();
      if (!validAddress(ip)) {
        err.textContent = 'That doesn’t look like a Wi-Fi address. It should be four numbers with dots, like 192.168.1.23.';
        err.hidden = false; field.setAttribute('aria-invalid', 'true'); field.focus();
        return;
      }
      device.address = ip; persist();
      renderPeople();
      if (ui.view === 'room') refresh(true);
      return toast('Invite link updated');
    }

    if (id === 'service-form') {
      const picked = ev.target.querySelector('input:checked');
      $('#service-sheet').close();
      if (!picked) return;
      device.app = picked.value; persist();
      act('app', { app: picked.value }).then(() => toast('Your music app is now ' + appName(picked.value))).catch(() => {});
    }
  });

  // ---------- start ----------

  async function boot() {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (hash.get('home')) device.home = hash.get('home');
    if (hash.get('name') && !device.name) device.name = hash.get('name').slice(0, 16);
    if (hash.get('app') && !device.app && APPS.some((a) => a.id === hash.get('app'))) device.app = hash.get('app');
    if (hash.get('notice')) ui.notice = hash.get('notice').slice(0, 160);
    persist();

    try { ui.info = await api('/api/info'); } catch (_) { /* keep defaults; actions will report errors */ }

    const joinCode = (hash.get('join') || '').toUpperCase();
    const wanted = joinCode || device.room;
    try { history.replaceState(null, '', location.pathname); } catch (_) { /* sandboxed */ }

    if (wanted && device.name && device.app && (!joinCode || device.room === joinCode)) {
      // Coming back after a reload: step straight into the room.
      try { await enterRoom('join', wanted); return; } catch (e) {
        device.room = ''; persist();
        if (!joinCode) ui.notice = e.status === 404 ? 'That room has ended.' : '';
      }
    }
    if (joinCode) {
      if (await probe('', joinCode)) { ui.setup = { mode: 'join', code: joinCode, busy: false }; return go('setup'); }
      ui.notice = 'That room has ended or the link is out of date.';
    }
    go('landing');
  }
  render();
  boot();
})();
