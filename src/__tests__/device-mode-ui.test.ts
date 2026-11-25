import { describe, it, expect, afterEach } from 'vitest';
import { deviceSwitcherLine, inDeviceMode, deviceComputerName, deviceTreesNotHere } from '../ui/device-mode-ui';
import { setResearchDeviceState } from '../research-link';

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
