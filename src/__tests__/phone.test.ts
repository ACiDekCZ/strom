/**
 * "Connect phone" (spec 012): what the bridge says about the phone connection,
 * read without trusting it, and the dialog's pure choices. Invented phones and
 * addresses only.
 */

import { describe, it, expect } from 'vitest';
import {
    sanitizePhoneSummary, sanitizePhoneState, phoneView, newlyPaired, lanSeenSince, phoneSilent, PHONE_SILENT_MS,
    pairCountdown, seenAgo, phoneDate, phoneAddressChanged, phoneIp, phonePort, phonePlatform,
    PhoneState, PhoneViewContext,
} from '../phone.js';

const NO_CTX: PhoneViewContext = { enabling: false, noDialog: false, refused: false, wantQr: false, paired: false };

function state(extra: Partial<PhoneState> = {}): PhoneState {
    return {
        state: 'off', since: '', addresses: [], addressChangedAt: '', lanSeenAt: '', pair: null, phones: [],
        error: null, platform: null, network: null, firewall: null, ...extra,
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
