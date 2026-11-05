import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { convertHelp, embedHelp } from '../help-convert.js';
import {
    findRule, getChapter, getHelpLoaded, hasHelpData, helpDocInfo, helpLangOf, loadHelp, ruleExists, setEmbeddedHelp,
} from '../help-data.js';
import type { EmbeddedHelp, HelpBundle } from '../help-types.js';
import { readHelpSources, VENDOR_DIR, vendorPin } from './help-sources.js';

let bundle: HelpBundle;
let embedded: EmbeddedHelp;

beforeAll(() => {
    bundle = convertHelp(readHelpSources(VENDOR_DIR), vendorPin());
    embedded = embedHelp(bundle, d => deflateRawSync(d, { level: 9 }));
});

afterEach(() => setEmbeddedHelp(null));

describe('help data', () => {
    it('has no content without the embedded help', async () => {
        setEmbeddedHelp(null);
        expect(hasHelpData()).toBe(false);
        expect(await loadHelp('cs')).toEqual({ parts: [], chapters: [], terms: [] });
        expect(findRule('cs', 'R2.4')).toBeNull();
        expect(helpDocInfo()).toEqual({ docVersion: '', describes: { app: '', research: '' } });
    });

    it('inflates a language to exactly the converted data and keeps it', async () => {
        setEmbeddedHelp(embedded);
        expect(hasHelpData()).toBe(true);
        expect(getHelpLoaded('de')).toBeNull();
        const de = await loadHelp('de');
        expect(de).toEqual(bundle.langs.de);
        expect(getHelpLoaded('de')).toBe(de);
        expect(await loadHelp('de')).toBe(de);
        expect(getHelpLoaded('cs')).toBeNull();
        expect(helpDocInfo()).toEqual({ docVersion: bundle.docVersion, describes: bundle.describes });
    });

    it('finds chapters and rules in any letter case', async () => {
        setEmbeddedHelp(embedded);
        expect(findRule('cs', 'R2.4')).toBeNull(); // not loaded yet
        await loadHelp('cs');
        const rule = findRule('cs', 'r2.4');
        expect(rule?.chapter.id).toBe('R2');
        expect(rule?.block).toMatchObject({ k: 'h', id: 'R2.4' });
        expect(findRule('cs', 'R7')).toMatchObject({ chapter: { id: 'R7' }, block: null });
        expect(getChapter('cs', 'r7')?.id).toBe('R7');
        expect(getChapter('cs', 'R7.6')).toBeNull();
        expect(ruleExists('cs', 'R5.3')).toBe(true);
        expect(ruleExists('cs', 'R9.99')).toBe(false);
        expect(ruleExists('cs', 'nonsense')).toBe(false);
    });

    it('reads English for a language the help does not have', async () => {
        setEmbeddedHelp({ ...embedded, langs: { en: embedded.langs.en } });
        expect(helpLangOf('pl')).toBe('en');
        expect(helpLangOf('xx')).toBe('en');
        expect(await loadHelp('pl')).toEqual(bundle.langs.en);
        expect(ruleExists('pl', 'R2.4')).toBe(true);
    });
});
