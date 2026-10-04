/**
 * Texts never address the user (SPEC "Pravidla textů"): no vykání or
 * tykání in Czech (no "váš", "jste", no imperative to "you"), no "you/your"
 * in English, no "Sie/Ihr" in German — in the groups of texts 3.9 brought
 * (the research, the archive, data protection, backups, sources). Texts for
 * an AI agent or a terminal are the exceptions, named below.
 */

import { describe, it, expect } from 'vitest';
import { getStringsForLang, Language } from '../strings.js';

const GROUPS = ['sync', 'research', 'install', 'treeSettings', 'batch', 'sources', 'snapshots', 'connect', 'researchUpdate',
    'live', 'researchOlder', 'researchEdge', 'material', 'media', 'mediaQueue', 'changes'] as const;

const ADDRESS: Record<'en' | 'cs' | 'de', RegExp> = {
    en: /\b(you|your|yours|yourself)\b/i,
    de: /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)\b/,
    cs: /(?<![\p{L}])(vy|vás|vám|vaše|váš|vaši|vašeho|vašem|vašich|vaším|vašemu|jste|tvůj|tvé|tvoje|tvém|tobě|tvého)(?![\p{L}])|(?<![\p{L}])[\p{L}]+(íte|ete|áte|ějte|ejte|ujte|ěte|něte|ďte|řte|ňte)(?![\p{L}])/iu,
};

/** Per language: texts quoting another program, and words that only look like an address (group.key). */
const EXCEPTIONS: Record<'en' | 'cs' | 'de', Set<string>> = {
    // Chrome's own question, quoted as the browser shows it.
    en: new Set(['install.waitLna', 'connect.textPrompt']),
    // "z dítěte" (of the child) only looks like a verb of address.
    cs: new Set(['researchEdge.estChild']),
    // A sentence-initial "Sie" meaning "it/they" (the changes, the source, the backup, the originals, the research).
    de: new Set(['sync.notWrittenListed', 'sync.notWrittenToast', 'research.reviewIntro', 'treeSettings.guideDesc', 'sources.deleteConfirm',
        'snapshots.restoreConfirm', 'mediaQueue.browserOnly', 'mediaQueue.bridgeDownSince', 'mediaQueue.staleSub']),
};

/** Every text of an object as "path → text"; a function's text is its source (the template it returns). */
function texts(value: unknown, path: string, out: [string, string][]): void {
    if (typeof value === 'string') out.push([path, value]);
    else if (typeof value === 'function') out.push([path, String(value)]);
    else if (Array.isArray(value)) value.forEach((v, i) => texts(v, `${path}.${i}`, out));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) texts(v, `${path}.${k}`, out);
}

describe('texts never address the user', () => {
    for (const lang of ['en', 'cs', 'de'] as const) {
        it(lang, () => {
            const pack = getStringsForLang(lang as Language) as unknown as Record<string, unknown>;
            const found: string[] = [];
            for (const g of GROUPS) {
                const all: [string, string][] = [];
                texts(pack[g], g, all);
                for (const [path, text] of all) {
                    const key = path.replace(/\.\d+$/, '');
                    if (EXCEPTIONS[lang].has(key)) continue;
                    const m = ADDRESS[lang].exec(text);
                    if (m) found.push(`${path}: …${text.slice(Math.max(0, m.index - 30), m.index + 30)}…`);
                }
            }
            expect(found).toEqual([]);
        });
    }
});
