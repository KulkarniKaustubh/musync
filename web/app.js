/* syng UI prototype.
   Everything here runs on mock data in memory: no backend, no real playback.
   The store at the top is the seam where a real room service plugs in later. */
(() => {
  'use strict';

  // ---------- mock data ----------

  const CATALOG = [
    ['Dancing Queen', 'ABBA', 231],
    ['Mr. Brightside', 'The Killers', 223],
    ['Hey Ya!', 'OutKast', 235],
    ['Levitating', 'Dua Lipa', 203],
    ['September', 'Earth, Wind & Fire', 215],
    ["Don't Stop Me Now", 'Queen', 209],
    ['Blinding Lights', 'The Weeknd', 200],
    ['Valerie', 'Mark Ronson and Amy Winehouse', 219],
    ['Pink + White', 'Frank Ocean', 184],
    ['Espresso', 'Sabrina Carpenter', 175],
    ['Take On Me', 'a-ha', 225],
    ['Dreams', 'Fleetwood Mac', 257],
    ['Got to Be Real', 'Cheryl Lynn', 225],
    ['Electric Feel', 'MGMT', 229],
    ['Juice', 'Lizzo', 195],
    ['I Wanna Dance with Somebody', 'Whitney Houston', 291],
    ['Redbone', 'Childish Gambino', 327],
    ['Crazy in Love', 'Beyoncé', 236],
    ['Heat Waves', 'Glass Animals', 239],
    ['Lovely Day', 'Bill Withers', 255],
    ['Rasputin', 'Boney M.', 280],
    ['Jai Ho', 'A. R. Rahman', 319],
    ['Despacito', 'Luis Fonsi', 229],
    ['Murder on the Dancefloor', 'Sophie Ellis-Bextor', 230],
  ].map(([title, artist, secs], id) => ({ id, title, artist, secs }));

  const song = (title) => CATALOG.find((s) => s.title === title);

  // ---------- store ----------

  let keySeq = 0;
  const entry = (title, by, bumps = []) => ({
    key: 'e' + (++keySeq), song: song(title), by, bumps: new Set(bumps), at: keySeq,
  });

  const state = {
    view: 'landing',
    room: 'KQ7M',
    me: 'You',
    people: { Maya: 'marigold', Dev: 'flamingo', You: 'pool', Priya: 'pistachio', Sam: 'lilac', Jo: 'tangerine' },
    now: { ...entry('September', 'Maya'), elapsed: 72 },
    playing: true,
    queue: [
      entry('Hey Ya!', 'Dev', ['Maya', 'Sam', 'Jo']),
      entry('Dreams', 'Priya', ['Dev', 'Maya']),
      entry('Levitating', 'Sam', ['Jo']),
      entry('Mr. Brightside', 'Jo', ['Dev']),
      entry('Pink + White', 'Maya'),
      entry('Rasputin', 'Dev'),
    ],
    justAdded: null,
  };

  const voiceOf = (name) => state.people[name] || 'lilac';
  const possessive = (name) => (name === state.me ? 'Your pick' : name + '’s pick');

  function sortQueue() {
    state.queue.sort((a, b) => b.bumps.size - a.bumps.size || a.at - b.at);
  }

  function addSong(id, by) {
    const s = CATALOG[id];
    const e = { key: 'e' + (++keySeq), song: s, by, bumps: new Set(), at: keySeq };
    if (!state.now) { state.now = { ...e, elapsed: 0 }; state.playing = true; }
    else { state.queue.push(e); sortQueue(); state.justAdded = e.key; }
    refresh();
    return s;
  }

  function toggleBump(key, who) {
    const e = state.queue.find((q) => q.key === key);
    if (!e) return;
    if (e.bumps.has(who)) e.bumps.delete(who); else e.bumps.add(who);
    sortQueue();
    refresh();
  }

  function removeSong(key) {
    const i = state.queue.findIndex((q) => q.key === key);
    if (i < 0) return;
    const [gone] = state.queue.splice(i, 1);
    refresh();
    toast('Removed ' + gone.song.title);
  }

  function skip() {
    const next = state.queue.shift();
    state.now = next ? { ...next, elapsed: 0 } : null;
    state.playing = !!next;
    refresh();
  }

  const isQueued = (id) =>
    (state.now && state.now.song.id === id) || state.queue.some((q) => q.song.id === id);

  // ---------- helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clock = (secs) => Math.floor(secs / 60) + ':' + String(Math.floor(secs % 60)).padStart(2, '0');
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ICON = {
    up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 8 5.5l5 5"/></svg>',
    x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    search: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="m13.5 13.5 4 4"/></svg>',
    play: '<svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M5 3.2v11.6a.8.8 0 0 0 1.2.7l9.3-5.8a.8.8 0 0 0 0-1.4L6.2 2.5A.8.8 0 0 0 5 3.2Z"/></svg>',
    pause: '<svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><rect x="3.5" y="3" width="4" height="12" rx="1"/><rect x="10.5" y="3" width="4" height="12" rx="1"/></svg>',
    skip: '<svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true"><path d="M3 3.7v10.6a.8.8 0 0 0 1.2.7l7.8-5.3a.8.8 0 0 0 0-1.4L4.2 3A.8.8 0 0 0 3 3.7Z"/><rect x="13" y="3" width="2.4" height="12" rx="1"/></svg>',
  };

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // ---------- pieces ----------

  function bandHTML(e, mode, i) {
    const n = e.bumps.size;
    const title = esc(e.song.title);
    let side = '';
    if (mode === 'guest') {
      const mine = e.bumps.has(state.me);
      side = `<button type="button" class="bump" data-bump="${e.key}" aria-pressed="${mine}"
        aria-label="${mine ? 'Remove your bump from' : 'Bump'} ${title}. ${plural(n, 'bump')} so far.">${ICON.up}<span>${n}</span></button>`;
    } else if (mode === 'host') {
      side = `<span class="band-side">${n ? `<span class="bump-count">${plural(n, 'bump')}</span>` : ''}
        <button type="button" class="remove" data-remove="${e.key}" aria-label="Remove ${title} from the queue">${ICON.x}</button></span>`;
    }
    const fresh = state.justAdded === e.key ? ' is-new' : '';
    return `<li class="band${fresh}" data-voice="${voiceOf(e.by)}" data-key="${e.key}" style="--i:${i}">
      <div><span class="band-title">${title}</span>
        <span class="band-meta"><span class="band-artist">${esc(e.song.artist)}</span><span class="band-by">${esc(possessive(e.by))}</span></span></div>
      ${side}</li>`;
  }

  function queueHTML(mode) {
    if (!state.queue.length) {
      return mode === 'host'
        ? '<div class="empty"><strong>Nothing queued after this.</strong>Scan the code to add the next song.</div>'
        : '<div class="empty"><strong>Nothing queued after this.</strong>Add the next song before the room goes quiet.</div>';
    }
    return `<ol class="stack stack-live">${state.queue.map((e, i) => bandHTML(e, mode, i)).join('')}</ol>`;
  }

  function nowHTML(mode) {
    const n = state.now;
    if (!n) {
      return mode === 'host'
        ? '<div class="empty"><strong>Nothing is playing.</strong>Scan the code and add the first song.</div>'
        : '<div class="empty"><strong>Nothing is playing.</strong>Add a song to start the room.</div>';
    }
    return `<section class="now" data-voice="${voiceOf(n.by)}" aria-label="Playing now">
      <p class="now-state" data-now-state>${state.playing ? 'Playing now' : 'Paused'}</p>
      <h1 class="now-title">${esc(n.song.title)}</h1>
      <p class="now-meta"><b>${esc(n.song.artist)}</b><span>${esc(possessive(n.by))}</span></p>
      <div class="progress">
        <div class="progress-track"><div class="progress-fill" data-fill></div></div>
        <span class="progress-time" data-time></span>
      </div>
    </section>`;
  }

  function rosterHTML() {
    return Object.keys(state.people).map((name) =>
      `<li class="chip" data-voice="${voiceOf(name)}">${esc(name)}</li>`).join('');
  }

  // ---------- views ----------

  function landingHTML() {
    const demo = [
      ['Hey Ya!', 'OutKast', 'Dev', 'flamingo'],
      ['Dreams', 'Fleetwood Mac', 'Priya', 'pistachio'],
      ['Levitating', 'Dua Lipa', 'Sam', 'lilac'],
      ['Mr. Brightside', 'The Killers', 'Jo', 'tangerine'],
      ['Pink + White', 'Frank Ocean', 'Maya', 'marigold'],
    ];
    return `<main class="landing">
      <div class="landing-copy">
        <p class="wordmark">syng</p>
        <h1>Everyone picks the music.</h1>
        <p class="landing-lede">Start a room on the screen next to the speakers. Friends scan a code and add songs from their own phones. No app to install and no account to make.</p>
        <div class="start">
          <button type="button" class="btn" data-go="host">Start a room</button>
          <small>Do this on the laptop or TV that plays the sound.</small>
        </div>
        <form class="join" id="join-form" novalidate>
          <h2>Join a room</h2>
          <div class="join-row">
            <label for="join-code">Room code
              <input class="field" id="join-code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="KQ7M">
            </label>
            <label for="join-name">Your name
              <input class="field" id="join-name" maxlength="16" autocomplete="given-name" placeholder="Shown on your songs">
            </label>
          </div>
          <p class="join-error" id="join-error" role="alert" hidden></p>
          <button type="submit" class="btn btn-outline">Join room</button>
        </form>
      </div>
      <figure class="demo">
        <ol class="stack stack-live">
          ${demo.map(([t, a, by, v], i) => `<li class="band" data-voice="${v}" style="--i:${i}">
            <div><span class="band-title">${esc(t)}</span>
            <span class="band-meta"><span class="band-artist">${esc(a)}</span><span class="band-by">${by}’s pick</span></span></div></li>`).join('')}
        </ol>
        <figcaption>A room’s queue. Each color is a different friend, so you can see whose song is next.</figcaption>
      </figure>
    </main>`;
  }

  function guestHTML() {
    return `<main class="guest">
      <header class="guest-head">
        <span class="wordmark">syng</span>
        <span class="guest-room"><span class="room-code" aria-label="Room code ${state.room}">${state.room}</span>
          <span class="chip" data-voice="${voiceOf(state.me)}">${esc(state.me)}</span></span>
      </header>
      <div data-slot="now"></div>
      <section class="block" aria-labelledby="g-next">
        <div class="section-head"><h2 id="g-next">Up next</h2><span data-slot="count"></span></div>
        <div data-slot="queue"></div>
      </section>
      <section class="roster-wrap" aria-labelledby="g-room">
        <p id="g-room">In the room. Bump a song to move it up.</p>
        <ul class="roster">${rosterHTML()}</ul>
      </section>
    </main>
    <div class="addbar"><button type="button" class="addbar-btn" id="open-sheet">${ICON.search}Add a song</button></div>`;
  }

  function hostHTML() {
    return `<main class="host">
      <div class="host-main">
        <div class="host-top"><span class="wordmark">syng</span>
          <button type="button" class="btn btn-quiet" data-go="landing">End room</button></div>
        <div class="video"><p><strong>The video plays here.</strong>This prototype has no sound. The progress bar below is simulated.</p></div>
        <div data-slot="now"></div>
        <div class="controls">
          <button type="button" class="btn" id="toggle-play"></button>
          <button type="button" class="btn btn-outline" id="skip">${ICON.skip}Skip</button>
        </div>
      </div>
      <aside class="host-side">
        <section class="joincard" aria-label="How to join">
          <div class="qr" id="qr" role="img" aria-label="QR code to join this room"></div>
          <div><h2>Scan to add songs</h2>
            <p>or enter the room code</p>
            <span class="room-code">${state.room}</span></div>
        </section>
        <section class="block" aria-labelledby="h-next">
          <div class="section-head"><h2 id="h-next">Up next</h2><span data-slot="count"></span></div>
          <div data-slot="queue"></div>
        </section>
      </aside>
    </main>`;
  }

  // ---------- rendering ----------

  const app = $('#app');

  function render() {
    const v = state.view;
    app.innerHTML = v === 'host' ? hostHTML() : v === 'guest' ? guestHTML() : landingHTML();
    document.querySelectorAll('.proto [data-go]').forEach((b) => {
      if (b.dataset.go === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (v === 'host') drawQR();
    if (v !== 'landing') scheduleFriend();
    refresh(true);
  }

  // Re-render the live regions. Bands that moved slide to their new place.
  function refresh(instant) {
    const mode = state.view;
    if (mode === 'landing') return;
    const slot = (name) => $(`[data-slot="${name}"]`, app);
    const queueSlot = slot('queue');
    const before = new Map();
    if (!instant) queueSlot.querySelectorAll('[data-key]').forEach((el) => before.set(el.dataset.key, el.getBoundingClientRect().top));

    const active = document.activeElement;
    const refocus = active && queueSlot.contains(active)
      ? (active.dataset.bump ? `[data-bump="${active.dataset.bump}"]` : null) : null;

    slot('now').innerHTML = nowHTML(mode);
    queueSlot.innerHTML = queueHTML(mode);
    slot('count').textContent = state.queue.length ? plural(state.queue.length, 'song') : '';
    paintProgress();
    paintControls();

    if (refocus) { const el = $(refocus, queueSlot); if (el) el.focus(); }
    if (!instant && !reducedMotion()) {
      queueSlot.querySelectorAll('[data-key]').forEach((el) => {
        const was = before.get(el.dataset.key);
        if (was == null) return;
        const dy = was - el.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) return;
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
          { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
      });
    }
    state.justAdded = null;
  }

  function paintProgress() {
    const n = state.now;
    if (!n) return;
    const fill = $('[data-fill]', app), time = $('[data-time]', app);
    if (!fill) return;
    fill.style.width = Math.min(100, (n.elapsed / n.song.secs) * 100) + '%';
    time.textContent = clock(n.elapsed) + ' / ' + clock(n.song.secs);
  }

  function paintControls() {
    const btn = $('#toggle-play');
    if (!btn) return;
    btn.disabled = !state.now;
    btn.innerHTML = state.playing ? ICON.pause + 'Pause' : ICON.play + 'Play';
    const skipBtn = $('#skip');
    if (skipBtn) skipBtn.disabled = !state.now;
    const label = $('[data-now-state]', app);
    if (label) label.textContent = state.playing ? 'Playing now' : 'Paused';
  }

  function drawQR() {
    const box = $('#qr');
    if (!box || typeof qrcode !== 'function') return;
    const qr = qrcode(0, 'M');
    qr.addData(location.href.split('#')[0] + '#guest');
    qr.make();
    box.innerHTML = qr.createSvgTag({ scalable: true, margin: 0 });
  }

  // ---------- add-a-song sheet ----------

  const sheet = $('#sheet');
  const input = $('#search-input');
  const results = $('#results');

  function renderResults() {
    const q = input.value.trim().toLowerCase();
    const hits = q
      ? CATALOG.filter((s) => (s.title + ' ' + s.artist).toLowerCase().includes(q))
      : CATALOG;
    if (!hits.length) {
      results.innerHTML = `<li class="results-note"><strong>Nothing matches “${esc(input.value.trim())}”.</strong>Check the spelling or search by artist instead.</li>`;
      return;
    }
    results.innerHTML = hits.map((s) => {
      const queued = isQueued(s.id);
      return `<li class="result">
        <div><span class="result-title">${esc(s.title)}</span><span class="result-artist">${esc(s.artist)}</span></div>
        <button type="button" class="btn" data-add="${s.id}" ${queued ? 'disabled' : ''}
          aria-label="${queued ? esc(s.title) + ' is already in the queue' : 'Add ' + esc(s.title)}">${queued ? 'Added' : 'Add'}</button>
      </li>`;
    }).join('');
  }

  function openSheet() {
    input.value = '';
    renderResults();
    if (typeof sheet.showModal === 'function') sheet.showModal(); else sheet.setAttribute('open', '');
    input.focus();
  }
  function closeSheet() {
    if (typeof sheet.close === 'function') sheet.close(); else sheet.removeAttribute('open');
  }

  // ---------- events ----------

  function go(view) {
    state.view = view;
    if (sheet.open) closeSheet();
    try { history.replaceState(null, '', view === 'landing' ? location.pathname + location.search : '#' + view); } catch (_) { /* sandboxed */ }
    render();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.bump) return toggleBump(t.dataset.bump, state.me);
    if (t.dataset.remove) return removeSong(t.dataset.remove);
    if (t.dataset.add != null && t.dataset.add !== '') {
      const s = addSong(Number(t.dataset.add), state.me);
      renderResults();
      toast('Added ' + s.title);
      return;
    }
    if (t.id === 'open-sheet') return openSheet();
    if (t.id === 'sheet-close') return closeSheet();
    if (t.id === 'skip') return skip();
    if (t.id === 'toggle-play') { state.playing = !state.playing; paintControls(); }
  });

  input.addEventListener('input', renderResults);
  $('#search-form').addEventListener('submit', (ev) => ev.preventDefault());
  sheet.addEventListener('click', (ev) => { if (ev.target === sheet) closeSheet(); });

  document.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'join-form') return;
    ev.preventDefault();
    const code = $('#join-code').value.trim().toUpperCase();
    const name = $('#join-name').value.trim();
    const err = $('#join-error');
    if (code.length !== 4) {
      err.textContent = 'Enter the 4-character code shown on the host screen.';
      err.hidden = false;
      $('#join-code').focus();
      return;
    }
    if (name && name !== state.me) {
      const voice = state.people[state.me];
      delete state.people[state.me];
      state.queue.forEach((q) => { if (q.by === state.me) q.by = name; });
      state.me = name;
      state.people[name] = voice;
    }
    state.room = code;
    go('guest');
  });

  // ---------- simulated playback and one scripted guest ----------

  setInterval(() => {
    if (!state.playing || !state.now) return;
    state.now.elapsed += 1;
    if (state.now.elapsed >= state.now.song.secs) skip(); else paintProgress();
  }, 1000);

  // So the queue feels live while you look at it: 14 seconds after you first
  // enter a room, one friend adds a song.
  let friendScheduled = false;
  function scheduleFriend() {
    if (friendScheduled) return;
    friendScheduled = true;
    setTimeout(() => {
      if (state.view === 'landing' || isQueued(song('Espresso').id)) return;
      addSong(song('Espresso').id, 'Priya');
      if (!sheet.open) toast('Priya added Espresso');
    }, 14000);
  }

  // ---------- start ----------

  const start = location.hash.replace('#', '');
  state.view = start === 'host' || start === 'guest' ? start : 'landing';
  render();
})();
