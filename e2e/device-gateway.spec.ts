import { test, expect, type Page } from '@playwright/test';
import { openApp, seedResearchPromoSeen, seedWhatsNewSeen } from './helpers.js';
import { startDeviceGateway, type FakeGateway } from './device-gateway.js';

/**
 * The device mode's core (spec 094 P3), without its screens: the app opened
 * from a fake gateway of the research pairs by the code of its address and
 * asks the research through the sealed tunnel; the app anywhere else makes
 * no request to /device/*.
 */

type DeviceHooks = {
    deviceFetch: (path: string, init?: RequestInit) => Promise<Response>;
    connection: () => { state: string } | null;
    events: () => { event: string; data: unknown }[];
    pairing: () => Promise<{ deviceId: string; name: string; kind: string; computer: { name: string }; trees: { id: string }[] } | null>;
};

async function seeds(page: Page): Promise<void> {
    await seedResearchPromoSeen(page);
    await seedWhatsNewSeen(page);
    await page.addInitScript(() => {
        try { localStorage.setItem('strom-tour-offered', '1'); } catch { /* none */ }
    });
}

async function deviceHooksReady(page: Page): Promise<void> {
    await page.waitForFunction(() => !!(globalThis as { __stromDevice?: unknown }).__stromDevice);
}

let gw: FakeGateway;
test.beforeEach(async () => {
    gw = await startDeviceGateway();
});
test.afterEach(async () => {
    await gw.close();
});

test('the app on the web and at an address of no gateway asks nothing of /device/*', async ({ page }) => {
    const asked: string[] = [];
    page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/device')) asked.push(r.url()); });
    await openApp(page);
    // the same build at a plain address of the home network (no code, no pairing, not the gateway's port)
    await page.goto(`${gw.origin}/`);
    await expect(page.locator('.toolbar')).toBeVisible();
    await page.waitForTimeout(500);
    expect(asked).toEqual([]);
    expect(gw.requests.filter(r => r.includes('/device'))).toEqual([]);
    expect(await page.evaluate(() => 'strom-device-paired' in localStorage)).toBe(false);
});

test('pairs by the code of its address and asks the research through the tunnel', async ({ page }) => {
    await seeds(page);
    const code = gw.pairCode();
    await page.goto(code.url);
    await deviceHooksReady(page);

    // the code taken out of the address at once
    const left = new URL(page.url());
    expect(left.pathname).toBe('/');
    expect(left.hash).toBe('');
    expect(left.search).not.toContain('m=app');
    expect(gw.devices).toHaveLength(1);
    const pairing = await page.evaluate(() => (globalThis as unknown as { __stromDevice: DeviceHooks }).__stromDevice.pairing());
    expect(pairing).toMatchObject({ deviceId: gw.devices[0].id, computer: { name: 'Pracovna' }, trees: [{ id: 'pychavkovi' }] });
    expect(pairing!.name).toBe(gw.devices[0].name);
    // the secret never in a request's path nor kept readable
    expect(gw.requests.some(r => r.includes(code.secret))).toBe(false);

    const status = await page.evaluate(async () => {
        const r = await (globalThis as unknown as { __stromDevice: DeviceHooks }).__stromDevice.deviceFetch('status?lang=en');
        return { status: r.status, body: await r.json() };
    });
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ features: ['device.gateway'], device: { id: gw.devices[0].id } });
    expect(gw.tunnelled.find(r => r.p === 'status')).toMatchObject({ m: 'GET', tree: 'pychavkovi', q: { lang: 'en' } });

    // connected: the event stream open
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __stromDevice: DeviceHooks }).__stromDevice.connection()?.state)).toBe('connected');
    await expect.poll(() => gw.streams()).toBe(1);
    // the stream as the research's U9b asks it: of the tree, with the app's version, signed over both
    const q = gw.streamQueries.at(-1)!;
    expect(q.get('tree')).toBe('pychavkovi');
    expect(q.get('app')).toMatch(/^\d+\.\d+\.\d+/);
    gw.ping();
    // events in order (their order in each AAD): another device's rename and a change both come through
    gw.sendEvent({ event: 'device', data: { type: 'device', what: 'renamed', id: 'dv_another', name: 'iPad · Safari' } });
    gw.sendEvent({ event: 'change', data: { head: 'abc', what: ['person P0001: Jan Pýchavka'] } });
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __stromDevice: DeviceHooks }).__stromDevice.events().map(e => e.event))).toEqual(['device', 'change']);

    // unpaired on the computer: the device forgets its key
    gw.sendEvent({ event: 'device', data: { type: 'device', what: 'unpaired', id: gw.devices[0].id } });
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __stromDevice: DeviceHooks }).__stromDevice.connection()?.state)).toBe('unpaired');
    expect(await page.evaluate(() => (globalThis as unknown as { __stromDevice: DeviceHooks }).__stromDevice.pairing())).toBeNull();
});

test('a stored pairing comes back after a reload; the computer away is unreachable', async ({ page }) => {
    await seeds(page);
    // the computer's name is this page's own host: no other address to look for
    gw.computer = { name: '127.0.0.1', label: 'Pracovna' };
    const code = gw.pairCode();
    await page.goto(code.url);
    await deviceHooksReady(page);
    expect(gw.devices).toHaveLength(1);

    // the reload: no code any more, the pairing of this origin
    await page.reload();
    await deviceHooksReady(page);
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __stromDevice: DeviceHooks }).__stromDevice.connection()?.state)).toBe('connected');
    expect(gw.devices).toHaveLength(1);

    // the computer away: unreachable
    gw.unreachable = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { __stromDevice: DeviceHooks }).__stromDevice.connection()?.state)).toBe('unreachable');
});
