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

    // The player bar at the bottom. Its clock is read three ways, most direct first:
    // the two time labels, the progress slider, then any pair of times in the bar.
    var posEl = q('[data-testid="playback-position"]'), durEl = q('[data-testid="playback-duration"]');
    var t = seconds(posEl), d = seconds(durEl), how = 'labels';
    var slider = q('[data-testid="playback-progressbar"] input[type="range"]');
    if ((t < 0 || d <= 0) && slider && +slider.max > 0) {
      var unit = +slider.max > 20000 ? 1000 : 1; // the slider counts in milliseconds or in seconds
      t = Math.floor(+slider.value / unit); d = Math.floor(+slider.max / unit); how = 'slider';
    }
    if (t < 0 || d <= 0) {
      var bar = q('[data-testid="now-playing-bar"]') || q('footer');
      var times = [];
      if (bar) {
        var els = bar.querySelectorAll('div, span');
        for (var k = 0; k < els.length && times.length < 4; k++) {
          if (els[k].children.length === 0 && seconds(els[k]) >= 0) times.push(seconds(els[k]));
        }
      }
      if (times.length >= 2 && times[times.length - 1] > 0) { t = times[0]; d = times[times.length - 1]; how = 'bar text'; }
    }
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

    function text(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : ''; }
    function note() {
      var pp = q('[data-testid="control-button-playpause"]');
      var alert = q('[role="alert"], [aria-live="assertive"], [data-testid*="error"], [data-testid*="snackbar"], [data-encore-id="banner"]');
      var md = navigator.mediaSession && navigator.mediaSession.metadata;
      return 'play button: ' + (q('[data-testid="play-button"]') ? 'yes' : 'no')
        + ', pressed: ' + (S.tries || 0)
        + ', bar button: ' + (pp ? '“' + (pp.getAttribute('aria-label') || '?') + '”' : 'none')
        + ', clock: ' + (t >= 0 && d > 0 ? t + 's of ' + d + 's by ' + how : 'none')
        + ' (labels “' + text(posEl) + '” “' + text(durEl) + '”, slider ' + (slider ? slider.value + '/' + slider.max : 'none') + ')'
        + ', now playing: ' + (widget ? (nowId ? 'a track' : '“' + text(widget) + '”') : 'nothing')
        + ', media: ' + state + (md && md.title ? ' “' + String(md.title).slice(0, 30) + '”' : '')
        + ', width: ' + window.innerWidth
        + (alert && text(alert) ? ', message: “' + text(alert) + '”' : '')
        + ', log in shown: ' + (q('[data-testid="login-button"]') ? 'yes' : 'no');
    }

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
      note: note()
    });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
})()
