import { chromium } from 'playwright';
import fs from 'fs';
const dir = process.argv[2];
const ytm = fs.readFileSync(dir + '/ytm.probe.js', 'utf8'), sc = fs.readFileSync(dir + '/soundcloud.probe.js', 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage();
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; };
// Android's evaluateJavascript returns the value of the script's last expression; page.evaluate(string) does the same.
await p.route('https://music.youtube.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<ytmusic-card-shelf-renderer><a href="channel/UCx">Artist</a></ytmusic-card-shelf-renderer>
<ytmusic-responsive-list-item-renderer><a href="watch?v=abc_DEF-123&list=RD1">Song</a></ytmusic-responsive-list-item-renderer>
<ytmusic-responsive-list-item-renderer><a href="/watch?v=zzzzzzzzzzz">Other</a></ytmusic-responsive-list-item-renderer>
<div id="movie_player" class="html5-video-player"><video></video></div>` }));
await p.goto('https://music.youtube.com/search?q=x');
let r = JSON.parse(await p.evaluate(ytm));
check('YouTube Music search: lists songs in order', r.search === true && r.picks.join() === 'abc_DEF-123,zzzzzzzzzzz' && r.has && r.paused && !r.ad, JSON.stringify(r));
await p.goto('https://music.youtube.com/watch?v=abc_DEF-123');
r = JSON.parse(await p.evaluate(ytm));
check('YouTube Music song page: says which song is loaded', r.search === false && r.playing === 'abc_DEF-123', JSON.stringify(r));

await p.route('https://m.soundcloud.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<a href="/discover">Home</a><a href="/search/sounds?q=x">Tracks</a>
<a href="/the-killers">The Killers</a><a href="/the-killers/sets/hot-fuss">Hot Fuss</a><a href="/the-killers/likes">Likes</a>
<a href="/the-killers/mr-brightside">Mr. Brightside</a><a href="https://soundcloud.com/other/song-two?in=x">Two</a><a href="/pages/cookies">Cookies</a>` }));
await p.goto('https://m.soundcloud.com/search/sounds?q=x');
r = JSON.parse(await p.evaluate(sc));
check('SoundCloud search: lists tracks only, in order', r.search === true && r.picks.join() === '/the-killers/mr-brightside,/other/song-two', JSON.stringify(r));

// musync's own SoundCloud player page, with SoundCloud's script replaced by a stand-in.
await p.route('https://w.soundcloud.com/player/api.js', (r) => r.fulfill({ contentType: 'application/javascript', body: `
  window.SC = { Widget: function (frame) { var h = {}; window.__w = { h: h, calls: [] };
    return { bind: function (e, f) { h[e] = f; }, play: function () { window.__w.calls.push('play'); }, pause: function () { window.__w.calls.push('pause'); },
      seekTo: function (ms) { window.__w.calls.push('seek ' + ms); }, getDuration: function (cb) { cb(200000); } }; } };
  window.SC.Widget.Events = { READY: 'ready', PLAY: 'play', PAUSE: 'pause', FINISH: 'finish', PLAY_PROGRESS: 'progress', SEEK: 'seek', ERROR: 'error' };` }));
await p.route('https://w.soundcloud.com/player/?**', (r) => r.fulfill({ contentType: 'text/html', body: 'widget' }));
await p.goto(process.argv[3] + 'players/soundcloud.html?track=' + encodeURIComponent('/the-killers/mr-brightside'));
r = JSON.parse(await p.evaluate(sc));
check('player page: waits for the SoundCloud player', r.has === false && r.playing === '/the-killers/mr-brightside' && !r.error, JSON.stringify(r));
check('player page: asks for the right track', (await p.locator('#widget').getAttribute('src')).includes(encodeURIComponent('https://soundcloud.com/the-killers/mr-brightside')));
await p.evaluate(() => { const h = window.__w.h; h.ready(); h.play(); h.progress({ currentPosition: 4321.4 }); });
r = JSON.parse(await p.evaluate(sc));
check('player page: reports position and length while playing', r.has && !r.paused && r.t === 4321 && r.d === 200000, JSON.stringify(r));
await p.evaluate(`if(window.__mp_cmd)window.__mp_cmd('seek',60000);`);
await p.evaluate(`if(window.__mp_cmd)window.__mp_cmd('pause',0);`);
check('player page: seek and pause reach the SoundCloud player', (await p.evaluate(() => window.__w.calls.join())) === 'play,seek 60000,pause', await p.evaluate(() => window.__w.calls.join()));
await p.evaluate(() => window.__w.h.finish());
r = JSON.parse(await p.evaluate(sc));
check('player page: reports the end of the track', r.ended === true);
await p.goto(process.argv[3] + 'players/soundcloud.html?track=not-a-track');
await p.waitForTimeout(100);
r = JSON.parse(await p.evaluate(sc));
await p.goto(process.argv[3] + 'players/soundcloud.html?track=' + encodeURIComponent('/other/song-two'));
r = JSON.parse(await p.evaluate(sc));
check('player page: a new song replaces the old one', r.playing === '/other/song-two' && r.t === 0 && !r.ended, JSON.stringify(r));
await p.goto(process.argv[3] + 'players/soundcloud.html?track=not-a-track');
r = JSON.parse(await p.evaluate(sc));
check('player page: refuses anything that is not a track address', !!r.error, JSON.stringify(r));

// Spotify's web player, as a stand-in page with the same markers the real one uses.
const spotify = fs.readFileSync(dir + '/spotify.probe.js', 'utf8');
await p.route('https://open.spotify.com/**', (r) => r.fulfill({ contentType: 'text/html', body: `<main>
<a href="/artist/0C0XlULifJtAgn6ZNCW2eu">The Killers</a>
<div data-testid="tracklist-row"><a href="/track/003vvx7Niy0yvhvHt4a68B">Mr. Brightside</a><a href="/artist/x">The Killers</a></div>
<div data-testid="tracklist-row"><a href="/track/7oK9VyNzrYvRFo7nQEYkWN">Mr. Brightside (live)</a></div>
<div data-testid="action-bar-row"><button data-testid="play-button" onclick="window.__c.push('song')">Play</button></div></main>
<footer><div data-testid="now-playing-widget"><a href="/album/4OHNH3sDzIxnmUADXzv2kT?highlight=spotify%3Atrack%3A003vvx7Niy0yvhvHt4a68B">Mr. Brightside</a></div>
<button data-testid="control-button-playpause" onclick="window.__c.push('toggle')">Play</button>
<span data-testid="playback-position">0:00</span>
<div data-testid="playback-progressbar"><input type="range" min="0" max="222075" value="0" oninput="window.__c.push('slide ' + this.value)"></div>
<span data-testid="playback-duration">3:42</span></footer><script>window.__c = [];</script>` }));
await p.goto('https://open.spotify.com/search/mr%20brightside%20the%20killers/tracks');
r = JSON.parse(await p.evaluate(spotify));
check('Spotify search: lists tracks in order', r.search && r.picks.join() === '003vvx7Niy0yvhvHt4a68B,7oK9VyNzrYvRFo7nQEYkWN' && r.rows === 2, JSON.stringify(r));
check('Spotify: reads the player bar, and a still clock means paused', r.has && r.paused && r.t === 0 && r.d === 222000 && r.playing === '003vvx7Niy0yvhvHt4a68B' && !r.ad, JSON.stringify(r));
if (process.argv[4]) {
  const cmds = Object.fromEntries(fs.readFileSync(process.argv[4], 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const run = (code) => p.evaluate('(function(){try{' + code + '}catch(e){window.__c.push("error " + e)}})()');
  await run(cmds.start);
  check('Spotify: nothing is pressed on a search page', (await p.evaluate(() => window.__c.join())) === '');
  await p.goto('https://open.spotify.com/track/003vvx7Niy0yvhvHt4a68B');
  await p.evaluate(spotify);
  await run(cmds.start); await run(cmds.start);
  check('Spotify: the song page’s play button is pressed once', (await p.evaluate(() => window.__c.join())) === 'song', await p.evaluate(() => window.__c.join()));
  await run(cmds.pause);
  check('Spotify: pause does nothing while nothing is playing', (await p.evaluate(() => window.__c.join())) === 'song');
  // The clock starts moving: the song is playing.
  await p.evaluate(() => { document.querySelector('[data-testid="playback-position"]').textContent = '0:01'; });
  r = JSON.parse(await p.evaluate(spotify));
  check('Spotify: a moving clock means playing', r.paused === false && r.t === 1000, JSON.stringify(r));
  await run(cmds.play);
  check('Spotify: play does nothing while it is playing', (await p.evaluate(() => window.__c.join())) === 'song');
  await run(cmds.pause);
  check('Spotify: pause presses the play/pause button', (await p.evaluate(() => window.__c.join())) === 'song,toggle');
  await run(cmds.seek);
  check('Spotify: moving through the song sets the slider', /^song,toggle,slide 900\d\d$/.test(await p.evaluate(() => window.__c.join())), await p.evaluate(() => window.__c.join()));
  await p.evaluate(() => { document.querySelector('[data-testid="now-playing-widget"]').innerHTML = '<span>Advertisement</span>';
    document.querySelector('[data-testid="playback-position"]').textContent = '0:02'; });
  r = JSON.parse(await p.evaluate(spotify));
  check('Spotify: an advert is told apart from a song', r.ad === true, JSON.stringify(r));
}

// Browsing a library: a tap on a song is taken for the queue; everything else on the page still works.
const browse = fs.readFileSync(dir + '/browse.js', 'utf8');
const picks = async () => JSON.parse(await p.evaluate(browse)).adds;
await p.unroute('https://music.youtube.com/**');
await p.route('https://music.youtube.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<script>window.__nav = []; window.__played = 0;</script>
<ytmusic-two-row-item-renderer><a id="pl" href="playlist?list=PL123" onclick="window.__nav.push('playlist'); return false;">Road trip</a></ytmusic-two-row-item-renderer>
<ytmusic-responsive-list-item-renderer onclick="window.__played++"><div class="title"><a href="watch?v=abc_DEF-123&list=PL123">Mr. Brightside</a></div>
<div class="secondary-flex-columns"><span>Song</span> • <a href="channel/UC1">The Killers</a> • <a href="browse/x">Hot Fuss</a> • 3:42</div><button id="menu">⋮</button></ytmusic-responsive-list-item-renderer>` }));
await p.goto('https://music.youtube.com/library/playlists');
await picks();
await p.click('#pl');
check('browsing YouTube Music: opening a playlist still works', (await p.evaluate(() => window.__nav.join())) === 'playlist' && (await picks()).length === 0);
await p.click('ytmusic-responsive-list-item-renderer .title a');
let got = await picks();
check('browsing YouTube Music: a tapped song is taken with its id, title and artist',
  got.length === 1 && got[0].app === 'ytm' && got[0].id === 'abc_DEF-123' && got[0].title === 'Mr. Brightside' && got[0].artist === 'The Killers', JSON.stringify(got));
check('browsing YouTube Music: the tap does not play the song or leave the page', (await p.evaluate(() => window.__played)) === 0 && p.url().endsWith('/library/playlists'));
await p.click('#menu'); await p.click('#menu');
check('browsing: tapping the same song twice quickly adds it once', (await picks()).length === 0);

await p.goto('https://open.spotify.com/collection/tracks');
await picks();
await p.click('[data-testid="tracklist-row"] >> nth=1');
got = await picks();
check('browsing Spotify: a tapped row is taken', got.length === 1 && got[0].app === 'spotify' && got[0].id === '7oK9VyNzrYvRFo7nQEYkWN' && got[0].title === 'Mr. Brightside (live)', JSON.stringify(got));
await p.goto('https://m.soundcloud.com/you/library');
await picks();
await p.evaluate(() => document.addEventListener('click', (e) => e.preventDefault())); // keep the stand-in page in place
await p.click('a[href="/the-killers/mr-brightside"]');
got = await picks();
check('browsing SoundCloud: a tapped track is taken', got.length === 1 && got[0].id === '/the-killers/mr-brightside' && got[0].title === 'Mr. Brightside', JSON.stringify(got));
await p.click('a[href="/the-killers"]');
check('browsing SoundCloud: an artist link is left alone', (await picks()).length === 0);

await b.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
