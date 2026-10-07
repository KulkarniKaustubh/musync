// Checks whole-song mode from the client's side, with a stand-in for the phone's music app.
// Start two servers first:
//   java -jar build/syng-server.jar --lan --port 8791 --sample-catalog --test-player ready
//   java -jar build/syng-server.jar --lan --port 8789 --sample-catalog --test-player no-access
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.SYNG_TEST_CHROMIUM || '/opt/pw-browsers/chromium' });
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; };
const shots = process.argv[2];
async function page(nativeStub) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  if (nativeStub) await p.addInitScript(() => {
    window.__calls = [];
    window.SyngNative = { open: (u) => window.__calls.push('open ' + u), keepAwake: () => {}, mediaAccess: () => 'missing',
      requestMediaAccess: () => window.__calls.push('requestMediaAccess'), openAppSettings: () => window.__calls.push('openAppSettings'),
      openApp: (a) => window.__calls.push('openApp ' + a) };
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

// --- the phone can play whole songs ---
const host = await page(true);
await host.goto('http://localhost:8791');
await host.click('#start-room');
await setup(host, 'Kau', 'Spotify');
await host.click('#people-sheet [data-close]');
const link = `http://${(await (await fetch('http://localhost:8791/api/info')).json()).addresses[0]}:8791/#join=X`;
const guest = await page(false);
await guest.goto(link.replace('#join=X', ''));
await guest.fill('#join-code', (await host.locator('[data-slot="code"]').innerText()).trim());
await guest.click('#join-submit');
await guest.waitForSelector('#setup-form');
await setup(guest, 'Dev', 'Tidal');

check('no setup card when whole songs already work', await host.locator('.card').count() === 0);
await add(host, 'th', 2);
await host.waitForFunction(() => /0:08/.test(document.querySelector('[data-total]')?.textContent || ''), null, { timeout: 5000 });
check('the host sees the song playing in their own app', (await host.locator('.now-pick-text').innerText()).includes('Playing in your Spotify'));
check('a guest sees whose app it is playing in', (await guest.locator('.now-pick-text').innerText()).includes('Playing in Kau’s Spotify'));
check('the length comes from the music app, not a 30-second clip', (await guest.locator('[data-total]').innerText()).trim() === '0:08');
check('the preview player stays silent in whole-song mode', await host.evaluate(() => !document.querySelector('#player').getAttribute('src')));
check('guests are not offered the preview sound toggle', await guest.locator('#toggle-listen').count() === 0);
check('a guest can still open the song in their own app', (await guest.locator('#open-full').innerText()).includes('Tidal'));
if (shots) { await host.screenshot({ path: `${shots}/full-host.png` }); await guest.screenshot({ path: `${shots}/full-guest.png` }); }
const first = await host.locator('.now-title').innerText();
await host.waitForFunction((t) => document.querySelector('.now-title')?.textContent !== t, first, { timeout: 15000 });
check('when the app finishes a song, the room moves to the next one', true);
await host.click('#toggle-play');
await guest.waitForFunction(() => document.querySelector('[data-slot="nowhead"]').textContent.includes('Paused'));
check('pause still works from the host', true);

// --- the phone has not been given access yet ---
const fresh = await page(true);
await fresh.goto('http://localhost:8789');
await fresh.click('#start-room');
await setup(fresh, 'Kau', 'YouTube Music');
await fresh.click('#people-sheet [data-close]');
await fresh.waitForSelector('.card');
const card = await fresh.locator('.card').innerText();
check('the host is offered whole songs in their chosen app', card.includes('Play whole songs in YouTube Music'));
check('the card says what the permission is for', card.includes('notification access') && card.includes('does not read your notifications'));
await fresh.click('#grant-access');
await fresh.click('#open-app-settings');
check('the buttons open the right Android screens', JSON.stringify(await fresh.evaluate(() => window.__calls)) === JSON.stringify(['requestMediaAccess', 'openAppSettings']));
await add(fresh, 'th', 1);
check('until then the room plays previews', (await fresh.locator('.now-pick-text').innerText()).includes('30-second preview'));
if (shots) await fresh.screenshot({ path: `${shots}/full-setup.png`, fullPage: true });

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
