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
    // The sample message the sender writes to a relative.
    en: new Set(['share.messagePlaceholder']),
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

/**
 * German names the people a file goes to or comes from without the generic
 * masculine ("der Empfänger", "er öffnet sie"): "Verwandte", "beim Öffnen".
 * A document role of the read results ("addressee" of a letter) is a term.
 */
describe('German texts about the people a file goes to are gender-neutral', () => {
    const MASCULINE = /\b(Empfänger|Empfängers|Absender|Absenders|einen Verwandten|einem Verwandten|Ein Verwandter)\b|\ber (öffnet|ergänzt|weiß|schickt)\b/;
    const TERMS = new Set(['read.roles.addressee']);
    it('de', () => {
        const pack = getStringsForLang('de' as Language) as unknown as Record<string, unknown>;
        const found: string[] = [];
        for (const g of Object.keys(pack)) {
            const all: [string, string][] = [];
            texts(pack[g], g, all);
            for (const [path, text] of all) {
                if (TERMS.has(path)) continue;
                const m = MASCULINE.exec(text);
                if (m) found.push(`${path}: …${text.slice(Math.max(0, m.index - 30), m.index + 30)}…`);
            }
        }
        expect(found).toEqual([]);
    });
});

/**
 * Czech names the people a file goes to or comes from without the generic
 * masculine ("příbuznému", "příjemce", "odesílatele"): "rodině", "při otevření",
 * "Někdo z rodiny". A document role of the read results is a term; a godparent
 * who "bývá příbuzný" is a person in a record, not the reader.
 */
describe('Czech texts about the people a file goes to are gender-neutral', () => {
    const MASCULINE = /(?<![\p{L}])(příbuznému|Příbuzný|[Pp]říjemce|příjemci|[Oo]desílatel|odesílatele|odesílateli)(?![\p{L}])/u;
    it('cs', () => {
        const pack = getStringsForLang('cs' as Language) as unknown as Record<string, unknown>;
        const found: string[] = [];
        for (const g of Object.keys(pack)) {
            const all: [string, string][] = [];
            texts(pack[g], g, all);
            for (const [path, text] of all) {
                if (path.startsWith('read.roles.')) continue;
                const m = MASCULINE.exec(text);
                if (m) found.push(`${path}: …${text.slice(Math.max(0, m.index - 30), m.index + 30)}…`);
            }
        }
        expect(found).toEqual([]);
    });
});

/**
 * The unknown-sender fallback ("Někdo z rodiny", "A relative", "Ein
 * Familienmitglied") is a whole phrase that cannot be declined or lowercased:
 * every sentence with the sender's name starts with it or quotes it after a
 * colon or in parentheses (a real name is not declined there either).
 */
describe('Sentences with the sender name read well with the unknown sender', () => {
    for (const lang of ['en', 'cs', 'de'] as const) {
        it(lang, () => {
            const s = getStringsForLang(lang as Language);
            const who = s.share.unknownSender;
            const sentences = [
                s.share.welcomeTitle(who), s.share.collabBar(who), s.share.replyTitle(who),
                s.shareDiff.previewTitle(who), s.auditLog.appliedChanges(who), s.undo.applyChanges(who),
            ];
            const bad = sentences.filter(t => !(t.startsWith(who) || t.includes(`: ${who}`) || t.includes(`(${who})`)));
            expect(bad).toEqual([]);
        });
    }
});
