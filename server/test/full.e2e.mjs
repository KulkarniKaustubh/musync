// Checks whole-song mode from the client's side, with a stand-in for the phone's music app.
// Start two servers first:
//   java -jar build/musync-server.jar --lan --port 8791 --sample-catalog --test-player ready
//   java -jar build/musync-server.jar --lan --port 8789 --sample-catalog --test-player no-access
//   java -jar build/musync-server.jar --lan --port 8792 --sample-catalog --test-player sign-in
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.MUSYNC_TEST_CHROMIUM || '/opt/pw-browsers/chromium' });
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; };
const shots = process.argv[2];
async function page(nativeStub) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  if (nativeStub) await p.addInitScript(() => {
    window.__calls = [];
    window.__signedIn = false;
    window.MusyncNative = { open: (u) => window.__calls.push('open ' + u), keepAwake: () => {}, mediaAccess: () => 'missing',
      requestMediaAccess: () => window.__calls.push('requestMediaAccess'), openAppSettings: () => window.__calls.push('openAppSettings'),
      openApp: (a) => window.__calls.push('openApp ' + a),
      // YouTube Music and SoundCloud play in web players built into the app; YouTube Music takes an account.
      // Spotify plays that way too, but only once signed in.
      playerKind: (a) => (a === 'ytm' || a === 'soundcloud' || a === 'spotify' ? 'web' : 'app'),
      webSignedIn: (a) => (a === 'ytm' ? (window.__signedIn ? 'in' : 'out') : a === 'spotify' ? 'out' : 'none'),
      showWebPlayer: (a) => window.__calls.push('showWebPlayer ' + a),
      // The app can show each of those services' own sites for browsing a library.
      browsable: () => '["ytm","soundcloud","spotify"]', browse: (a) => window.__calls.push('browse ' + a),
      browseResult: (t) => window.__calls.push('result ' + t) };
  });
  return p;
}
async function setup(p, name, app) {
  await p.fill('#setup-name', name); await p.click(`.option:has-text("${app}")`); await p.click('#setup-submit'); await p.waitForSelector('.room');
}
async function add(p, q, n = 1) {
  await p.click('#open-search'); await p.fill('#search-input', q); await p.waitForSelector('[data-add]');
  for (let i = 0; i < n; i++) { await p.locator('[data-add]').first().click(); await p.waitForTimeout(250); }
  await p.click('#search-sheet [data-close]');
}

// --- the phone can play whole songs, in two services ---
const host = await page(true);
await host.goto('http://localhost:8791');
await host.click('#start-room');
await setup(host, 'Kau', 'YouTube Music');
await host.click('#people-sheet [data-close]');
const link = `http://${(await (await fetch('http://localhost:8791/api/info')).json()).addresses[0]}:8791/#join=X`;
const guest = await page(false);
await guest.goto(link.replace('#join=X', ''));
await guest.fill('#join-code', (await host.locator('[data-slot="code"]').innerText()).trim());
await guest.click('#join-submit');
await guest.waitForSelector('#setup-form');
await setup(guest, 'Dev', 'SoundCloud');

check('no permission step when whole songs already work', await host.locator('#grant-access').count() === 0);
check('the host is offered sign-in for the service that takes an account', (await host.locator('[data-slot="after"] .card').innerText()).includes('Sign in to YouTube Music'));
await host.click('[data-slot="after"] [data-show-player="ytm"]');
check('Sign in opens that service’s player', (await host.evaluate(() => window.__calls)).includes('showWebPlayer ytm'));
await host.evaluate(() => { window.__signedIn = true; window.musyncRefresh(); });
check('the sign-in card goes away once signed in', await host.locator('[data-slot="after"] .card').count() === 0);

// Adding: the host chooses which service the song plays in.
await host.click('#open-search');
check('the host can choose which service plays the song', (await host.locator('#scope-chips').innerText()).replace(/\s+/g, ' ').includes('Play in YouTube Music SoundCloud'));
check('their own service is chosen to begin with', await host.locator('[data-play-in="ytm"]').getAttribute('aria-pressed') === 'true');
await host.fill('#search-input', 'th'); await host.waitForSelector('[data-add]');
await host.locator('[data-add]').first().click();
await host.waitForSelector('.progress.is-starting');
check('a song that has not started yet says so', (await host.locator('.now-pick-text').innerText()).includes('Starting in YouTube Music on this phone'));
check('the clock does not run before the song starts', (await host.locator('[data-elapsed]').innerText()).trim() === '' && await host.locator('#toggle-play').count() === 0);
await host.click('[data-play-in="soundcloud"]');
await host.locator('[data-add]').first().click(); await host.waitForTimeout(250);
await host.click('#search-sheet [data-close]');
await host.waitForFunction(() => /0:08/.test(document.querySelector('[data-total]')?.textContent || ''), null, { timeout: 5000 });
check('once it starts, the host sees where it is playing', (await host.locator('.now-pick-text').innerText()).includes('Playing in YouTube Music on this phone'));
check('a guest sees whose phone it is playing on', (await guest.locator('.now-pick-text').innerText()).includes('Playing in YouTube Music on Kau’s phone'));
check('the length comes from the player, not a 30-second clip', (await guest.locator('[data-total]').innerText()).trim() === '0:08');
check('the queued song shows the service it will play in', (await host.locator('[data-slot="queue"] .row-pick').first().innerText()).includes('SoundCloud'));
check('the preview player stays silent in whole-song mode', await host.evaluate(() => !document.querySelector('#player').getAttribute('src')));
check('guests are not offered the preview sound toggle', await guest.locator('#toggle-listen').count() === 0);
check('a guest can still open the song in their own app', (await guest.locator('#open-full').innerText()).includes('SoundCloud'));

// Moving through the song.
check('the host has a handle to move through the song, a guest does not', await host.locator('[data-scrub]').count() === 1 && await guest.locator('[data-scrub]').count() === 0);
await host.locator('[data-scrub]').evaluate((el) => {
  el.value = 5000;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await guest.waitForFunction(() => /0:0[5-7]/.test(document.querySelector('[data-elapsed]')?.textContent || ''), null, { timeout: 3000 });
check('moving through the song reaches everyone', true);
if (shots) { await host.screenshot({ path: `${shots}/full-host.png`, fullPage: true }); await guest.screenshot({ path: `${shots}/full-guest.png` }); }

const first = await host.locator('.now-title').innerText();
await host.waitForFunction((t) => document.querySelector('.now-title')?.textContent !== t, first, { timeout: 15000 });
check('when the player finishes a song, the room moves to the next one', true);
await host.waitForFunction(() => /Playing in SoundCloud/.test(document.querySelector('.now-pick-text')?.textContent || ''), null, { timeout: 5000 });
check('the next song plays in the other service', true);
await host.click('#toggle-play');
await guest.waitForFunction(() => document.querySelector('[data-slot="nowhead"]').textContent.includes('Paused'));
check('pause still works from the host', true);
await host.click('#open-people');
const svc = await host.locator('#people-body').innerText();
check('the room sheet lists what this phone plays', svc.includes('This phone plays') && svc.includes('Signed in') && svc.includes('No account needed'));
check('a service that needs an account offers sign-in there', svc.includes('Sign in to play Spotify songs here') && await host.locator('#people-body [data-show-player="spotify"]').count() === 1);
if (shots) await host.screenshot({ path: `${shots}/full-services.png` });
await host.click('#people-sheet [data-close]');

// Adding from your own library, in the app.
await host.click('#open-search');
const lib = await host.locator('#library-row').innerText();
check('the app offers the person’s own library, their service first', lib.replace(/\s+/g, ' ').includes('From your library YouTube Music'));
if (shots) await host.screenshot({ path: `${shots}/full-search.png` });
await host.click('[data-browse="soundcloud"]');
check('choosing a service opens its library', (await host.evaluate(() => window.__calls)).includes('browse soundcloud'));
await host.click('#search-sheet [data-close]');
// The app hands over a song the person tapped on the service's site.
await host.evaluate(() => window.musyncAddDirect({ app: 'soundcloud', id: '/odesza/a-moment-apart', title: 'A Moment Apart', artist: 'ODESZA' }));
await guest.waitForFunction(() => [...document.querySelectorAll('[data-slot="queue"] .row-title')].some((e) => e.textContent === 'A Moment Apart'));
check('a song tapped in the library joins the queue for everyone', true);
check('it is marked to play in the service it came from', (await guest.locator('[data-slot="queue"] .row:has-text("A Moment Apart") .row-pick').innerText()).includes('SoundCloud'));
check('the person browsing is told it was added', (await host.evaluate(() => window.__calls)).includes('result Added “A Moment Apart”'));
await host.evaluate(() => window.musyncAddDirect({ app: 'soundcloud', id: '/odesza/a-moment-apart', title: 'A Moment Apart', artist: 'ODESZA' }));
await host.waitForFunction(() => window.__calls.some((c) => c.startsWith('result That song is already')));
check('adding it twice says why not', true);
await host.evaluate(() => window.musyncAddDirect({ app: 'soundcloud', id: 'https://evil.example/x', title: 'Nope', artist: '' }));
await host.waitForFunction(() => window.__calls.some((c) => c.startsWith('result That doesn’t look like a song')));
check('something that is not a track is refused', true);
await guest.click('#open-search');
check('in a browser there is no library row', await guest.locator('#library-row').isHidden());
await guest.click('#search-sheet [data-close]');
// Someone on an Android phone who scanned the code into their browser is pointed to the app.
const actx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce',
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
const android = await actx.newPage();
await android.goto(link.replace('#join=X', '#join=' + (await host.locator('[data-slot="code"]').innerText()).trim()));
await android.waitForSelector('#setup-form');
await setup(android, 'Priya', 'Spotify');
await android.click('#open-search');
const appLink = await android.locator('#library-row a').getAttribute('href');
check('an Android browser guest gets a link that opens this room in the app',
  /^musync:\/\/join\?url=http%3A%2F%2F[\d.]+%3A8791&code=[A-Z0-9]{4}$/.test(appLink || ''), appLink);
if (shots) await android.screenshot({ path: `${shots}/full-android-browser.png` });
// An iPhone gets the same room in its browser, and can keep it on the home screen.
const ictx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
const iphone = await ictx.newPage();
await iphone.goto(link.replace('#join=X', '#join=' + (await host.locator('[data-slot="code"]').innerText()).trim()));
await iphone.waitForSelector('#setup-form');
await setup(iphone, 'Sam', 'Apple Music');
await add(iphone, 'dream', 1);
await host.waitForFunction(() => [...document.querySelectorAll('[data-slot="queue"] .row-pick')].some((e) => e.textContent.includes('Sam')));
check('an iPhone browser guest can join and add a song', true);
await iphone.click('#open-search');
check('an iPhone is not offered an Android app', await iphone.locator('#library-row').isHidden());
const man = await (await fetch('http://localhost:8791/manifest.webmanifest')).json();
const touch = await fetch('http://localhost:8791/icons/apple-touch-icon.png');
check('the room can be kept on a phone’s home screen', man.display === 'standalone' && touch.ok && touch.headers.get('content-type') === 'image/png'
  && await iphone.locator('link[rel="apple-touch-icon"]').count() === 1);

// --- the phone has not been given access yet ---
const fresh = await page(true);
await fresh.goto('http://localhost:8789');
await fresh.click('#start-room');
await setup(fresh, 'Kau', 'Tidal');
await fresh.click('#people-sheet [data-close]');
await fresh.waitForSelector('.card');
const card = await fresh.locator('.card').innerText();
check('the host is told the one step that is left', card.includes('One step before the music plays') && card.includes('Tidal'));
check('the card says what the permission is for', card.includes('notification access') && card.includes('does not read your notifications'));
await fresh.click('#grant-access');
await fresh.click('#open-app-settings');
check('the buttons open the right Android screens', JSON.stringify(await fresh.evaluate(() => window.__calls)) === JSON.stringify(['requestMediaAccess', 'openAppSettings']));
await add(fresh, 'th', 1);
check('the song waits instead of playing a preview', (await fresh.locator('.now-pick-text').innerText()).includes('Waiting for the step above'));
await fresh.waitForTimeout(2500);
check('no preview sound is loaded on the host phone', await fresh.evaluate(() => !document.querySelector('#player').getAttribute('src')));
check('the host is not sent to another app', await fresh.locator('#open-full').count() === 0);
check('the setup step sits above the song', await fresh.evaluate(() => document.querySelector('.card').getBoundingClientRect().top < document.querySelector('.now').getBoundingClientRect().top));
check('nothing to drag before the song can play', await fresh.locator('[data-scrub]').count() === 0);
if (shots) await fresh.screenshot({ path: `${shots}/full-setup.png`, fullPage: true });

// --- the host's service plays inside musync but needs signing in first ---
const sp = await page(true);
await sp.goto('http://localhost:8792');
await sp.click('#start-room');
await setup(sp, 'Kau', 'Spotify');
await sp.click('#people-sheet [data-close]');
await sp.waitForSelector('.card-step');
const signCard = await sp.locator('.card-step').innerText();
check('a host whose service needs an account is asked to sign in', signCard.includes('Sign in to Spotify to start') && !signCard.includes('notification access'));
await sp.click('.card-step [data-show-player="spotify"]');
check('the button opens that service’s sign-in', (await sp.evaluate(() => window.__calls)).includes('showWebPlayer spotify'));
await add(sp, 'th', 1);
check('the song waits until then', (await sp.locator('.now-pick-text').innerText()).includes('Waiting for the step above'));
if (shots) await sp.screenshot({ path: `${shots}/full-signin.png` });

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
