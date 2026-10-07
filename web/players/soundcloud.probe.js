// Asked of the page a few times a second by the musync app. On SoundCloud's
// search page it lists the tracks found; on musync's own player page it
// reports what the SoundCloud player is doing.
(function () {
  try {
    var mp = window.__mp;
    if (mp) {
      return JSON.stringify({
        href: location.href, search: false, picks: [], playing: mp.url || '', has: !!mp.ready,
        t: mp.t || 0, d: mp.d || 0, paused: !!mp.paused, ended: !!mp.ended, ad: false, rows: 0,
        error: mp.error || undefined
      });
    }
    // A track's address is soundcloud.com/<artist>/<track>. Everything else with
    // two parts (an artist's likes, sets, and so on) is not a track.
    var notArtist = /^(search|discover|you|charts|pages|terms-of-use|popular|tags|stations|upload|feed|stream|settings|messages|notifications|people|imprint|jobs|download|mobile|pro|creators|signin|login|logout|connect|go|premium|checkout|legal|press|community-guidelines)$/;
    var notTrack = /^(sets|tracks|albums|likes|reposts|followers|following|popular-tracks|comments|toptracks|spotlight)$/;
    var picks = [];
    var links = document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length && picks.length < 5; i++) {
      var m = /^(?:https?:\/\/(?:m\.|www\.)?soundcloud\.com)?\/([^\/?#]+)\/([^\/?#]+)\/?(?:[?#].*)?$/.exec(links[i].getAttribute('href') || '');
      if (!m || notArtist.test(m[1]) || notTrack.test(m[2])) continue;
      var path = '/' + m[1] + '/' + m[2];
      if (picks.indexOf(path) < 0) picks.push(path);
    }
    return JSON.stringify({
      href: location.href, search: location.pathname.indexOf('/search') === 0, picks: picks, playing: '',
      has: false, t: 0, d: 0, paused: true, ended: false, ad: false, rows: links.length
    });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
})()
