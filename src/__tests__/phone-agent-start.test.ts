/**
 * The agent started from a phone's Research screen (spec 094 K3.15 §10): the links built as on the computer, the
 * buttons offered only where the device starts the agent (else the quiet sentences stay), Now's row of a start
 * by its state (10.3–10.7) and the agent's buttons of Waiting.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { setLanguage, strings } from '../strings';
import { setResearchDeviceState, DEVICE_AGENT_START, DEVICE_AGENT_BRIDGE } from '../research-link';
import {
    phoneAgentLink, phoneComputerOnlyNote, phoneLineRunWhy, phoneQueueWorkOffered, phoneStartRow, phoneWaitingAgentLink,
} from '../ui/phone-research-ui';
import type { DeviceGlance, DeviceGlanceLine } from '../device/device-research-data';
import type { DeviceAgentStartEntry } from '../device/device-agent';

const TREE = '0b9e1c2a-4f3d-4c5e-8a7b-1d2e3f4a5b6c';
const PC = 'Pracovna';

const device = (actions: string[]) => setResearchDeviceState({ origin: 'http://192.168.1.20:47800', trees: [TREE], computer: PC, actions });

function line(o: Partial<DeviceGlanceLine> = {}): DeviceGlanceLine {
    return { id: 'G0002', n: 1, name: 'Ancestors of Bohumil', direction: 'ancestors', way: 'up', state: 'active', tasks: 4, waiting: 0, working: false, ...o } as DeviceGlanceLine;
}

function glance(o: Partial<DeviceGlance> = {}): DeviceGlance {
    return {
        head: 'h', tree: { id: TREE, name: 'Puffballs', lang: 'en', state: 'active', persons: 10, families: 3 },
        now: [], runs: [], lines: [line()], waiting: { n: 0, items: [] }, people: {}, ...o,
    } as DeviceGlance;
}

function start(o: Partial<DeviceAgentStartEntry>): DeviceAgentStartEntry {
    return { tree: TREE, link: 'strom-research://work?tree=x&do=loop', kind: 'queue', state: 'starting', noConfirm: false, since: 0, runsBefore: [], ...o } as DeviceAgentStartEntry;
}

beforeAll(() => setLanguage('en'));
afterEach(() => setResearchDeviceState(null));

describe('the agent\'s links of a device', () => {
    it('are built as on the computer, only with agent.start', () => {
        device([]);
        expect(phoneAgentLink(TREE, 'work', { workDo: 'loop' })).toBeNull();
        device([DEVICE_AGENT_START]);
        expect(phoneAgentLink(TREE, 'work', { workDo: 'loop' })).toMatch(/^strom-research[a-z-]*:\/\/work\?.*do=loop/);
        expect(phoneAgentLink(TREE, 'work', { workDo: 'loop', research: 'G0002' })).toContain('research=G0002');
        expect(phoneAgentLink(TREE, 'chat', { research: 'G0002' })).toMatch(/:\/\/chat\?/);
        expect(phoneAgentLink(null, 'work', { workDo: 'loop' })).toBeNull();
    });

    it('a task talked over (T…) and a conflict left to the agent (X…); other ids none', () => {
        device([DEVICE_AGENT_START]);
        expect(phoneWaitingAgentLink(TREE, { id: 'T0007' }, 'discuss')).toMatch(/:\/\/task\?.*task=T0007.*do=chat|do=chat.*task=T0007/);
        expect(phoneWaitingAgentLink(TREE, { id: 'X0003' }, 'leave')).toMatch(/:\/\/conflict\?/);
        expect(phoneWaitingAgentLink(TREE, { id: 'C0001' }, 'leave')).toBeNull();
        expect(phoneWaitingAgentLink(TREE, { id: 'W-B-1' }, 'discuss')).toBeNull();
        device([]);
        expect(phoneWaitingAgentLink(TREE, { id: 'T0007' }, 'discuss')).toBeNull();
    });
});

describe('the quiet sentences of what stays on the computer', () => {
    it('stay without the agent, give way to the buttons with it', () => {
        device([]);
        expect(phoneComputerOnlyNote('line-work', PC)).toBe(strings.device.dirWorkOnComputer(PC));
        expect(phoneComputerOnlyNote('batch-sort', PC)).toBe(strings.batch.sortOnComputer);
        device([DEVICE_AGENT_START]);
        expect(phoneComputerOnlyNote('line-work', PC)).toBeNull();
        expect(phoneComputerOnlyNote('batch-sort', PC)).toBe(strings.batch.sortOnComputer);
        device([DEVICE_AGENT_START, DEVICE_AGENT_BRIDGE]);
        expect(phoneComputerOnlyNote('batch-sort', PC)).toBeNull();
        // A conflict's value is chosen on the computer: its sentence always stays.
        expect(phoneComputerOnlyNote('conflict', PC)).toBe(strings.deviceResearch.conflictOnComputer(PC));
    });
});

describe('Work on the queue… under Now', () => {
    const link = 'strom-research://work?tree=x&do=loop';
    it('offered with a link, the queue not at work and no start of it on its way', () => {
        expect(phoneQueueWorkOffered(glance(), null, link)).toBe(true);
        expect(phoneQueueWorkOffered(glance(), null, null)).toBe(false);
        expect(phoneQueueWorkOffered(null, null, link)).toBe(false);
        expect(phoneQueueWorkOffered(glance({ tree: { ...glance().tree, state: 'archive' } }), null, link)).toBe(false);
        const queueRun = { id: 'R1', line: null, way: 'up', since: '', state: 'working' } as DeviceGlance['runs'][number];
        expect(phoneQueueWorkOffered(glance({ runs: [queueRun] }), null, link)).toBe(false);
        expect(phoneQueueWorkOffered(glance({ runs: [{ ...queueRun, line: 'G0002' }] }), null, link)).toBe(true);
        expect(phoneQueueWorkOffered(glance(), start({ state: 'starting' }), link)).toBe(false);
        expect(phoneQueueWorkOffered(glance(), start({ state: 'waitPc' }), link)).toBe(false);
        // Not started: offered again (Try again stands in Now's row too).
        expect(phoneQueueWorkOffered(glance(), start({ state: 'notStarted', why: 'timeout' }), link)).toBe(true);
        expect(phoneQueueWorkOffered(glance(), start({ kind: 'line', line: 'G0002' }), link)).toBe(true);
    });
});

describe('a line\'s own run in Line actions', () => {
    const link = 'strom-research://work?tree=x&do=loop&research=G0002';
    it('offered, grey with the reason, or not there', () => {
        expect(phoneLineRunWhy(line(), glance(), null, link)).toBe('');
        expect(phoneLineRunWhy(line(), glance(), null, null)).toBeNull();
        expect(phoneLineRunWhy(line({ state: 'done' }), glance(), null, link)).toBeNull();
        const run = { id: 'R1', line: 'G0002', way: 'up', since: '', state: 'working' } as DeviceGlance['runs'][number];
        expect(phoneLineRunWhy(line(), glance({ runs: [run] }), null, link)).toBeNull();
        expect(phoneLineRunWhy(line({ state: 'paused' }), glance(), null, link)).toBe(strings.live.lineRunPaused);
        expect(phoneLineRunWhy(line({ tasks: 0 }), glance(), null, link)).toBe(strings.live.lineRunEmpty);
        expect(phoneLineRunWhy(line(), glance(), start({ kind: 'line', line: 'G0002' }), link)).toBe(strings.busy.starting);
        expect(phoneLineRunWhy(line(), glance(), start({ kind: 'line', line: 'G0009' }), link)).toBe('');
    });
});

describe('Now\'s row of a start (10.3–10.7)', () => {
    const A = () => strings.deviceAgent;
    it('starting: the queue\'s or the line\'s words, where it comes up or that nothing is confirmed', () => {
        expect(phoneStartRow(null, PC)).toBeNull();
        expect(phoneStartRow(start({}), PC)).toMatchObject({ state: 'starting', title: strings.busy.queueStarting, sub: A().startingSub(PC), retry: false });
        expect(phoneStartRow(start({ kind: 'line', label: 'Ancestors' }), PC)?.title).toBe(strings.live.lineRunStarting('Ancestors'));
        expect(phoneStartRow(start({ noConfirm: true }), PC)?.sub).toBe(A().noConfirm(PC));
    });

    it('running: Now\'s own row (none here); a conversation at the computer with Close', () => {
        expect(phoneStartRow(start({ state: 'running' }), PC)).toBeNull();
        expect(phoneStartRow(start({ kind: 'chat', state: 'running', label: 'T0007' }), PC))
            .toMatchObject({ state: 'chat', title: A().chatRow(PC), sub: 'T0007', close: true, retry: false });
    });

    it('waiting at the computer, not started after 30 s, not started with why — never silent', () => {
        expect(phoneStartRow(start({ state: 'waitPc' }), PC)).toMatchObject({ state: 'waitPc', title: A().waitPc(PC), sub: A().waitPcSub });
        expect(phoneStartRow(start({ state: 'notStarted', why: 'timeout' }), PC))
            .toMatchObject({ title: strings.busy.queueNotStarted, retry: true });
        const no = phoneStartRow(start({ state: 'notStarted', why: 'noTerminal' as DeviceAgentStartEntry['why'] }), PC)!;
        expect(no).toMatchObject({ title: A().notStartedTitle, why: A().noTerminal(PC), retry: true });
        const said = phoneStartRow(start({ kind: 'line', label: 'L', state: 'notStarted', why: 'said', text: 'At most 2 runs.' }), PC)!;
        expect(said).toMatchObject({ title: A().notStartedLine, why: 'At most 2 runs.', sub: 'L' });
        expect(phoneStartRow(start({ kind: 'chat', state: 'notStarted', why: 'said' }), PC)!.why).not.toBe('');
    });
});
