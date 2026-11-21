/**
 * Holds of tasks and archives (spec 127 K3.1): the bridge's `working[].hold`,
 * `working[].waits`, `queue[].heldBy` and `queue[].archiveHeld` read only with
 * `task.holds` / `archive.holds` (bad values dropped; an older research shows
 * nothing new), and their sentences in four languages, times in the local
 * clock. Invented data.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { setLanguage } from '../strings.js';
import {
    sanitizeLiveStatus, sanitizeQueue, sanitizeWorking, holdsSaid, ARCHIVE_HOLDS_FEATURE, TASK_HOLDS_FEATURE,
    type QueueArchiveHeld, type QueueHeldBy,
} from '../research-link.js';
import { archiveHeldText, heldByText, queueHoldText, waitsText, workingHoldText } from '../research-holds.js';

const UUID = '7d5e2a4c-1b3f-4e6a-9c8d-0f1e2d3c4b5a';
/** A local time of 21 Nov 2026 (the sentences say the local clock). */
const at = (h: number, m: number): string => new Date(2026, 10, 21, h, m).toISOString();
const NOW = new Date(2026, 10, 21, 14, 33).getTime();
const BOTH = { task: true, archive: true };

const HOLD = { by: 'agent', since: at(14, 5), beat: at(14, 31), until: at(15, 1) };
const AGENT_ROW = { who: 'Claude Code – práce přímo', since: at(14, 5), session: 'N0040', task: 'Křest Jana Lhotáka', research: 'G0003', hold: HOLD };
const WAITING_RUN = {
    who: 'Claude Code – samostatná práce', since: at(13, 58),
    paused: { until: at(14, 40), reason: 'čeká na archiv www.lhota-archiv.example', archive: 'www.lhota-archiv.example', since: at(14, 10) },
    waits: { archive: 'www.lhota-archiv.example', since: at(14, 10), until: at(14, 40) },
};
const HELD_BY = { session: 'N0040', who: 'Claude Code', ...HOLD };
const ARCHIVE_HELD = { site: 'www.lhota-archiv.example', until: at(15, 1), own: false, by: 'agent', since: at(14, 5), beat: at(14, 31) };

describe('reading the holds from the bridge', () => {
    it('with both features: the hold, the wait, who holds a task, who uses its archive', () => {
        const [agent, run] = sanitizeWorking([AGENT_ROW, WAITING_RUN], false, BOTH);
        expect(agent.hold).toEqual(HOLD);
        expect(agent.paused).toBeUndefined();
        expect(run.waits).toEqual(WAITING_RUN.waits);
        // `paused` stays the object an older app reads.
        expect(run.paused).toMatchObject({ until: at(14, 40), reason: 'čeká na archiv www.lhota-archiv.example' });
        const [held, arch] = sanitizeQueue([
            { id: 'T0012', text: 'Křest Jana Lhotáka', state: 'next', heldBy: HELD_BY },
            { id: 'T0013', text: 'Oddací matrika', state: 'next', archiveHeld: ARCHIVE_HELD },
        ], true, true, 20, true, BOTH);
        expect(held.heldBy).toEqual(HELD_BY);
        expect(held.archiveHeld).toBeUndefined();
        expect(arch.archiveHeld).toEqual(ARCHIVE_HELD);
    });

    it('a hold of a live process has no `until`; `waiting` keeps no times; `session` only with `own`', () => {
        const { until: _u, ...live } = HOLD;
        expect(sanitizeWorking([{ ...AGENT_ROW, hold: { ...live, by: 'run' } }], false, BOTH)[0].hold).toEqual({ ...live, by: 'run' });
        const [w, o, x] = sanitizeQueue([
            { id: 'T0001', text: 'a', state: 'next', archiveHeld: { site: 's.example', until: at(15, 1), own: false, by: 'waiting', since: at(14, 0) } },
            { id: 'T0002', text: 'b', state: 'next', archiveHeld: { ...ARCHIVE_HELD, own: true, session: 'N0041' } },
            { id: 'T0003', text: 'c', state: 'next', archiveHeld: { ...ARCHIVE_HELD, session: 'N0041' } },
        ], true, true, 20, true, BOTH);
        expect(w.archiveHeld).toEqual({ site: 's.example', until: at(15, 1), own: false, by: 'waiting' });
        expect(o.archiveHeld?.session).toBe('N0041');
        expect(x.archiveHeld?.session).toBeUndefined();
    });

    it('bad values are dropped, and a task held by a session never carries an archive too', () => {
        const bad = sanitizeWorking([
            { ...AGENT_ROW, hold: { ...HOLD, by: 'robot' } },
            { ...AGENT_ROW, hold: { ...HOLD, beat: 'soon' } },
            { ...WAITING_RUN, waits: { archive: '', since: at(14, 10), until: at(14, 40) } },
        ], false, BOTH);
        expect(bad.map(w => w.hold ?? w.waits ?? null)).toEqual([null, null, null]);
        const [both, noWho, noOwn] = sanitizeQueue([
            { id: 'T0001', text: 'a', state: 'next', heldBy: HELD_BY, archiveHeld: ARCHIVE_HELD },
            { id: 'T0002', text: 'b', state: 'next', heldBy: { ...HELD_BY, who: '' } },
            { id: 'T0003', text: 'c', state: 'next', archiveHeld: { ...ARCHIVE_HELD, own: 'no' } },
        ], true, true, 20, true, BOTH);
        expect(both.heldBy).toBeDefined();
        expect(both.archiveHeld).toBeUndefined();
        expect(noWho.heldBy).toBeUndefined();
        expect(noOwn.archiveHeld).toBeUndefined();
    });

    it('an older research (no features): nothing of it is read, the rows as before', () => {
        const status = (features: string[]) => sanitizeLiveStatus({
            tree: { id: UUID, name: 'Lhotákovi' }, features,
            working: [AGENT_ROW, WAITING_RUN],
            queue: [{ id: 'T0012', text: 'Křest', state: 'next', heldBy: HELD_BY }, { id: 'T0013', text: 'Oddací', state: 'next', archiveHeld: ARCHIVE_HELD }],
        })!;
        const old = status(['working.place']);
        expect(old.working[0]).not.toHaveProperty('hold');
        expect(old.working[1]).not.toHaveProperty('waits');
        expect(old.working[1].paused).toBeDefined();
        expect(old.queue[0]).not.toHaveProperty('heldBy');
        expect(old.queue[1]).not.toHaveProperty('archiveHeld');
        // Each feature lets through its own part only.
        const task = status([TASK_HOLDS_FEATURE]);
        expect(task.working[0].hold).toBeDefined();
        expect(task.working[1]).not.toHaveProperty('waits');
        expect(task.queue[0].heldBy).toBeDefined();
        expect(task.queue[1]).not.toHaveProperty('archiveHeld');
        const archive = status([ARCHIVE_HOLDS_FEATURE]);
        expect(archive.working[0]).not.toHaveProperty('hold');
        expect(archive.working[1].waits).toBeDefined();
        expect(archive.queue[0]).not.toHaveProperty('heldBy');
        expect(archive.queue[1].archiveHeld).toBeDefined();
        expect(holdsSaid(null)).toEqual({ task: false, archive: false });
    });
});

describe('the sentences, in four languages', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
        setLanguage('en');
    });

    const heldBy = HELD_BY as QueueHeldBy;
    const arch = ARCHIVE_HELD as QueueArchiveHeld;

    it('cs, de and pl as the research words them (24-hour clock)', () => {
        const want = {
            cs: {
                held: 'Úkol drží Claude Code (sezení N0040, linie G3) od 14:05, naposledy 14:31; uvolní se nejpozději v 15:01.',
                live: 'Úkol drží Claude Code (sezení N0040) od 14:05, naposledy 14:31; uvolní se, až skončí.',
                waits: 'čeká na archiv www.lhota-archiv.example (nejdéle do 14:40)',
                other: 'Archiv www.lhota-archiv.example teď používá jiný výzkum (od 14:05, naposledy 14:31); uvolní se nejpozději v 15:01.',
                own: 'Archiv www.lhota-archiv.example teď používá sezení N0041 (od 14:05, naposledy 14:31); uvolní se nejpozději v 15:01.',
                fetch: 'Archiv www.lhota-archiv.example teď používá hromadné stahování (od 14:05, naposledy 14:31); uvolní se nejpozději v 15:01.',
                waiting: 'Na archiv www.lhota-archiv.example déle čeká jiná práce; na řadě nejpozději v 15:01.',
                row: 'naposledy 14:31; uvolní se nejpozději v 15:01',
            },
            de: {
                held: 'Die Aufgabe hält Claude Code (Sitzung N0040, Linie G3) seit 14:05, zuletzt 14:31; frei spätestens um 15:01.',
                live: 'Die Aufgabe hält Claude Code (Sitzung N0040) seit 14:05, zuletzt 14:31; frei, wenn sie endet.',
                waits: 'wartet auf das Archiv www.lhota-archiv.example (höchstens bis 14:40)',
                other: 'Das Archiv www.lhota-archiv.example nutzt gerade eine andere Forschung (seit 14:05, zuletzt 14:31); frei spätestens um 15:01.',
                own: 'Das Archiv www.lhota-archiv.example nutzt gerade die Sitzung N0041 (seit 14:05, zuletzt 14:31); frei spätestens um 15:01.',
                fetch: 'Das Archiv www.lhota-archiv.example nutzt gerade ein Massendownload (seit 14:05, zuletzt 14:31); frei spätestens um 15:01.',
                waiting: 'Auf das Archiv www.lhota-archiv.example wartet eine andere Arbeit länger; an der Reihe spätestens um 15:01.',
                row: 'zuletzt 14:31; frei spätestens um 15:01',
            },
            pl: {
                held: 'Zadanie trzyma Claude Code (sesja N0040, linia G3) od 14:05, ostatnio 14:31; zwolni się najpóźniej o 15:01.',
                live: 'Zadanie trzyma Claude Code (sesja N0040) od 14:05, ostatnio 14:31; zwolni się, gdy się skończy.',
                waits: 'czeka na archiwum www.lhota-archiv.example (najdłużej do 14:40)',
                other: 'Z archiwum www.lhota-archiv.example korzysta teraz inne badanie (od 14:05, ostatnio 14:31); zwolni się najpóźniej o 15:01.',
                own: 'Z archiwum www.lhota-archiv.example korzysta teraz sesja N0041 (od 14:05, ostatnio 14:31); zwolni się najpóźniej o 15:01.',
                fetch: 'Z archiwum www.lhota-archiv.example korzysta teraz zbiorcze pobieranie (od 14:05, ostatnio 14:31); zwolni się najpóźniej o 15:01.',
                waiting: 'Na archiwum www.lhota-archiv.example dłużej czeka inna praca; kolej najpóźniej o 15:01.',
                row: 'ostatnio 14:31; zwolni się najpóźniej o 15:01',
            },
        } as const;
        const { until: _u, ...live } = heldBy;
        for (const [lang, w] of Object.entries(want)) {
            setLanguage(lang as 'cs' | 'de' | 'pl');
            expect(heldByText(heldBy, 'G3', NOW, lang), lang).toBe(w.held);
            expect(heldByText(live, '', NOW, lang), lang).toBe(w.live);
            expect(waitsText({ waits: WAITING_RUN.waits }, NOW, lang), lang).toBe(w.waits);
            expect(archiveHeldText(arch, NOW, lang), lang).toBe(w.other);
            expect(archiveHeldText({ ...arch, own: true, session: 'N0041' }, NOW, lang), lang).toBe(w.own);
            expect(archiveHeldText({ ...arch, by: 'fetch' }, NOW, lang), lang).toBe(w.fetch);
            expect(archiveHeldText({ site: arch.site, until: arch.until, own: false, by: 'waiting' }, NOW, lang), lang).toBe(w.waiting);
            expect(workingHoldText(HOLD as never, NOW, lang), lang).toBe(w.row);
        }
    });

    it('en, in the app\'s clock for English', () => {
        setLanguage('en');
        const t = (h: number, m: number) => new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(2026, 10, 21, h, m));
        expect(heldByText(heldBy, '', NOW, 'en'))
            .toBe(`The task is held by Claude Code (session N0040) since ${t(14, 5)}, last sign ${t(14, 31)}; free by ${t(15, 1)} at the latest.`);
        expect(archiveHeldText(arch, NOW, 'en'))
            .toBe(`The archive www.lhota-archiv.example is used by another research now (since ${t(14, 5)}, last sign ${t(14, 31)}); free by ${t(15, 1)} at the latest.`);
        expect(waitsText({ waits: WAITING_RUN.waits }, NOW, 'en')).toBe(`waiting for the archive www.lhota-archiv.example (at most until ${t(14, 40)})`);
    });

    it('"last" only when it differs from "since"; a row of a live process says nothing beyond its since', () => {
        setLanguage('cs');
        expect(heldByText({ ...heldBy, beat: at(14, 5) }, '', NOW, 'cs')).toBe('Úkol drží Claude Code (sezení N0040) od 14:05; uvolní se nejpozději v 15:01.');
        expect(workingHoldText({ by: 'run', since: at(14, 5), beat: at(14, 5) }, NOW, 'cs')).toBe('');
        expect(workingHoldText(undefined, NOW, 'cs')).toBe('');
        expect(queueHoldText({}, '', NOW, 'cs')).toBe('');
        expect(queueHoldText({ heldBy, archiveHeld: arch }, '', NOW, 'cs')).toMatch(/^Úkol drží/);
        // Another day: the day with the time.
        expect(waitsText({ waits: { archive: 'a.example', since: at(14, 10), until: new Date(2026, 10, 22, 9, 15).toISOString() } }, NOW, 'cs'))
            .toBe('čeká na archiv a.example (nejdéle do 22. 11. 09:15)');
    });
});
