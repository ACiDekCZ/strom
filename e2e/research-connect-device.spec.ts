import { test, expect, Page, Locator } from '@playwright/test';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    fakeBridge, fakePhone, fakeDevice, openResearch, openResearchMenu, poll, DEVICE_FEATURES,
    FakeBridge, FakeDevice, FakePhone, FakePhoneEntry,
} from './research-bridge.js';
import { overflowing } from './research-conflict.js';

/**
 * "Connect a device" (spec 094 P3) on the computer with the research: only
 * when the bridge says `device.gateway`. The menu's "Devices" with the devices
 * connected now, the code made by `POST phone/pair` with its address to copy,
 * "Open only the phone page", the list of devices (kind as a word, connected
 * now / last seen, paired on, the phone's page), renaming in place, Unpair /
 * Undo, the bridge's device event; without the gateway nothing of it. All
 * against a fake bridge; the Pýchavkovi of Mlýnky's invented devices.
 */

const DESKTOP = { width: 1440, height: 900 };
const ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true, media: null };
const NOW = new Date('2026-11-24T13:20:00Z');
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const GATEWAY = ['phone', ...DEVICE_FEATURES];
const SHOTS = path.join(os.homedir(), 'Projects/strom-dirigent/prace/1124-app-094-u10/snimky');

const IPHONE = 'dv_aaaaaaaaaaaaaaaa';
const NOTEBOOK = 'dv_bbbbbbbbbbbbbbbb';
const IPAD = 'dv_cccccccccccccccc';

function devices(list: FakeDevice[] = [
    fakeDevice(IPHONE, 'iPhone · Safari', { kind: 'phone', connected: true, lastSeenAt: at(-30_000) }),
    fakeDevice(NOTEBOOK, 'Notebook · Firefox', { kind: 'computer', lastSeenAt: at(-75 * 60_000), pairedAt: '2026-11-02T09:00:00Z' }),
], app: 'ready' | 'none' = 'ready') {
    return { app, appVersion: '3.33.0', name: 'Pracovna.local', list };
}

function pagePhone(id: string, name: string): FakePhoneEntry {
    return { id, name, pairedAt: '2026-11-02T09:00:00Z', lastSeenAt: at(-3 * 3600_000), address: 'http://192.168.1.23:47800', stale: false };
}

/** The connection on with two devices of the app and one phone's page. */
function onPhone(init: Partial<FakePhone> = {}): FakePhone {
    return fakePhone({
        state: 'on', since: at(-3600_000), qrExpiresAt: at(9 * 60_000 + 41_000),
        phones: [pagePhone('ph_page1', 'Android · Chrome')], devices: devices(), ...init,
    });
}

async function setup(page: Page, phone: FakePhone, features = GATEWAY): Promise<FakeBridge> {
    await page.clock.setFixedTime(NOW);
    const b = await fakeBridge(page, { accepts: ACCEPTS, features, phone });
    await openResearch(page);
    await poll(page);
    return b;
}

async function openDialog(page: Page, title = 'Connect a device'): Promise<Locator> {
    await openResearchMenu(page, { expandMore: true });
    await page.locator('#research-item-phone').click();
    const dialog = page.locator('#phone-modal');
    await expect(dialog.locator('h2')).toHaveText(title);
    return dialog;
}

const ask = (page: Page) => page.evaluate(() => (window.Strom.UI as any).askPhone());
const row = (dialog: Locator, name: string) => dialog.locator('.phone-row').filter({ hasText: name });

test.describe('Connect a device (094 P3)', () => {
    // Fixed clock (NOW) and a fixed zone: the times of the list read the same here and on CI.
    test.use({ viewport: DESKTOP, timezoneId: 'Europe/Prague' });

    test('without device.gateway nothing new: its other features and devices in GET phone change nothing', async ({ page }) => {
        const b = await setup(page, onPhone({ phones: [pagePhone('ph_page1', 'Android · Chrome')] }), ['phone', 'device.rename', 'device.events', 'device.phonePage']);
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-phone')).toContainText('Phone');
        await expect(page.locator('#research-item-phone .research-item-pill')).toHaveText('on · 1');
        const dialog = await openDialog(page, 'Connect phone');
        await expect(dialog.locator('#phone-list-title')).toHaveText('Paired phones · 1');
        await expect(dialog.locator('.phone-row')).toHaveCount(1);
        await expect(dialog.locator('.phone-rename-btn, .phone-list-now')).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Connect phone' }).click();
        await expect(dialog.locator('.phone-qr-img')).toBeVisible();
        await expect(dialog.locator('.phone-addr, .phone-page-only, [data-countdown-sr]')).toHaveCount(0);
        expect(b.phone!.qrAsks).toHaveLength(1);
        expect(b.phone!.deviceAsks ?? []).toEqual([]);
        // A device event of such a bridge: nothing.
        await dialog.locator('.phone-footer [data-act="close"]').click();
        await page.evaluate(id => (window.Strom.UI as any).noteDeviceEvent(id, { type: 'device', what: 'paired', id: 'dv_cccccccccccccccc', name: 'iPad · Safari' }),
            await page.evaluate(() => window.Strom.UI.activeResearchId()));
        // No "New device connected" (the toast of the opened research is today's and may still show).
        await expect(page.locator('.toast').filter({ hasText: /device/i })).toHaveCount(0);
    });

    test('off, nothing paired: the three promises, the window on the computer, then the code with its address to copy', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        const b = await setup(page, fakePhone({ devices: devices([]), qrExpiresAt: at(9 * 60_000 + 41_000) }));
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-phone')).toHaveText('Connect a device…');
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-intro li > span:not(.phone-check)')).toHaveText([
            'A phone, tablet or another computer on the same home network opens this research in the Strom app.',
            'Everything works there as here, except approvals and starting the agent – those stay on this computer.',
            'Nothing leaves the home network; the connection is encrypted and can be switched off at any time.',
        ]);
        await dialog.getByRole('button', { name: 'Turn connection on' }).click();
        await expect(dialog.locator('.phone-content')).toContainText('“Turn on the connection with devices?”');
        b.phone!.state = 'on';
        b.phone!.since = at(0);
        await ask(page);
        await expect(dialog.locator('.phone-qr-img')).toHaveAttribute('alt', 'QR code for pairing a device');
        expect(b.phone!.deviceAsks).toEqual([expect.stringMatching(/^pair \{"mode":"app","lang":"en"\}$/)]);
        expect(b.phone!.qrAsks).toEqual([]);
        const text = dialog.locator('.phone-qr-text');
        await expect(text).toContainText('Scan the QR code with the device’s camera.');
        await expect(text).toContainText('Computer: type the address into the browser.');
        await expect(dialog.locator('.phone-url--code')).toHaveText('http://192.168.1.23:47800/d#k=Q3mXv7TzPpL2aN8wRk4sYb6Hc1Jf9GdE');
        await expect(dialog.locator('[data-countdown]')).toHaveText('Code valid for 9:41 more, for one device.');
        await expect(dialog.locator('[data-countdown]')).toHaveAttribute('aria-hidden', 'true');
        await expect(dialog.locator('[data-countdown-sr]')).toHaveText('Code valid for 10 more minutes, for one device.');
        await expect(dialog.locator('[data-countdown-sr]')).toHaveAttribute('role', 'status');
        await expect(dialog.locator('.phone-foot-note')).toHaveText('Waiting for the device…');
        await dialog.getByRole('button', { name: 'Copy address' }).click();
        await expect(page.locator('.toast')).toContainText('Address copied');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://192.168.1.23:47800/d#k=Q3mXv7TzPpL2aN8wRk4sYb6Hc1Jf9GdE');
        // "Open only the phone page": the next code is the phone page's.
        await dialog.getByLabel('Open only the phone page (overview and photos)').check();
        await expect(dialog.locator('.phone-url--code')).toHaveText('http://192.168.1.23:47800/pair?m=page#7Kd2Xq9Lm4Rt');
        expect(b.phone!.deviceAsks!.at(-1)).toBe('pair {"mode":"page","lang":"en"}');
        await expect(dialog.getByLabel('Open only the phone page (overview and photos)')).toBeChecked();
        // A device pairs: named, then the list.
        b.phone!.devices!.list.push(fakeDevice(IPAD, 'iPad · Safari', { kind: 'tablet', connected: true, lastSeenAt: at(0), pairedAt: at(0) }));
        await ask(page);
        await expect(dialog.locator('.phone-paired strong')).toHaveText('Paired: iPad · Safari');
        await expect(dialog.locator('.phone-paired p')).toHaveText('The Strom app with this research opened on the device. An icon on its home screen makes opening it next time easier.');
        await expect(dialog.getByRole('button', { name: 'Connect another device' })).toBeVisible();
        await dialog.getByRole('button', { name: 'Done' }).click();
        await expect(dialog.locator('#phone-list-title')).toHaveText('Paired devices · 1');
        await expect(dialog.locator('.phone-list-now')).toHaveText('connected now 1');
    });

    test('a code while the bridge starts its server (503): asked again; 409 when it went off', async ({ page }) => {
        const b = await setup(page, onPhone({ pairStarting: 1 }));
        const dialog = await openDialog(page);
        await dialog.getByRole('button', { name: 'Connect a device' }).click();
        await expect(dialog.locator('.phone-qr-img')).toBeVisible();
        expect(b.phone!.deviceAsks!.filter(x => x.startsWith('pair '))).toHaveLength(2);
    });

    test('the list: kind as a word, connected now / last seen, paired on, the phone page; the menu counts the connected ones', async ({ page }) => {
        await setup(page, onPhone());
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-phone .research-item-pill')).toHaveText('on · 1 connected');
        await expect(page.locator('#research-menu-btn')).toHaveAttribute('aria-label', /connection with devices on/);
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-content')).toHaveAttribute('data-view', 'list');
        await expect(dialog.locator('#phone-list-title')).toHaveText('Paired devices · 3');
        await expect(dialog.locator('.phone-list-now')).toHaveText('connected now 1');
        await expect(row(dialog, 'iPhone').locator('.phone-row-sub')).toHaveText(/^connected now · phone · paired \S/);
        await expect(row(dialog, 'iPhone').locator('.phone-row-now .phone-dot.is-on')).toHaveCount(1);
        await expect(row(dialog, 'Notebook').locator('.phone-row-sub')).toHaveText(/^last seen today 0?1:05\sPM · computer · paired 11\/2$/);
        await expect(row(dialog, 'Android').locator('.phone-row-sub')).toHaveText(/^last seen today 0?11:20\sAM · phone · phone page · paired 11\/2$/);
        // The phone page's row has no pencil (the research names its devices of the app only).
        await expect(row(dialog, 'Android').locator('.phone-rename-btn')).toHaveCount(0);
        await expect(row(dialog, 'iPhone').getByRole('button', { name: 'Rename iPhone · Safari' })).toBeVisible();
        await expect(dialog.locator('.phone-keep')).toHaveText('After switching off, devices stay paired and reconnect when it is on again.');
    });

    test('rename in place: Enter saves through the bridge, Esc reverts and closes nothing else', async ({ page }) => {
        const b = await setup(page, onPhone());
        const dialog = await openDialog(page);
        await row(dialog, 'Notebook').getByRole('button', { name: 'Rename Notebook · Firefox' }).click();
        const field = dialog.getByRole('textbox', { name: 'Device name' });
        await expect(field).toBeFocused();
        await expect(field).toHaveValue('Notebook · Firefox');
        await expect(dialog.locator('#phone-rename-hint')).toHaveText('computer · Notebook · Firefox · Enter saves, Esc reverts');
        await field.fill('Kuchyň');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        await expect(field).toHaveCount(0);
        await expect(row(dialog, 'Notebook').getByRole('button', { name: 'Rename Notebook · Firefox' })).toBeFocused();
        expect(b.phone!.deviceAsks ?? []).toEqual([]);
        await page.keyboard.press('Enter');
        await field.fill('Pracovna u okna');
        await page.keyboard.press('Enter');
        await expect(row(dialog, 'Pracovna u okna')).toHaveCount(1);
        expect(b.phone!.deviceAsks).toEqual([`rename ${NOTEBOOK} {"name":"Pracovna u okna"}`]);
        await expect(row(dialog, 'Pracovna u okna').getByRole('button', { name: 'Rename Pracovna u okna' })).toBeFocused();
    });

    test('without device.rename no pencil; without device.phonePage no "Open only the phone page"', async ({ page }) => {
        await setup(page, onPhone(), ['phone', 'device.gateway']);
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-rename-btn')).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Connect a device' }).click();
        await expect(dialog.locator('.phone-qr-img')).toBeVisible();
        await expect(dialog.locator('.phone-page-only')).toHaveCount(0);
    });

    test('Unpair: at once, struck through with Undo (its token), back on Undo; a phone page as before', async ({ page }) => {
        const b = await setup(page, onPhone());
        const dialog = await openDialog(page);
        await row(dialog, 'iPhone').getByRole('button', { name: 'Unpair iPhone · Safari' }).click();
        const gone = dialog.locator('.phone-row.is-removed');
        await expect(gone).toContainText('Unpaired. The device sees nothing any more; photos and edits waiting on it stay there.');
        await expect(gone.locator('s')).toHaveText('iPhone · Safari');
        expect(b.phone!.deviceAsks).toEqual([`delete ${IPHONE}`]);
        await gone.getByRole('button', { name: 'Undo' }).click();
        await expect(row(dialog, 'iPhone').locator('.phone-row-name')).toHaveText('iPhone · Safari');
        await expect(dialog.locator('.phone-row.is-removed')).toHaveCount(0);
        expect(b.phone!.deviceAsks!.at(-1)).toBe(`restore ${IPHONE} {"undo":"undo-${IPHONE}"}`);
        await row(dialog, 'Android').getByRole('button', { name: 'Unpair Android · Chrome' }).click();
        await expect(dialog.locator('.phone-row.is-removed')).toContainText('Android · Chrome');
        expect(b.phone!.posts).toContain('remove/ph_page1');
    });

    test('no app for the devices on this computer: the code opens the phone page, said in a sentence', async ({ page }) => {
        const b = await setup(page, onPhone({ devices: devices(undefined, 'none') }));
        const dialog = await openDialog(page);
        await dialog.getByRole('button', { name: 'Connect a device' }).click();
        await expect(dialog.locator('.phone-app-none')).toHaveText('The app for the devices is not on this computer yet: the code opens the phone page (overview and photos).');
        await expect(dialog.locator('.phone-page-only')).toHaveCount(0);
        expect(b.phone!.deviceAsks).toEqual(['pair {"mode":"page","lang":"en"}']);
    });

    test('the address changed: devices with the app find it; a stale device says so in its row', async ({ page }) => {
        await setup(page, onPhone({
            addressChangedAt: at(-600_000),
            devices: devices([
                fakeDevice(IPHONE, 'iPhone · Safari', { kind: 'phone', connected: true, lastSeenAt: at(-30_000) }),
                fakeDevice(NOTEBOOK, 'Notebook · Firefox', { kind: 'computer', lastSeenAt: at(-75 * 60_000), stale: true }),
            ]),
        }));
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-bar.is-address')).toContainText('Devices with the Strom app find the computer on their own.');
        await expect(row(dialog, 'Notebook').locator('.phone-row-sub')).toHaveText(/^computer’s address changed – pair again · computer/);
    });

    test('off while devices stay paired: "Devices" with "off"; on again counts connected now', async ({ page }) => {
        const b = await setup(page, onPhone({ state: 'off' }));
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-phone')).toContainText('Devices');
        await expect(page.locator('#research-item-phone .research-item-pill')).toHaveText('off');
        await expect(page.locator('#research-item-phone .research-item-pill')).toHaveClass(/is-off/);
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-content')).toHaveAttribute('data-view', 'offList');
        await expect(dialog.locator('.phone-bar.is-off')).toContainText('Paired devices see nothing now.');
        b.phone!.state = 'on';
        await ask(page);
        await dialog.locator('.phone-footer [data-act="close"]').click();
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-phone .research-item-pill')).toHaveText('on · 1 connected');
    });

    test('the bridge\'s event of a new device: a toast with "Devices…" opening the list; connected / gone refresh the count', async ({ page }) => {
        const b = await setup(page, onPhone());
        const id = await page.evaluate(() => window.Strom.UI.activeResearchId());
        const event = (what: string, name = 'iPad · Safari') => page.evaluate(([rid, w, n]) =>
            (window.Strom.UI as any).noteDeviceEvent(rid, { type: 'device', what: w, id: 'dv_cccccccccccccccc', name: n, kind: 'tablet', at: '2026-11-24T13:20:00Z' }), [id, what, name] as const);
        b.phone!.devices!.list.push(fakeDevice(IPAD, 'iPad · Safari', { kind: 'tablet', connected: true, lastSeenAt: at(0), pairedAt: at(0) }));
        await event('paired');
        const toast = page.locator('.toast').filter({ hasText: 'New device connected: iPad · Safari' });
        await expect(toast).toBeVisible();
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-phone .research-item-pill')).toHaveText('on · 2 connected');
        await toast.getByRole('button', { name: 'Devices…' }).click();
        const dialog = page.locator('#phone-modal');
        await expect(dialog.locator('.phone-content')).toHaveAttribute('data-view', 'list');
        await expect(dialog.locator('#phone-list-title')).toHaveText('Paired devices · 4');
        await dialog.locator('.phone-footer [data-act="close"]').click();
        // Gone: the count follows (the menu's look at the bridge).
        b.phone!.devices!.list[0]!.connected = false;
        await event('gone', 'iPhone · Safari');
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-phone .research-item-pill')).toHaveText('on · 1 connected');
        await expect(page.locator('.toast').filter({ hasText: 'iPhone' })).toHaveCount(0);
    });
});

/** A device's name as long as the research keeps one (60 characters). */
const LONG = 'iPad Pro Pýchavkových z Mlýnků v obývacím pokoji u okna · Saf'.slice(0, 60);

/** Pairwise overlap of the boxes (a 0.5 px tolerance). */
async function overlapping(boxes: Locator[]): Promise<string[]> {
    const rects = await Promise.all(boxes.map(async l => (await l.count()) ? l.boundingBox() : null));
    const out: string[] = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (!a || !b) continue;
        if (a.x + a.width - 0.5 > b.x && b.x + b.width - 0.5 > a.x && a.y + a.height - 0.5 > b.y && b.y + b.height - 0.5 > a.y) out.push(`${i}×${j}`);
    }
    return out;
}

/** Nothing past the dialog's edge or cut (the screen reader's one-pixel line set aside). */
async function nothingOut(dialog: Locator): Promise<void> {
    await dialog.locator('.phone-sr').evaluateAll(els => els.forEach(el => { (el as HTMLElement).style.display = 'none'; }));
    expect(await overflowing(dialog.locator('.phone-dialog'))).toEqual([]);
    expect(await dialog.locator('.phone-dialog').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
}

test.describe('Connect a device: widths and themes', () => {
    for (const lang of ['en', 'de'] as const) {
        for (const [width, dark] of [[1440, false], [1440, true], [1024, false], [1024, true], [390, false], [390, true]] as const) {
            test(`${lang}, ${width}${dark ? ', dark' : ''}: the list with a 60-character name and the code, nothing past the edge or overlapping`, async ({ page }) => {
                await page.setViewportSize({ width, height: width < 641 ? 844 : 900 });
                if (dark) await page.emulateMedia({ colorScheme: 'dark' });
                await setup(page, onPhone({
                    devices: devices([
                        fakeDevice(IPHONE, LONG, { kind: 'tablet', connected: true, lastSeenAt: at(-30_000) }),
                        fakeDevice(NOTEBOOK, 'Notebook · Firefox', { kind: 'computer', lastSeenAt: at(-75 * 60_000) }),
                    ]),
                }));
                if (lang === 'de') await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
                await page.evaluate(() => window.Strom.UI.showPhoneDialog());
                const dialog = page.locator('#phone-modal');
                await expect(dialog.locator('h2')).toHaveText(lang === 'en' ? 'Connect a device' : 'Gerät verbinden');
                await expect(dialog.locator('.phone-content')).toHaveAttribute('data-view', 'list');
                const long = row(dialog, LONG);
                await expect(long.locator('.phone-row-name')).toHaveText(LONG);
                await nothingOut(dialog);
                for (const r of await dialog.locator('.phone-row').all()) {
                    expect(await overlapping([r.locator('.phone-row-head'), r.locator('.phone-row-sub'), r.locator('[data-act="dev-unpair"], [data-act="unpair"]')])).toEqual([]);
                }
                expect(await overlapping(await dialog.locator('.phone-footer button').all())).toEqual([]);
                const tag = `${width}-${dark ? 'dark' : 'light'}`;
                if (lang === 'de') await page.screenshot({ path: path.join(SHOTS, `d2-liste-${tag}.png`) });
                // Renaming the long one: the field and its hint inside the row.
                await long.locator('.phone-rename-btn').click();
                await expect(dialog.locator('.phone-rename')).toHaveValue(LONG);
                await nothingOut(dialog);
                expect(await overlapping([dialog.locator('.phone-row.is-renaming .phone-row-text'), dialog.locator('[data-act="dev-rename-save"]')])).toEqual([]);
                if (lang === 'de') await page.screenshot({ path: path.join(SHOTS, `d2-prejmenovat-${tag}.png`) });
                await page.keyboard.press('Escape');
                // The code: on a phone-wide window the QR above its text.
                await dialog.locator('.phone-footer [data-act="qr"]').click();
                await expect(dialog.locator('.phone-qr-img')).toBeVisible();
                await expect(dialog.locator('.phone-url--code')).toBeVisible();
                await nothingOut(dialog);
                expect(await overlapping([dialog.locator('.phone-url--code'), dialog.locator('[data-act="copy"]')])).toEqual([]);
                const [box, text] = await Promise.all([dialog.locator('.phone-qr-box').boundingBox(), dialog.locator('.phone-qr-text').boundingBox()]);
                if (width === 390) expect(box!.y + box!.height).toBeLessThanOrEqual(text!.y + 0.5);
                else expect(box!.x + box!.width).toBeLessThanOrEqual(text!.x + 0.5);
                if (lang === 'de') await page.screenshot({ path: path.join(SHOTS, `d2-qr-${tag}.png`) });
            });
        }
    }
});
