/**
 * The sources a story rests on (Story.sources: the sources of its facts and of
 * its background, GEDCOM `2 SOUR @S…@` under _STORY, `3 SOUR` under _DRAFT),
 * and the research's bare source codes in a story's text ("[S0164]") named by
 * the source's title. Pure and DOM-free: the story reader, the person page,
 * the family book and the comparison of versions share it.
 */

import type { Source, Story } from './types.js';
import { safeHttpUrl } from './validation.js';

type Catalog = Readonly<Record<string, Source>> | undefined;

/** A source as a story shows it: its title and, when it has a web address, a safe link. */
export interface StorySourceShown {
    id: string;
    title: string;
    href: string | null;
}

/** The story's sources that the tree holds, in their order, each once. */
export function storySourcesShown(catalog: Catalog, ids: readonly string[] | undefined): StorySourceShown[] {
    const out: StorySourceShown[] = [];
    const seen = new Set<string>();
    for (const id of ids ?? []) {
        const s = catalog?.[id];
        if (!s || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, title: s.title?.trim() || '?', href: safeHttpUrl(s.url) });
    }
    return out;
}

/** "[S0164]", "(S0164)", "[S0001, S0002]": a bracket that holds research source codes only. */
const CODE_GROUP = /([[(])\s*(S\d{2,9}(?:\s*[,;]\s*S\d{2,9})*)\s*([\])])/g;

/**
 * A namer of bare source codes over one catalog (built once, for many texts):
 * a bracket of codes becomes the sources' titles in parentheses ("Lhotečka
 * [S0002]" → "Lhotečka (Dějiny hasičů ve Lhotě)"). A code the tree has no
 * source for leaves its bracket exactly as it was.
 */
export function sourceCodeNamer(catalog: Catalog): (text: string) => string {
    let byRefn: Map<string, string> | null = null;
    const titles = (): Map<string, string> => {
        if (byRefn) return byRefn;
        byRefn = new Map();
        for (const s of Object.values(catalog ?? {})) {
            const refn = s.refn?.trim();
            if (refn && !byRefn.has(refn)) byRefn.set(refn, s.title?.trim() || '');
        }
        return byRefn;
    };
    return (text: string): string => {
        if (!text || !catalog) return text;
        return text.replace(CODE_GROUP, (m, open: string, codes: string, close: string) => {
            if ((open === '[') !== (close === ']')) return m;
            const named = codes.split(/\s*[,;]\s*/).map(code => titles().get(code));
            if (named.some(t => !t)) return m;
            return `(${[...new Set(named)].join('; ')})`;
        });
    };
}

/** One text's bare source codes named by their titles (see sourceCodeNamer). */
export function nameSourceCodes(text: string, catalog: Catalog): string {
    return sourceCodeNamer(catalog)(text);
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The "Based on sources" block under a story: the heading and one line per
 * source, its title a link to its web address (a new window, ↗ as any web
 * link) when it has one. `link: false` (print): the title alone. `after` adds
 * to a line (the family book's source number). '' when nothing is listed.
 */
export function storySourcesHtml(list: readonly StorySourceShown[], heading: string,
    o: { cls: string; link?: boolean; after?: (id: string) => string }): string {
    if (!list.length) return '';
    const items = list.map(s => {
        const title = o.link !== false && s.href
            ? `<a href="${esc(s.href)}" rel="noopener noreferrer" target="_blank">${esc(s.title)} ↗</a>`
            : esc(s.title);
        return `<li>${title}${o.after?.(s.id) ?? ''}</li>`;
    }).join('');
    return `<div class="${o.cls}"><p class="${o.cls}-h">${esc(heading)}</p><ul class="${o.cls}-list">${items}</ul></div>`;
}

/**
 * Rewrite the source ids of a story and of its waiting new version in place:
 * `fix` returns the ids to keep (none: the field goes). For removing a source
 * from the tree, merging duplicate sources, a copy without sources.
 */
export function rewriteStorySources(story: Story | undefined, fix: (ids: string[]) => string[]): void {
    if (!story) return;
    for (const holder of [story, story.draft]) {
        if (!holder?.sources) continue;
        const kept = [...new Set(fix(holder.sources))];
        if (kept.length) holder.sources = kept;
        else delete holder.sources;
    }
}

/** The source ids a story cites (its own and its waiting new version's). */
export function storySourceIds(story: Story | undefined): string[] {
    return [...(story?.sources ?? []), ...(story?.draft?.sources ?? [])];
}
