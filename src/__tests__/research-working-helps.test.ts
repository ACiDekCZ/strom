/**
 * A task at work now that only helps its line (spec 036 K1.8): the bridge's
 * `working[].helps` and `branch` read only with the feature `working.helps`
 * (bad values dropped), and the Now row's reason in the queue's words in four
 * languages. Invented data.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { setLanguage, type Language } from '../strings.js';
import { sanitizeWorking, sanitizeLiveStatus, WORKING_HELPS_FEATURE, type LiveWorker } from '../research-link.js';

const UUID = '7d5e2a4c-1b3f-4e6a-9c8d-0f1e2d3c4b5a';

describe('working rows: how a task helps its line, its branch', () => {
    const rows = [
        { who: 'agent', task: 'Křest Terezie Fíškové', research: 'G0003', helps: 'joins', branch: 'B-P0208' },
        { who: 'agent', task: 'A', research: 'G0003', helps: 'branch', branch: 'B-P0031' },
        { who: 'agent', task: 'B', research: 'G0003', helps: 'kin', branch: 'P0031' },
        { who: 'agent', task: 'C', helps: 'question', branch: 'B-P0040' },
        { who: 'agent', task: 'D', research: 'G0003', helps: 7, branch: 12 },
    ];

    it('read with the feature: valid values kept, bad ones dropped, `helps` only with a line', () => {
        const [a, b, c, d, e] = sanitizeWorking(rows, true);
        expect(a).toMatchObject({ research: 'G0003', helps: 'joins', branch: 'B-P0208' });
        expect(b).toMatchObject({ helps: 'branch', branch: 'B-P0031' });
        expect(c.helps).toBeUndefined();
        expect(c.branch).toBeUndefined();
        expect(d.helps).toBeUndefined();
        expect(d.branch).toBe('B-P0040');
        expect(e.helps).toBeUndefined();
        expect(e.branch).toBeUndefined();
        for (const by of ['question', 'joins', 'agent', 'partner', 'branch']) {
            expect(sanitizeWorking([{ who: 'agent', research: 'G0001', helps: by }], true)[0].helps).toBe(by);
        }
    });

    it('an older research (no feature): neither is read, the row as before', () => {
        for (const w of sanitizeWorking(rows)) {
            expect(w.helps).toBeUndefined();
            expect(w.branch).toBeUndefined();
        }
        const old = sanitizeLiveStatus({ tree: { id: UUID, name: 'T' }, working: rows.slice(0, 1), features: ['working.place'] })!;
        expect(old.working[0]).not.toHaveProperty('helps');
        const now = sanitizeLiveStatus({ tree: { id: UUID, name: 'T' }, working: rows.slice(0, 1), features: [WORKING_HELPS_FEATURE] })!;
        expect(now.working[0]).toMatchObject({ helps: 'joins', branch: 'B-P0208' });
    });
});

type WhyText = (w: LiveWorker, s: unknown, grouped?: boolean) => string;

describe('the Now row\'s reason, in four languages', () => {
    let workingWhyText: WhyText;
    beforeAll(async () => {
        workingWhyText = (await import('../ui/research-offline-ui.js') as unknown as { workingWhyText: WhyText }).workingWhyText;
    }, 60000);
    afterEach(() => setLanguage('en'));

    const LINE = 'Předci: Eva Lhotáková';
    const session = { researches: [{ id: 'G0003', name: LINE, state: 'active' }] };
    const w = (x: Partial<LiveWorker>): LiveWorker => ({ who: 'agent', since: '', task: 'Křest Terezie Fíškové', ...x });

    const expected: Record<Language, Record<string, string>> = {
        cs: {
            question: `pomáhá linii ${LINE} · otázka linie`,
            joins: `pomáhá linii ${LINE} · připojuje lidi ke stromu`,
            agent: `pomáhá linii ${LINE} · jak uvádí agent`,
            partner: `pomáhá linii ${LINE} · manžel nebo manželka předka`,
            branch: `pomáhá linii ${LINE} · větev P0031`,
            out: 'mimo linie · větev P0040',
            outGrouped: 'větev P0040',
        },
        en: {
            question: `helps the direction ${LINE} · a question of the direction`,
            joins: `helps the direction ${LINE} · connects people to the tree`,
            agent: `helps the direction ${LINE} · as the agent says`,
            partner: `helps the direction ${LINE} · spouse of an ancestor`,
            branch: `helps the direction ${LINE} · branch P0031`,
            out: 'outside the directions · branch P0040',
            outGrouped: 'branch P0040',
        },
        de: {
            question: `hilft der Richtung ${LINE} · eine Frage der Richtung`,
            joins: `hilft der Richtung ${LINE} · verbindet Personen mit dem Baum`,
            agent: `hilft der Richtung ${LINE} · wie der Agent angibt`,
            partner: `hilft der Richtung ${LINE} · Ehepartner eines Vorfahren`,
            branch: `hilft der Richtung ${LINE} · Zweig P0031`,
            out: 'außerhalb der Richtungen · Zweig P0040',
            outGrouped: 'Zweig P0040',
        },
        pl: {
            question: `pomaga linii ${LINE} · pytanie linii`,
            joins: `pomaga linii ${LINE} · łączy ludzi z drzewem`,
            agent: `pomaga linii ${LINE} · według agenta`,
            partner: `pomaga linii ${LINE} · małżonek przodka`,
            branch: `pomaga linii ${LINE} · gałąź P0031`,
            out: 'poza liniami · gałąź P0040',
            outGrouped: 'gałąź P0040',
        },
    };

    for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
        it(`${lang}: each way of helping names the line and how; outside the lines its branch`, () => {
            setLanguage(lang);
            const t = expected[lang];
            for (const by of ['question', 'joins', 'agent', 'partner'] as const) {
                expect(workingWhyText(w({ research: 'G0003', helps: by }), session)).toBe(t[by]);
            }
            expect(workingWhyText(w({ research: 'G0003', helps: 'branch', branch: 'B-P0031' }), session)).toBe(t.branch);
            expect(workingWhyText(w({ branch: 'B-P0040' }), session)).toBe(t.out);
            expect(workingWhyText(w({ branch: 'B-P0040' }), session, true)).toBe(t.outGrouped);
        });

        it(`${lang}: under the line's own heading, how it helps without the line's name`, () => {
            setLanguage(lang);
            const t = expected[lang];
            const how = (s: string) => s.slice(s.indexOf(`${LINE} · `) + LINE.length + 3);
            for (const by of ['question', 'joins', 'agent', 'partner'] as const) {
                const said = workingWhyText(w({ research: 'G0003', helps: by }), session, true);
                expect(said).toBe(how(t[by]));
                expect(said).not.toContain(LINE);
            }
            expect(workingWhyText(w({ research: 'G0003', helps: 'branch', branch: 'B-P0031' }), session, true)).toBe(how(t.branch));
        });
    }

    it('a task of the line, or a research that does not say: no reason (the line\'s name stays)', () => {
        expect(workingWhyText(w({ research: 'G0003' }), session)).toBe('');
        expect(workingWhyText(w({}), session)).toBe('');
        expect(workingWhyText(w({ research: 'G0003', branch: 'B-P0031' }), session)).toBe('');
    });

    it('the choice of work outside the lines says what helping a line means, in four languages', async () => {
        const m = await import('../strings.js');
        const says: Record<Language, string> = {
            en: '(a question of the direction, connecting people to someone in it or to their spouse, a reason the agent gives)',
            cs: '(otázka linie, připojení lidí k člověku linie nebo k jeho partnerovi, důvod uvedený agentem)',
            de: '(eine Frage der Richtung, Personen an jemanden in ihr oder an dessen Partner anbinden, ein vom Agenten genannter Grund)',
            pl: '(pytanie linii, dołączenie osób do kogoś z linii lub do jego partnera, powód podany przez agenta)',
        };
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            setLanguage(lang);
            expect(m.strings.live.setOutIntro).toContain(says[lang]);
        }
    });

    it('a line the research does not list: its id', () => {
        setLanguage('cs');
        expect(workingWhyText(w({ research: 'G0009', helps: 'joins' }), session)).toBe('pomáhá linii G0009 · připojuje lidi ke stromu');
        // Under Outside the directions (no heading of its own): the id stays.
        expect(workingWhyText(w({ research: 'G0009', helps: 'joins' }), session, true)).toBe('pomáhá linii G0009 · připojuje lidi ke stromu');
    });
});
