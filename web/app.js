/* syng UI prototype.
   Everything runs on synthetic data in memory: no backend, no sign-in, no sound.
   The "store" section is the seam where a real room service plugs in later. */
(() => {
  'use strict';

  // ---------- synthetic data ----------

  // Illustrative list. Which services launch is undecided (see PRODUCT.md).
  const SERVICES = [
    { id: 'spotify', name: 'Spotify' },
    { id: 'apple', name: 'Apple Music' },
    { id: 'ytm', name: 'YouTube Music' },
    { id: 'tidal', name: 'Tidal' },
    { id: 'amazon', name: 'Amazon Music' },
    { id: 'soundcloud', name: 'SoundCloud' },
  ];
  const ALL = SERVICES.map((s) => s.id);
  const serviceName = (id) => (SERVICES.find((s) => s.id === id) || {}).name || id;

  // Real, well-known songs are treated as available everywhere. The three
  // single-service entries are invented, so no real availability is claimed.
  const CATALOG = [
    ['Dancing Queen', 'ABBA', 231], ['Mr. Brightside', 'The Killers', 223],
    ['Hey Ya!', 'OutKast', 235], ['Levitating', 'Dua Lipa', 203],
    ['September', 'Earth, Wind & Fire', 215], ["Don't Stop Me Now", 'Queen', 209],
    ['Blinding Lights', 'The Weeknd', 200], ['Valerie', 'Mark Ronson and Amy Winehouse', 219],
    ['Pink + White', 'Frank Ocean', 184], ['Espresso', 'Sabrina Carpenter', 175],
    ['Take On Me', 'a-ha', 225], ['Dreams', 'Fleetwood Mac', 257],
    ['Got to Be Real', 'Cheryl Lynn', 225], ['Electric Feel', 'MGMT', 229],
    ['Juice', 'Lizzo', 195], ['I Wanna Dance with Somebody (Who Loves Me)', 'Whitney Houston', 291],
    ['Redbone', 'Childish Gambino', 327], ['Crazy in Love', 'Beyoncé', 236],
    ['Heat Waves', 'Glass Animals', 239], ['Lovely Day', 'Bill Withers', 255],
    ['Rasputin', 'Boney M.', 280], ['Jai Ho', 'A. R. Rahman', 319],
    ['Despacito', 'Luis Fonsi', 229], ['Murder on the Dancefloor', 'Sophie Ellis-Bextor', 230],
    ['Basement Session No. 4', 'The Night Buses', 268, ['ytm']],
    ['Rooftop Mix 012', 'okra', 412, ['soundcloud']],
    ['Daylight Savings (Demo)', 'Lena Marsh', 198, ['tidal']],
  ].map(([title, artist, secs, on], id) => ({ id, title, artist, secs, on: on || ALL }));
  const song = (title) => CATALOG.find((s) => s.title === title);

  const PERSON_COLORS = ['coral', 'sky', 'mint', 'lilac', 'peach', 'pink', 'teal'];
  const ME = 'me'; // this device's person id; other people get their own ids

  // ---------- device preferences ----------

  const prefs = {
    read() { try { return JSON.parse(localStorage.getItem('syng.me') || 'null') || {}; } catch (_) { return {}; } },
    write(v) { try { localStorage.setItem('syng.me', JSON.stringify(v)); } catch (_) { /* private mode */ } },
  };

  // ---------- store ----------

  let keySeq = 0;
  let script = 0; // bumps whenever the room changes, cancelling old scripted events

  const state = {
    view: 'landing',     // landing | setup | room | tv
    setup: { mode: 'start', code: '', busy: false },
    room: null,          // { code, hostId }
    me: { name: prefs.read().name || '', services: prefs.read().services || [] },
    people: [],          // { id, name, label, service, color, host }
    now: null,           // queue entry + { elapsed }
    playing: false,
    queue: [],
    scope: 'mine',       // 'mine' | 'all' | service id
    loading: false,
    connecting: null,
    justAdded: null,
    tvRows: 5,
  };

  const myService = () => state.me.services[0];
  const person = (id) => state.people.find((p) => p.id === id);
  const labelOf = (id) => (person(id) || {}).label || 'Someone';
  const colorOf = (id) => (person(id) || {}).color || 'sky';
  const isHost = () => !!state.room && state.room.hostId === ME;
  const pickLabel = (id) => (id === ME ? 'Your pick' : labelOf(id) + '’s pick');
  const fromLabel = (e) => (e.by === ME
    ? 'Playing from your ' + serviceName(e.service)
    : 'Playing from ' + labelOf(e.by) + '’s ' + serviceName(e.service));

  // Two people can share a name, so identity is the id and the label is made unique.
  function addPerson(id, name, service, host) {
    if (person(id)) return;
    const same = state.people.filter((p) => p.name.toLowerCase() === name.toLowerCase()).length;
    state.people.push({
      id, name, label: same ? `${name} (${same + 1})` : name, service, host: !!host,
      color: PERSON_COLORS[state.people.length % PERSON_COLORS.length],
    });
  }
  const entry = (title, by, service, bumps = []) => ({
    key: 'e' + (++keySeq), song: song(title), by, service, bumps: new Set(bumps), at: keySeq,
  });
  const sortQueue = () => state.queue.sort((a, b) => b.bumps.size - a.bumps.size || a.at - b.at);
  const inRoom = (id) => (state.now && state.now.song.id === id) || state.queue.some((q) => q.song.id === id);

  function addSong(id, by, service) {
    const e = { key: 'e' + (++keySeq), song: CATALOG[id], by, service, bumps: new Set(), at: keySeq };
    if (!state.now) { state.now = { ...e, elapsed: 0 }; state.playing = true; }
    else { state.queue.push(e); sortQueue(); state.justAdded = e.key; }
    refresh();
    return e;
  }
  function toggleBump(key) {
    const e = state.queue.find((q) => q.key === key);
    if (!e) return;
    if (e.bumps.has(ME)) e.bumps.delete(ME); else e.bumps.add(ME);
    sortQueue();
    refresh();
  }
  function removeSong(key) {
    const i = state.queue.findIndex((q) => q.key === key);
    if (i < 0) return;
    const [gone] = state.queue.splice(i, 1);
    refresh();
    toast('Removed ' + gone.song.title, 'Undo', () => {
      if (inRoom(gone.song.id)) return;
      state.queue.push(gone); sortQueue(); state.justAdded = gone.key; refresh();
    });
  }
  function skip() {
    const next = state.queue.shift();
    state.now = next ? { ...next, elapsed: 0 } : null;
    state.playing = !!next;
    refresh();
  }

  // A room that already has people in it: what you see when you join a friend.
  function loadFriendsRoom(code) {
    script++;
    state.room = { code: code || 'KQ7M', hostId: 'maya' };
    state.people = [];
    addPerson('maya', 'Maya', 'spotify', true); addPerson('dev', 'Dev', 'ytm'); addPerson('priya', 'Priya', 'apple');
    addPerson('sam', 'Sam', 'tidal'); addPerson('jo', 'Jo', 'spotify');
    addPerson(ME, state.me.name, myService());
    state.now = { ...entry('September', 'maya', 'spotify'), elapsed: 73 };
    state.playing = true;
    state.queue = [
      entry('Hey Ya!', 'dev', 'ytm', ['maya', 'sam', 'jo']),
      entry('Dreams', 'priya', 'apple', ['dev', 'maya']),
      entry('Levitating', 'sam', 'tidal', ['jo']),
      entry('Mr. Brightside', 'jo', 'spotify', ['dev']),
      entry('Pink + White', 'maya', 'spotify'),
      entry('Basement Session No. 4', 'dev', 'ytm'),
    ];
    later(14000, () => {
      if (inRoom(song('Espresso').id)) return;
      addSong(song('Espresso').id, 'priya', 'apple');
      toast('Priya added Espresso');
    });
  }

  // A room you just started: empty, then friends arrive.
  function loadOwnRoom() {
    script++;
    const code = Array.from({ length: 4 }, () => 'ABCDEFGHJKMNPQRSTVWXYZ23456789'[Math.floor(Math.random() * 30)]).join('');
    state.room = { code, hostId: ME };
    state.people = [];
    addPerson(ME, state.me.name, myService(), true);
    state.now = null; state.playing = false; state.queue = [];
    later(7000, () => { addPerson('maya', 'Maya', 'spotify'); refresh(); toast(labelOf('maya') + ' joined'); });
    later(12000, () => { if (!inRoom(song('September').id)) { addSong(song('September').id, 'maya', 'spotify'); toast(labelOf('maya') + ' added September'); } });
    later(19000, () => { addPerson('dev', 'Dev', 'ytm'); refresh(); toast(labelOf('dev') + ' joined'); });
    later(24000, () => { if (!inRoom(song('Hey Ya!').id)) { addSong(song('Hey Ya!').id, 'dev', 'ytm'); toast(labelOf('dev') + ' added Hey Ya!'); } });
  }

  function later(ms, fn) {
    const mine = script;
    setTimeout(() => { if (mine === script && state.room) fn(); }, ms);
  }

  // ---------- helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clock = (secs) => Math.floor(secs / 60) + ':' + String(Math.floor(secs % 60)).padStart(2, '0');
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
    tv: svg('<rect x="2.5" y="4" width="15" height="10" rx="1.5"/><path d="M7 17h6"/>'),
    copy: svg('<rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M4 12.5v-7A1.5 1.5 0 0 1 5.5 4h7"/>'),
  };

  // Abstract cover tiles. Hue and shape come from the song's place in the
  // catalog, so no two songs share a tile. Synthetic stand-ins, not real art.
  const SHAPES = [
    (a, b, g) => `<circle cx="24" cy="24" r="17" fill="${a}"/><circle cx="24" cy="24" r="9" fill="${b}"/><circle cx="24" cy="24" r="2.5" fill="${g}"/>`,
    (a, b) => `<rect x="6" y="26" width="8" height="16" fill="${a}"/><rect x="20" y="14" width="8" height="28" fill="${b}"/><rect x="34" y="20" width="8" height="22" fill="${a}"/>`,
    (a, b) => `<path d="M0 48A48 48 0 0 1 48 0v48z" fill="${a}"/><path d="M0 48a26 26 0 0 1 26-26v26z" fill="${b}"/>`,
    (a, b) => `<rect width="24" height="24" fill="${a}"/><circle cx="34" cy="34" r="10" fill="${b}"/>`,
    (a, b) => `<path d="M0 0h48L0 48z" fill="${a}"/><circle cx="33" cy="33" r="7" fill="${b}"/>`,
    (a, b) => `<rect y="10" width="48" height="8" fill="${a}"/><rect y="24" width="48" height="8" fill="${b}"/><rect y="38" width="48" height="4" fill="${a}"/>`,
    (a, b) => `<circle cx="16" cy="24" r="12" fill="${a}"/><circle cx="32" cy="24" r="12" fill="${b}" fill-opacity=".85"/>`,
    (a, b) => `<path d="M24 6l18 36H6z" fill="${a}"/><circle cx="24" cy="31" r="6" fill="${b}"/>`,
    (a, b) => `<rect x="8" y="8" width="32" height="32" fill="${a}"/><rect x="16" y="16" width="16" height="16" fill="${b}"/>`,
  ];
  function coverHue(s) {
    if (s.id != null) return (s.id * 47 + 18) % 360;
    let h = 0;
    for (const ch of s.title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  }
  function cover(s) {
    const known = s.id != null ? s : song(s.title) || s;
    const hue = coverHue(known), kind = known.id != null ? known.id % SHAPES.length : hue % SHAPES.length;
    const bg = `hsl(${hue} 44% 36%)`, a = `hsl(${(hue + 28) % 360} 62% 66%)`, b = `hsl(${(hue + 320) % 360} 55% 52%)`;
    return `<span class="cover"><svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" fill="${bg}"/>${SHAPES[kind](a, b, bg)}</svg></span>`;
  }

  const avatar = (id, size = '') =>
    `<span class="avatar ${size}" data-person="${colorOf(id)}" aria-hidden="true">${esc(labelOf(id).trim().charAt(0))}</span>`;

  let toastTimer;
  function toast(msg, action, onAction) {
    const el = $('#toast');
    const host = document.querySelector('dialog[open]') || document.body;
    if (el.parentNode !== host) host.appendChild(el);
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { el.hidden = true; onAction(); };
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 3000);
  }

  // ---------- views ----------

  function landingHTML() {
    const rows = [
      ['Hey Ya!', 'OutKast', 'Dev', 'sky', 'YouTube Music'],
      ['Dreams', 'Fleetwood Mac', 'Priya', 'mint', 'Apple Music'],
      ['Levitating', 'Dua Lipa', 'Sam', 'lilac', 'Tidal'],
      ['Mr. Brightside', 'The Killers', 'Jo', 'peach', 'Spotify'],
    ];
    return `<main class="landing">
      <div class="landing-main">
        <p class="wordmark">syng</p>
        <h1>One queue for everyone’s music.</h1>
        <p class="landing-lede">Start a room and share the code. Friends add songs from the music app they already use.</p>
        <div class="landing-actions">
          <button type="button" class="btn btn-primary btn-block" id="start-room">Start a room</button>
          <p class="divider">or join one</p>
          <form id="join-form" novalidate>
            <label class="field-label" for="join-code">Room code</label>
            <div class="join-row">
              <input class="field" id="join-code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="4 characters" aria-describedby="join-error">
              <button type="submit" class="btn">Join</button>
            </div>
            <p class="field-error" id="join-error" role="alert" hidden></p>
          </form>
        </div>
        <ol class="steps">
          <li><span><b>Start or join a room</b>No account needed. A room is just a code.</span></li>
          <li><span><b>Pick your music app</b>Search the catalog you already know.</span></li>
          <li><span><b>Add to the shared queue</b>Each song plays from the account of whoever added it.</span></li>
        </ol>
      </div>
      <figure class="sample" aria-label="Example queue">
        <div class="section-head"><h2>Up next</h2><span>4 songs</span></div>
        <ul class="list">
          ${rows.map(([t, a, by, c, app]) => `<li class="row">${cover({ title: t, artist: a })}
            <div class="row-main"><span class="row-title">${esc(t)}</span><span class="row-artist">${esc(a)}</span>
            <span class="row-pick"><span class="avatar avatar-sm" data-person="${c}" aria-hidden="true">${by[0]}</span><b>${by}</b><span>${app}</span></span></div></li>`).join('')}
        </ul>
        <figcaption class="sample-caption">Example room. Four friends, four different apps, one queue.</figcaption>
      </figure>
    </main>`;
  }

  function serviceOptions(name, selected) {
    return `<div class="options">${SERVICES.map((s) => `<label class="option">
      <span>${esc(s.name)}</span>
      <input type="radio" name="${name}" value="${s.id}" ${selected === s.id ? 'checked' : ''}>
      <span class="option-mark">${ICON.check}</span></label>`).join('')}</div>`;
  }

  function setupHTML() {
    const joining = state.setup.mode === 'join';
    return `<main class="setup">
      <div class="setup-top"><button type="button" class="iconbtn" id="setup-back" aria-label="Back">${ICON.back}</button><span class="wordmark">syng</span></div>
      <div><h1>${joining ? 'Join room ' + esc(state.setup.code) : 'Start a room'}</h1>
        <p class="setup-sub">Two things and you’re in.</p></div>
      <form id="setup-form" novalidate>
        <div>
          <label class="field-label" for="setup-name">Your name</label>
          <input class="field" id="setup-name" maxlength="16" autocomplete="given-name" value="${esc(state.me.name)}" placeholder="Shown next to the songs you add" aria-describedby="setup-name-error">
          <p class="field-error" id="setup-name-error" role="alert" hidden></p>
        </div>
        <fieldset>
          <legend>Your music app</legend>
          <p class="legend-help">You’ll search this app’s catalog, and your songs play from your account there.</p>
          ${serviceOptions('service', myService())}
          <p class="field-error" id="setup-service-error" role="alert" hidden></p>
        </fieldset>
        <div class="setup-foot">
          <button type="submit" class="btn btn-primary btn-block" id="setup-submit">${joining ? 'Join room' : 'Start room'}</button>
          <p>Next you’ll sign in to the app you picked. You can change it later.</p>
        </div>
      </form>
    </main>`;
  }

  function roomHTML() {
    return `<main class="room">
      <header class="roombar" id="roombar">
        <div class="roombar-id">
          <span class="roombar-name">${esc(isHost() ? 'Your room' : labelOf(state.room.hostId) + '’s room')}</span>
          <span class="roombar-code">Code <b>${esc(state.room.code)}</b></span>
        </div>
        <div class="roombar-actions">
          <button type="button" class="people-btn" id="open-people" data-slot="people"></button>
          <button type="button" class="btn btn-sm" id="open-invite">${ICON.invite}Invite</button>
        </div>
      </header>
      <div class="room-grid">
        <section class="room-col room-col-now" aria-labelledby="now-h">
          <div class="section-head"><h2 id="now-h" data-slot="nowhead"></h2></div>
          <div data-slot="now"></div>
        </section>
        <section class="room-col" aria-labelledby="next-h">
          <div class="addbar"><button type="button" class="addbar-btn" id="open-search">${ICON.search}<span data-slot="addlabel"></span></button></div>
          <div class="section-head"><h2 id="next-h">Up next</h2><span data-slot="count"></span></div>
          <div data-slot="queue"></div>
        </section>
      </div>
    </main>`;
  }

  function tvHTML() {
    return `<main class="tv force-dark">
      <div class="tv-top"><span class="wordmark">syng</span>
        <button type="button" class="btn btn-sm" id="tv-exit">Exit big screen</button></div>
      <div class="tv-grid">
        <section class="tv-now" data-slot="now" aria-label="Now playing"></section>
        <aside class="tv-side">
          <section class="tv-join" aria-label="How to join">
            <div class="qr" id="tv-qr" role="img" aria-label="QR code to join this room"></div>
            <div><h2>Scan to add songs</h2><p>or enter the room code</p>
              <p class="invite-code">${esc(state.room.code)}</p></div>
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

  const eq = () => `<span class="eq${state.playing ? ' is-on' : ''}" aria-hidden="true"><i></i><i></i><i></i></span>`;
  const nowHeadHTML = () => (state.now ? `${state.playing ? 'Now playing' : 'Paused'}${eq()}` : 'Now playing');

  function nowHTML() {
    const n = state.now;
    if (state.view === 'tv') {
      if (!n) return '<div class="tv-idle"><p class="tv-label">Nothing is playing</p><h1 class="tv-title">Scan the code and add the first song.</h1></div>';
      return `<div class="tv-cover">${cover(n.song)}</div>
        <div><p class="tv-label">${state.playing ? 'Now playing' : 'Paused'}${eq()}</p>
          <h1 class="tv-title">${esc(n.song.title)}</h1><p class="tv-artist">${esc(n.song.artist)}</p></div>
        <p class="tv-pick">${avatar(n.by)}<span><b>${esc(pickLabel(n.by))}</b>, ${esc(fromLabel(n).replace('Playing from', 'playing from'))}</span></p>
        ${progressHTML()}`;
    }
    if (!n) return '<div class="empty"><b>Nothing is playing</b>The room starts when someone adds a song.</div>';
    const mine = n.by === ME;
    // Placeholder rules, pending a product decision: the host can pause and skip,
    // and whoever added the current song can skip it.
    const actions = [];
    if (isHost()) actions.push(`<button type="button" class="btn btn-sm" id="toggle-play">${state.playing ? ICON.pause + 'Pause' : ICON.play + 'Play'}</button>`);
    if (isHost() || mine) actions.push(`<button type="button" class="btn btn-sm" id="skip">${ICON.skip}${mine && !isHost() ? 'Skip my song' : 'Skip'}</button>`);
    return `<div class="now" style="--tint: hsl(${coverHue(n.song)} 44% 36%)">
      <div class="now-top">${cover(n.song)}
        <div><h3 class="now-title">${esc(n.song.title)}</h3><p class="now-artist">${esc(n.song.artist)}</p></div></div>
      <div class="now-pick">${avatar(n.by)}<div class="now-pick-text"><b>${esc(pickLabel(n.by))}</b><span>${esc(fromLabel(n))}</span></div></div>
      ${progressHTML()}
      ${actions.length ? `<div class="now-actions">${actions.join('')}</div>` : ''}
    </div>`;
  }

  const progressHTML = () => `<div class="progress">
      <div class="progress-track"><div class="progress-fill" data-fill></div></div>
      <div class="progress-times num"><span data-elapsed></span><span data-total></span></div></div>`;

  function rowHTML(e) {
    const n = e.bumps.size, title = esc(e.song.title);
    const mine = e.by === ME;
    let side;
    if (state.view === 'tv') {
      side = n ? `<span class="tv-bumps num">${plural(n, 'bump')}</span>` : '<span></span>';
    } else {
      const bumped = e.bumps.has(ME);
      // Placeholder rule, pending a product decision: you can remove your own
      // songs, and the host can remove any.
      side = `<div class="row-side">
        ${mine || isHost() ? `<button type="button" class="iconbtn" data-remove="${e.key}" aria-label="Remove ${title} from the queue">${ICON.x}</button>` : ''}
        <button type="button" class="bump num" data-bump="${e.key}" aria-pressed="${bumped}"
          aria-label="${bumped ? 'Take back your bump on' : 'Bump'} ${title}. ${plural(n, 'bump')}.">${bumped ? ICON.upSolid : ICON.up}<span>${n}</span></button></div>`;
    }
    return `<li class="row${state.justAdded === e.key ? ' is-new' : ''}" data-key="${e.key}">${cover(e.song)}
      <div class="row-main"><span class="row-title">${title}</span><span class="row-artist">${esc(e.song.artist)}</span>
        <span class="row-pick">${avatar(e.by, 'avatar-sm')}<b>${esc(mine ? 'You' : labelOf(e.by))}</b><span>${esc(serviceName(e.service))}</span></span></div>
      ${side}</li>`;
  }

  function queueHTML() {
    const tv = state.view === 'tv';
    if (!state.queue.length) {
      if (!state.now) {
        return tv ? '' : `<div class="empty"><b>The queue is empty</b>Songs line up here as people add them. Friends can use any music app.
          <button type="button" class="btn" data-open-invite>${ICON.invite}Invite friends</button></div>`;
      }
      return tv
        ? '<div class="empty"><b>Nothing queued after this</b>Scan the code to add the next song.</div>'
        : '<div class="empty"><b>Nothing queued after this</b>Add the next song before the room goes quiet.</div>';
    }
    let shown = state.queue.length;
    if (tv) shown = state.queue.length > state.tvRows ? Math.max(1, state.tvRows - 1) : state.queue.length;
    const more = state.queue.length - shown;
    return `<ol class="list">${state.queue.slice(0, shown).map(rowHTML).join('')}</ol>${more > 0 ? `<p class="tv-more">and ${plural(more, 'more song')}</p>` : ''}`;
  }

  function peopleBtnHTML() {
    const shown = state.people.slice(0, 3);
    return `<span class="stack">${shown.map((p) => avatar(p.id)).join('')}</span><span aria-hidden="true">${state.people.length}</span>
      <span class="visually-hidden">${people(state.people.length)} in this room. Open the list.</span>`;
  }

  // ---------- rendering ----------

  const app = $('#app');
  const slot = (name) => $(`[data-slot="${name}"]`, app);

  function render() {
    const v = state.view;
    app.innerHTML = v === 'room' ? roomHTML() : v === 'tv' ? tvHTML() : v === 'setup' ? setupHTML() : landingHTML();
    document.body.classList.toggle('is-tv', v === 'tv');
    document.querySelectorAll('.proto [data-proto]').forEach((b) => {
      const on = b.dataset.proto === v || (b.dataset.proto === 'landing' && v === 'setup');
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (v === 'tv') drawQR($('#tv-qr'));
    if (v === 'room' || v === 'tv') refresh(true);
    if (v === 'tv') fitTV();
    if (v === 'room') watchRoombar();
  }

  // Re-render the parts that change while the room is open. Rows that moved slide.
  function refresh(instant) {
    if (state.view !== 'room' && state.view !== 'tv') return;
    const q = slot('queue');
    const before = new Map();
    if (!instant) q.querySelectorAll('[data-key]').forEach((el) => before.set(el.dataset.key, el.getBoundingClientRect().top));
    const active = document.activeElement;
    const refocus = active && app.contains(active)
      ? (active.dataset.bump ? `[data-bump="${active.dataset.bump}"]` : active.id ? '#' + active.id : null) : null;

    slot('now').innerHTML = nowHTML();
    q.innerHTML = queueHTML();
    slot('count').textContent = state.queue.length ? plural(state.queue.length, 'song') : '';
    if (state.view === 'room') {
      slot('nowhead').innerHTML = nowHeadHTML();
      slot('people').innerHTML = peopleBtnHTML();
      slot('addlabel').textContent = 'Add a song from ' + serviceName(myService());
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
    state.justAdded = null;
    if ($('#people-sheet').open) renderPeople();
  }

  function paintProgress(jump) {
    const n = state.now, fill = $('[data-fill]', app);
    if (!n || !fill) return;
    if (jump) fill.style.transition = 'none';
    fill.style.transform = 'scaleX(' + Math.min(1, n.elapsed / n.song.secs) + ')';
    if (jump) { void fill.offsetWidth; fill.style.transition = ''; }
    $('[data-elapsed]', app).textContent = clock(n.elapsed);
    $('[data-total]', app).textContent = clock(n.song.secs);
  }

  // The big screen cannot scroll, so show only as many rows as fit.
  function fitTV() {
    if (state.view !== 'tv') return;
    const box = $('.tv-queue', app), row = $('.tv-queue .row', app);
    if (!box || !row) return;
    const fixed = matchMedia('(min-width: 900px)').matches;
    const rows = fixed ? Math.max(1, Math.floor(box.clientHeight / row.getBoundingClientRect().height)) : 99;
    if (rows !== state.tvRows) { state.tvRows = rows; refresh(true); }
  }
  window.addEventListener('resize', fitTV);

  function watchRoombar() {
    const bar = $('#roombar');
    if (bar) bar.classList.toggle('is-stuck', window.scrollY > 4);
  }
  window.addEventListener('scroll', watchRoombar, { passive: true });

  function drawQR(box) {
    if (!box || typeof qrcode !== 'function') return;
    const qr = qrcode(0, 'M');
    qr.addData(location.href.split('#')[0] + '#join');
    qr.make();
    box.innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
  }

  // ---------- search sheet ----------

  const searchSheet = $('#search-sheet'), input = $('#search-input'), results = $('#results');
  $('.searchbox-icon').innerHTML = ICON.search;
  let searchTimer;

  const scopeIds = () => (state.scope === 'mine' ? state.me.services : state.scope === 'all' ? ALL : [state.scope]);
  const connected = (id) => state.me.services.includes(id);

  function renderChips() {
    const mine = state.me.services;
    const chips = [
      ['mine', mine.length > 1 ? 'My apps' : serviceName(mine[0])],
      ['all', 'All apps'],
      ...SERVICES.filter((s) => !(mine.length === 1 && s.id === mine[0])).map((s) => [s.id, s.name]),
    ];
    $('#scope-chips').innerHTML = chips.map(([id, label]) =>
      `<button type="button" class="chip" data-scope="${id}" aria-pressed="${state.scope === id}">${esc(label)}</button>`).join('');
  }

  function runSearch() {
    state.loading = true;
    renderResults();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.loading = false; renderResults(); }, 320);
  }

  function connectButton(id, label) {
    return state.connecting === id
      ? '<button type="button" class="btn btn-sm is-busy" disabled>Connecting</button>'
      : `<button type="button" class="btn btn-sm" data-connect="${id}">${esc(label)}</button>`;
  }

  function renderResults() {
    const note = $('#search-note');
    const ids = scopeIds();
    const single = state.scope !== 'mine' && state.scope !== 'all' ? state.scope : null;
    const scopeLabel = state.scope === 'all' ? 'all apps' : state.scope === 'mine' && ids.length > 1 ? 'your apps' : serviceName(ids[0]);
    input.placeholder = 'Search ' + scopeLabel;

    // Browsing an app you have not connected: say so, and say where songs would play from.
    if (single && !connected(single)) {
      note.innerHTML = `<span>You haven’t connected ${esc(serviceName(single))}. Songs you add here play from your ${esc(serviceName(myService()))} when it has them.</span>
        ${connectButton(single, 'Connect ' + serviceName(single))}`;
    } else {
      note.textContent = input.value.trim() ? '' : 'Suggested on ' + scopeLabel;
    }

    if (state.loading) {
      results.innerHTML = Array.from({ length: 5 }, () => '<li class="skel" aria-hidden="true"><i></i><div><i></i><i></i></div></li>').join('');
      return;
    }
    const q = input.value.trim().toLowerCase();
    const hits = CATALOG.filter((s) => s.on.some((id) => ids.includes(id))
      && (q ? (s.title + ' ' + s.artist).toLowerCase().includes(q) : !inRoom(s.id)));
    if (!hits.length) {
      const wider = state.scope !== 'all';
      results.innerHTML = `<li class="results-note"><b>No results for “${esc(input.value.trim())}” on ${esc(scopeLabel)}</b>
        ${wider ? 'It may be on another app.' : 'Check the spelling, or try the artist’s name.'}
        ${wider ? '<br><button type="button" class="btn btn-sm" data-scope="all">Search all apps</button>' : ''}</li>`;
      return;
    }
    results.innerHTML = hits.map((s) => {
      const via = s.on.find(connected);
      const only = s.on.length === ALL.length ? '' : 'Only on ' + s.on.map(serviceName).join(', ');
      let where = only;
      if (via && single && via !== single) where = 'Plays from your ' + serviceName(via);
      if (!via) where = only + '. Connect it to add this song.';
      let action;
      if (inRoom(s.id)) action = `<span class="added">${ICON.check}In queue</span>`;
      else if (via) action = `<button type="button" class="btn btn-primary btn-sm" data-add="${s.id}" data-via="${via}" aria-label="Add ${esc(s.title)}">Add</button>`;
      else action = connectButton(s.on[0], 'Connect');
      return `<li class="row">${cover(s)}
        <div class="row-main"><span class="row-title">${esc(s.title)}</span><span class="row-artist">${esc(s.artist)}</span>
          ${where ? `<span class="result-where">${esc(where)}</span>` : ''}</div>
        ${action}</li>`;
    }).join('');
  }

  function openSearch() {
    state.scope = 'mine';
    input.value = '';
    renderChips();
    state.loading = false;
    renderResults();
    searchSheet.showModal();
    input.focus();
  }

  // ---------- room sheet (people + invite) and app picker ----------

  function renderPeople() {
    $('#people-body').innerHTML = `
      <section class="sheet-section" aria-labelledby="inv-h"><h3 id="inv-h">Invite</h3>
        <div class="invite"><div class="qr" id="invite-qr" role="img" aria-label="QR code to join this room"></div>
          <div><p>Room code</p><p class="invite-code">${esc(state.room.code)}</p>
            <button type="button" class="btn btn-sm" id="copy-link">${ICON.copy}Copy invite link</button></div></div>
      </section>
      <section class="sheet-section" aria-labelledby="ppl-h"><h3 id="ppl-h">${people(state.people.length)} here</h3>
        <ul>${state.people.map((p) => `<li class="person">${avatar(p.id, 'avatar-lg')}
          <div><span class="person-name">${esc(p.id === ME ? p.label + ' (you)' : p.label)}${p.host ? '<span class="tag">Host</span>' : ''}</span>
            <span class="person-app">${esc(p.id === ME ? state.me.services.map(serviceName).join(', ') : serviceName(p.service))}</span></div>
          ${p.id === ME ? '<button type="button" class="btn btn-sm" id="change-app">Change app</button>' : '<span></span>'}</li>`).join('')}</ul>
      </section>
      <div class="sheet-actions">
        <button type="button" class="btn btn-block" id="open-tv">${ICON.tv}Show on a big screen</button>
        <button type="button" class="btn btn-ghost btn-block btn-danger-text" id="leave-room">Leave room</button>
      </div>`;
    drawQR($('#invite-qr'));
  }
  function openPeople() { renderPeople(); $('#people-sheet').showModal(); }

  function openServicePicker() {
    $('#service-body').innerHTML = `<p class="setup-sub">Search uses this app first. Songs you add play from your account there.</p>
      <form id="service-form">${serviceOptions('service-pick', myService())}
      <button type="submit" class="btn btn-primary btn-block">Use this app</button></form>`;
    $('#service-sheet').showModal();
  }

  function setPrimaryService(id) {
    state.me.services = [id, ...state.me.services.filter((s) => s !== id)];
    savePrefs();
    const p = person(ME);
    if (p) p.service = id;
  }
  const savePrefs = () => prefs.write({ name: state.me.name, services: state.me.services });

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
    state.view = view;
    const hash = { room: '#room', tv: '#tv' }[view] || '';
    try { history.replaceState(null, '', hash || location.pathname + location.search); } catch (_) { /* sandboxed */ }
    render();
    window.scrollTo(0, 0);
  }

  function ensureDemoIdentity() {
    if (!state.me.name) state.me.name = 'Alex';
    if (!state.me.services.length) state.me.services = ['spotify'];
  }

  function leaveRoom() { script++; state.room = null; go('landing'); }

  // The Android app calls this for the system back button. Returns "1" when
  // the press was used here, so the app only closes from the landing page.
  window.syngBack = () => {
    const open = document.querySelector('dialog[open]');
    if (open) { open.close(); return '1'; }
    if (state.view === 'tv') { go('room'); return '1'; }
    if (state.view === 'setup') { go('landing'); return '1'; }
    if (state.view === 'room') { leaveRoom(); return '1'; }
    return '0';
  };

  // ---------- events ----------

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    const d = t.dataset;

    if (d.proto) {
      if (d.proto === 'landing') return leaveRoom();
      ensureDemoIdentity();
      if (!state.room) loadFriendsRoom();
      return go(d.proto);
    }
    if ('close' in d) return t.closest('dialog').close();
    if (t.id === 'start-room') { state.setup = { mode: 'start', code: '', busy: false }; return go('setup'); }
    if (t.id === 'setup-back') return go('landing');

    if (d.bump) return toggleBump(d.bump);
    if (d.remove) return removeSong(d.remove);
    if (t.id === 'open-search') return openSearch();
    if (t.id === 'open-people' || t.id === 'open-invite' || 'openInvite' in d) return openPeople();
    if (t.id === 'skip') return skip();
    if (t.id === 'toggle-play') { state.playing = !state.playing; return refresh(true); }

    if (d.scope) { state.scope = d.scope; renderChips(); return runSearch(); }
    if (d.add != null && d.add !== '') {
      const e = addSong(Number(d.add), ME, d.via);
      renderResults();
      const from = 'your ' + serviceName(e.service);
      return toast(state.now && state.now.key === e.key ? 'Playing now from ' + from : 'Added. Plays from ' + from + '.');
    }
    if (d.connect) {
      state.connecting = d.connect; renderResults();
      return setTimeout(() => {
        if (!connected(d.connect)) state.me.services.push(d.connect);
        state.connecting = null; savePrefs(); renderChips(); renderResults();
        toast(serviceName(d.connect) + ' connected');
      }, 700);
    }

    if (t.id === 'copy-link') {
      const link = location.href.split('#')[0] + '#join';
      const done = () => toast('Invite link copied');
      const fail = () => toast('Copy this link: ' + link);
      try { navigator.clipboard.writeText(link).then(done, fail); } catch (_) { fail(); }
      return;
    }
    if (t.id === 'change-app') return openServicePicker();
    if (t.id === 'open-tv') return go('tv');
    if (t.id === 'tv-exit') return go('room');
    if (t.id === 'leave-room') return leaveRoom();
  });

  input.addEventListener('input', runSearch);

  document.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const id = ev.target.id;

    if (id === 'join-form') {
      const field = $('#join-code'), err = $('#join-error');
      const code = field.value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(code)) {
        err.textContent = 'Room codes are 4 letters or numbers. Check the screen or the invite.';
        err.hidden = false; field.setAttribute('aria-invalid', 'true'); field.focus();
        return;
      }
      state.setup = { mode: 'join', code, busy: false };
      return go('setup');
    }

    if (id === 'setup-form') {
      if (state.setup.busy) return;
      const nameField = $('#setup-name'), nameErr = $('#setup-name-error'), svcErr = $('#setup-service-error');
      const name = nameField.value.trim();
      const picked = ev.target.querySelector('input[name="service"]:checked');
      nameErr.hidden = svcErr.hidden = true; nameField.removeAttribute('aria-invalid');
      if (!name) {
        nameErr.textContent = 'Enter a name so friends know whose pick it is.';
        nameErr.hidden = false; nameField.setAttribute('aria-invalid', 'true'); nameField.focus();
        return;
      }
      if (!picked) {
        svcErr.textContent = 'Choose the app you listen with.';
        svcErr.hidden = false; ev.target.querySelector('input[name="service"]').focus();
        return;
      }
      state.me.name = name;
      state.me.services = [picked.value];
      savePrefs();
      // Stand-in for the real sign-in hand-off to the chosen app.
      state.setup.busy = true;
      const btn = $('#setup-submit');
      btn.disabled = true; btn.classList.add('is-busy');
      btn.textContent = 'Connecting ' + serviceName(picked.value);
      const mode = state.setup.mode, code = state.setup.code;
      setTimeout(() => {
        if (state.view !== 'setup') return;
        if (mode === 'join') loadFriendsRoom(code); else loadOwnRoom();
        go('room');
        if (mode === 'start') openPeople();
        toast(serviceName(picked.value) + ' connected');
      }, 900);
      return;
    }

    if (id === 'service-form') {
      const picked = ev.target.querySelector('input:checked');
      if (picked) setPrimaryService(picked.value);
      $('#service-sheet').close();
      refresh(true);
      if (picked) toast('Now searching ' + serviceName(picked.value));
    }
  });

  // ---------- simulated playback ----------

  setInterval(() => {
    if (!state.playing || !state.now) return;
    state.now.elapsed += 1;
    if (state.now.elapsed >= state.now.song.secs) skip(); else paintProgress();
  }, 1000);

  // ---------- start ----------

  const start = location.hash.replace('#', '');
  if (start === 'room' || start === 'tv') { ensureDemoIdentity(); loadFriendsRoom(); state.view = start; }
  else if (start === 'join') { state.setup = { mode: 'join', code: 'KQ7M', busy: false }; state.view = 'setup'; }
  render();
})();
