import { describe, it, expect, afterEach } from 'vitest';
import { setLanguage, getStringsForLang, type Language } from '../strings';
import { researchOpenMark, researchOpenLabel, researchOpenSrText, researchLabelText } from '../ui/research-open-mark';

const LANGS: Language[] = ['en', 'cs', 'de'];

describe('the "opens in the research" mark (§6)', () => {
    afterEach(() => setLanguage('en'));

    it('state 2: the terminal mark with its title and the hidden words; no AI badge, no ↗', () => {
        setLanguage('en');
        const html = researchOpenMark();
        expect(html).toContain('class="research-open-mark" title="Opens in the research (Strom Research terminal)" aria-hidden="true"');
        expect(html).toContain('<svg class="research-open-svg" width="14"');
        expect(html).not.toContain('research-ai-badge');
        expect(html).not.toContain('↗');
        expect(html).toContain('<span class="research-open-sr">, opens in the research</span>');
    });

    it('state 3: the hidden words, the AI badge, the mark always last', () => {
        setLanguage('en');
        const html = researchOpenMark({ ai: true });
        const badge = html.indexOf('research-ai-badge');
        const mark = html.indexOf('research-open-mark');
        // The hidden words first: no box before them (a space in the accessible name otherwise).
        expect(html.indexOf('research-open-sr')).toBe(html.indexOf('<span class="research-open-sr"') + '<span class="'.length);
        expect(html.startsWith('<span class="research-open-sr">, AI, opens in the research</span>')).toBe(true);
        expect(badge).toBeGreaterThan(0);
        expect(mark).toBeGreaterThan(badge);
        expect(html.endsWith('</svg></span>')).toBe(true);
        expect(researchOpenSrText(true)).toBe(', AI, opens in the research');
    });

    it('sizes 12 / 14 / 16; a named element leaves the hidden words out', () => {
        expect(researchOpenMark({ size: 12 })).toContain('width="12"');
        expect(researchOpenMark({ size: 12 })).toContain('stroke-width="2.2"');
        expect(researchOpenMark({ size: 16 })).toContain('width="16"');
        expect(researchOpenMark({ sr: false })).not.toContain('research-open-sr');
    });

    it('a label keeps its last word with the mark (no mark alone on a new line), escaped', () => {
        setLanguage('en');
        const html = researchOpenLabel('Decide in the <research>');
        expect(html.startsWith('<span class="research-open-text">Decide in the <span class="research-open-nowrap">&lt;research&gt;<span class="research-open-sr">')).toBe(true);
        expect(html.endsWith('</svg></span></span></span>')).toBe(true);
        expect(researchLabelText('Answer ↗')).toBe('Answer');
    });

    it('the title says what the mark means in every language', () => {
        for (const lang of LANGS) {
            setLanguage(lang);
            const title = getStringsForLang(lang).research.opensInResearchTitle;
            expect(title).toContain('Strom Research');
            expect(researchOpenMark()).toContain(`title="${title}"`);
        }
    });

    it('labels of actions that open the research no longer carry ↗ (the mark is drawn at them)', () => {
        for (const lang of LANGS) {
            const s = getStringsForLang(lang);
            const labels = [
                s.batch.openInResearch, s.conflict.keepLink, s.conflict.takeLink, s.install.haveIt, s.install.haveItEmpty,
                s.install.haveItDownloaded, s.materials.openSystem, s.read.openResearch, s.read.updateResearch,
                s.research.adoptStart, s.research.adoptTree, s.research.answer, s.research.approveStory, s.research.decide,
                s.research.drop, s.research.findSource, s.research.park, s.research.wake, s.research.updateResearch,
                s.research.reviewSubmit, s.research.fullQualityExternal, s.researchUpdate.startResearch,
                s.story.keepOld, s.story.takeNew, s.story.openAgain, s.sync.decideInResearch, s.sync.held.sealButton,
                s.sync.openResearch, s.sync.pillStart, s.sync.startAndSend, s.sync.startResearch, s.sync.startShort,
                s.research.queueMore(3), s.live.sessions(2),
                ...Object.values(s.live.waitingActions),
            ];
            for (const label of labels) expect(label, `${lang}: ${label}`).not.toContain('↗');
        }
    });
});
