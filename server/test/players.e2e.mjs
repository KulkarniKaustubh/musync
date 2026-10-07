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
await b.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
