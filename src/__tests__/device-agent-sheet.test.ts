/**
 * The sheet of the agent's start from a device (spec 094 K3.15, 10.2 / 10.9 / 10.10): its kind by the link, the
 * app's own heading and texts, the research's lines under the AI row, the queue's segment and the primary button.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { setLanguage, strings } from '../strings';
import {
    deviceAgentOnlyLabel, deviceAgentRefusedAction, deviceAgentSheetKindOf, deviceAgentSheetModel,
} from '../ui/device-agent-ui';
import type { DeviceAgentAsk } from '../device/device-agent';

const ASK: DeviceAgentAsk = {
    what: 'Start the agent on the queue?',
    note: ['About 12 tasks, a few minutes each.', 'Uses the Pro subscription.'],
    said: [],
    tree: 'Puffballs of Mushroom Hollow',
};

beforeAll(() => setLanguage('en'));

describe('the sheet\'s kind by its link', () => {
    it.each([
        ['strom-research://work?tree=r1&do=loop', 'queue'],
        ['strom-research://work?tree=r1&do=tasks&n=3&research=G2', 'line'],
        ['strom-research://chat?tree=r1', 'chat'],
        ['strom-research://chat?tree=r1&research=G2', 'chat'],
        ['strom-research://task?tree=r1&task=T1&do=chat', 'chat'],
        ['strom-research://conflict?tree=r1&conflict=K1&do=agent', 'chat'],
        ['strom-research://conflict?tree=r1&conflict=K1&do=decide', 'other'],
        ['strom-research-beta://places?tree=r1&do=run', 'other'],
        ['https://example.org/work', 'other'],
    ])('%s → %s', (link, kind) => {
        expect(deviceAgentSheetKindOf(link)).toBe(kind);
    });
});

describe('the sheet\'s content', () => {
    const A = () => strings.deviceAgent;
    const L = () => strings.live;

    it('the queue: its heading, the tree with its tasks, where, the AI row, the research\'s lines, how to stop', () => {
        const m = deviceAgentSheetModel(
            { kind: 'queue', tasks: 12, first: 'Ask the district archive (T0418)', mode: { n: 3, on: 'loop' }, linkFor: () => 'x' },
            ASK, 'Pracovna', 'strom-research://work?tree=r1&do=loop');
        expect(m.title).toBe(L().queueWorkTitle);
        expect(m.sub).toBe(A().queueSub(ASK.tree, 12));
        expect(m.first).toBe(`${L().queueWorkFirst}: Ask the district archive (T0418)`);
        expect(m.seg).toEqual({ auto: L().queueWorkAuto, only: deviceAgentOnlyLabel(3), on: 'loop' });
        expect(m.rows.map(r => r.icon)).toEqual(['terminal', 'ai', 'note', 'note', 'stop']);
        expect(m.rows[0]).toEqual({ icon: 'terminal', text: A().where('Pracovna'), strong: 'Pracovna' });
        expect(m.rows[1].text).toBe(A().cost);
        expect(m.rows.slice(2, 4).map(r => r.text)).toEqual(ASK.note);
        expect(m.rows[4].text).toBe(A().stopHow);
        expect(m.back).toBe(A().back);
        expect(m.primary).toBe(A().startOn('Pracovna'));
        expect(m.mark).toBe('agent');
    });

    it('a line: its kicker, its name with its tasks, its agent (the default when none), no stop row', () => {
        const link = 'strom-research://work?tree=r1&do=loop&research=G2';
        const m = deviceAgentSheetModel({ lineName: 'Ancestors of Bohumil', tasks: 5 }, ASK, 'Pracovna', link);
        expect(m.kind).toBe('line');
        expect(m.title).toBe(L().lineRunKicker);
        expect(m.sub).toBe(A().queueSub('Ancestors of Bohumil', 5));
        expect(m.rows[0].text).toBe(A().whereLine('Pracovna'));
        expect(m.rows[1]).toEqual({ icon: 'agent', text: `${L().lineRunAgent}: ${L().lineRunAgentDefault}` });
        expect(m.rows.some(r => r.icon === 'stop')).toBe(false);
        // No segment without the links of its choices.
        expect(m.seg).toBeNull();
        const named = deviceAgentSheetModel({ lineName: 'Ancestors of Bohumil', agent: 'Codex' }, ASK, 'Pracovna', link);
        expect(named.rows[1].text).toBe(`${L().lineRunAgent}: Codex`);
    });

    it('a conversation: where it runs and "Open on {pc}"', () => {
        const m = deviceAgentSheetModel({}, ASK, 'Pracovna', 'strom-research://task?tree=r1&task=T1&do=chat');
        expect(m.kind).toBe('chat');
        expect(m.title).toBe(strings.live.waitingTask.discuss);
        expect(m.sub).toBe(ASK.tree);
        expect(m.rows[0].text).toBe(A().whereChat('Pracovna'));
        expect(m.primary).toBe(A().openOn('Pracovna'));
    });

    it('other work of the agent: the research\'s question as its heading', () => {
        const m = deviceAgentSheetModel({}, { ...ASK, note: [] }, 'Pracovna', 'strom-research://places?tree=r1&do=run');
        expect(m.kind).toBe('other');
        expect(m.title).toBe(ASK.what);
        expect(m.rows.map(r => r.icon)).toEqual(['terminal', 'ai']);
        expect(m.primary).toBe(A().startOn('Pracovna'));
    });

    it('the texts address nobody (de: the primary button)', () => {
        setLanguage('de');
        try {
            const m = deviceAgentSheetModel({ kind: 'queue', tasks: 3 }, ASK, 'Pracovna', 'strom-research://work?tree=r1&do=loop');
            expect(m.primary).toBe('Auf Pracovna starten');
            for (const t of [m.title, m.sub, m.back, m.primary, ...m.rows.map(r => r.text)]) expect(t).not.toMatch(/\b(Sie|Ihr|du|dein)\b/);
        } finally {
            setLanguage('en');
        }
    });
});

describe('the action a refusal names', () => {
    it.each([
        ['link.work', 'strom-research://work?tree=r1', 'work'],
        [undefined, 'strom-research://chat?tree=r1', 'chat'],
        [undefined, 'strom-research://conflict?tree=r1&do=agent', 'conflict-agent'],
        ['link.nonsense', 'strom-research://work?tree=r1', null],
    ])('%s %s → %s', (action, link, out) => {
        expect(deviceAgentRefusedAction(action, link)).toBe(out);
    });
});
