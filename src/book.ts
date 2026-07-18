/**
 * Family book generator. Produces a self-contained, printable HTML document
 * (title page → family tree → "Families" chapters → person index) following the
 * approved template in docs/predlohy/. Pure and DOM-free: the caller supplies
 * the tree SVG (options.treeSvg) so this stays testable.
 *
 * Structure and algorithms are adopted from the F1 prototype
 * (docs/predlohy/kniha-predloha-generator.ts); F2 adds source footnotes,
 * localization, privacy, media dropping and a max-generations limit.
 */

import { StromData, Person, PersonId, Partnership, Source, LifeEvent } from './types.js';
import { applyLivingPrivacy, PrivacyMode } from './privacy.js';
import { stripMedia } from './attachments.js';
import { formatFlexDate, yearOf } from './dates.js';
import { sortLifeEvents } from './events.js';
import { assignGenerations } from './generations.js';
import { getStringsForLang } from './strings.js';
import { personInitials } from './initials.js';

export interface BookOptions {
    title?: string;
    lang: 'cs' | 'en';
    privacyMode: PrivacyMode;
    dropMedia?: boolean;
    maxGenerations?: number;
    /** Tree overview SVG for the "Family tree" page (supplied by the UI). */
    treeSvg?: string;
    /** "compiled …" line (supplied so output is deterministic for tests). */
    dateLabel?: string;
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

type Book = ReturnType<typeof getStringsForLang>['book'];

/** Generate the complete family-book HTML for `data`. */
export function buildFamilyBook(data: StromData, options: BookOptions): string {
    const lang = options.lang;
    const S = getStringsForLang(lang);
    const B: Book = S.book;

    // Privacy + media stripping happen BEFORE anything is rendered.
    let tree = applyLivingPrivacy(data, options.privacyMode);
    if (options.dropMedia) tree = stripMedia(tree);
    const persons = tree.persons;
    const partnerships = tree.partnerships;
    const sources = tree.sources ?? {};

    const name = (p?: Person) => p ? esc(`${p.firstName} ${p.lastName}`.trim()) : '';
    const dates = (p: Person) => {
        const b = formatFlexDate(p.birthDate, lang);
        const d = formatFlexDate(p.deathDate, lang);
        if (!b && !d) return '';
        return `${b ? '* ' + b : ''}${b && d ? ' ' : ''}${d ? '† ' + d : ''}`;
    };
    const placeLine = (p: Person) => {
        const parts: string[] = [];
        if (p.birthPlace) parts.push(`${B.born} ${p.birthPlace}`);
        if (p.deathPlace) parts.push(`${B.died} ${p.deathPlace}`);
        return parts.join(' · ');
    };

    // ---- generation assignment (longest ancestor path, memoized DAG walk) ----
    const gen = assignGenerations(tree);
    const personGen = (id: string) => gen.get(id) ?? 0;

    // ---- chapters: one per partnership WITH children, in REGISTER order ----
    // Classic family-book (Register style) ordering: after a couple's chapter
    // come the families of their children, depth-first, children in birth
    // order — the book reads along the family line instead of sweeping whole
    // generations. Root chapters (couples who are nobody's children within
    // the book) are ordered oldest generation first, then by wedding year,
    // then by the older partner's birth year, then by name (deterministic).
    const withChildren = Object.values(partnerships).filter(u => u.childIds.length > 0);
    const coupleKey = (u: Partnership): [number, number, number, string] => {
        const g = Math.max(personGen(u.person1Id), personGen(u.person2Id));
        const wed = yearOf(u.startDate) ?? 9999;
        const born = Math.min(
            yearOf(persons[u.person1Id]?.birthDate) ?? 9999,
            yearOf(persons[u.person2Id]?.birthDate) ?? 9999);
        const nm = `${persons[u.person1Id]?.lastName ?? ''} ${persons[u.person1Id]?.firstName ?? ''}`;
        return [g, wed, born, nm];
    };
    const cmpCouples = (a: Partnership, b: Partnership): number => {
        const ka = coupleKey(a), kb = coupleKey(b);
        for (let i = 0; i < 3; i++) {
            if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
        }
        return (ka[3] as string).localeCompare(kb[3] as string);
    };

    // A root chapter: neither partner is a child of another chapter couple.
    const chapterChildIds = new Set(withChildren.flatMap(u => u.childIds as string[]));
    const roots = withChildren
        .filter(u => !chapterChildIds.has(u.person1Id) && !chapterChildIds.has(u.person2Id))
        .sort(cmpCouples);

    const unionsOfParent = new Map<string, Partnership[]>();
    for (const u of withChildren) {
        for (const pid of [u.person1Id, u.person2Id]) {
            const list = unionsOfParent.get(pid) ?? [];
            list.push(u);
            unionsOfParent.set(pid, list);
        }
    }

    const byBirth = (a: PersonId, b: PersonId) =>
        (yearOf(persons[a]?.birthDate) ?? 9999) - (yearOf(persons[b]?.birthDate) ?? 9999);

    let chapterUnions: Partnership[] = [];
    const visited = new Set<string>();
    const visit = (u: Partnership): void => {
        if (visited.has(u.id)) return;
        visited.add(u.id);
        chapterUnions.push(u);
        for (const childId of [...u.childIds].sort(byBirth)) {
            for (const childUnion of (unionsOfParent.get(childId) ?? []).sort(cmpCouples)) {
                visit(childUnion);
            }
        }
    };
    for (const root of roots) visit(root);
    // Anything unreachable (defensive: odd graphs) still gets a chapter.
    for (const u of [...withChildren].sort(cmpCouples)) visit(u);

    // maxGenerations: keep chapters within N generations of the oldest.
    if (options.maxGenerations !== undefined) {
        chapterUnions = chapterUnions.filter(u =>
            Math.max(personGen(u.person1Id), personGen(u.person2Id)) < options.maxGenerations!);
    }

    const chapterNo = new Map<string, number>();
    chapterUnions.forEach((u, i) => chapterNo.set(u.id, i + 1));
    const parentChapter = new Map<string, number>();
    for (const u of chapterUnions) {
        const n = chapterNo.get(u.id)!;
        if (!parentChapter.has(u.person1Id)) parentChapter.set(u.person1Id, n);
        if (u.person2Id && !parentChapter.has(u.person2Id)) parentChapter.set(u.person2Id, n);
    }

    // ---- event + source helpers ----
    const eventLabel = (ev: LifeEvent): string => {
        if (ev.type === 'custom') return ev.customLabel ?? '';
        return S.events.types[ev.type] ?? ev.type;
    };
    const formatSource = (src: Source): string =>
        [src.title, src.repository, src.reference].filter(Boolean).map(x => esc(x!)).join(', ');

    // Photo (circular) or initials.
    const photoImg = (p: Person) => p.photo
        ? `<img class="book-portrait" src="${esc(p.photo)}" alt="">`
        : `<div class="book-portrait book-portrait-empty">${esc(personInitials(p.firstName, p.lastName))}</div>`;

    // A person medallion. `cite(id)` returns a footnote-marker string for a
    // source id, collecting per-chapter footnotes as a side effect.
    const personBlock = (p: Person, cite: (sourceId: string) => string) => {
        const events = sortLifeEvents(p.events ?? []);
        const eventHtml = events.map(ev => {
            const label = esc(eventLabel(ev));
            const date = ev.date ? ` ${esc(formatFlexDate(ev.date, lang))}` : '';
            const place = ev.place ? `, ${esc(ev.place)}` : '';
            const note = ev.note ? ` — ${esc(ev.note)}` : '';
            const refs = (ev.sourceIds ?? []).map(cite).join('');
            return `<div class="book-person-event">${label}${date}${place}${note}${refs}</div>`;
        }).join('');
        const personRefs = (p.sourceIds ?? []).map(cite).join('');
        return `
        <div class="book-person">
            ${photoImg(p)}
            <div class="book-person-info">
                <div class="book-person-name">${name(p)}${personRefs}</div>
                <div class="book-person-dates">${esc(dates(p))}</div>
                ${placeLine(p) ? `<div class="book-person-places">${esc(placeLine(p))}</div>` : ''}
                ${eventHtml}
                ${p.notes ? `<div class="book-person-notes">${esc(p.notes)}</div>` : ''}
            </div>
        </div>`;
    };

    const chapters = chapterUnions.map(u => {
        const p1 = persons[u.person1Id];
        const p2 = persons[u.person2Id];
        const n = chapterNo.get(u.id)!;

        // Per-chapter footnotes: source id -> local number, in first-seen order.
        const footnoteNo = new Map<string, number>();
        const cite = (sourceId: string): string => {
            if (!sources[sourceId]) return '';
            let no = footnoteNo.get(sourceId);
            if (no === undefined) { no = footnoteNo.size + 1; footnoteNo.set(sourceId, no); }
            return `<sup class="book-fn-ref">[${no}]</sup>`;
        };

        const married = u.startDate
            ? `⚭ ${esc(formatFlexDate(u.startDate, lang))}${u.startPlace ? `, ${esc(u.startPlace)}` : ''}`
            : (u.startPlace ? `⚭ ${esc(u.startPlace)}` : '');
        const coupleHtml = `${p1 ? personBlock(p1, cite) : ''}${p2 ? personBlock(p2, cite) : ''}`;
        const children = u.childIds.map(cid => {
            const c = persons[cid];
            if (!c) return '';
            const ref = parentChapter.get(cid);
            return `<li>${name(c)}${dates(c) ? ` <span class="book-muted">(${esc(dates(c))})</span>` : ''}${ref ? ` <span class="book-chapter-ref">→ ${B.chapterShort} ${ref}</span>` : ''}</li>`;
        }).join('');

        // Footnotes are collected during coupleHtml rendering above.
        const footnotes = [...footnoteNo.entries()]
            .map(([sid, no]) => `<div class="book-footnote">[${no}] ${formatSource(sources[sid])}</div>`)
            .join('');

        return `
        <section class="book-chapter">
            <h2><span class="book-chapter-num">${n}</span> ${name(p1)}${p2 ? ` <span class="book-amp">&amp;</span> ${name(p2)}` : ''}</h2>
            ${married ? `<div class="book-marriage-line">${married}</div>` : ''}
            ${u.note ? `<div class="book-marriage-note">${esc(u.note)}</div>` : ''}
            <div class="book-couple">${coupleHtml}</div>
            ${children ? `<div class="book-children"><h3>${esc(B.children)}</h3><ul>${children}</ul></div>` : ''}
            ${footnotes ? `<div class="book-footnotes"><h3>${esc(B.sources)}</h3>${footnotes}</div>` : ''}
        </section>`;
    }).join('\n');

    // ---- index: every non-placeholder person that appears in the book ----
    const inBook = (p: Person): boolean => {
        if (options.maxGenerations === undefined) return true;
        if (parentChapter.has(p.id)) return true;
        return chapterUnions.some(u => u.childIds.includes(p.id));
    };
    const indexRows = Object.values(persons)
        .filter(p => !p.isPlaceholder && inBook(p))
        .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, lang))
        .map(p => {
            const refs = new Set<number>();
            const pc = parentChapter.get(p.id);
            if (pc) refs.add(pc);
            for (const u of chapterUnions) if (u.childIds.includes(p.id)) refs.add(chapterNo.get(u.id)!);
            const refStr = [...refs].sort((a, b) => a - b).join(', ');
            const indexName = p.lastName ? `${p.lastName}, ${p.firstName}` : p.firstName;
            return `<div class="book-index-row"><span>${esc(indexName)}</span><span class="book-dots"></span><span class="book-muted">${esc(dates(p)) || '—'}</span>${refStr ? `<span class="book-index-ref">${B.chapterShort} ${refStr}</span>` : ''}</div>`;
        }).join('');

    // ---- title-page stats ----
    const indexedPersons = Object.values(persons).filter(p => !p.isPlaceholder && inBook(p));
    const personCount = indexedPersons.length;
    const years = indexedPersons.map(p => yearOf(p.birthDate)).filter((y): y is number => y !== null);
    const span = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '';
    const generations = gen.size ? Math.max(...gen.values()) + 1 : 0;

    const title = esc(options.title || B.title);
    const compiled = options.dateLabel ? esc(options.dateLabel) : '';

    return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${esc(B.title)} — ${title}</title>
<style>
    :root { --book-ink: #2b2620; --book-accent: #8b6f47; --book-rule: #c9b99a; }
    .book-page * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; color: var(--book-ink); background: #f4efe6; }
    .book-page { max-width: 700px; margin: 0 auto; padding: 48px 56px; background: #fffdf8; }
    @media screen { .book-page { box-shadow: 0 2px 14px rgba(0,0,0,.12); margin: 24px auto; } }

    .book-title-page { text-align: center; display: flex; flex-direction: column; justify-content: center; min-height: 85vh; }
    .book-title-ornament { color: var(--book-accent); font-size: 22px; letter-spacing: .6em; margin: 18px 0; }
    .book-title-page h1 { font-size: 44px; font-weight: normal; letter-spacing: .06em; margin: 10px 0 4px; }
    .book-title-sub { font-style: italic; color: #6b6154; font-size: 17px; }
    .book-title-rule { width: 140px; border: 0; border-top: 1px solid var(--book-rule); margin: 26px auto; }
    .book-title-meta { color: #8a8070; font-size: 13px; line-height: 1.9; }

    .book-tree-page h2, .book-index-page h2, .book-families h2 { font-size: 24px; font-weight: normal; border-bottom: 1px solid var(--book-rule); padding-bottom: 8px; margin-bottom: 18px; }
    .book-tree-wrap { overflow: hidden; border: 1px solid var(--book-rule); }
    .book-tree-wrap svg { width: 100%; height: auto; display: block; }
    .book-tree-hint { font-size: 12px; color: #8a8070; margin-top: 8px; font-style: italic; }

    .book-chapter { margin: 34px 0; break-inside: avoid; }
    .book-chapter h2 { font-size: 21px; font-weight: normal; border-bottom: 1px solid var(--book-rule); padding-bottom: 6px; margin-bottom: 4px; }
    .book-chapter-num { display: inline-block; min-width: 30px; color: var(--book-accent); }
    .book-amp { color: var(--book-accent); }
    .book-marriage-line { font-size: 13.5px; color: #6b6154; margin: 4px 0 2px 30px; }
    .book-marriage-note { font-size: 13px; font-style: italic; color: #6b6154; margin: 2px 0 0 30px; }
    .book-couple { display: flex; gap: 24px; margin: 14px 0 0 30px; }
    .book-person { flex: 1; display: flex; gap: 10px; min-width: 0; }
    .book-portrait { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; flex: none; border: 1px solid var(--book-rule); }
    .book-portrait-empty { display: flex; align-items: center; justify-content: center; background: #efe7d8; color: var(--book-accent); font-size: 16px; }
    .book-person-name { font-weight: bold; font-size: 14.5px; }
    .book-person-dates { font-size: 13px; color: #6b6154; }
    .book-person-places, .book-person-event { font-size: 12.5px; color: #6b6154; }
    .book-person-event::before { content: '· '; color: var(--book-accent); }
    .book-person-notes { font-size: 12.5px; font-style: italic; margin-top: 4px; line-height: 1.45; }
    .book-fn-ref { color: var(--book-accent); font-size: 10px; }
    .book-children { margin: 12px 0 0 30px; }
    .book-children h3, .book-footnotes h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .14em; color: var(--book-accent); font-weight: normal; margin-bottom: 4px; }
    .book-children ul { list-style: none; }
    .book-children li { font-size: 13.5px; line-height: 1.75; }
    .book-children li::before { content: '— '; color: var(--book-rule); }
    .book-chapter-ref, .book-index-ref { font-size: 11.5px; color: var(--book-accent); white-space: nowrap; }
    .book-muted { color: #8a8070; }
    .book-footnotes { margin: 12px 0 0 30px; border-top: 1px solid var(--book-rule); padding-top: 6px; }
    .book-footnote { font-size: 11.5px; color: #6b6154; line-height: 1.6; }

    .book-index-row { display: flex; align-items: baseline; gap: 8px; font-size: 13px; line-height: 1.9; }
    .book-index-row .book-dots { flex: 1; border-bottom: 1px dotted var(--book-rule); }

    /* Floating toolbar: the book opens in its own window/view — standalone
       PWAs have no browser chrome, so it must carry its own Close + Print. */
    .book-toolbar {
        position: fixed; top: 10px; right: 10px; z-index: 10;
        display: flex; gap: 8px;
    }
    .book-toolbar button {
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        padding: 9px 14px; border-radius: 18px; border: 1px solid #cfc7b8;
        background: rgba(255,255,255,0.92); color: #4a4436; cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.12);
    }
    .book-toolbar button:hover { background: #fff; }

    @page { size: A4; margin: 18mm 16mm; }
    @media print {
        .book-toolbar { display: none; }
        body { background: #fff; }
        .book-page { max-width: none; box-shadow: none; margin: 0; padding: 0; background: #fff; }
        .book-page-break { break-before: page; }
        .book-title-page { min-height: 90vh; }
        .book-chapter { break-inside: avoid; }
    }
</style></head><body>

<div class="book-toolbar">
    <button type="button" onclick="window.print()">🖨 ${esc(B.toolbarPrint)}</button>
    <button type="button" onclick="window.close(); setTimeout(function(){ if (!window.closed) history.back(); }, 200)">✕ ${esc(B.toolbarClose)}</button>
</div>

<div class="book-page book-title-page">
    <div class="book-title-ornament">❦</div>
    <h1>${title}</h1>
    <div class="book-title-sub">${esc(B.subtitle)}</div>
    <hr class="book-title-rule">
    <div class="book-title-meta">
        ${personCount} ${esc(B.persons)} · ${generations} ${esc(B.generations)}${span ? ` · ${esc(span)}` : ''}${compiled ? `<br>${compiled}` : ''}
    </div>
    <div class="book-title-ornament">❦</div>
</div>

${options.treeSvg ? `<div class="book-page book-tree-page book-page-break">
    <h2>${esc(B.tree)}</h2>
    <div class="book-tree-wrap">${options.treeSvg}</div>
    <div class="book-tree-hint">${esc(B.treeHint)}</div>
</div>` : ''}

<div class="book-page book-families book-page-break">
    <h2>${esc(B.families)}</h2>
    ${chapters}
</div>

<div class="book-page book-index-page book-page-break">
    <h2>${esc(B.index)}</h2>
    ${indexRows}
</div>

</body></html>`;
}
