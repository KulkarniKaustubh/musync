// Runs inside a music service's own website while a person browses their
// library in the musync app. A tap on a song adds it to the room's queue
// instead of playing it; everything else on the page (opening a playlist,
// scrolling, signing in) works as usual.
//
// The app asks this script a couple of times a second for the songs tapped
// since last time. The page is given no way to call into the app.
(function () {
  try {
    var B = window.__musyncBrowse;
    if (!B) {
      B = window.__musyncBrowse = { adds: [], lastId: '', lastAt: 0, touch: null, handledAt: 0 };
      // Touch first: some players act on the finger lifting, before any click exists.
      document.addEventListener('touchstart', function (ev) {
        var t = ev.touches && ev.touches[0];
        B.touch = t ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
      }, true);
      document.addEventListener('touchend', function (ev) {
        var s = B.touch, t = ev.changedTouches && ev.changedTouches[0];
        B.touch = null;
        if (!s || !t) return;
        // A tap, not a scroll or a long press.
        if (Math.abs(t.clientX - s.x) > 10 || Math.abs(t.clientY - s.y) > 10 || Date.now() - s.at > 600) return;
        if (take(ev)) B.handledAt = Date.now();
      }, true);
      document.addEventListener('click', function (ev) {
        if (Date.now() - B.handledAt < 800) { stop(ev); return; } // the click that follows a tap already handled
        take(ev);
      }, true);
    }
    var out = B.adds;
    B.adds = [];
    return JSON.stringify({ href: location.href, adds: out });
  } catch (e) {
    return JSON.stringify({ error: String(e), adds: [] });
  }

  function stop(ev) { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); }

  function take(ev) {
    var el = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target && ev.target.parentElement;
    if (!el || !el.closest) return false;
    var found = find(el);
    if (!found || !found.song.id || !found.song.title) return false;
    stop(ev);
    var B = window.__musyncBrowse, now = Date.now();
    if (found.song.id === B.lastId && now - B.lastAt < 1500) return true; // a double tap is one song
    B.lastId = found.song.id; B.lastAt = now;
    B.adds.push(found.song);
    flash(found.row);
    return true;
  }

  // Shows which row was taken, without changing the page's layout.
  function flash(row) {
    if (!row || !row.style) return;
    var before = row.style.backgroundColor, transition = row.style.transition;
    row.style.transition = 'background-color .15s';
    row.style.backgroundColor = 'rgba(255, 210, 63, .38)';
    setTimeout(function () { row.style.backgroundColor = before; setTimeout(function () { row.style.transition = transition; }, 200); }, 450);
  }

  function text(el) { return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }

  function find(el) {
    var host = location.hostname;
    if (/(^|\.)youtube\.com$/.test(host)) return youtube(el);
    if (/(^|\.)spotify\.com$/.test(host)) return spotify(el);
    if (/(^|\.)soundcloud\.com$/.test(host)) return soundcloud(el);
    return null;
  }

  function youtube(el) {
    var row = el.closest('ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer, ytmusic-player-queue-item');
    var link = row ? row.querySelector('a[href*="watch?v="]') : el.closest('a[href*="watch?v="]');
    if (!link) return null;
    var m = /[?&]v=([A-Za-z0-9_-]{6,20})/.exec(link.getAttribute('href') || '');
    if (!m) return null;
    var title = text(row ? row.querySelector('.title') || link : link);
    var artist = '';
    if (row) {
      // "Song, The Killers, Hot Fuss, 3:42" joined by bullets in search results; just the artist in a playlist.
      var parts = text(row.querySelector('.secondary-flex-columns, .subtitle, .byline')).split(/[\u2022\u00b7]/);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (p && !/^(song|video|episode|single|ep)$/i.test(p)) { artist = p; break; }
      }
    }
    return { row: row || link, song: { app: 'ytm', id: m[1], title: title, artist: artist } };
  }

  function spotify(el) {
    var row = el.closest('[data-testid="tracklist-row"], [data-testid="track-row"]');
    var link = row ? row.querySelector('a[href*="/track/"]') : null;
    if (!link) return null;
    var m = /\/track\/([A-Za-z0-9]{22})/.exec(link.getAttribute('href') || '');
    if (!m) return null;
    var names = [], artists = row.querySelectorAll('a[href*="/artist/"]');
    for (var i = 0; i < artists.length && names.length < 3; i++) { var n = text(artists[i]); if (n && names.indexOf(n) < 0) names.push(n); }
    var img = row.querySelector('img'), art = img && /^https:\/\//.test(img.src || '') ? img.src : '';
    return { row: row, song: { app: 'spotify', id: m[1], title: text(link), artist: names.join(', '), art: art } };
  }

  function soundcloud(el) {
    var notArtist = /^(search|discover|you|charts|pages|terms-of-use|popular|tags|stations|upload|feed|stream|settings|messages|notifications|people|imprint|jobs|download|mobile|pro|creators|signin|login|logout|connect|go|premium|checkout|legal|press|community-guidelines|library)$/;
    var notTrack = /^(sets|tracks|albums|likes|reposts|followers|following|popular-tracks|comments|toptracks|spotlight)$/;
    var link = el.closest('a[href]');
    if (!link) return null;
    var m = /^(?:https?:\/\/(?:m\.|www\.)?soundcloud\.com)?\/([A-Za-z0-9_-]{1,80})\/([A-Za-z0-9_-]{1,120})\/?(?:[?#].*)?$/.exec(link.getAttribute('href') || '');
    if (!m || notArtist.test(m[1]) || notTrack.test(m[2])) return null;
    // A track cell reads title first, then the artist.
    var lines = (link.innerText || link.textContent || '').split('\n'), kept = [];
    for (var i = 0; i < lines.length && kept.length < 2; i++) { var l = lines[i].replace(/\s+/g, ' ').trim(); if (l) kept.push(l); }
    var title = kept[0] || m[2].replace(/-/g, ' ');
    return { row: link, song: { app: 'soundcloud', id: '/' + m[1] + '/' + m[2], title: title, artist: kept[1] || m[1].replace(/-/g, ' ') } };
  }
})()
