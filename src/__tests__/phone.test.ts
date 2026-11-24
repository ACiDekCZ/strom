/**
 * "Connect phone" (spec 012): what the bridge says about the phone connection,
 * read without trusting it, and the dialog's pure choices. Invented phones and
 * addresses only.
 */

import { describe, it, expect } from 'vitest';
import {
    sanitizePhoneSummary, sanitizePhoneState, phoneView, newlyPaired, lanSeenSince, phoneSilent, PHONE_SILENT_MS,
    pairCountdown, seenAgo, phoneDate, phoneAddressChanged, phoneIp, phonePort, phonePlatform,
    PhoneState, PhoneViewContext, deviceGatewayCaps, sanitizePhoneDevices, sanitizeDeviceEvent, deviceKindOf,
    phonePairedCount, pairMinutesLeft,
} from '../phone.js';

const NO_CTX: PhoneViewContext = { enabling: false, noDialog: false, refused: false, wantQr: false, paired: false };

function state(extra: Partial<PhoneState> = {}): PhoneState {
    return {
        state: 'off', since: '', addresses: [], addressChangedAt: '', lanSeenAt: '', pair: null, phones: [],
        error: null, platform: null, network: null, firewall: null, devices: null, ...extra,
    };
}

const phone = (id: string, extra = {}) => ({
    id, name: 'Pixel 8 (Chrome)', pairedAt: '2026-10-12T09:00:00Z', lastSeenAt: '2026-10-19T08:00:00Z',
    address: 'http://192.168.1.23:47800', stale: false, maybeReplaces: [], ...extra,
});

describe('status.phone', () => {
    it('on / error kept, anything else (confirm, declined, unknown, missing) reads as off', () => {
        expect(sanitizePhoneSummary({ state: 'on', phones: 2 })).toEqual({ state: 'on', phones: 2 });
        expect(sanitizePhoneSummary({ state: 'error', phones: 0 })).toEqual({ state: 'error', phones: 0 });
        expect(sanitizePhoneSummary({ state: 'confirm', phones: 1 })).toEqual({ state: 'off', phones: 1 });
        expect(sanitizePhoneSummary({ state: 'declined' })).toEqual({ state: 'off', phones: 0 });
        expect(sanitizePhoneSummary(undefined)).toEqual({ state: 'off', phones: 0 });
        expect(sanitizePhoneSummary('on')).toEqual({ state: 'off', phones: 0 });
    });

    it('the count is a whole, bounded, non-negative number', () => {
        expect(sanitizePhoneSummary({ state: 'on', phones: 2.7 }).phones).toBe(2);
        expect(sanitizePhoneSummary({ state: 'on', phones: -3 }).phones).toBe(0);
        expect(sanitizePhoneSummary({ state: 'on', phones: 1e9 }).phones).toBe(999);
        expect(sanitizePhoneSummary({ state: 'on', phones: Infinity }).phones).toBe(0);
        expect(sanitizePhoneSummary({ state: 'on', phones: '3' }).phones).toBe(0);
    });
});

describe('GET phone', () => {
    it('a full answer is kept, the system names translated', () => {
        const s = sanitizePhoneState({
            state: 'on', since: '2026-10-19T08:00:00Z',
            addresses: [{ url: 'http://192.168.1.23:47800/', iface: 'Wi-Fi', kind: 'wifi' }],
            addressChangedAt: '2026-10-19T07:00:00Z', lanSeenAt: '2026-10-19T08:01:00Z',
            pair: { expiresAt: '2026-10-19T08:10:00Z' },
            phones: [phone('ph_a1')],
            error: null, platform: 'win32', network: { category: 'public', checkedAt: 'x' }, firewall: { on: true },
        })!;
        expect(s.state).toBe('on');
        expect(s.addresses).toEqual([{ url: 'http://192.168.1.23:47800', iface: 'Wi-Fi', kind: 'wifi' }]);
        expect(s.pair).toEqual({ expiresAt: '2026-10-19T08:10:00Z' });
        expect(s.phones).toEqual([phone('ph_a1')]);
        expect(s.platform).toBe('win');
        expect(s.network).toEqual({ category: 'public' });
        expect(s.firewall).toEqual({ on: true });
        expect(s.error).toBeNull();
        expect(sanitizePhoneState({ platform: 'darwin' })!.platform).toBe('mac');
        expect(sanitizePhoneState({ platform: 'linux' })!.platform).toBe('linux');
        expect(sanitizePhoneState({ platform: 'aix' })!.platform).toBeNull();
    });

    it('not an object: null; missing parts tolerated', () => {
        expect(sanitizePhoneState(null)).toBeNull();
        expect(sanitizePhoneState([])).toBeNull();
        expect(sanitizePhoneState('on')).toBeNull();
        expect(sanitizePhoneState({})).toEqual(state());
        expect(sanitizePhoneState({ state: 'dancing' })!.state).toBe('off');
    });

    it('addresses: only http on a host; https, paths, scripts dropped; kind unknown is null', () => {
        const s = sanitizePhoneState({
            addresses: [
                { url: 'https://192.168.1.23:47800', kind: 'wifi' },
                { url: 'http://192.168.1.23:47800/admin', kind: 'wifi' },
                { url: 'javascript:alert(1)', kind: 'wifi' },
                { url: 'http://10.0.0.5:47800', iface: 'eth0', kind: 'usb' },
                'http://10.0.0.6:47800',
            ],
        })!;
        expect(s.addresses).toEqual([{ url: 'http://10.0.0.5:47800', iface: 'eth0', kind: null }]);
    });

    it('phones: bad ids and duplicates dropped, a bad address emptied, maybeReplaces filtered', () => {
        const s = sanitizePhoneState({
            phones: [
                phone('ph_a1', { maybeReplaces: ['ph_old', 'ph_a1', '../x', 7], address: 'file:///etc', stale: 'yes' }),
                phone('ph_a1'),
                phone('bad id'),
                phone('<script>'),
                { name: 'no id' },
            ],
        })!;
        expect(s.phones).toHaveLength(1);
        expect(s.phones[0].maybeReplaces).toEqual(['ph_old']);
        expect(s.phones[0].address).toBe('');
        expect(s.phones[0].stale).toBe(false);
    });

    it('control characters in a name become spaces; times that are not times are empty', () => {
        const s = sanitizePhoneState({ phones: [phone('ph_a1', { name: 'Pixel\u0000\n8', lastSeenAt: 'yesterday' })] })!;
        expect(s.phones[0].name).toBe('Pixel  8');
        expect(s.phones[0].lastSeenAt).toBe('');
    });

    it('error: a known code kept; an error state without one reads as bind-failed; outside error a stray code too', () => {
        expect(sanitizePhoneState({ state: 'error', error: { code: 'port-busy', detail: 'EADDRINUSE' } })!.error)
            .toEqual({ code: 'port-busy', detail: 'EADDRINUSE' });
        expect(sanitizePhoneState({ state: 'error' })!.error).toEqual({ code: 'bind-failed', detail: '' });
        expect(sanitizePhoneState({ state: 'error', error: { code: 'weird' } })!.error).toEqual({ code: 'bind-failed', detail: '' });
        expect(sanitizePhoneState({ state: 'off', error: { code: 'no-lan' } })!.error).toEqual({ code: 'no-lan', detail: '' });
        expect(sanitizePhoneState({ state: 'off' })!.error).toBeNull();
    });
});

describe('which body the dialog shows', () => {
    it('by the state at opening (DEV §4)', () => {
        expect(phoneView(state(), NO_CTX)).toBe('intro');
        expect(phoneView(state({ phones: [phone('a')] }), NO_CTX)).toBe('offList');
        expect(phoneView(state({ state: 'confirm' }), NO_CTX)).toBe('wait');
        expect(phoneView(state({ state: 'declined' }), NO_CTX)).toBe('refused');
        expect(phoneView(state({ state: 'error' }), NO_CTX)).toBe('error');
        expect(phoneView(state({ state: 'on' }), NO_CTX)).toBe('qr');
        expect(phoneView(state({ state: 'on', phones: [phone('a')] }), NO_CTX)).toBe('list');
    });

    it('by what was done in the dialog', () => {
        expect(phoneView(state({ state: 'on', phones: [phone('a')] }), { ...NO_CTX, wantQr: true })).toBe('qr');
        expect(phoneView(state({ state: 'on', phones: [phone('a')] }), { ...NO_CTX, paired: true })).toBe('paired');
        expect(phoneView(state(), { ...NO_CTX, enabling: true })).toBe('wait');
        expect(phoneView(state(), { ...NO_CTX, noDialog: true })).toBe('noGui');
        expect(phoneView(state({ phones: [phone('a')] }), { ...NO_CTX, refused: true })).toBe('refused');
        // The bridge's word wins over a stale local wish.
        expect(phoneView(state({ state: 'confirm' }), { ...NO_CTX, noDialog: true })).toBe('wait');
        expect(phoneView(state({ state: 'error' }), { ...NO_CTX, wantQr: true })).toBe('error');
    });
});

describe('pairing and the phone reaching the computer', () => {
    it('the phone not there when the code was shown is the new one', () => {
        const before = new Set(['a']);
        expect(newlyPaired([phone('a')] as never, before)).toBeNull();
        expect(newlyPaired([phone('a'), phone('b')] as never, before)?.id).toBe('b');
    });

    it('silent a minute after the code, until the computer was reached', () => {
        const shown = Date.parse('2026-10-19T08:00:00Z');
        expect(lanSeenSince('2026-10-19T07:59:59Z', shown)).toBe(false);
        expect(lanSeenSince('2026-10-19T08:00:00Z', shown)).toBe(true);
        expect(lanSeenSince('', shown)).toBe(false);
        expect(phoneSilent('', shown, shown + PHONE_SILENT_MS - 1)).toBe(false);
        expect(phoneSilent('', shown, shown + PHONE_SILENT_MS)).toBe(true);
        expect(phoneSilent('2026-10-19T07:00:00Z', shown, shown + PHONE_SILENT_MS)).toBe(true);
        expect(phoneSilent('2026-10-19T08:00:30Z', shown, shown + PHONE_SILENT_MS)).toBe(false);
    });

    it('the code\'s countdown', () => {
        const now = 1_000_000;
        expect(pairCountdown(now + 600_000, now)).toBe('10:00');
        expect(pairCountdown(now + 551_200, now)).toBe('9:12');
        expect(pairCountdown(now + 400, now)).toBe('0:01');
        expect(pairCountdown(now - 5000, now)).toBe('0:00');
        expect(pairCountdown(NaN, now)).toBeNull();
    });

    it('the address changed: only when a phone was paired at the old one', () => {
        expect(phoneAddressChanged(state({ addressChangedAt: '2026-10-19T08:00:00Z' }))).toBe(false);
        expect(phoneAddressChanged(state({ addressChangedAt: '2026-10-19T08:00:00Z', phones: [phone('a', { stale: true })] }))).toBe(true);
        expect(phoneAddressChanged(state({ phones: [phone('a', { stale: true })] }))).toBe(false);
    });
});

describe('last seen', () => {
    const now = new Date(2026, 9, 19, 14, 30, 0).getTime();
    it('seconds, minutes, today, yesterday, a date', () => {
        expect(seenAgo(new Date(now - 12_000).toISOString(), now, 'en')).toEqual({ kind: 'seconds', n: 12 });
        expect(seenAgo(new Date(now + 5000).toISOString(), now, 'en')).toEqual({ kind: 'seconds', n: 0 });
        expect(seenAgo(new Date(now - 5 * 60_000).toISOString(), now, 'en')).toEqual({ kind: 'minutes', n: 5 });
        expect(seenAgo(new Date(2026, 9, 19, 9, 5).toISOString(), now, 'cs').kind).toBe('today');
        expect(seenAgo(new Date(2026, 9, 18, 22, 0).toISOString(), now, 'cs').kind).toBe('yesterday');
        expect(seenAgo(new Date(2026, 9, 12, 9, 0).toISOString(), now, 'cs')).toEqual({ kind: 'date', date: phoneDate(new Date(2026, 9, 12, 9, 0).toISOString(), 'cs') });
        expect(seenAgo('', now, 'en')).toEqual({ kind: 'never' });
        expect(phoneDate('nope', 'en')).toBe('');
    });
});

describe('addresses and the system', () => {
    it('ip and port of an address', () => {
        expect(phoneIp('http://192.168.1.23:47800')).toBe('192.168.1.23');
        expect(phoneIp('nonsense')).toBe('');
        expect(phonePort('http://192.168.1.23:47800')).toBe(47800);
        expect(phonePort('http://192.168.1.23')).toBeNull();
        expect(phonePort(undefined)).toBeNull();
    });

    it('the bridge\'s word first, else the browser\'s', () => {
        expect(phonePlatform('linux', 'Mozilla/5.0 (Windows NT 10.0)')).toBe('linux');
        expect(phonePlatform(null, 'Mozilla/5.0 (Windows NT 10.0)')).toBe('win');
        expect(phonePlatform(null, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('mac');
        expect(phonePlatform(null, 'Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
        expect(phonePlatform(null, '', 'Win32')).toBe('win');
    });
});

const device = (id: string, extra = {}) => ({
    id, name: 'iPhone · Safari', kind: 'phone', via: 'app', pairedAt: '2026-11-18T09:00:00Z', lastSeenAt: '2026-11-24T13:05:00Z',
    connected: false, stale: false, home: false, ...extra,
});

describe('the gateway of the devices (spec 094 P3)', () => {
    it('nothing of it without device.gateway, not even its other features', () => {
        expect(deviceGatewayCaps(['phone', 'device.rename', 'device.events', 'device.phonePage']))
            .toEqual({ gateway: false, rename: false, events: false, phonePage: false });
        expect(deviceGatewayCaps(null).gateway).toBe(false);
        expect(deviceGatewayCaps(['device.gateway', 'device.events']))
            .toEqual({ gateway: true, rename: false, events: true, phonePage: false });
    });

    it('devices of GET phone read tolerantly: unknown fields, bad rows and duplicates dropped', () => {
        const d = sanitizePhoneDevices({
            app: 'odd', appVersion: '3.33.0', name: 'Pracovna.local', connectedNow: 1, extra: true,
            list: [device('dv_a', { connected: true }), device('dv_a'), { id: 'bad id!' }, 'x', device('dv_b', { kind: 'gizmo', name: 'iPad · Safari' })],
        });
        expect(d?.app).toBe('ready');
        expect(d?.name).toBe('Pracovna.local');
        expect(d?.list.map(x => x.id)).toEqual(['dv_a', 'dv_b']);
        expect(d?.list[1]!.kind).toBe('tablet');
        expect(d?.connectedNow).toBe(1);
        expect(sanitizePhoneDevices(null)).toBeNull();
        // Without connectedNow: counted from the rows.
        expect(sanitizePhoneDevices({ list: [device('dv_a', { connected: true }), device('dv_b', { connected: true })] })?.connectedNow).toBe(2);
        expect(sanitizePhoneDevices({ app: 'none', list: 'no' })).toMatchObject({ app: 'none', list: [] });
    });

    it('a state without devices (a bridge without the gateway) has none', () => {
        expect(sanitizePhoneState({ state: 'on', phones: [] })?.devices).toBeNull();
        expect(sanitizePhoneState({ state: 'on', phones: [], devices: { list: [device('dv_a')] } })?.devices?.list).toHaveLength(1);
    });

    it('a kind by the bridge, else told by the name', () => {
        expect(deviceKindOf('computer', 'iPhone')).toBe('computer');
        expect(deviceKindOf(undefined, 'Android · Chrome')).toBe('phone');
        expect(deviceKindOf(undefined, 'iPad · Safari')).toBe('tablet');
        expect(deviceKindOf(undefined, 'Notebook · Firefox')).toBe('computer');
        expect(deviceKindOf(undefined, 'Kuchyň')).toBeNull();
    });

    it('device events: known kinds only', () => {
        expect(sanitizeDeviceEvent({ type: 'device', what: 'paired', id: 'dv_a', name: 'iPad · Safari', kind: 'tablet' }))
            .toEqual({ what: 'paired', id: 'dv_a', name: 'iPad · Safari', kind: 'tablet' });
        expect(sanitizeDeviceEvent({ what: 'exploded', id: 'dv_a' })).toBeNull();
        expect(sanitizeDeviceEvent({ what: 'gone', id: '../x' })).toBeNull();
        expect(sanitizeDeviceEvent('paired')).toBeNull();
    });

    it('with the gateway, devices count as paired (the list, not the intro)', () => {
        const s = state({ state: 'on', devices: sanitizePhoneDevices({ list: [device('dv_a')] }) });
        expect(phonePairedCount(s)).toBe(0);
        expect(phonePairedCount(s, true)).toBe(1);
        expect(phoneView(s, NO_CTX)).toBe('qr');
        expect(phoneView(s, { ...NO_CTX, gateway: true })).toBe('list');
        expect(phoneView({ ...s, state: 'off' }, { ...NO_CTX, gateway: true })).toBe('offList');
    });

    it('the address changed: a stale device counts only with the gateway', () => {
        const s = state({ state: 'on', addressChangedAt: '2026-11-24T10:00:00Z', devices: sanitizePhoneDevices({ list: [device('dv_a', { stale: true })] }) });
        expect(phoneAddressChanged(s)).toBe(false);
        expect(phoneAddressChanged(s, true)).toBe(true);
    });

    it('the code\'s minutes for a screen reader', () => {
        const now = Date.parse('2026-11-24T10:00:00Z');
        expect(pairMinutesLeft(now + 9 * 60_000 + 41_000, now)).toBe(10);
        expect(pairMinutesLeft(now + 60_000, now)).toBe(1);
        expect(pairMinutesLeft(now - 1, now)).toBe(0);
        expect(pairMinutesLeft(NaN, now)).toBeNull();
    });
});
