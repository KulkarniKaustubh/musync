// Asked of Spotify's web player a few times a second by the musync app.
// Answers: where the page is, which tracks it lists, and what the player bar
// says is happening. Spotify keeps its audio element out of the page, so the
// position and length are read from the player bar's own clock.
(function () {
  try {
    var S = window.__musync || (window.__musync = { last: -1, changedAt: 0, adv: false, d: 0 });
    function q(sel) { return document.querySelector(sel); }
    function seconds(el) {
      if (!el) return -1;
      var m = /^-?(\d+):(\d\d)(?::(\d\d))?$/.exec((el.textContent || '').trim());
      if (!m) return -1;
      return m[3] !== undefined ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
    }
    function trackIn(href) {
      var s = href || '';
      try { s = decodeURIComponent(s); } catch (e) { /* keep as is */ }
      var m = /track[:\/]([A-Za-z0-9]{22})/.exec(s);
      return m ? m[1] : '';
    }

    // Tracks listed on a search page, rows first, in order.
    var picks = [];
    function take(list) {
      for (var i = 0; i < list.length && picks.length < 5; i++) {
        var id = trackIn(list[i].getAttribute('href'));
        if (id && picks.indexOf(id) < 0) picks.push(id);
      }
    }
    var main = q('main') || document;
    take(main.querySelectorAll('[data-testid="tracklist-row"] a[href*="/track/"]'));
    take(main.querySelectorAll('a[href*="/track/"]'));

    // The player bar at the bottom.
    var t = seconds(q('[data-testid="playback-position"]'));
    var d = seconds(q('[data-testid="playback-duration"]'));
    var now = Date.now();
    if (t !== S.last) { if (S.last >= 0 && t >= 0) S.changedAt = now; S.last = t; }
    S.adv = now - S.changedAt < 2600; // the clock moved within the last few seconds
    if (d > 0) S.d = d * 1000;
    var state = navigator.mediaSession ? navigator.mediaSession.playbackState : 'none';
    var paused = state === 'paused' ? true : state === 'playing' ? !S.adv && now - S.changedAt > 6000 : !S.adv;

    var widget = q('[data-testid="now-playing-widget"]');
    var link = widget ? widget.querySelector('a[href*="track"]') : null;
    var nowId = link ? trackIn(link.getAttribute('href')) : '';
    // Something is playing that is not a track: an advert between songs.
    var ad = !paused && !!widget && !nowId || !!q('[data-testid="context-item-info-ad-subtitle"]');

    var path = location.pathname;
    return JSON.stringify({
      href: location.href,
      search: path.indexOf('/search') === 0,
      picks: picks,
      playing: nowId,
      has: t >= 0 && d > 0,
      t: Math.max(0, t) * 1000,
      d: Math.max(0, d) * 1000,
      paused: paused,
      ended: false,
      ad: ad,
      rows: document.querySelectorAll('[data-testid="tracklist-row"]').length,
      // Shown in the message when a song will not start, to tell what the page offered.
      note: 'play button: ' + (q('[data-testid="play-button"]') ? 'yes' : 'no')
        + ', player bar: ' + (q('[data-testid="control-button-playpause"]') ? 'yes' : 'no')
        + ', clock: ' + (t >= 0 ? t + 's of ' + d + 's' : 'none')
        + ', log in shown: ' + (q('[data-testid="login-button"]') ? 'yes' : 'no')
    });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
})()
