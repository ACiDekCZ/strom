import { test, expect, Page } from '@playwright/test';
import { fakeBridge, fakePhone, openResearch, openResearchMenu, poll, FakeBridge, FakePhoneEntry } from './research-bridge.js';

/**
 * "Connect phone" (spec 012): the Research menu's item and the button's dot,
 * the dialog that turns the connection on (the computer's window, or the
 * terminal), the QR code made by the research, pairing, the list with
 * "Unpair" / "Undo", the connection's problems. All against a fake bridge;
 * invented phones and addresses.
 */

const DESKTOP = { width: 1440, height: 900 };
const ACCEPTS = { sync: { auto: 'off' }, sources: true, verified: true, media: null };

function entry(id: string, name: string, extra: Partial<FakePhoneEntry> = {}): FakePhoneEntry {
    return {
        id, name, pairedAt: '2026-10-12T09:00:00Z', lastSeenAt: new Date(Date.now() - 120_000).toISOString(),
        address: 'http://192.168.1.23:47800', stale: false, ...extra,
    };
}

async function setup(page: Page, phone = fakePhone(), features = ['phone']): Promise<FakeBridge> {
    const b = await fakeBridge(page, { accepts: ACCEPTS, features, phone });
    await openResearch(page);
    await poll(page);
    return b;
}

async function openDialog(page: Page) {
    await openResearchMenu(page, { expandMore: true });
    await page.locator('#research-item-phone').click();
    const dialog = page.locator('#phone-modal');
    await expect(dialog.locator('h2')).toHaveText('Connect phone');
    return dialog;
}

/** The dialog asks the bridge again now (instead of waiting for its 2 s poll). */
const ask = (page: Page) => page.evaluate(() => (window.Strom.UI as any).askPhone());

test.describe('Connect phone', () => {
    test.use({ viewport: DESKTOP });

    test('an older research (no "phone" in its features): no item', async ({ page }) => {
        await setup(page, fakePhone(), []);
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-batch, #research-item-version, #research-item-open').first()).toBeAttached();
        await expect(page.locator('#research-item-phone')).toHaveCount(0);
    });

    test('off: the explanation, turned on in the computer\'s window, straight to the code; the item and the dot follow', { tag: '@smoke' }, async ({ page }) => {
        const b = await setup(page);
        const ph = b.phone!;
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-phone')).toHaveText('Connect phone…');
        await expect(page.locator('#research-item-phone .research-item-pill')).toHaveCount(0);
        await expect(page.locator('#research-menu-btn .research-menu-phone')).toBeHidden();
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-intro li')).toHaveCount(3);
        await expect(dialog.locator('.phone-sys')).toContainText('What appears on the computer');
        // A Mac (the research says so): its firewall sentence, no sketch of the Windows window.
        await expect(dialog.locator('.phone-sys')).toContainText('Allow incoming connections for node?');
        await expect(dialog.locator('.phone-fw')).toHaveCount(0);
        await expect(dialog.locator('.phone-foot-note')).toHaveText('The connection is off');
        // The research knows the Mac firewall is off: nothing to say about it.
        ph.firewall = { on: false, checkedAt: new Date().toISOString() };
        await ask(page);
        await expect(dialog.locator('.phone-sys')).not.toContainText('Allow incoming connections for node?');

        await dialog.getByRole('button', { name: 'Turn connection on' }).click();
        await expect(dialog.locator('.phone-state')).toContainText('Confirm in the window on the computer…');
        expect(ph.posts).toEqual(['on {"lang":"en"}']);
        await expect(dialog.getByRole('button', { name: 'Turn connection on' })).toHaveCount(0);

        ph.state = 'on';
        ph.since = new Date().toISOString();
        await ask(page);
        await expect(dialog.locator('.phone-qr-img')).toBeVisible();
        await expect(dialog.locator('.phone-bar.is-on')).toContainText('Connection on · 192.168.1.23');
        await expect(dialog.getByRole('button', { name: 'Turn connection off' })).toBeVisible();
        await expect(dialog.locator('.phone-url')).toHaveText('http://192.168.1.23:47800');
        await expect(dialog.locator('.phone-valid')).toHaveText(/^Code valid for (10:00|9:5\d) more, for one phone\.$/);
        await expect(dialog.locator('.phone-foot-note')).toHaveText('Waiting for the phone…');
        expect(ph.qrAsks[0]).toContain('lang=en');
        // The image is the research's SVG, shown from a blob.
        await expect(dialog.locator('.phone-qr-img')).toHaveAttribute('src', /^blob:/);

        await expect(page.locator('#research-menu-btn .research-menu-phone')).toBeVisible();
        await expect(page.locator('#research-menu-btn')).toHaveAttribute('aria-label', /phone connection on/);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-phone .research-item-label')).toHaveText('Phone');
        await expect(page.locator('#research-item-phone .research-item-pill')).toHaveText('on');
    });

    test('turned down in the computer\'s window: stays off, can be tried again', async ({ page }) => {
        const b = await setup(page);
        const dialog = await openDialog(page);
        await dialog.getByRole('button', { name: 'Turn connection on' }).click();
        await expect(dialog.locator('.phone-state')).toContainText('Confirm in the window');
        b.phone!.state = 'declined';
        await ask(page);
        await expect(dialog.locator('.phone-state')).toContainText('The connection stays off.');
        // The research says off again a minute later: still said as turned down.
        b.phone!.state = 'off';
        await ask(page);
        await expect(dialog.locator('.phone-state')).toContainText('The connection stays off.');
        await dialog.getByRole('button', { name: 'Turn connection on' }).click();
        await expect(dialog.locator('.phone-state')).toContainText('Confirm in the window');
        expect(b.phone!.posts.filter(p => p.startsWith('on'))).toHaveLength(2);
    });

    test('no window possible: the terminal line, then the code by itself', async ({ page }) => {
        const b = await setup(page, fakePhone({ onReply: 'no-dialog' }));
        const dialog = await openDialog(page);
        await dialog.getByRole('button', { name: 'Turn connection on' }).click();
        await expect(dialog.locator('.phone-cmd')).toHaveText('strom phone on');
        await expect(dialog).toContainText('After that the dialog switches to the QR code by itself.');
        b.phone!.state = 'on';
        await ask(page);
        await expect(dialog.locator('.phone-qr-img')).toBeVisible();
    });

    test('closing while the computer\'s window waits closes that window too', async ({ page }) => {
        const b = await setup(page);
        const dialog = await openDialog(page);
        await dialog.getByRole('button', { name: 'Turn connection on' }).click();
        await expect(dialog.locator('.phone-state')).toContainText('Confirm in the window');
        await dialog.locator('.close-btn').click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(() => b.phone!.posts).toEqual(['on {"lang":"en"}', 'off']);
        expect(b.phone!.state).toBe('off');
    });

    test('pairing from the list: the new phone named, its older entry offered for unpairing', async ({ page }) => {
        const old = entry('ph_old00001', 'Pixel 8 (Chrome)', { stale: true, address: 'http://192.168.1.40:47800', pairedAt: '2026-10-12T09:00:00Z' });
        const b = await setup(page, fakePhone({ state: 'on', since: new Date().toISOString(), phones: [old], addressChangedAt: new Date().toISOString() }));
        const ph = b.phone!;
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-list .phone-section-title')).toHaveText('Paired phones · 1');
        await dialog.locator('.phone-footer').getByRole('button', { name: 'Connect phone' }).click();
        await expect(dialog.locator('.phone-qr-img')).toBeVisible();
        await expect(dialog.locator('[data-act="back"]')).toBeVisible();
        ph.phones.push(entry('ph_new00002', 'Pixel 8 (Chrome)', { lastSeenAt: new Date().toISOString(), maybeReplaces: ['ph_old00001'] }));
        ph.lanSeenAt = new Date().toISOString();
        await ask(page);
        await expect(dialog.locator('.phone-paired')).toContainText('Paired: Pixel 8 (Chrome)');
        const replaces = dialog.locator('.phone-replaces');
        await expect(replaces.locator('.phone-replaces-row')).toHaveCount(1);
        await expect(replaces).toContainText('Older entry for the same phone: Pixel 8 (Chrome), paired 10/12');
        await expect(replaces).toContainText('No longer works since the computer’s address changed.');
        await dialog.getByRole('button', { name: 'Remove old entry' }).click();
        // The dead entry goes without Undo, and the empty box with it.
        await expect(replaces).toHaveCount(0);
        expect(ph.posts).toContain('remove/ph_old00001');
        expect(ph.posts).not.toContain('restore/ph_old00001');
        await dialog.getByRole('button', { name: 'Done' }).click();
        await expect(dialog.locator('.phone-list .phone-section-title')).toHaveText('Paired phones · 1');
        await expect(dialog.locator('.phone-row')).toHaveCount(1);
        await expect(dialog.locator('.phone-row-name')).toHaveText('Pixel 8 (Chrome)');
    });

    test('the list: an old address said; Unpair struck through with Undo; gone after a while', async ({ page }) => {
        await page.clock.install();
        const b = await setup(page, fakePhone({
            state: 'on', since: new Date().toISOString(),
            phones: [entry('ph_iphone001', 'iPhone (Safari)'), entry('ph_pixel0002', 'Pixel 8 (Chrome)', { stale: true })],
        }));
        const ph = b.phone!;
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-row')).toHaveCount(2);
        const iphone = dialog.locator('.phone-row', { hasText: 'iPhone (Safari)' });
        await expect(iphone.locator('.phone-row-sub')).toContainText('last seen 2 min ago');
        await expect(dialog.locator('.phone-row', { hasText: 'Pixel 8' }).locator('.phone-row-stale')).toHaveText('computer address changed – pair again');
        await expect(dialog.locator('.phone-keep')).toHaveText('Phones stay paired when turned off and reconnect when turned on again.');

        await iphone.getByRole('button', { name: 'Unpair iPhone (Safari)' }).click();
        const struck = dialog.locator('.phone-row.is-removed');
        await expect(struck).toContainText('Unpaired. The phone no longer sees anything.');
        await expect(dialog.locator('.phone-list .phone-section-title')).toHaveText('Paired phones · 1');
        expect(ph.posts).toEqual(['remove/ph_iphone001']);
        await struck.getByRole('button', { name: 'Undo' }).click();
        await expect(dialog.locator('.phone-row.is-removed')).toHaveCount(0);
        await expect(dialog.locator('.phone-row')).toHaveCount(2);
        expect(ph.posts).toEqual(['remove/ph_iphone001', 'restore/ph_iphone001']);

        await dialog.locator('.phone-row', { hasText: 'iPhone' }).getByRole('button', { name: 'Unpair' }).click();
        await expect(dialog.locator('.phone-row.is-removed')).toHaveCount(1);
        // Undo stays as long as the research keeps the entry (15 s).
        await page.clock.fastForward(9000);
        await expect(dialog.locator('.phone-row.is-removed')).toHaveCount(1);
        await page.clock.fastForward(7000);
        await expect(dialog.locator('.phone-row.is-removed')).toHaveCount(0);
        await expect(dialog.locator('.phone-row')).toHaveCount(1);
    });

    test('turned off in one step: phones stay listed, the off bar offers turning on again', async ({ page }) => {
        const b = await setup(page, fakePhone({ state: 'on', since: new Date().toISOString(), phones: [entry('ph_iphone001', 'iPhone (Safari)')] }));
        const dialog = await openDialog(page);
        await dialog.getByRole('button', { name: 'Turn connection off' }).click();
        await expect(dialog.locator('.phone-bar.is-off')).toContainText('Connection off');
        expect(b.phone!.posts).toEqual(['off']);
        await expect(dialog.locator('.phone-row')).toHaveCount(1);
        await dialog.getByRole('button', { name: 'What happens when turned on' }).click();
        await expect(dialog.locator('.phone-sys')).toBeVisible();
        await expect(page.locator('#research-menu-btn .research-menu-phone')).toBeHidden();
    });

    test('problems: the port taken, no local network; the item says so', async ({ page }) => {
        const b = await setup(page, fakePhone({ state: 'error', error: { code: 'port-busy', detail: 'EADDRINUSE' }, phones: [entry('ph_iphone001', 'iPhone (Safari)')] }));
        await openResearchMenu(page, { expandMore: true });
        await expect(page.locator('#research-item-phone .research-item-pill')).toHaveText('connection problem');
        await expect(page.locator('#research-menu-btn .research-menu-phone')).toBeHidden();
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-bar.is-error')).toContainText('Another program is using port 47800.');
        await expect(dialog.locator('.phone-bar.is-error')).toContainText('The connection is retried every minute.');
        await expect(dialog.locator('.phone-qr')).toHaveCount(0);
        await expect(dialog.locator('.phone-row')).toHaveCount(1);
        b.phone!.error = { code: 'no-lan', detail: '' };
        b.phone!.addresses = [];
        await ask(page);
        await expect(dialog.locator('.phone-bar.is-error')).toContainText('The computer is not on any local network right now.');
        await expect(dialog.locator('.phone-bar.is-error')).toContainText('The connection starts by itself once on Wi-Fi.');
        b.phone!.error = { code: 'bind-failed', detail: 'EACCES' };
        await ask(page);
        await expect(dialog.locator('.phone-bar.is-error')).toContainText('The connection could not be started.');
        await expect(dialog.locator('.phone-bar.is-error')).toContainText('The system did not allow a network connection to be opened. Retrying every minute.');
    });

    test('the computer\'s address changed: the yellow bar with a new code', async ({ page }) => {
        const b = await setup(page, fakePhone({
            state: 'on', since: new Date().toISOString(), addressChangedAt: new Date().toISOString(),
            phones: [entry('ph_pixel0002', 'Pixel 8 (Chrome)', { stale: true, address: 'http://192.168.1.40:47800' })],
        }));
        const dialog = await openDialog(page);
        const bar = dialog.locator('.phone-bar.is-address');
        await expect(bar).toContainText('The computer address changed to 192.168.1.23.');
        await expect(bar).toContainText('it can be reserved for this computer in the router');
        await bar.getByRole('button', { name: 'New QR' }).click();
        await expect(dialog.locator('.phone-qr-img')).toBeVisible();
        expect(b.phone!.qrAsks).toHaveLength(1);
    });

    test('two networks: the code for the other one on request', async ({ page }) => {
        const b = await setup(page, fakePhone({
            state: 'on', since: new Date().toISOString(),
            addresses: [{ url: 'http://192.168.1.23:47800', iface: 'Wi-Fi', kind: 'wifi' }, { url: 'http://10.0.0.5:47800', iface: 'Ethernet', kind: 'ethernet' }],
        }));
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-nets')).toContainText('Network: Wi-Fi 192.168.1.23');
        await dialog.getByRole('button', { name: 'Show the code for 10.0.0.5' }).click();
        await expect(dialog.locator('.phone-url')).toHaveText('http://10.0.0.5:47800');
        await expect(dialog.locator('.phone-nets')).toContainText('Network: 10.0.0.5 (cable)');
        await expect(dialog.locator('.phone-nets')).toContainText('Other network: Wi-Fi 192.168.1.23');
        expect(b.phone!.qrAsks.at(-1)).toContain(`address=${encodeURIComponent('http://10.0.0.5:47800')}`);
    });

    test('the code expires: grey, a new one only on request', async ({ page }) => {
        await page.clock.install();
        const b = await setup(page, fakePhone({ state: 'on', since: new Date().toISOString() }));
        const now = await page.evaluate(() => Date.now());
        b.phone!.qrExpiresAt = new Date(now + 30_000).toISOString();
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-valid')).toHaveText(/Code valid for 0:(30|29|28) more/);
        await page.clock.fastForward(31_000);
        await expect(dialog.locator('.phone-expired')).toContainText('The code has expired.');
        await expect(dialog.locator('.phone-qr-box')).toHaveClass(/is-expired/);
        await page.clock.fastForward(10_000);
        expect(b.phone!.qrAsks).toHaveLength(1);
        b.phone!.qrExpiresAt = new Date(now + 700_000).toISOString();
        await dialog.getByRole('button', { name: 'New code' }).click();
        await expect(dialog.locator('.phone-qr-box')).not.toHaveClass(/is-expired/);
        await expect(dialog.locator('.phone-valid')).toBeVisible();
        expect(b.phone!.qrAsks).toHaveLength(2);
    });

    test('the phone does not reach the computer: the checklist after a minute, gone once it does', async ({ page }) => {
        await page.clock.install();
        const b = await setup(page, fakePhone({ state: 'on', since: new Date().toISOString(), platform: 'win32', network: { category: 'public', checkedAt: new Date().toISOString() } }));
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-qr-img')).toBeVisible();
        await expect(dialog.locator('.phone-checklist')).toHaveCount(0);
        await page.clock.fastForward(61_000);
        const list = dialog.locator('.phone-checklist');
        await expect(list).toContainText('The phone has not reached the computer yet. Check:');
        await expect(list).toContainText('firewall window: Private networks + Allow access');
        await expect(list).toContainText('Windows network type: Private, not Public');
        // How to: the box of what appears on the computer, with the way back.
        await list.getByRole('button', { name: 'How to' }).click();
        await expect(dialog.locator('.phone-fw')).toBeVisible();
        await expect(dialog.locator('.phone-public')).toContainText('Windows marks this Wi-Fi as Public.');
        await dialog.locator('[data-act="back"]').click();
        await expect(dialog.locator('.phone-qr-img')).toBeVisible();
        // A private network: the network type is no longer worth checking.
        b.phone!.network = { category: 'private', checkedAt: new Date().toISOString() };
        await ask(page);
        await expect(list).not.toContainText('Windows network type');
        b.phone!.lanSeenAt = new Date(await page.evaluate(() => Date.now())).toISOString();
        await ask(page);
        await expect(dialog.locator('.phone-checklist')).toHaveCount(0);
    });

    test('the research stops answering: the last state greyed, said in one line', async ({ page }) => {
        const b = await setup(page, fakePhone({ state: 'on', since: new Date().toISOString(), phones: [entry('ph_iphone001', 'iPhone (Safari)')] }));
        const dialog = await openDialog(page);
        await expect(dialog.locator('.phone-row')).toHaveCount(1);
        b.down = true;
        await ask(page);
        await expect(dialog.locator('.phone-lost')).toHaveText('The research is not responding right now. The state shown is the last one known.');
        await expect(dialog.locator('.phone-row')).toHaveCount(1);
        await expect(dialog.getByRole('button', { name: 'Turn connection off' })).toBeDisabled();
        b.down = false;
        await ask(page);
        await expect(dialog.locator('.phone-lost')).toHaveCount(0);
    });
});
