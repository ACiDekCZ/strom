/**
 * Comparing an approved story with its waiting new version: the diff
 * (src/story-diff.ts), its HTML (src/story-compare.ts) and the family book's
 * banner and dialog. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { diffStoryText, diffStoryLines, storyParagraphs } from '../story-diff.js';
import { storyCompareHtml } from '../story-compare.js';
import { buildFamilyBook } from '../book.js';
import { getStringsForLang } from '../strings.js';
import { storyProseHtml } from '../story-text.js';
import { StromData, Story, PersonId, PartnershipId } from '../types.js';

const L = getStringsForLang('cs').story;
const html = (approved: Story, draft: Story['draft']) =>
    storyCompareHtml({ approved, draft: draft! }, L, { idPrefix: 't', prose: (t, title) => storyProseHtml(t, { title }) });

const JAN: Story = { status: 'final', text: 'Jan byl mlynář.', facts: [] };
const DRAFT = {
    title: 'Mlynář z Horní Lhoty',
    text: 'Jan byl mlynář ve Lhotě, jako jeho otec.\n\nMlýn vyhořel roku 1856.',
    facts: ['OCCU mlynář [S0001]', 'EVEN požár 1856 [S0007]'],
    note: 'Požár je z kroniky obce.',
    at: '2026-10-02',
};

const paras = (n: number, changed: number[]): [string, string] => {
    const old = Array.from({ length: n }, (_, i) => `Odstavec číslo ${i + 1} vypráví o mlýně a o rodině, která v něm žila.`);
    const neu = old.map((p, i) => changed.includes(i + 1) ? p.replace('o rodině', 'o velké rodině mlynáře') : p);
    return [old.join('\n\n'), neu.join('\n\n')];
};

describe('the diff', () => {
    it('marks the words added and removed inside a paragraph, spacing aside', () => {
        const d = diffStoryText('Po smrti otce převzal Václav mlýn někdy kolem roku 1880.', 'Po smrti otce převzal Václav mlýn v dubnu 1879.');
        expect(d.paras).toHaveLength(1);
        const p = d.paras[0];
        expect(p.kind).toBe('changed');
        if (p.kind !== 'changed') return;
        expect(p.ops.filter(o => o.op === 'del').map(o => o.text.trim())).toEqual(['někdy kolem roku 1880']);
        expect(p.ops.filter(o => o.op === 'add').map(o => o.text.trim())).toEqual(['v dubnu 1879']);
        expect(p.ops.map(o => o.op === 'del' ? '' : o.text).join('')).toBe('Po smrti otce převzal Václav mlýn v dubnu 1879.');
    });

    it('takes a paragraph without a like in the other version as new or removed', () => {
        const d = diffStoryText('Jan byl mlynář.\n\nMěl tři syny.', 'Jan byl mlynář ve Lhotě.\n\nMlýn vyhořel roku 1856.');
        expect(d.paras.map(p => p.kind)).toEqual(['changed', 'removed', 'added']);
    });

    it('keeps bold out of the comparison but remembers it', () => {
        const d = diffStoryText('Byl **nádeník** v Lhotě.', 'Byl **nádeník** v Horní Lhotě.');
        const p = d.paras[0];
        if (p.kind !== 'changed') throw new Error(p.kind);
        expect(p.ops.find(o => o.text.startsWith('nádeník'))).toMatchObject({ op: 'eq', bold: true });
        expect(p.ops.filter(o => o.op !== 'eq').map(o => o.text.trim())).toEqual(['Horní']);
    });

    it('folds unchanged paragraphs only while at most half changed', () => {
        const few = diffStoryText(...paras(11, [2, 7, 11]));
        expect([few.changed, few.total, few.collapse]).toEqual([3, 11, true]);
        const many = diffStoryText(...paras(11, [1, 2, 3, 5, 7, 9, 11]));
        expect(many.collapse).toBe(false);
    });

    it('leaves out a first heading that only repeats the title', () => {
        expect(storyParagraphs('# Mlynář\n\nJan byl mlynář.', 'Mlynář')).toHaveLength(1);
        expect(storyParagraphs('## Mládí\n\nText.')[0].heading).toBe(true);
    });

    it('compares the facts as a set', () => {
        expect(diffStoryLines(['A [S1]', 'B'], ['B', 'C  [S2]'])).toEqual({ added: ['C  [S2]'], removed: ['A [S1]'] });
    });
});

describe('the comparison as HTML', () => {
    it('shows the changes, the title row and the facts added', () => {
        const out = html(JAN, DRAFT);
        expect(out).toContain('<ins data-sr="přidáno:">ve Lhotě, jako jeho otec</ins>');
        expect(out).toContain('<span class="sc-tag sc-tag--add">nový</span>');
        expect(out).toMatch(/<span class="sc-none">bez nadpisu<\/span><span class="sc-arrow"[^>]*>→<\/span><ins[^>]*>Mlynář z Horní Lhoty<\/ins>/);
        expect(out.match(/sc-line--add/g)).toHaveLength(3);   // two facts + the caveat
        expect(out).toContain('aria-selected="true"');
        expect(out).toMatch(/id="t-new"[^>]*hidden/);
    });

    it('has no title row when the new version does not say its title', () => {
        const { title: _t, ...noTitle } = DRAFT;
        expect(html(JAN, noTitle)).not.toContain('>Nadpis<');
    });

    it('folds unchanged runs and says how much changed', () => {
        const [a, b] = paras(11, [2, 7, 11]);
        const out = html({ status: 'final', text: a }, { text: b });
        expect(out.match(/<details class="sc-run">/g)).toHaveLength(3);
        expect(out).toContain('odstavec 1 beze změny');
        expect(out).toContain('odstavce 3–6 beze změny');
        expect(out).toContain('3 z 11 odstavců změněno');
        const [c, d] = paras(11, [1, 2, 3, 5, 7, 9, 11]);
        expect(html({ status: 'final', text: c }, { text: d })).not.toContain('<details');
    });

    it('escapes the text', () => {
        expect(html({ status: 'final', text: 'A <b>' }, { text: 'A <i>' })).not.toMatch(/<[bi]>/);
    });
});

describe('the family book', () => {
    const data = (): StromData => ({
        version: 8,
        persons: {
            ['p1' as PersonId]: {
                id: 'p1' as PersonId, firstName: 'Jan', lastName: 'Vlk', gender: 'male', isPlaceholder: false,
                deathDate: '1874', partnerships: ['u1' as PartnershipId], parentIds: [], childIds: [],
                story: { ...JAN, draft: DRAFT },
            },
            ['p2' as PersonId]: {
                id: 'p2' as PersonId, firstName: 'Marie', lastName: 'Vlková', gender: 'female', isPlaceholder: false,
                deathDate: '1880', partnerships: ['u1' as PartnershipId], parentIds: [], childIds: [],
            },
            // A chapter is a couple with children.
            ['c1' as PersonId]: {
                id: 'c1' as PersonId, firstName: 'Josef', lastName: 'Vlk', gender: 'male', isPlaceholder: false,
                birthDate: '1850', deathDate: '1910', partnerships: [], parentIds: ['p1', 'p2'], childIds: [],
            },
        },
        partnerships: {
            ['u1' as PartnershipId]: {
                id: 'u1' as PartnershipId, person1Id: 'p1' as PersonId, person2Id: 'p2' as PersonId, childIds: ['c1'], status: 'married',
                story: { status: 'final', text: 'Svatba byla v únoru.', draft: { text: 'Svatba byla v únoru 1865.' } },
            },
        },
    } as unknown as StromData);

    it('says nothing about new versions without the UI', () => {
        const out = buildFamilyBook(data(), { lang: 'cs', privacyMode: 'full' });
        expect(out).not.toContain('book-nv"');
        expect(out).not.toContain('<dialog');
    });

    it('puts a banner above the person\'s and the couple\'s story, and their comparisons', () => {
        const out = buildFamilyBook(data(), {
            lang: 'cs', privacyMode: 'full',
            storyDraftUrls: (o) => 'person' in o ? { final: 'strom-research://story?x&do=final', keep: 'strom-research://story?x&do=keep' } : {},
        });
        expect(out.match(/<div class="book-nv">/g)).toHaveLength(2);
        expect(out).toContain('<strong>Nová verze čeká.</strong> Výzkum napsal 2. 10. 2026 nový text.');
        expect(out).toContain('data-story-person="p1"');
        expect(out).toContain('data-story-couple="u1"');
        expect(out).toContain('Jan Vlk a Marie Vlková');
        expect(out).toContain('href="strom-research://story?x&amp;do=final" data-compare-do="final"');
        // The couple without links: read-only.
        expect(out).toContain('Rozhodnout můžete ve výzkumu na počítači.');
        expect(out).toMatch(/@media print \{[^}]*\}\s*\.book-nv, \.book-compare \{ display: none !important; \}/);
    });
});
