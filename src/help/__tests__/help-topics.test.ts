import { describe, expect, it } from 'vitest';
import { convertHelp } from '../help-convert.js';
import { HELP_LANGS, type HelpBlock, type HelpBundle } from '../help-types.js';
import { HELP_TOPICS } from '../topics.js';
import { readHelpSources, VENDOR_DIR, vendorPin } from './help-sources.js';

/** Every chapter and rule number of each language of a bundle. */
function numbersOf(bundle: HelpBundle): Record<string, Set<string>> {
    const out: Record<string, Set<string>> = {};
    const visit = (set: Set<string>, blocks: HelpBlock[]): void => {
        for (const b of blocks) {
            if (b.k === 'h') set.add(b.id);
            else if (b.k === 'quote') visit(set, b.blocks);
        }
    };
    for (const lang of HELP_LANGS) {
        const set = new Set<string>();
        for (const c of bundle.langs[lang].chapters) {
            set.add(c.id);
            visit(set, c.blocks);
        }
        out[lang] = set;
    }
    return out;
}

function expectTopicsIn(bundle: HelpBundle): void {
    const numbers = numbersOf(bundle);
    for (const [topic, id] of Object.entries(HELP_TOPICS)) {
        for (const lang of HELP_LANGS) expect(numbers[lang].has(id), `${topic} → ${id} in ${lang}`).toBe(true);
    }
}

describe('help topics', () => {
    it('lead to numbers the embedded help has in all four languages', () => {
        expectTopicsIn(convertHelp(readHelpSources(VENDOR_DIR), vendorPin()));
    });
});

// CI runs this against a fresh clone of strom-doc main (job help-topics-main):
// a number renamed or removed there shows up before the next pin.
describe.skipIf(!process.env.STROM_DOC_MAIN_DIR)('help topics against strom-doc main', () => {
    it('lead to numbers strom-doc main has in all four languages', () => {
        expectTopicsIn(convertHelp(readHelpSources(process.env.STROM_DOC_MAIN_DIR!), 'main'));
    });
});
