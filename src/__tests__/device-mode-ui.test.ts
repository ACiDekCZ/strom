import { describe, it, expect, afterEach } from 'vitest';
import { deviceSwitcherLine, inDeviceMode, deviceComputerName, deviceTreesNotHere } from '../ui/device-mode-ui';
import { setResearchDeviceState, noteResearchDeviceActions, researchDeviceState } from '../research-link';
import { setLanguage, strings } from '../strings';

afterEach(() => setResearchDeviceState(null));

describe('device mode: the tree switcher\'s second line (spec 094 §3)', () => {
    it('a dot and a line for each state of the connection', () => {
        expect(deviceSwitcherLine({ state: 'connected' }, 'Pracovna')).toEqual({ dot: 'is-on', text: 'on computer Pracovna' });
        expect(deviceSwitcherLine({ state: 'connecting' }, 'Pracovna')).toEqual({ dot: 'is-wait', text: 'connecting to Pracovna…' });
        for (const state of ['unreachable', 'otherAddress', 'offline', 'disabled'] as const) {
            expect(deviceSwitcherLine({ state }, 'Pracovna'), state).toEqual({ dot: 'is-error', text: 'Pracovna not reachable' });
        }
        expect(deviceSwitcherLine({ state: 'unpaired' }, 'Pracovna')).toEqual({ dot: 'is-error', text: 'not paired with Pracovna' });
    });

    it('the phone\'s screen of an archive is read-only; the tree held here says it is being updated (094 K3.13 §7, §8)', () => {
        expect(deviceSwitcherLine({ state: 'connected' }, 'Pracovna', { archive: true })).toEqual({ dot: 'is-on', text: 'Archive · read-only' });
        expect(deviceSwitcherLine({ state: 'connected' }, 'Pracovna', { updating: true })).toEqual({ dot: 'is-wait', text: 'on computer Pracovna · updating…' });
        // Away, the connection's state says more than either.
        expect(deviceSwitcherLine({ state: 'unreachable' }, 'Pracovna', { archive: true, updating: true })).toEqual({ dot: 'is-error', text: 'Pracovna not reachable' });
        expect(deviceSwitcherLine({ state: 'unpaired' }, 'Pracovna', { archive: true })).toEqual({ dot: 'is-error', text: 'not paired with Pracovna' });
    });

    it('only in the device mode; the computer\'s name kept once the state is gone', () => {
        expect(inDeviceMode()).toBe(false);
        setResearchDeviceState({ origin: 'http://192.168.1.20:47800', trees: ['t'], computer: 'Pracovna', actions: [] });
        expect(inDeviceMode()).toBe(true);
        expect(deviceComputerName()).toBe('Pracovna');
        expect(deviceTreesNotHere()).toBe('On computer Pracovna. New tree, import and managing trees are on the computer with the research.');
        setResearchDeviceState(null);
        expect(inDeviceMode()).toBe(false);
        expect(deviceComputerName()).toBe('Pracovna');
    });
});

describe('other devices connected now (spec 094 §9, 3.5: status.device.others)', () => {
    afterEach(() => setLanguage('en'));

    it('kept from each status that says it, forgotten by one that does not, untrusted values left out', () => {
        setResearchDeviceState({ origin: 'http://192.168.1.20:47800', trees: ['t'], computer: 'Pracovna', actions: [] });
        noteResearchDeviceActions(['device.rename'], 2);
        expect(researchDeviceState()).toMatchObject({ actions: ['device.rename'], others: 2 });
        noteResearchDeviceActions(['device.rename']);
        expect(researchDeviceState()?.others).toBeUndefined();
        for (const bad of [-1, Number.NaN, '3', null]) {
            noteResearchDeviceActions([], bad);
            expect(researchDeviceState()?.others, String(bad)).toBeUndefined();
        }
        noteResearchDeviceActions([], 2.7);
        expect(researchDeviceState()?.others).toBe(2);
    });

    it('said in every language', () => {
        expect(strings.device.othersConnected(1)).toBe('1 more device connected');
        expect(strings.device.othersConnected(2)).toBe('2 more devices connected');
        setLanguage('cs');
        expect(strings.device.othersConnected(2)).toBe('Připojena ještě 2 zařízení');
        expect(strings.device.othersConnected(5)).toBe('Připojeno ještě 5 zařízení');
        setLanguage('de');
        expect(strings.device.othersConnected(2)).toBe('Noch 2 Geräte verbunden');
        setLanguage('pl');
        expect(strings.device.othersConnected(2)).toBe('Połączone jeszcze 2 urządzenia');
    });
});
