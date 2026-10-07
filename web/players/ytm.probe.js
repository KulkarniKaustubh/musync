// Asked of YouTube Music's page a few times a second by the musync app.
// Answers: where the page is, which songs it lists, and what the audio is doing.
(function () {
  try {
    var v = document.querySelector('video');
    var picks = [];
    function take(list) {
      for (var i = 0; i < list.length && picks.length < 5; i++) {
        var m = /[?&]v=([A-Za-z0-9_-]{6,})/.exec(list[i].getAttribute('href') || '');
        if (m && picks.indexOf(m[1]) < 0) picks.push(m[1]);
      }
    }
    // Song rows first, then any link to a song on the page.
    take(document.querySelectorAll('ytmusic-responsive-list-item-renderer a[href*="watch?v="]'));
    take(document.querySelectorAll('a[href*="watch?v="]'));
    var mp = document.querySelector('#movie_player');
    var d = v && isFinite(v.duration) ? v.duration : 0;
    var now = /[?&]v=([A-Za-z0-9_-]{6,})/.exec(location.href);
    return JSON.stringify({
      href: location.href,
      search: location.pathname.indexOf('/search') === 0,
      picks: picks,
      playing: now && location.pathname.indexOf('/watch') === 0 ? now[1] : '',
      has: !!v,
      t: v ? Math.round(v.currentTime * 1000) : 0,
      d: Math.round(d * 1000),
      paused: v ? v.paused : true,
      ended: v ? v.ended : false,
      ad: !!(mp && /(^|\s)ad-(showing|interrupting)/.test(mp.className)),
      rows: document.querySelectorAll('ytmusic-responsive-list-item-renderer').length
    });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
})()
