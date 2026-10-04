/**
 * Texts never address the user (SPEC "Pravidla textů"): no vykání or
 * tykání in Czech (no "váš", "jste", no imperative to "you"), no "you/your"
 * in English, no "Sie/Ihr" or "du" in German — in every group of texts.
 * Texts for an AI agent or a terminal are the exceptions, named below.
 */

import { describe, it, expect } from 'vitest';
import { getStringsForLang, Language } from '../strings.js';

const ADDRESS: Record<'en' | 'cs' | 'de', RegExp> = {
    en: /\b(you|your|yours|yourself)\b/i,
    de: /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen|du|dein|deine|deinen|deinem|deiner|dir|dich)\b/,
    // Pronouns; verbs of the second person: the plural imperative ("vyberte", "spusťte", "zkuste"),
    // the present ("máte"), the singular ("pošleš", "vyžádej"). "jej" and "dítěte" only look like them.
    cs: new RegExp('(?<![\\p{L}])(vy|vás|vám|vámi|vaše|váš|vaši|vaší|vašeho|vašem|vašich|vaším|vašim|vašemu|jste|byste|tvůj|tvé|tvoje|tvoji|tvou|tvá|tvém|tvým|tvých|tvému|tobě|tebe|tebou|tvého|ti|tě)(?![\\p{L}])'
        + '|(?<![\\p{L}])(?!(?:jej|dítěte)(?![\\p{L}]))[\\p{L}]+(rte|ťte|žte|zte|dte|nte|cte|uste|ijte|lte|pte|šte|hte|vte|mte|bte|íte|ete|áte|ějte|ejte|ujte|ěte|ďte|řte|ňte'
        + '|uješ|(?<!sp|li)íš|eš|áš|ej)(?![\\p{L}])', 'iu'),
};

/** Per language: texts quoting another program, and words that only look like an address (group.key). */
const EXCEPTIONS: Record<'en' | 'cs' | 'de', Set<string>> = {
    // Chrome's own question, quoted as the browser shows it; the sample message the sender writes to a relative.
    en: new Set(['install.waitLna', 'connect.textPrompt', 'share.messagePlaceholder']),
    // The sample message the sender writes to a relative.
    cs: new Set(['share.messagePlaceholder']),
    // A sentence-initial "Sie" meaning "it/they" (the changes, the source, the backup, the originals, the research).
    de: new Set(['sync.notWrittenListed', 'sync.notWrittenToast', 'research.reviewIntro', 'treeSettings.guideDesc', 'sources.deleteConfirm',
        'snapshots.restoreConfirm', 'mediaQueue.browserOnly', 'mediaQueue.bridgeDownSince', 'mediaQueue.staleSub',
        // The sample message the sender writes to a relative.
        'share.messagePlaceholder']),
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
            for (const g of Object.keys(pack)) {
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
