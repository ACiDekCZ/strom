/**
 * A card with two or three action signals (waiting, conflict, question):
 * which it shows and in what order, how many choices a click on the stack
 * offers, the stack's HTML (two or three badges, the most pressing in
 * front, two dots), its name for a screen reader in four languages and its
 * bubble of a row per signal. A card with one signal keeps its badge, its
 * bubble and its dot exactly as before. Invented people.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { Person, PersonId, ResearchConflict, StromData } from '../types.js';
import { CardSignalContext, CardSignalInfo, cardSignalInfo, presentActions, stackChoices } from '../card-signals.js';
import { cardActionMarksHtml, stackAriaLabel } from '../card-signal-marks.js';
import { CARD_SIGNAL_DEFAULTS, CardSignals } from '../settings.js';
import { createEmptyData } from '../data.js';
import { setLanguage, strings } from '../strings.js';

afterEach(() => setLanguage('en'));

const conflict = (id: string, status: 'open' | 'decided' = 'open'): ResearchConflict =>
    ({ id, fact: 'BIRT', status, values: [] }) as ResearchConflict;

function person(extra: Partial<Person> = {}): Person {
    return {
        id: 'p1' as PersonId, firstName: 'Ottilie', lastName: 'Brandauer', gender: 'female',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], refn: 'P0001', ...extra,
    } as Person;
}

function signalsOf(p: Person, opts: { waiting?: string; waitingStory?: boolean; agent?: string; settings?: Partial<CardSignals> } = {}): CardSignalInfo {
    const data: StromData = createEmptyData();
    data.persons[p.id] = p;
    const ctx: CardSignalContext = {
        data, unions: new Map(), treeHasSources: false,
        reliability: { researchTree: false, originFeature: false },
        settings: { ...CARD_SIGNAL_DEFAULTS, ...opts.settings },
        research: new Map([['P0001', { waiting: opts.waiting, waitingStory: opts.waitingStory, agent: opts.agent }]]),
    };
    return cardSignalInfo(p, ctx);
}

const all = (settings?: Partial<CardSignals>, extra: { waitingStory?: boolean; agent?: string } = {}): CardSignalInfo => signalsOf(person({
    question: 'Who was the godfather at the baptism?',
    research: { conflicts: [conflict('X0001'), conflict('X0002'), conflict('X0003', 'decided')], hypotheses: [{ title: 'The miller of Hollendorf was her father' }] },
} as Partial<Person>), { waiting: 'Confirm the marriage record of 1891 in Hollendorf', settings, ...extra });

describe('presentActions', () => {
    it('every signal present and switched on, in the order waiting, conflict, question; the first is the badge', () => {
        const s = all();
        expect(s.actions).toEqual(['waiting', 'conflict', 'question']);
        expect(s.action).toBe('waiting');
        expect(presentActions({ waiting: null, conflicts: 2, question: 'Q' }, CARD_SIGNAL_DEFAULTS)).toEqual(['conflict', 'question']);
        expect(presentActions({ waiting: null, conflicts: 0, question: null }, CARD_SIGNAL_DEFAULTS)).toEqual([]);
    });

    it('a signal switched off (Settings → Show on card) is left out; the badge is the first one left', () => {
        expect(all({ waiting: false }).actions).toEqual(['conflict', 'question']);
        expect(all({ waiting: false }).action).toBe('conflict');
        expect(all({ conflict: false }).actions).toEqual(['waiting', 'question']);
        expect(all({ waiting: false, conflict: false }).actions).toEqual(['question']);
        expect(all({ waiting: false, conflict: false, question: false }).actions).toEqual([]);
        expect(all({ waiting: false, conflict: false, question: false }).action).toBeNull();
    });

    it('a decided conflict does not count; a placeholder shows nothing', () => {
        const s = signalsOf(person({ research: { conflicts: [conflict('X0001', 'decided')] } } as Partial<Person>));
        expect(s.actions).toEqual([]);
        expect(signalsOf(person({ isPlaceholder: true, question: 'Q' }), { waiting: 'W' }).actions).toEqual([]);
    });
});

describe('stackChoices', () => {
    it('what waits, the story, what the research knows (one choice), the agent at work', () => {
        expect(stackChoices(all())).toEqual(['waiting', 'knows']);
        expect(stackChoices(all({}, { waitingStory: true }))).toEqual(['waiting', 'story', 'knows']);
        // The agent at work is offered beside the badges (its arc is not drawn then).
        const withAgent = all({}, { agent: 'Reading the parish register' });
        expect(withAgent.showAgent).toBe(false);
        expect(stackChoices(withAgent)).toEqual(['waiting', 'knows', 'agent']);
    });

    it('a conflict and a question alone: one choice, what the research knows', () => {
        const s = signalsOf(person({ question: 'Q', research: { conflicts: [conflict('X0001')] } } as Partial<Person>));
        expect(s.actions).toEqual(['conflict', 'question']);
        expect(stackChoices(s)).toEqual(['knows']);
    });
});

/** The badge's HTML as the renderer wrote it before the stack (HEAD 7378a9b), for one signal. */
function badgeBefore(id: string, s: CardSignalInfo): { badgeHtml: string; dotHtml: string } {
    const esc = (t: string): string => (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const c = strings.card;
    const markTip = (kind: string, head: string, lines: string[], click: string, below = false): string =>
        `<span class="badge-tooltip mark-tip mt-${kind}${below ? ' below' : ''}" id="mt-${kind}-${esc(id)}" role="tooltip">`
        + `<span class="badge-tooltip-header">${esc(head)}</span>`
        + lines.filter(Boolean).map(l => `<span class="badge-tooltip-body">${esc(l)}</span>`).join('')
        + (click ? `<span class="badge-tooltip-action">${esc(click)}</span>` : '')
        + '</span>';
    const clipText = (t: string, n = 120): string => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
    const clip = (t: string): string => (t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t);
    const label = s.action === 'waiting' ? c.ttWaiting(clip(s.waiting ?? ''))
        : s.action === 'conflict' ? c.ttConflicts(s.conflicts) : c.ttQuestion(clip(s.question ?? ''));
    const also = (parts: string[]): string => (parts.length > 0 ? c.tipAlso(parts.join(', ')) : '');
    const knowsParts = [s.conflicts > 0 ? c.ttConflicts(s.conflicts) : '', s.question ? c.menuQuestions(1) : ''].filter(Boolean);
    const tip = s.action === 'waiting'
        ? markTip('badge', strings.cardDensity.cardWaiting, [clipText(s.waiting ?? ''), also(knowsParts)], c.tipClickAnswer)
        : s.action === 'conflict'
            ? markTip('badge', c.tipConflictHead, [
                [c.ttConflicts(s.conflicts), s.hypotheses > 0 ? c.ttHypotheses(s.hypotheses) : ''].filter(Boolean).join(' · '),
                also(s.question ? [c.menuQuestions(1)] : []),
            ], c.tipClickKnows)
            : markTip('badge', c.tipQuestionHead, [clipText(s.question ?? '')], c.tipClickKnows);
    const glyph = { waiting: '!', conflict: '≠', question: '?' }[s.action!];
    return {
        badgeHtml: `<button type="button" class="card-signal signal-${s.action}" data-signal="${s.action}" data-mark="badge" aria-label="${esc(label)}" aria-describedby="mt-badge-${esc(id)}">${glyph}</button>${tip}`,
        dotHtml: `<span class="card-signal-dot signal-${s.action}" aria-hidden="true"></span>`,
    };
}

describe('the card’s marks: one signal as before', () => {
    const cases: [string, Partial<CardSignals>][] = [
        ['waiting (conflicts and the question switched off, still named in "Also")', { conflict: false, question: false }],
        ['conflict', { waiting: false, question: false }],
        ['question', { waiting: false, conflict: false }],
    ];
    for (const lang of ['en', 'cs'] as const) {
        for (const [name, settings] of cases) {
            it(`${name} (${lang})`, () => {
                setLanguage(lang);
                const s = all(settings);
                expect(s.actions).toHaveLength(1);
                const now = cardActionMarksHtml('p1', s, 3);
                expect(now).toEqual(badgeBefore('p1', s));
                expect(now!.badgeHtml).not.toContain('card-signal-stack');
            });
        }
    }

    it('a text with quotes and markup stays escaped', () => {
        const s = signalsOf(person({ question: 'Was "Hans" <the> godfather & witness?' }));
        expect(cardActionMarksHtml('p"1', s)).toEqual(badgeBefore('p"1', s));
    });

    it('no action signal: nothing', () => {
        expect(cardActionMarksHtml('p1', signalsOf(person()))).toBeNull();
    });
});

describe('the card’s marks: a stack of two or three', () => {
    it('three: .card-signal-stack.n3, three coins, the front one with the first signal\'s glyph, two dots', () => {
        const m = cardActionMarksHtml('p1', all(), 3)!;
        expect(m.badgeHtml).toMatch(/^<button type="button" class="card-signal-stack n3" data-mark="badge-stack" aria-haspopup="menu" aria-expanded="false" aria-label="[^"]+">/);
        expect(m.badgeHtml.match(/class="cs-coin /g)).toHaveLength(3);
        expect(m.badgeHtml).toContain('<span class="cs-coin cs-back2" aria-hidden="true"></span><span class="cs-coin cs-back1" aria-hidden="true"></span><span class="cs-coin cs-front" aria-hidden="true">!</span></button>');
        expect(m.badgeHtml).not.toContain('aria-describedby');
        expect(m.badgeHtml).not.toContain('class="card-signal ');
        expect(m.dotHtml).toBe('<span class="card-signal-dot card-signal-dot--back" aria-hidden="true"></span><span class="card-signal-dot signal-waiting" aria-hidden="true"></span>');
    });

    it('two: .n2, two coins, the front one the most pressing; two dots', () => {
        const m = cardActionMarksHtml('p1', all({ waiting: false }))!;
        expect(m.badgeHtml).toContain('class="card-signal-stack n2"');
        expect(m.badgeHtml.match(/class="cs-coin /g)).toHaveLength(2);
        expect(m.badgeHtml).not.toContain('cs-back2');
        expect(m.badgeHtml).toContain('<span class="cs-coin cs-front" aria-hidden="true">≠</span>');
        expect(m.dotHtml.match(/card-signal-dot/g)).toHaveLength(3);
        expect(m.dotHtml).toContain('card-signal-dot signal-conflict');
    });

    it('a conflict and a question alone (one choice, straight to what the research knows): a dialog, no menu', () => {
        const s = signalsOf(person({ question: 'Q', research: { conflicts: [conflict('X0001')] } } as Partial<Person>));
        const m = cardActionMarksHtml('p1', s)!;
        expect(m.badgeHtml).toContain('class="card-signal-stack n2" data-mark="badge-stack" aria-haspopup="dialog" aria-label=');
        expect(m.badgeHtml).not.toContain('aria-expanded');
        expect(m.badgeHtml).not.toContain('aria-haspopup="menu"');
    });

    it('the stack\'s name in four languages', () => {
        const s = all();
        const label = (): string => stackAriaLabel(s, 3);
        expect(label()).toBe('3 waiting, 2 conflicts, 1 hypothesis, 1 question');
        setLanguage('cs');
        expect(label()).toBe('Čeká 3, 2 rozpory, 1 hypotéza, 1 otázka');
        setLanguage('de');
        expect(label()).toBe('3 wartend, 2 Widersprüche, 1 Hypothese, 1 Frage');
        setLanguage('pl');
        expect(label()).toBe('Czeka 3, 2 sprzeczności, 1 hipoteza, 1 pytanie');
        expect(cardActionMarksHtml('p1', s, 3)!.badgeHtml).toContain(`aria-label="${label()}"`);
    });

    it('the name leaves out a signal switched off', () => {
        setLanguage('cs');
        expect(stackAriaLabel(all({ conflict: false }), 1)).toBe('Čeká 1, 1 otázka');
    });
});

describe('the stack\'s bubble', () => {
    const rows = (html: string): string[] =>
        [...html.matchAll(/<span class="mt-row">.*?<\/span><\/span><\/span>/g)].map(m => m[0]);

    it('a row per signal in the stack\'s order, the task and the question as their text; no header, no "Also"', () => {
        const m = cardActionMarksHtml('p1', all(), 3)!;
        const tip = m.badgeHtml.slice(m.badgeHtml.indexOf('</button>') + 9);
        expect(tip).toMatch(/^<span class="badge-tooltip mark-tip mt-stack" id="mt-stack-p1" role="tooltip">/);
        expect(tip).not.toContain('badge-tooltip-header');
        expect(tip).not.toContain('Also');
        const r = rows(tip);
        expect(r).toHaveLength(3);
        expect(r[0]).toContain('>!</span>');
        expect(r[0]).toContain('<span class="mt-row-head">Awaiting action · 3</span><span class="mt-row-sub">Confirm the marriage record of 1891 in Hollendorf</span>');
        expect(r[1]).toContain('>≠</span>');
        expect(r[1]).toContain('<span class="mt-row-head">2 conflicts · 1 hypothesis</span></span>');
        expect(r[1]).not.toContain('mt-row-sub');
        expect(r[2]).toContain('>?</span>');
        expect(r[2]).toContain('<span class="mt-row-head">Open question</span><span class="mt-row-sub">Who was the godfather at the baptism?</span>');
        expect(tip).toContain('<span class="badge-tooltip-action">Click: choose what to open</span></span>');
    });

    it('one choice (a conflict and a question): the click says what the research knows', () => {
        const s = signalsOf(person({ question: 'Q', research: { conflicts: [conflict('X0001')] } } as Partial<Person>));
        const html = cardActionMarksHtml('p1', s)!.badgeHtml;
        expect(html).toContain(`<span class="badge-tooltip-action">${strings.card.tipClickKnows}</span>`);
        expect(rows(html)).toHaveLength(2);
    });

    it('the click line in four languages; the waiting row\'s head from "Awaiting action"', () => {
        const words: [string, string, string][] = [
            ['cs', 'Klik: vybrat, co otevřít', 'Čeká na vyřízení · 3'],
            ['de', 'Klick: auswählen, was sich öffnet', 'Wartet auf Bearbeitung · 3'],
            ['pl', 'Kliknięcie: wybór, co otworzyć', 'Czeka na decyzję · 3'],
        ];
        for (const [lang, click, head] of words) {
            setLanguage(lang as 'cs' | 'de' | 'pl');
            const html = cardActionMarksHtml('p1', all(), 3)!.badgeHtml;
            expect(html).toContain(`<span class="badge-tooltip-action">${click}</span>`);
            expect(html).toContain(`<span class="mt-row-head">${head}</span>`);
        }
    });

    it('a long task is cut with "…"', () => {
        const long = 'x'.repeat(200);
        const s = signalsOf(person({ question: 'Q' }), { waiting: long });
        const html = cardActionMarksHtml('p1', s)!.badgeHtml;
        expect(html).toContain(`<span class="mt-row-sub">${'x'.repeat(119)}…</span>`);
    });
});
