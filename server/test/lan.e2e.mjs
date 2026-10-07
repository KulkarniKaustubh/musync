// Checks the phone-hosted ("LAN") mode: what the host shows to friends, and
// joining from a second device by link and by typed code.
// Start two servers first, both in LAN mode, standing in for two phones:
//   java -jar build/musync-server.jar --lan --port 8787 --sample-catalog    (the host's phone)
//   java -jar build/musync-server.jar --lan --port 8790 --sample-catalog    (a guest's phone)
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.MUSYNC_TEST_CHROMIUM || '/opt/pw-browsers/chromium' });
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  ' + detail)); if (!ok) failed++; };
const page = async () => (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' })).newPage();
const noLocalhost = (t) => !/127\.0\.0\.1|localhost/i.test(t);
async function setup(p, name, app) {
  await p.fill('#setup-name', name); await p.click(`.option:has-text("${app}")`); await p.click('#setup-submit'); await p.waitForSelector('.room');
}

const info = await (await fetch('http://localhost:8787/api/info')).json();
check('the host finds an address other devices can use', info.addresses.length > 0 && noLocalhost(info.addresses.join(' ')), JSON.stringify(info));
const ip = info.addresses[0];

// The host's own screen runs on localhost, like the app's built-in screen does.
const host = await page();
await host.goto('http://localhost:8787');
await host.click('#start-room');
await setup(host, 'Kau', 'Spotify');
await host.waitForSelector('#people-sheet[open]');
await host.waitForTimeout(400);
const sheet = await host.locator('#people-body').innerText();
const link = (await host.locator('.invite-link').innerText()).trim();
const code = (await host.locator('#people-sheet .invite-code').innerText()).trim();
check('the invite link uses the phone’s network address', link.startsWith(`http://${ip}:8787/#join=`), link);
check('nothing in the invite mentions localhost or 127.0.0.1', noLocalhost(sheet), sheet);
check('the room code is the one derived from that address', code === info.code, code + ' vs ' + info.code);
const qrLink = await host.evaluate(() => document.querySelector('#invite-qr svg') !== null);
check('a QR code is shown', qrLink);
await host.click('#people-sheet [data-close]');

// A friend opens the link in a browser.
const friend = await page();
await friend.goto(link);
await friend.waitForSelector('#setup-form');
await setup(friend, 'Dev', 'Tidal');
check('a friend joins from the invite link', (await friend.locator('[data-slot="roomname"]').innerText()).includes('Kau'));
check('a friend’s device cannot start a room on the host’s phone', (await (await fetch(`http://${ip}:8787/api/info`)).json()).canStart === false);
await friend.click('#open-people');
check('the friend sees the same invite link', (await friend.locator('.invite-link').innerText()).trim() === link);
await friend.click('#people-sheet [data-close]');

// Another friend has the app (their own local server) and types the 4-character code.
const typed = await page();
await typed.goto('http://localhost:8790');
await typed.fill('#join-code', code);
await typed.click('#join-submit');
await typed.waitForSelector('#setup-form', { timeout: 15000 });
check('typing the code finds the host on the network', typed.url().startsWith(`http://${ip}:8787/`), typed.url());
await setup(typed, 'Priya', 'Apple Music');
await host.waitForFunction(() => document.querySelector('[data-slot="people"]').textContent.includes('3'));
check('all three are in the same room', true);
await typed.click('#open-people'); await typed.click('#leave-room');
await typed.waitForURL('http://localhost:8790/**');
check('leaving returns that phone to its own start screen', true);

// A wrong code is explained.
await typed.waitForSelector('#join-code');
await typed.fill('#join-code', 'AAAA');
await typed.click('#join-submit');
await typed.waitForSelector('#join-error:not([hidden])', { timeout: 15000 });
check('an unknown code says to check the Wi-Fi', (await typed.locator('#join-error').innerText()).includes('same network'));

// When the phone has no usable address, the host is told so and no link is shown.
const lost = await page();
await lost.route('**/api/info', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ lan: true, addresses: [], port: 8787, canStart: true, local: true, code: null }) }));
await lost.goto('http://localhost:8787');
await lost.click('#start-room');
await setup(lost, 'Kau', 'Spotify');
await lost.waitForSelector('#people-sheet[open]');
await lost.waitForTimeout(400);
const lostSheet = await lost.locator('#people-body').innerText();
check('with no address, the host is told friends can’t reach the phone', lostSheet.includes('can’t reach this phone'));
check('with no address, no link, QR or localhost is shown', noLocalhost(lostSheet) && await lost.locator('.invite-link').count() === 0 && await lost.locator('#invite-qr').count() === 0, lostSheet);
await lost.fill('#address-input', '999.1.1');
await lost.click('#address-form button[type=submit]');
check('a mistyped address is rejected', await lost.locator('#address-error:not([hidden])').count() === 1);
await lost.fill('#address-input', '192.168.1.23');
await lost.click('#address-form button[type=submit]');
await lost.waitForSelector('.invite-link');
check('a typed-in address produces a proper invite link', (await lost.locator('.invite-link').innerText()).trim().startsWith('http://192.168.1.23:8787/#join='));
if (process.argv[2]) {
  await lost.screenshot({ path: `${process.argv[2]}/invite-manual.png` });
  await host.click('#open-people'); await host.waitForTimeout(400); await host.screenshot({ path: `${process.argv[2]}/invite-lan.png` });
}

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
