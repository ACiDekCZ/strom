import { describe, it, expect, afterEach } from 'vitest';
import { undoPreviewOf, undoFieldLine, deviceUndoableSend } from '../ui/device-progress-ui';
import type { ResearchSendRecord } from '../research-link';
import type { StromData } from '../types';
import { setLanguage } from '../strings';

afterEach(() => setLanguage('en'));

const ME = 'dv_iphone000000000000000000000000';
const IPAD = { id: 'dv_ipad0000000000000000000000000', name: 'iPad · Safari' };

describe('Undo this send on a device: the preview (spec 094 §4, 4.9; K2.3)', () => {
    it('each field now → after; a fact the send added is removed, a part emptied is empty', () => {
        const p = undoPreviewOf({
            input: 'I0007', undone: 3, fields: [
                { what: 'Death – Bohumil Pýchavka', field: 'date', from: '12 JAN 1934', to: '1934' },
                { what: 'Marriage – Bohumil Pýchavka', field: 'place', from: 'Mlýnky', to: '' },
                { what: 'Note – Bohumil Pýchavka', field: 'fact', from: 'The miller of Mlýnky', to: '' },
                { what: '', field: '', from: 'x', to: 'y' },
            ],
        }, ME);
        expect(p.already).toBe(false);
        expect(p.fields.map(undoFieldLine)).toEqual([
            'Death – Bohumil Pýchavka: 12 Jan 1934 → 1934',
            'Marriage – Bohumil Pýchavka: Mlýnky → empty',
            'Note – Bohumil Pýchavka: The miller of Mlýnky → removed',
        ]);
        setLanguage('cs');
        expect(undoFieldLine(p.fields[2])).toBe('Note – Bohumil Pýchavka: The miller of Mlýnky → odebere se');
        expect(undoFieldLine(p.fields[1])).toBe('Marriage – Bohumil Pýchavka: Mlýnky → prázdné');
    });

    it('the other devices whose later changes stay are named once; this device, the computer and the research are not', () => {
        const p = undoPreviewOf({
            fields: [{ what: 'Birth – Hřibík Pýchavka', field: 'date', from: '1902', to: '1901' }],
            kept: [
                { event: 'E0031', fields: ['place'], what: 'Birth – Hřibík Pýchavka', by: 'send', client: IPAD },
                { event: 'E0032', fields: ['date'], what: 'Death – Hřibík Pýchavka', by: 'send', client: IPAD },
                { event: 'E0033', fields: ['date'], what: 'Baptism – Hřibík Pýchavka', by: 'send', client: { id: ME, name: 'iPhone · Safari' } },
                { event: 'E0034', fields: ['date'], what: 'Burial – Hřibík Pýchavka', by: 'send', client: { id: 'cl_pracovna', name: 'Pracovna' } },
                { event: 'E0035', fields: ['date'], what: 'Census – Hřibík Pýchavka', by: 'research' },
            ],
        }, ME);
        expect(p.keptFrom).toEqual(['iPad · Safari']);
    });

    it('a send taken back already says so (no fields, undoneAt)', () => {
        expect(undoPreviewOf({ input: 'I0007', undone: 0, undoneAt: '2026-11-24T10:00:00Z' }, ME).already).toBe(true);
        expect(undoPreviewOf({ input: 'I0007', undone: 0, fields: [] }, ME).already).toBe(false);
    });
});

describe('"Undo send…" among the research\'s actions on a device (4.2, 6.1): which send', () => {
    const NOW = Date.parse('2026-11-25T10:00:00Z');
    const send = (at: string, client: { id: string; name?: string } | undefined, more: Partial<ResearchSendRecord> = {}): ResearchSendRecord => ({
        intake: `in-${at}`, input: 'I0001', at, state: 'written', changes: 2, tries: null, tree: 't', sent: '', decidedAt: '', reason: '',
        conflicts: null, conflictPersons: [], ...(client ? { client } : {}), ...more,
    } as ResearchSendRecord);

    it('this device\'s newest written send of the last 24 hours with its input; none of another device, none without input', () => {
        const mine = send('2026-11-25T09:30:00Z', { id: ME }, { input: 'I0009' });
        const sends = [
            send('2026-11-25T08:00:00Z', { id: ME }, { input: 'I0005' }),
            mine,
            send('2026-11-25T09:50:00Z', IPAD),
            send('2026-11-25T09:55:00Z', { id: ME }, { input: undefined }),
            send('2026-11-25T09:58:00Z', { id: ME }, { state: 'undone' }),
            send('2026-11-24T08:00:00Z', { id: ME }, { input: 'I0001' }),
        ];
        expect(deviceUndoableSend(sends, ME, NOW)).toBe(mine);
        expect(deviceUndoableSend(sends, IPAD.id + 'x', NOW)).toBeNull();
        expect(deviceUndoableSend(sends, '', NOW)).toBeNull();
        expect(deviceUndoableSend(null, ME, NOW)).toBeNull();
    });
});

describe('Undo this send on a device: each change in the app\'s words (094 U10-n1, N2)', () => {
    const DATA = {
        persons: {
            p1: { id: 'p1', firstName: 'Hřibík', lastName: 'Pýchavka', gender: 'male', refn: 'P0003', parentIds: [], partnerships: ['u1'],
                researchVerify: { birth: { eid: 'E0031' }, 'event:ev1': { eid: 'E0033' } },
                events: [{ id: 'ev1', type: 'occupation' }] },
            p2: { id: 'p2', firstName: 'Holubinka', lastName: 'Ryzcová', gender: 'female', refn: 'P0002', parentIds: [], partnerships: ['u1'] },
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'p1', person2Id: 'p2', childIds: [], researchId: 'F0001', researchVerify: { marriage: { eid: 'E0040' } } },
        },
    } as unknown as StromData;
    const BODY = {
        input: 'I0007', undone: 4, fields: [
            { what: 'Birth – Hřibík Pýchavka (E0031)', field: 'date', from: '3 APR 1902', to: '1902', event: 'E0031', person: 'P0003' },
            { what: 'Marriage – Hřibík Pýchavka & Holubinka Ryzcová (E0040)', field: 'place', from: 'Mlýnky', to: '', event: 'E0040', family: 'F0001' },
            { what: 'Occupation – Hřibík Pýchavka (E0033)', field: 'fact', from: '1925, Mlýnky, miller', to: '', event: 'E0033', person: 'P0003' },
            { what: 'Hřibík Pýchavka', field: 'name', from: 'Hřibík Pýchavka', to: '', person: 'P0003' },
        ],
    };

    it('the fact and the person from the tree here, the date in the app\'s style, in the app\'s language', () => {
        setLanguage('de');
        expect(undoPreviewOf(BODY, ME, DATA).fields.map(undoFieldLine)).toEqual([
            'Geburt – Hřibík Pýchavka: 3.4.1902 → 1902',
            'Heirat – Hřibík Pýchavka & Holubinka Ryzcová: Mlýnky → leer',
            'Beruf – Hřibík Pýchavka: 1925, Mlýnky, miller → wird entfernt',
            'Name – Hřibík Pýchavka: Hřibík Pýchavka → wird entfernt',
        ]);
        setLanguage('cs');
        expect(undoFieldLine(undoPreviewOf(BODY, ME, DATA).fields[0])).toBe('Narození – Hřibík Pýchavka: 3. 4. 1902 → 1902');
    });

    it('the research\'s words only when the tree here does not hold the fact (without its id)', () => {
        const other = { persons: {}, partnerships: {} } as unknown as StromData;
        const lines = undoPreviewOf(BODY, ME, other).fields.map(undoFieldLine);
        expect(lines[0]).toBe('Birth – Hřibík Pýchavka: 3 Apr 1902 → 1902');
        expect(lines[1]).toBe('Marriage – Hřibík Pýchavka & Holubinka Ryzcová: Mlýnky → empty');
    });
});
