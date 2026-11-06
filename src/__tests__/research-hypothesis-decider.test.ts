/**
 * Who decided a hypothesis (spec 060): the research's file says it under a
 * decided or abandoned `_STROM_HYPO` (`2 _BY agent`, `2 DECI` with CONC/CONT,
 * `2 _AT`); "What the research knows" words it; the way into the research to
 * decide it or change its decision; who decides in `/status`. Invented data only.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { researchHypothesisDecision, researchHypothesisLinkLabel } from '../research-hypotheses.js';
import { researchSchemeUrl, researchUrlMark, sanitizeLiveStatus } from '../research-link.js';
import { setLanguage } from '../strings.js';
import { hypothesesDecideReply } from '../history-bridge.js';
import type { ResearchHypothesis } from '../types.js';

const TREE = '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10';

function hypothesesOf(lines: string[]): ResearchHypothesis[] {
    const ged = [
        '0 HEAD', '1 CHAR UTF-8', '1 SOUR STROM_RESEARCH', `1 _STROM_TREE ${TREE}`,
        '0 @I1@ INDI', '1 NAME Václav /Brhlík/', '1 SEX M', '1 REFN P0012',
        ...lines,
        '0 TRLR',
    ].join('\n');
    const data = convertToStrom(parseGedcom(ged)).data;
    return Object.values(data.persons)[0].research?.hypotheses ?? [];
}

/** Graphemes of a text (an emoji with its joiners stays one). */
type GraphemeSegmenter = new (lang: string, o: { granularity: 'grapheme' }) => { segment(t: string): Iterable<{ segment: string }> };
const Segmenter = (Intl as unknown as { Segmenter: GraphemeSegmenter }).Segmenter;
const graphemes = (t: string): string[] => Array.from(new Segmenter('cs', { granularity: 'grapheme' }).segment(t), g => g.segment);

/**
 * A text written as the research writes it: a paragraph a line (2 DECI, then
 * 3 CONT), each cut into CONC lines after the given graphemes — never beside
 * a space (the research's rule), so a cut may fall right after an emoji or
 * inside a word with diacritics.
 */
function cutLines(tag: string, text: string, cutAfter: (para: string[]) => number[]): string[] {
    const out: string[] = [];
    text.split('\n').forEach((para, i) => {
        const g = graphemes(para);
        const cuts = [0, ...cutAfter(g).filter(c => c > 0 && c < g.length && g[c - 1] !== ' ' && g[c] !== ' '), g.length];
        cuts.slice(0, -1).forEach((from, k) => {
            const chunk = g.slice(from, cuts[k + 1]).join('');
            if (k > 0) out.push(`3 CONC ${chunk}`);
            else out.push(i === 0 ? `2 ${tag} ${chunk}` : `3 CONT ${chunk}`);
        });
    });
    return out;
}

describe('who decided a hypothesis, read from the research file', () => {
    it('reads the agent, the reason and the day of a decided hypothesis', () => {
        const [h] = hypothesesOf([
            '1 _STROM_HYPO H0022', '2 TITL Otec Václava: Jakub, nebo Josef Brhlík?', '2 STAT decided', '2 _CHOSEN B',
            '2 _BY agent', '2 DECI Křestní zápis 1865 jmenuje otce Jakuba.', '2 _AT 2026-11-06',
            '2 NOTE A: syn Josefa', '3 CONT B: syn Jakuba a Marie',
        ]);
        expect(h).toMatchObject({
            id: 'H0022', status: 'decided', chosen: 'B', decidedBy: 'agent',
            decision: 'Křestní zápis 1865 jmenuje otce Jakuba.', decidedAt: '2026-11-06',
        });
    });

    it('a person\'s decision: no mark, the reason still read; any other _BY is the person', () => {
        const [person, other] = hypothesesOf([
            '1 _STROM_HYPO H0023', '2 TITL Matka?', '2 STAT decided', '2 _CHOSEN A', '2 DECI Oddací zápis.',
            '1 _STROM_HYPO H0024', '2 TITL Bratr?', '2 STAT abandoned', '2 _BY person', '2 DECI Nic nenalezeno.', '2 _AT 2026-10-01',
        ]);
        expect(person.decidedBy).toBeUndefined();
        expect(person.decision).toBe('Oddací zápis.');
        expect(other.decidedBy).toBeUndefined();
        expect(other).toMatchObject({ status: 'abandoned', decision: 'Nic nenalezeno.', decidedAt: '2026-10-01' });
    });

    it('an open hypothesis keeps none of it; a day not ISO goes', () => {
        const [open, badDay] = hypothesesOf([
            '1 _STROM_HYPO H0025', '2 TITL Otec?', '2 STAT open', '2 _BY agent', '2 DECI Navrženo B.', '2 _AT 2026-11-06',
            '1 _STROM_HYPO H0026', '2 TITL Sestra?', '2 STAT decided', '2 _BY AGENT', '2 _AT 6 NOV 2026',
        ]);
        expect(open.decidedBy).toBeUndefined();
        expect(open.decision).toBeUndefined();
        expect(open.decidedAt).toBeUndefined();
        expect(badDay.decidedBy).toBe('agent');
        expect(badDay.decidedAt).toBeUndefined();
    });

    it('an older file without the lines: nothing new', () => {
        const [h] = hypothesesOf(['1 _STROM_HYPO H0027', '2 TITL Otec?', '2 STAT decided', '2 _CHOSEN A']);
        expect(h).toEqual({ id: 'H0027', title: 'Otec?', status: 'decided', chosen: 'A' });
    });

    it('joins a reason cut into CONC and CONT lines back into the original text (diacritics, an emoji at the cut)', () => {
        const reason = 'Křestní zápis 1865 (fol. 41) jmenuje otce Jakuba Brhlíka a matku Marii rozenou Datlovou👨‍👩‍👦(rodina úplná); '
            + 'u Josefa chybí jakýkoli doklad.\nZápis č. 12 – podpis kněze čitelný✍🏽.';
        const lines = cutLines('DECI', reason, g => {
            const text = g.join('');
            const family = g.findIndex(x => x.includes('👨'));
            const name = text.indexOf('Brhlíka');
            const sign = g.findIndex(x => x.includes('✍'));
            // Right after the family emoji, inside "Brh|líka" (graphemes = code points before it), right before the hand.
            return [family >= 0 ? family + 1 : -1, name >= 0 ? name + 3 : -1, sign].filter(c => c > 0).sort((a, b) => a - b);
        });
        expect(lines).toEqual([
            '2 DECI Křestní zápis 1865 (fol. 41) jmenuje otce Jakuba Brh',
            '3 CONC líka a matku Marii rozenou Datlovou👨‍👩‍👦',
            '3 CONC (rodina úplná); u Josefa chybí jakýkoli doklad.',
            '3 CONT Zápis č. 12 – podpis kněze čitelný',
            '3 CONC ✍🏽.',
        ]);
        const [h] = hypothesesOf(['1 _STROM_HYPO H0028', '2 TITL Otec?', '2 STAT decided', '2 _CHOSEN B', '2 _BY agent', ...lines]);
        expect(h.decision).toBe(reason);
    });
});

describe('"What the research knows" words the decision', () => {
    afterEach(() => setLanguage('en'));

    it('the agent marked, the day in the app\'s date style, the reason; open: nothing', () => {
        setLanguage('cs');
        const agent: ResearchHypothesis = { id: 'H0022', title: 'Otec?', status: 'decided', chosen: 'B', decidedBy: 'agent', decision: 'Křest 1865.', decidedAt: '2026-11-06' };
        expect(researchHypothesisDecision(agent)).toEqual({ by: 'rozhodl agent', day: '6. 11. 2026', reason: 'Křest 1865.' });
        const person: ResearchHypothesis = { id: 'H0023', title: 'Matka?', status: 'decided', chosen: 'A', decision: 'Oddací zápis.' };
        expect(researchHypothesisDecision(person)).toEqual({ by: '', day: '', reason: 'Oddací zápis.' });
        expect(researchHypothesisDecision({ title: 'Otec?', status: 'open', decidedBy: 'agent', decision: 'x' })).toEqual({ by: '', day: '', reason: '' });
    });

    it('the way into the research: decide an open one, change a decided or abandoned one', () => {
        setLanguage('cs');
        expect(researchHypothesisLinkLabel({ title: 'Otec?', status: 'open' })).toBe('Rozhodnout ve výzkumu');
        expect(researchHypothesisLinkLabel({ title: 'Otec?' })).toBe('Rozhodnout ve výzkumu');
        expect(researchHypothesisLinkLabel({ title: 'Otec?', status: 'decided', chosen: 'B' })).toBe('Změnit ve výzkumu');
        setLanguage('de');
        expect(researchHypothesisLinkLabel({ title: 'Otec?', status: 'abandoned' })).toBe('In der Forschung ändern');
    });
});

describe('the hypothesis links (spec 060)', () => {
    it('builds the hypothesis link by its id and do=decide only', () => {
        expect(researchSchemeUrl('hypothesis', { tree: TREE, hypothesis: 'H0022', hypothesisDo: 'decide' }))
            .toBe(`strom-research://hypothesis?tree=${TREE}&id=H0022&do=decide`);
        expect(researchSchemeUrl('hypothesis', { tree: TREE, hypothesis: 'H0022' })).toBeNull();
        expect(researchSchemeUrl('hypothesis', { tree: TREE, hypothesis: 'X0007', hypothesisDo: 'decide' })).toBeNull();
        expect(researchSchemeUrl('hypothesis', { tree: TREE, hypothesis: 'H22&do=agent', hypothesisDo: 'decide' })).toBeNull();
    });

    it('builds who decides with a fixed value only', () => {
        expect(researchSchemeUrl('hypotheses', { tree: TREE, decide: 'agent' }, 'strom-research-beta'))
            .toBe(`strom-research-beta://hypotheses?tree=${TREE}&decide=agent`);
        expect(researchSchemeUrl('hypotheses', { tree: TREE })).toBeNull();
        expect(researchSchemeUrl('hypotheses', { tree: TREE, decide: 'nobody' as 'agent' })).toBeNull();
    });

    it('both open the research\'s terminal: the terminal mark', () => {
        expect(researchUrlMark(`strom-research://hypothesis?tree=${TREE}&id=H0022&do=decide`)).toBe('terminal');
        expect(researchUrlMark(`strom-research://hypotheses?tree=${TREE}&decide=agent`)).toBe('terminal');
    });
});

describe('who decides in /status (spec 060)', () => {
    const raw = { tree: { id: TREE }, hypotheses: { decide: 'agent' } };

    it('read only with hypotheses.decide in features', () => {
        expect(sanitizeLiveStatus({ ...raw, features: [] })!.hypothesesDecide).toBeUndefined();
        expect(sanitizeLiveStatus({ ...raw, features: ['hypotheses.decide'] })!.hypothesesDecide).toBe('agent');
        expect(sanitizeLiveStatus({ ...raw, hypotheses: { decide: 'person' }, features: ['hypotheses.decide'] })!.hypothesesDecide).toBe('person');
    });

    it('an unknown value reads as the person; no value: not said', () => {
        expect(sanitizeLiveStatus({ ...raw, hypotheses: { decide: 'committee' }, features: ['hypotheses.decide'] })!.hypothesesDecide).toBe('person');
        expect(sanitizeLiveStatus({ tree: { id: TREE }, features: ['hypotheses.decide'] })!.hypothesesDecide).toBeUndefined();
        expect(sanitizeLiveStatus({ ...raw, hypotheses: {}, features: ['hypotheses.decide'] })!.hypothesesDecide).toBeUndefined();
    });
});

describe('the answer to POST /hypotheses (spec 060)', () => {
    const check = { tree: TREE };
    const F = ['hypotheses.decide'];

    it('the person written: ok, with the value the research says', () => {
        expect(hypothesesDecideReply(200, { ok: true, decide: 'person' }, F, 'person', check)).toEqual({ ok: true, decide: 'person' });
        expect(hypothesesDecideReply(200, { ok: true }, F, 'person', check)).toEqual({ ok: true });
    });

    it('the agent: 403 hypotheses.link with the research\'s link, used only when it is its own for this tree', () => {
        const own = `strom-research://hypotheses?tree=${TREE}&decide=agent`;
        const said = (link: unknown) => hypothesesDecideReply(403, { code: 'hypotheses.link', error: 'Confirm.', link }, F, 'agent', check);
        expect(said(own)).toMatchObject({ ok: false, code: 'link', link: own });
        // Not the research's own (another scheme, tree, parameter): the app builds its own.
        for (const bad of ['https://example.org/hypotheses?tree=x', `strom-research://hypotheses?tree=${TREE}&decide=agent&run=rm`,
            'strom-research://hypotheses?tree=00000000-0000-0000-0000-000000000000&decide=agent', `strom-research://setup?tree=${TREE}`, 42]) {
            expect(said(bad)).toMatchObject({ code: 'link', link: own });
        }
        expect(hypothesesDecideReply(403, { code: 'hypotheses.link', link: `strom-research-beta://hypotheses?tree=${TREE}&decide=agent` }, F, 'agent',
            { tree: TREE, scheme: 'strom-research-beta' })).toMatchObject({ link: `strom-research-beta://hypotheses?tree=${TREE}&decide=agent` });
    });

    it('the other refusals typed', () => {
        expect(hypothesesDecideReply(409, { code: 'hypotheses.archive', error: 'An archive.' }, F, 'person', check))
            .toMatchObject({ ok: false, code: 'archive', reason: 'An archive.' });
        expect(hypothesesDecideReply(400, { code: 'hypotheses.invalid' }, F, 'person', check)).toMatchObject({ code: 'invalid' });
        expect(hypothesesDecideReply(503, { code: 'research.busy' }, F, 'person', check)).toMatchObject({ code: 'busy' });
        expect(hypothesesDecideReply(500, {}, F, 'person', check)).toMatchObject({ code: 'unknown' });
    });
});

describe('who decides as the research last said it (spec 060)', () => {
    it('the settings module loads without touching the bridge listeners early, and the last word stays while the bridge is down', async () => {
        // The whole UI module graph loads here (slow). research-sync-ui first: the settings module is then evaluated inside
        // the cycle, before research-sync-ui is, and nothing of it may reach research-sync-ui's state that early.
        const { rememberBridgeStatus, lastBridgeStatus } = await import('../ui/research-sync-ui.js');
        await import('../ui/research-tree-settings-ui.js');
        await new Promise(resolve => setTimeout(resolve, 0));
        const status = sanitizeLiveStatus({ treeId: TREE, features: ['hypotheses.decide'], hypotheses: { decide: 'agent' } });
        expect(status?.hypothesesDecide).toBe('agent');
        rememberBridgeStatus(TREE, status!);
        expect(lastBridgeStatus(TREE.toUpperCase())?.hypothesesDecide).toBe('agent');
        rememberBridgeStatus(TREE, sanitizeLiveStatus({ treeId: TREE, features: [] })!);
        expect(lastBridgeStatus(TREE)?.hypothesesDecide).toBeUndefined();
    }, 60_000);
});
