// End-to-end check of a live room with three devices.
// Start the server first:  java -cp out app.syng.server.Main --port 8801 --web ../web --sample-catalog
// Then:  node test/rooms.e2e.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = process.env.SYNG_URL || 'http://localhost:8801';
const shots = process.argv[2];
if (shots) fs.mkdirSync(shots, { recursive: true });
const fontPath = process.env.SYNG_TEST_CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: fontPath });
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; };
const errors = [];

async function device(label, w = 390, h = 844) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(label + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(label + ': ' + m.text()); });
  return page;
}
const text = (page, sel) => page.locator(sel).first().innerText();
const titles = (page) => page.locator('[data-slot="queue"] .row-title').allInnerTexts();
async function setup(page, name, app) {
  await page.fill('#setup-name', name);
  await page.click(`.option:has-text("${app}")`);
  await page.click('#setup-submit');
  await page.waitForSelector('.room');
}
async function add(page, query, n = 1) {
  await page.click('#open-search');
  await page.fill('#search-input', query);
  await page.waitForSelector('[data-add]');
  for (let i = 0; i < n; i++) { await page.locator('[data-add]').first().click(); await page.waitForTimeout(250); }
  await page.click('#search-sheet [data-close]');
}

// 1. Host starts a room.
const host = await device('host');
await host.goto(BASE);
await host.click('#start-room');
await setup(host, 'Maya', 'Spotify');
await host.waitForSelector('#people-sheet[open]');
const code = (await text(host, '#people-sheet .invite-code')).trim();
check('host starts a room and sees an invite with a 4-character code', /^[A-Z2-9]{4}$/.test(code), code);
check('invite link points at this room', (await text(host, '.invite-link')).includes('#join=' + code));
await host.click('#people-sheet [data-close]');
check('empty room explains itself', (await text(host, '[data-slot="now"]')).includes('Nothing is playing'));

// 2. A guest joins from the invite link.
const dev = await device('dev');
await dev.goto(`${BASE}/#join=${code}`);
await dev.waitForSelector('#setup-form');
check('invite link opens the join screen for that room', (await text(dev, '.setup h1')).includes(code));
await setup(dev, 'Dev', 'YouTube Music');
check('guest sees the host’s room name', (await text(dev, '[data-slot="roomname"]')).includes('Maya'));

// 3. Another guest joins by typing the code, using a name that is already taken.
const maya2 = await device('maya2');
await maya2.goto(BASE);
await maya2.fill('#join-code', 'zz');
await maya2.click('#join-submit');
check('a short code is rejected with a reason', (await text(maya2, '#join-error')).includes('4 letters'));
await maya2.fill('#join-code', code.toLowerCase());
await maya2.click('#join-submit');
await maya2.waitForSelector('#setup-form');
await setup(maya2, 'Maya', 'Apple Music');
await host.waitForFunction(() => document.querySelector('[data-slot="people"]').textContent.includes('3'));
await host.click('#open-people');
const roster = await text(host, '#people-body');
check('host sees three people, the duplicate name numbered', roster.includes('Maya (you)') && roster.includes('Dev') && roster.includes('Maya (2)'), roster);
check('each person shows their own music app', roster.includes('YouTube Music') && roster.includes('Apple Music'));
await host.click('#people-sheet [data-close]');

// 4. Host adds songs; everyone sees them.
await add(host, "th", 3);
await dev.waitForFunction(() => document.querySelectorAll('[data-slot="queue"] .row').length === 2);
const playing = await text(dev, '.now-title');
check('first song starts playing for everyone', playing.length > 0 && (await text(maya2, '.now-title')) === playing, playing);
check('guest sees whose pick it is', (await text(dev, '.now-pick-text')).includes('Maya’s pick'));
check('host sees it as their own pick', (await text(host, '.now-pick-text')).includes('Your pick'));
check('queue matches on host and guest', JSON.stringify(await titles(host)) === JSON.stringify(await titles(dev)));

// 5. A guest adds a song and bumps it to the top.
await add(dev, 'dreams');
await host.waitForFunction(() => document.querySelectorAll('[data-slot="queue"] .row').length === 3);
check('guest’s song arrives last', (await titles(host))[2] === 'Dreams', (await titles(host)).join(' | '));
await dev.locator('[data-slot="queue"] .row:has-text("Dreams") [data-bump]').click();
await host.waitForFunction(() => document.querySelector('[data-slot="queue"] .row-title').textContent === 'Dreams');
check('a bump moves the song to the top on every device', (await titles(maya2))[0] === 'Dreams');
check('the bumper’s pill is pressed', await dev.locator('[data-slot="queue"] .row:has-text("Dreams") [data-bump]').getAttribute('aria-pressed') === 'true');

// 6. Permissions.
check('a guest cannot remove someone else’s song', await maya2.locator('[data-remove]').count() === 0);
check('a guest can remove their own song', await dev.locator('[data-slot="queue"] .row:has-text("Dreams") [data-remove]').count() === 1);
check('the host can remove any song', await host.locator('[data-remove]').count() === 3);
check('only the host sees pause', await host.locator('#toggle-play').count() === 1 && await dev.locator('#toggle-play').count() === 0);
check('a guest cannot skip someone else’s song', await dev.locator('#skip').count() === 0);
const denied = await dev.evaluate(async (c) => {
  const s = JSON.parse(localStorage.getItem('syng'));
  const r = await fetch(`/api/rooms/${c}/act`, { method: 'POST', body: JSON.stringify({ token: s.token, type: 'pause' }) });
  return r.status;
}, code);
check('the server refuses a guest’s pause even if the button is forged', denied === 409, String(denied));

// 7. Pause shows everywhere.
await host.click('#toggle-play');
await dev.waitForFunction(() => document.querySelector('[data-slot="nowhead"]').textContent.includes('Paused'));
check('pause shows on a guest', true);
await host.click('#toggle-play');
await dev.waitForFunction(() => document.querySelector('[data-slot="nowhead"]').textContent.includes('Now playing'));

// 8. Reload keeps you in the room.
await dev.reload();
await dev.waitForSelector('.room');
check('a reload returns the guest to the room without asking again', (await titles(dev))[0] === 'Dreams');

// 9. Host removes a song (with undo) and skips.
const last = (await titles(host))[2];
await host.locator('[data-slot="queue"] .row').nth(2).locator('[data-remove]').click();
await dev.waitForFunction(() => document.querySelectorAll('[data-slot="queue"] .row').length === 2);
check('remove reaches a guest', !(await titles(dev)).includes(last));
await host.click('#toast button');
await dev.waitForFunction(() => document.querySelectorAll('[data-slot="queue"] .row').length === 3);
check('undo puts the song back', (await titles(dev)).includes(last));
await host.click('#skip');
await dev.waitForFunction(() => document.querySelector('.now-title').textContent === 'Dreams');
check('skip plays the top of the queue for everyone', (await text(maya2, '.now-title')) === 'Dreams');
check('the guest who added it now sees "Your pick" and can skip it', (await text(dev, '.now-pick-text')).includes('Your pick') && await dev.locator('#skip').count() === 1);

// 10. Search states.
await maya2.click('#open-search');
check('search starts with a prompt, not an empty list', (await text(maya2, '#results')).includes('Find a song'));
await maya2.fill('#search-input', 'zzzzqq');
await maya2.waitForFunction(() => document.querySelector('#results').textContent.includes('No results'));
check('no results is explained', true);
await maya2.fill('#search-input', 'dreams');
await maya2.waitForFunction(() => document.querySelector('#results').textContent.includes('In queue'));
check('a song already in the room cannot be added twice', await maya2.locator('[data-add]').count() === 0 || !(await text(maya2, '#results')).startsWith('Add'));
if (shots) await maya2.screenshot({ path: `${shots}/search.png` });
await maya2.click('#search-sheet [data-close]');

if (shots) {
  await host.screenshot({ path: `${shots}/host.png` });
  await dev.screenshot({ path: `${shots}/guest.png` });
  await host.click('#open-people');
  await host.screenshot({ path: `${shots}/invite.png` });
  await host.click('#people-sheet [data-close]');
  const tv = await device('tv', 1920, 1080);
  await tv.goto(`${BASE}/#join=${code}`);
  await tv.waitForSelector('#setup-form');
  await setup(tv, 'Living room', 'Tidal');
  await tv.click('#open-people'); await tv.click('#open-tv');
  await tv.waitForSelector('.tv');
  await tv.waitForTimeout(400);
  await tv.screenshot({ path: `${shots}/tv.png` });
  await tv.close();
}

// 11. The room moves on by itself when a song runs out (previews are about 30 seconds).
const before = await text(host, '.now-title');
await host.waitForFunction((t) => { const el = document.querySelector('.now-title'); return el && el.textContent !== t; }, before, { timeout: 45000 });
check('the next song starts on its own when a preview ends', (await text(dev, '.now-title')) !== before);

// 12. The host leaves; the room is handed over and carries on.
await host.click('#open-people');
await host.click('#leave-room');
await host.waitForSelector('.landing');
await dev.waitForFunction(() => document.querySelector('[data-slot="roomname"]').textContent === 'Your room');
check('when the host leaves, the longest-standing guest becomes host', await dev.locator('#toggle-play').count() === 1);

// 13. Everyone leaves; the code stops working.
await dev.click('#open-people'); await dev.click('#leave-room');
await maya2.click('#open-people'); await maya2.click('#leave-room');
await maya2.waitForSelector('.landing');
check('leaving returns to the start screen', true);

check('no script errors on any device', errors.length === 0, errors.join(' || '));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
