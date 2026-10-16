/**
 * "What's new" after an update — the pure, testable half: the changelog
 * section of a version, its small markdown subset, and the decision when the
 * dialog appears. The DOM half lives in src/ui/release-notes-ui.ts.
 *
 * The section of the running version is cut out of CHANGELOG.md /
 * CHANGELOG.cs.md / CHANGELOG.de.md at build time (scripts/bundle.js runs
 * changelogSection on each file) and embedded in the bundle: the dialog never
 * asks a server for anything and works offline.
 */

/** Languages with a changelog file of their own; any other UI language reads the English one. */
export type ChangelogLanguage = 'en' | 'cs' | 'de';

export const CHANGELOG_LANGUAGES: ChangelogLanguage[] = ['en', 'cs', 'de'];

/** The changelog file of a changelog language (en → CHANGELOG.md, cs → CHANGELOG.cs.md, …). */
export function changelogFileName(lang: ChangelogLanguage): string {
    return lang === 'en' ? 'CHANGELOG.md' : `CHANGELOG.${lang}.md`;
}

/** The changelog language of a UI language. */
export function changelogLanguageOf(lang: string): ChangelogLanguage {
    return lang === 'cs' || lang === 'de' ? lang : 'en';
}

/** What the build embeds: the version and its section per changelog language (null: none). */
export interface EmbeddedReleaseNotes {
    version: string;
    sections: Partial<Record<ChangelogLanguage, string | null>>;
}

/**
 * The version a changelog section is headed with: a pre-release or build
 * suffix is dropped, so 3.12.0-beta.5 reads the section "## 3.12.0".
 */
export function releaseVersion(version: string): string {
    return version.trim().split(/[-+]/)[0];
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The body of the version's section in a changelog: the lines under
 * "## X.Y.Z" up to the next heading of the same or a higher level, trimmed.
 * Null when the changelog has no such section or it is empty.
 */
export function changelogSection(markdown: string, version: string): string | null {
    const wanted = releaseVersion(version);
    if (!wanted) return null;
    const heading = new RegExp(`^##\\s+v?${escapeRegExp(wanted)}(?![0-9A-Za-z.-])`);
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const start = lines.findIndex(line => heading.test(line.trim()));
    if (start === -1) return null;
    const body: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
        if (/^#{1,2}\s/.test(lines[i])) break;
        body.push(lines[i]);
    }
    const text = body.join('\n').trim();
    return text === '' ? null : text;
}

/** A run of text: plain, **bold**, *italic* or `code`. */
export interface NotesInline {
    text: string;
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
}

/** A bullet point or a paragraph of the section. */
export interface NotesBlock {
    kind: 'item' | 'para';
    inline: NotesInline[];
}

/**
 * The inline subset: **bold**, *italic* (also __bold__ and _italic_) and
 * `code` (its content literal, no emphasis inside); everything else stays
 * literal text, so nothing in the changelog can become markup in the page.
 */
export function parseInline(text: string): NotesInline[] {
    const out: NotesInline[] = [];
    const re = /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s](?:[^*]*?[^*\s])?)\*|(?<![\p{L}\p{N}])_([^_\s](?:[^_]*?[^_\s])?)_(?![\p{L}\p{N}])/gu;
    let last = 0;
    let m: RegExpExecArray | null;
    const push = (part: NotesInline): void => {
        if (part.text === '') return;
        const prev = out[out.length - 1];
        if (prev && !prev.bold && !prev.italic && !prev.code && !part.bold && !part.italic && !part.code) prev.text += part.text;
        else out.push(part);
    };
    while ((m = re.exec(text)) !== null) {
        push({ text: text.slice(last, m.index) });
        if (m[1] !== undefined) push({ text: m[1], code: true });
        else if (m[2] !== undefined || m[3] !== undefined) push({ text: m[2] ?? m[3], bold: true });
        else push({ text: m[4] ?? m[5], italic: true });
        last = m.index + m[0].length;
    }
    push({ text: text.slice(last) });
    return out;
}

/** A paragraph that is italic as a whole: the "in preparation" note, left out of the dialog. */
function isNoteParagraph(text: string): boolean {
    return /^\*[^*](?:[\s\S]*[^*])?\*$/.test(text) || /^_[^_](?:[\s\S]*[^_])?_$/.test(text);
}

/**
 * The blocks of a section: "- " / "* " bullet points (continuation lines
 * joined) and paragraphs; a paragraph written entirely in italics (the note
 * that a version is in preparation) is left out. "### Sub-heading" lines
 * become bold paragraphs.
 */
export function parseReleaseNotes(section: string): NotesBlock[] {
    const blocks: NotesBlock[] = [];
    let current: { kind: 'item' | 'para'; text: string } | null = null;
    const flush = (): void => {
        if (!current) return;
        const text = current.text.trim();
        if (text !== '' && !(current.kind === 'para' && isNoteParagraph(text))) {
            blocks.push({ kind: current.kind, inline: parseInline(text) });
        }
        current = null;
    };
    for (const raw of section.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trim();
        if (line === '') { flush(); continue; }
        const bullet = /^[-*+]\s+(.*)$/.exec(line);
        const sub = /^#{3,6}\s+(.*)$/.exec(line);
        if (sub) {
            flush();
            blocks.push({ kind: 'para', inline: [{ text: sub[1].replace(/\s*#+$/, ''), bold: true }] });
        } else if (bullet) {
            flush();
            current = { kind: 'item', text: bullet[1] };
        } else if (current) {
            current.text += ' ' + line;
        } else {
            current = { kind: 'para', text: line };
        }
    }
    flush();
    return blocks;
}

/**
 * The notes to show for a UI language: the section of its changelog
 * language, else the English one; null when neither has anything to show.
 */
export function releaseNotesFor(embedded: EmbeddedReleaseNotes | null, uiLang: string): NotesBlock[] | null {
    if (!embedded) return null;
    const own = changelogLanguageOf(uiLang);
    for (const lang of own === 'en' ? ['en' as const] : [own, 'en' as const]) {
        const section = embedded.sections[lang];
        if (!section) continue;
        const blocks = parseReleaseNotes(section);
        if (blocks.length > 0) return blocks;
    }
    return null;
}

/** Everything the "What's new" decision looks at. */
export interface ReleaseNotesContext {
    /** The version last recorded as seen in this browser (null: never). */
    seenVersion: string | null;
    /** The running version (APP_VERSION). */
    currentVersion: string;
    /** This browser held tree data when the app started (any tree with persons). */
    hasData: boolean;
    /** The setting "What's new after an update" is on. */
    enabled: boolean;
    /** Something is in the way: a dialog, the tour, the update toast, a locked start… */
    busy: boolean;
    /** A standalone file with embedded data or a read-only view: nothing was updated here. */
    embedded: boolean;
    /** The build carries notes of this version. */
    hasNotes: boolean;
}

/**
 * - `show`: show the dialog now;
 * - `mark-seen`: record the running version as seen without showing anything
 *   (a new user, the setting off, no notes for this version);
 * - `wait`: not now, ask again when the app is free;
 * - `skip`: nothing to do here (already seen, or an embedded file).
 */
export type ReleaseNotesDecision = 'show' | 'mark-seen' | 'wait' | 'skip';

export function decideReleaseNotes(ctx: ReleaseNotesContext): ReleaseNotesDecision {
    if (ctx.embedded) return 'skip';
    if (ctx.seenVersion === ctx.currentVersion) return 'skip';
    // A first start with nothing stored: a new user, not an update. An
    // existing user coming from a version before this dialog has no seen
    // version either, but has trees.
    if (ctx.seenVersion === null && !ctx.hasData) return 'mark-seen';
    if (!ctx.enabled || !ctx.hasNotes) return 'mark-seen';
    if (ctx.busy) return 'wait';
    return 'show';
}
