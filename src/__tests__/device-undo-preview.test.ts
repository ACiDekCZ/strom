import { describe, it, expect, afterEach } from 'vitest';
import { undoPreviewOf, undoFieldLine, deviceUndoableSend } from '../ui/device-progress-ui';
import type { ResearchSendRecord } from '../research-link';
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
            'Death – Bohumil Pýchavka: 12 JAN 1934 → 1934',
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
