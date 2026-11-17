/**
 * A source and the files it is taken from (spec 102 §5–§7):
 *
 * - "Create a source from this file…" (§5): the source editor opens filled
 *   in from the file (its title, its date), the file as the source's evidence
 *   and "Cite at" (the person it came from, the event of a record whose year
 *   fits). Saving is one undo step: the source, the evidence, the citation.
 *   Material outside the tree is linked with its working copy (as §4).
 * - "Evidence from the person's materials" (§6): a new source opened from a
 *   person offers the person's files as its evidence.
 * - The source viewer's "Taken from" (§7): the evidence rows, the note when
 *   there is none and "Link evidence…".
 *
 * The evidence is the place `{ sourceId }` of a file of the tree
 * (data v24); the file is never stored twice.
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { Attachment, MediaPlace, PartnershipId, Person, PersonId, Source, SourceExcerpt } from '../types.js';
import { strings } from '../strings.js';
import { MaterialItem, attachmentItem, materialDate, materialKindLabel, materialSystemLink, materialType } from '../materials.js';
import { announcedResearchScheme } from '../research-device.js';
import { researchLinkMark } from '../research-link.js';
import { researchActionLabel } from './research-open-mark.js';
import { materialThumbs } from '../material-thumbs.js';
import { findMedia, mediaOf, mediaPersonIds, mediaSourceIds } from '../media.js';
import { formatFlexDate, parseFlexDate, yearOf } from '../dates.js';
import { parseGedcomDate } from '../gedcom-date-read.js';
import { eventTypeLabel } from './person-events.js';
import { coupleEventLabel } from '../events.js';
import { materialItemSha, materialTileLetters } from './materials-ui.js';
import { attachmentPdf, openPdfBlob } from './material-viewer-ui.js';
import { closeImageViewer } from './image-viewer.js';
import { uiModule } from './module.js';

/** A file staged as the source's evidence in the editor. */
interface DocDraft {
    /** The record's id, or `pending:N` for material outside the tree (linked on Save). */
    key: string;
    /** Material outside the tree: its working copy, a file of the tree on Save. */
    record?: Omit<Attachment, 'id' | 'places'>;
    /** The offer's item this draft came from (its key), to show it chosen. */
    itemKey?: string;
}

/** "Cite at": the person (null: cite nowhere) and the event (null: the person). */
interface CiteDraft {
    from: PersonId;
    personId: PersonId | null;
    place: MediaPlace | null;
}

/** What "Create a source from this file…" hands the editor before it opens. */
interface DocSeed {
    docs: DocDraft[];
    cite: CiteDraft | null;
    fromTitle: boolean;
}

/** Over this many files the offer has a search field and scrolls (6b). */
const OFFER_SEARCH_OVER = 12;

let docs: DocDraft[] = [];
let docsAtOpen: string[] = [];
let cite: CiteDraft | null = null;
let seed: DocSeed | null = null;
let fromTitle = false;
/** The editor was opened by "Create a source from this file…". */
let fromFile = false;
let offerShown = false;
let offerNext = false;
let offerQuery = '';
let offerAll = false;
let pendingN = 0;
/** Items of the offer being fetched (their working copy). */
const fetching = new Set<string>();

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fullName(p: Pick<Person, 'firstName' | 'lastName'> | undefined | null): string {
    return p ? `${p.firstName} ${p.lastName}`.trim() : '';
}

/** A file's date as a source's record date (flex form), if it can be read. */
export function recordDateOfFile(date: string | undefined): string | undefined {
    if (!date) return undefined;
    // A material's date is a GEDCOM date ("3 FEB 1901"); the record date is the app's.
    const flex = parseGedcomDate(date);
    if (flex && parseFlexDate(flex)) return flex;
    return parseFlexDate(date) ? date : undefined;
}

/** The events of a person "Cite at" offers: birth, baptism and other events, marriages, death. */
export function citeEventPlaces(person: Person): MediaPlace[] {
    const out: MediaPlace[] = [{ personId: person.id, fact: 'birth' }];
    for (const ev of person.events ?? []) out.push({ personId: person.id, eventId: ev.id });
    for (const uid of person.partnerships ?? []) {
        const union = DataManager.getPartnership(uid);
        if (!union) continue;
        out.push({ partnershipId: uid as PartnershipId });
        for (const ev of union.events ?? []) out.push({ partnershipId: uid as PartnershipId, eventId: ev.id });
    }
    if (person.deathDate || person.deathPlace || person.isDeceased) out.push({ personId: person.id, fact: 'death' });
    return out;
}

/** The date of a place's event (birth, death, an event, the wedding). */
function placeDate(place: MediaPlace): string | undefined {
    if ('personId' in place) {
        const p = DataManager.getPerson(place.personId);
        if (place.fact === 'birth') return p?.birthDate;
        if (place.fact === 'death') return p?.deathDate;
        return p?.events?.find(e => e.id === place.eventId)?.date;
    }
    if ('partnershipId' in place) {
        const u = DataManager.getPartnership(place.partnershipId);
        return place.eventId ? u?.events?.find(e => e.id === place.eventId)?.date : u?.startDate;
    }
    return undefined;
}

/** An event's name in "Cite at" and the toast (without the date). */
function citeEventName(place: MediaPlace, personId: PersonId): string {
    if ('personId' in place) {
        if (place.fact) return strings.events.types[place.fact];
        const ev = DataManager.getPerson(place.personId)?.events?.find(e => e.id === place.eventId);
        return ev ? eventTypeLabel(ev) : '';
    }
    if ('partnershipId' in place) {
        const u = DataManager.getPartnership(place.partnershipId);
        if (place.eventId) {
            const ev = u?.events?.find(e => e.id === place.eventId);
            return ev ? coupleEventLabel(ev) : '';
        }
        const other = u ? (u.person1Id === personId ? u.person2Id : u.person1Id) : null;
        return strings.sources.citeMarriage(fullName(other ? DataManager.getPerson(other) : null));
    }
    return '';
}

function citeOptionLabel(place: MediaPlace, personId: PersonId): string {
    const name = citeEventName(place, personId);
    const date = placeDate(place);
    return date ? `${name} · ${formatFlexDate(date)}` : name;
}

/** The event of a record whose year is the file's (a birth certificate of 1901 → Birth 1901). */
export function preselectCitePlace(person: Person, kind: string | undefined, date: string | undefined): MediaPlace | null {
    if (kind !== 'record') return null;
    const year = yearOf(recordDateOfFile(date));
    if (year === null) return null;
    return citeEventPlaces(person).find(p => yearOf(placeDate(p)) === year) ?? null;
}

function placeKey(p: MediaPlace): string {
    if ('personId' in p) return `p:${p.personId}:${p.fact ?? ''}:${p.eventId ?? ''}`;
    if ('partnershipId' in p) return `u:${p.partnershipId}:${p.eventId ?? ''}`;
    return `s:${p.sourceId}`;
}

/** A draft's record: the tree's (by id) or the working copy. */
function draftRecord(d: DocDraft): (Omit<Attachment, 'id' | 'places'> & { id?: string; places?: Attachment['places'] }) | undefined {
    return d.record ?? DataManager.getMedia(d.key);
}

function isImage(rec: { mimeType: string; originalOnly?: boolean; dataUrl?: string } | undefined): boolean {
    return !!rec && rec.mimeType.startsWith('image/') && !rec.originalOnly && !!rec.dataUrl;
}

/** "name · kind · date" of a file. */
function fileMeta(rec: Omit<Attachment, 'id' | 'places'>): string {
    const kind = materialKindLabel({ kind: rec.kind, mime: rec.original?.mimeType ?? rec.mimeType, file: undefined, attachment: undefined, name: rec.name });
    return [rec.name, kind, rec.date ? materialDate(rec.date) : ''].filter(Boolean).join(' · ');
}

function fileTitle(rec: Pick<Attachment, 'title' | 'name'>): string {
    return rec.title?.trim() || rec.name;
}

function thumbHtml(rec: Omit<Attachment, 'id' | 'places'>, cls: string): string {
    if (isImage(rec)) return `<span class="${cls}"><img src="${esc(rec.dataUrl)}" alt=""></span>`;
    const letters = materialTileLetters({ mime: rec.original?.mimeType ?? rec.mimeType, title: rec.name, name: rec.name } as MaterialItem);
    return `<span class="${cls}"><span class="material-row-tile">${esc(letters)}</span></span>`;
}

const OFFER_THUMB_PX = 128;

/** A tile of the research's material: its preview when one is ready, else the type's letters (filled in by the queue). */
function archiveThumbHtml(it: MaterialItem): string {
    const letters = `<span class="material-row-tile">${esc(materialTileLetters(it))}</span>`;
    const sha = materialItemSha(it);
    if (!sha || !['image', 'pdf'].includes(materialType(it.mime, it.name))) return `<span class="source-offer-thumb">${letters}</span>`;
    const ready = materialThumbs().urlOf(sha, OFFER_THUMB_PX);
    if (ready) return `<span class="source-offer-thumb"><img src="${esc(ready)}" alt=""></span>`;
    return `<span class="source-offer-thumb" data-sha="${esc(sha)}" data-item="${esc(it.key)}">${letters}</span>`;
}

function citationContextOf(place: MediaPlace | null, personId: PersonId): { personId: PersonId; eventId?: string; fact?: 'birth' | 'death' } | { partnershipId: PartnershipId; eventId?: string } {
    if (!place) return { personId };
    if ('personId' in place) return place.fact ? { personId: place.personId, fact: place.fact as 'birth' | 'death' } : { personId: place.personId, ...(place.eventId ? { eventId: place.eventId } : {}) };
    if ('partnershipId' in place) return { partnershipId: place.partnershipId, ...(place.eventId ? { eventId: place.eventId } : {}) };
    return { personId };
}

export const sourceDocsMethods = uiModule({
    // ==================== CREATE A SOURCE FROM THIS FILE (§5) ====================

    /**
     * "Create a source from this file…": the editor with the file as the
     * evidence. Material outside the tree first gets its working copy from the
     * bridge (it becomes a file of the tree on Save, in the same undo step).
     */
    async makeSourceFromMaterial(item: MaterialItem, ctx: { personId?: PersonId | null; leave?: () => void } = {}): Promise<boolean> {
        if (DataManager.isReadOnly() || !this.canEditSources()) return false;
        const att = item.attachment && !item.attachment.removed && item.attachment.places?.length ? DataManager.getMedia(item.attachment.id) : undefined;
        let draft: DocDraft;
        if (att) {
            draft = { key: att.id, itemKey: item.key };
        } else if (item.file && item.origin !== 'tree') {
            const mc = this.materialsContext();
            if (!mc?.caps.bridgeUp || !mc.base) {
                this.showToast(strings.materials.actionsWhenRunning);
                return false;
            }
            const record = await this.materialWorkingCopy(item, mc);
            if (!record) {
                this.showToast(strings.materials.attachFailed);
                return false;
            }
            draft = { key: `pending:${++pendingN}`, record, itemKey: item.key };
        } else {
            return false;
        }
        const rec = draftRecord(draft)!;
        // Cite at: the person it was opened from, else the file's only person.
        const own = att ? mediaPersonIds(att)
            : item.persons.map(refn => DataManager.getAllPersons().find(p => p.refn === refn)?.id).filter((id): id is PersonId => !!id);
        const personId = ctx.personId && DataManager.getPerson(ctx.personId) ? ctx.personId : own.length === 1 ? own[0] : null;
        const person = personId ? DataManager.getPerson(personId) : undefined;
        const citeDraft: CiteDraft | null = person
            ? { from: person.id, personId: person.id, place: preselectCitePlace(person, item.kind ?? rec.kind, item.date ?? rec.date) }
            : null;
        const titled = !!rec.title?.trim();
        ctx.leave?.();
        closeImageViewer();
        seed = { docs: [draft], cite: citeDraft, fromTitle: titled };
        this.citeSourceAfterCreate = false;
        this.sourceEditorContext = person ? { personId: person.id } : null;
        const recordDate = recordDateOfFile(rec.date);
        this.showAddSourceModal({ ...(titled ? { title: rec.title!.trim() } : {}), ...(recordDate ? { recordDate } : {}) }, titled ? '' : rec.name);
        if (recordDate) {
            const more = document.getElementById('source-more') as HTMLDetailsElement | null;
            if (more) more.open = true;
        }
        document.getElementById('input-source-title')?.focus();
        return true;
    },

    // ==================== THE EDITOR'S BLOCKS ====================

    /** The editor's evidence for a source being filled in (fillSourceEditor). */
    resetSourceDocs(src: Partial<Source>): void {
        offerQuery = '';
        offerAll = false;
        fetching.clear();
        if (seed) {
            docs = seed.docs;
            cite = seed.cite;
            fromTitle = seed.fromTitle;
            seed = null;
            fromFile = true;
            docsAtOpen = [];
            offerShown = false;
        } else {
            docs = src.id ? mediaOf(DataManager.getData(), { sourceId: src.id }).map(a => ({ key: a.id })) : [];
            cite = null;
            fromTitle = false;
            fromFile = false;
            docsAtOpen = docs.map(d => d.key);
            offerShown = offerNext || (!src.id && this.citeSourceAfterCreate);
        }
        offerNext = false;
    },

    /** "Link evidence…" in the viewer: the editor opens with the offer. */
    attachDocFromSourceViewer(): void {
        offerNext = true;
        this.editFromSourceViewer();
        document.getElementById('source-offer')?.querySelector<HTMLElement>('input, button')?.focus();
    },

    /** The evidence's part of the editor's "unsaved changes" state. */
    sourceDocsState(): string {
        return JSON.stringify([docs.map(d => d.key), cite ? [cite.personId, cite.place ? placeKey(cite.place) : null] : null]);
    },

    /** The people whose files the offer shows: the editor's context, else those the source cites. */
    sourceOfferPersonIds(): PersonId[] {
        const fromCtx = this.excerptContextPersonIds();
        if (fromCtx.length) return fromCtx;
        const id = this.editingSourceId;
        if (!id) return [];
        const out = new Set<PersonId>();
        for (const ref of DataManager.listSourceCitations(id)) {
            if ('personId' in ref) out.add(ref.personId);
            else {
                const u = DataManager.getPartnership(ref.partnershipId);
                if (u) { out.add(u.person1Id); out.add(u.person2Id); }
            }
        }
        return [...out];
    },

    /** Draw the editor's Evidence, Cite at and the offer (6a). */
    renderSourceDocs(): void {
        this.renderSourceDocBlock();
        this.renderSourceCiteAt();
        this.renderSourceOffer();
        const hint = document.getElementById('source-title-from-file');
        if (hint) hint.hidden = !fromTitle;
    },

    renderSourceDocBlock(): void {
        const box = document.getElementById('source-docs');
        if (!box) return;
        const s = strings.sources;
        const list = docs.map(d => ({ d, rec: draftRecord(d) })).filter(x => !!x.rec);
        const canOffer = !offerShown && this.sourceOfferPersonIds().some(pid => this.personMaterialItems(pid).length > 0);
        if (!list.length && !canOffer) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        box.hidden = false;
        const mc = this.materialsContext();
        // A file whose original is only in the archive (5e): "Open in the system" through the research's link.
        const systemLink = (r: Omit<Attachment, 'id' | 'places'>): string | null => {
            const sha = r.original?.sha256;
            return r.originalOnly && sha && mc && mc.caps.openLinks !== false ? materialSystemLink(mc.researchId, sha, announcedResearchScheme()) : null;
        };
        const cards = list.map(({ d, rec }) => {
            const r = rec!;
            const title = fileTitle(r);
            // A file whose only place is this source is not unlinked here (it would leave the tree).
            const att = d.record ? undefined : DataManager.getMedia(d.key);
            const onlyHere = !!att && docsAtOpen.includes(d.key) && att.places.length === 1;
            const remove = onlyHere ? '' : `<button type="button" class="source-doc-remove" data-doc-act="remove" aria-label="${esc(s.docRemove(title))}" title="${esc(s.docRemove(title))}">×</button>`;
            const pdf = r.mimeType === 'application/pdf' && !r.originalOnly && !!r.dataUrl;
            const act = isImage(r)
                ? `<button type="button" class="secondary btn-sm" data-doc-act="cut">${esc(s.cutExcerpt)}</button>`
                : pdf ? `<button type="button" class="secondary btn-sm" data-doc-act="pdf">${esc(strings.materials.openPdf)}</button>`
                    : systemLink(r) ? `<button type="button" class="secondary btn-sm" data-doc-act="system">${researchActionLabel(strings.materials.openSystem, researchLinkMark('media'))}</button>` : '';
            return `<div class="source-doc-card" data-doc="${esc(d.key)}">
                <div class="source-doc-row">${thumbHtml(r, 'source-doc-thumb')}
                    <span class="source-doc-main"><span class="source-doc-title">${esc(title)}</span><span class="source-doc-meta">${esc(fileMeta(r))}</span></span>${remove}</div>
                ${act ? `<div class="source-doc-acts">${act}</div>` : ''}</div>`;
        }).join('');
        const more = list.length ? s.moreDoc : s.attachDoc;
        const link = this.sourceOfferPersonIds().length && !offerShown
            ? `<button type="button" class="link-button source-doc-more" data-doc-act="more">${esc(more)}</button>` : '';
        box.innerHTML = `<span class="form-label">${esc(s.docLabel)}</span>${cards}${link}${list.length ? `<p class="field-hint">${esc(s.docHint)}</p>` : ''}`;
        box.querySelectorAll<HTMLElement>('[data-doc-act]').forEach(btn => btn.addEventListener('click', () => {
            const key = btn.closest<HTMLElement>('[data-doc]')?.dataset.doc ?? '';
            const d = docs.find(x => x.key === key);
            const act = btn.dataset.docAct;
            if (act === 'more') {
                offerShown = true;
                this.renderSourceDocs();
                document.getElementById('source-offer')?.querySelector<HTMLElement>('input, .source-offer-tile')?.focus();
                return;
            }
            if (!d) return;
            const r = draftRecord(d);
            if (act === 'remove') {
                docs = docs.filter(x => x !== d);
                this.renderSourceDocs();
                (box.querySelector<HTMLElement>('[data-doc-act]') ?? document.getElementById('input-source-title'))?.focus();
            } else if (act === 'cut' && r?.dataUrl) {
                void this.addExcerptFromAttachment({ id: d.key, dataUrl: r.dataUrl }, -1);
            } else if (act === 'pdf' && r) {
                openPdfBlob({ dataUrl: r.dataUrl, mimeType: r.mimeType });
            } else if (act === 'system' && r) {
                const link = systemLink(r);
                if (link) this.launchResearchLink(link);
            }
        }));
    },

    renderSourceCiteAt(): void {
        const box = document.getElementById('source-cite-at');
        if (!box) return;
        if (!cite || this.editingSourceId) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        const s = strings.sources;
        box.hidden = false;
        const person = cite.personId ? DataManager.getPerson(cite.personId) : undefined;
        let body: string;
        if (person) {
            const places = citeEventPlaces(person);
            const chosen = cite.place ? placeKey(cite.place) : '';
            const options = [`<option value="">${esc(s.citeNoEvent)}</option>`]
                .concat(places.map(p => `<option value="${esc(placeKey(p))}"${placeKey(p) === chosen ? ' selected' : ''}>${esc(citeOptionLabel(p, person.id))}</option>`)).join('');
            body = `<div class="source-cite-row">
                <span class="source-cite-chip">${esc(fullName(person))}<button type="button" class="source-cite-x" data-cite-act="none" aria-label="${esc(s.citeUncite(fullName(person)))}">×</button></span>
                <select id="source-cite-event" class="source-cite-event" aria-label="${esc(s.citeEvent)}">${options}</select></div>
                <p class="field-hint">${esc(s.citeHint)}</p>`;
        } else {
            const from = DataManager.getPerson(cite.from);
            body = `<div class="source-cite-row"><span class="source-cite-none">${esc(s.citeNone)}</span>${from ? `<button type="button" class="link-button" data-cite-act="back">${esc(fullName(from))}</button>` : ''}</div>`;
        }
        box.innerHTML = `<span class="form-label">${esc(s.citeAtLabel)}</span>${body}`;
        const select = box.querySelector<HTMLSelectElement>('#source-cite-event');
        select?.addEventListener('change', () => {
            if (!cite?.personId) return;
            const p = DataManager.getPerson(cite.personId);
            cite.place = p ? citeEventPlaces(p).find(x => placeKey(x) === select.value) ?? null : null;
        });
        box.querySelector('[data-cite-act="none"]')?.addEventListener('click', () => {
            if (!cite) return;
            cite.personId = null;
            cite.place = null;
            this.renderSourceCiteAt();
            box.querySelector<HTMLElement>('[data-cite-act="back"]')?.focus();
        });
        box.querySelector('[data-cite-act="back"]')?.addEventListener('click', () => {
            if (!cite) return;
            cite.personId = cite.from;
            this.renderSourceCiteAt();
            box.querySelector<HTMLElement>('#source-cite-event')?.focus();
        });
    },

    // ==================== THE OFFER (§6) ====================

    renderSourceOffer(): void {
        const box = document.getElementById('source-offer');
        if (!box) return;
        const persons = offerShown ? this.sourceOfferPersonIds() : [];
        const seen = new Set<string>();
        const items: MaterialItem[] = [];
        for (const pid of persons) {
            for (const it of this.personMaterialItems(pid)) {
                if (seen.has(it.key) || it.hidden) continue;
                if (!it.attachment && !(it.file && it.origin !== 'tree')) continue;
                seen.add(it.key);
                items.push(it);
            }
        }
        // A person without files: no block (6c).
        if (!items.length) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        const s = strings.sources;
        const editing = this.editingSourceId;
        const q = offerQuery.trim().toLowerCase();
        const shown = q ? items.filter(it => `${it.title} ${it.name}`.toLowerCase().includes(q)) : items;
        const isOther = (it: MaterialItem) => !!it.attachment && mediaSourceIds(it.attachment).some(id => id !== editing);
        const free = shown.filter(it => !isOther(it));
        const other = shown.filter(isOther);
        const names = persons.map(pid => fullName(DataManager.getPerson(pid))).filter(Boolean).join(', ');
        const mc = this.materialsContext();
        const bridgeUp = !!mc?.caps.bridgeUp && !!mc.base;
        const tile = (it: MaterialItem) => {
            const on = docs.some(d => d.itemKey === it.key || (!!it.attachment && d.key === it.attachment.id));
            const outside = !it.attachment;
            const off = outside && !bridgeUp;
            const att = it.attachment;
            const thumb = att ? thumbHtml(att, 'source-offer-thumb') : archiveThumbHtml(it);
            const meta = [materialKindLabel(it), it.date ? materialDate(it.date) : ''].filter(Boolean).join(' · ');
            return `<button type="button" class="source-offer-tile" data-item="${esc(it.key)}" aria-pressed="${on}"${off ? ` aria-disabled="true" title="${esc(strings.materials.actionsWhenRunning)}"` : ''}${fetching.has(it.key) ? ' aria-busy="true"' : ''}>
                ${thumb}<span class="source-offer-check" aria-hidden="true"></span>
                <span class="source-offer-title">${esc(it.title)}</span><span class="source-offer-meta">${esc(meta)}</span></button>`;
        };
        const group = (label: string, list: MaterialItem[]) => list.length
            ? `<div class="source-offer-group">${esc(label)}</div><div class="source-offer-grid">${list.map(tile).join('')}</div>` : '';
        const many = items.length > OFFER_SEARCH_OVER;
        box.hidden = false;
        box.classList.toggle('is-many', many);
        box.classList.toggle('is-all', offerAll);
        box.innerHTML = `
            <div class="source-offer-head"><span class="source-offer-title-main">${esc(s.offerTitle)}</span>
                <span class="source-offer-sub">${esc(s.offerSub(names, items.length))}</span>
                <button type="button" class="link-button source-offer-all" data-offer-act="all" aria-expanded="${offerAll}">${esc(s.offerAll(items.length))}</button></div>
            ${many ? `<input type="search" class="source-offer-search" value="${esc(offerQuery)}" placeholder="${esc(s.offerSearch)}" aria-label="${esc(s.offerSearch)}">` : ''}
            <div class="source-offer-body" role="group" aria-label="${esc(s.offerTitle)}">${group(s.offerNoSource(free.length), free)}${group(s.offerOther(other.length), other)}</div>
            <div class="source-offer-foot"><button type="button" class="link-button" data-offer-act="file">${esc(s.otherFile)}</button></div>`;
        const search = box.querySelector<HTMLInputElement>('.source-offer-search');
        search?.addEventListener('input', () => {
            offerQuery = search.value;
            const pos = search.selectionStart;
            this.renderSourceOffer();
            const again = box.querySelector<HTMLInputElement>('.source-offer-search');
            again?.focus();
            if (again && pos !== null) again.setSelectionRange(pos, pos);
        });
        box.querySelector('[data-offer-act="all"]')?.addEventListener('click', () => {
            offerAll = !offerAll;
            this.renderSourceOffer();
            box.querySelector<HTMLElement>('[data-offer-act="all"]')?.focus();
        });
        box.querySelector('[data-offer-act="file"]')?.addEventListener('click', () => this.pickExcerptFile(-1));
        // The research's material: its preview from the bridge (the window's queue), the type's letters until then.
        if (mc && bridgeUp) {
            const queue = materialThumbs();
            queue.setEnv({ treeId: mc.treeId, base: mc.base, thumb: mc.caps.thumb, bridgeUp: mc.caps.bridgeUp });
            box.querySelectorAll<HTMLElement>('.source-offer-thumb[data-sha]').forEach(el => {
                const it = items.find(x => x.key === el.dataset.item);
                queue.want({ sha: el.dataset.sha!, px: OFFER_THUMB_PX, mime: it?.mime, name: it?.file?.name ?? it?.title, bytes: it?.bytes },
                    url => { if (url && el.isConnected) el.innerHTML = `<img src="${esc(url)}" alt="">`; },
                    () => el.isConnected);
            });
        }
        box.querySelectorAll<HTMLButtonElement>('.source-offer-tile').forEach(btn => btn.addEventListener('click', () => {
            if (btn.getAttribute('aria-disabled') === 'true' || btn.getAttribute('aria-busy') === 'true') return;
            const it = items.find(x => x.key === btn.dataset.item);
            if (it) void this.toggleOfferItem(it);
        }));
    },

    /** A tile of the offer chosen or not: the file is (or is no longer) the source's evidence. */
    async toggleOfferItem(it: MaterialItem): Promise<void> {
        const had = docs.find(d => d.itemKey === it.key || (!!it.attachment && d.key === it.attachment.id));
        if (had) {
            docs = docs.filter(d => d !== had);
        } else if (it.attachment) {
            docs.push({ key: it.attachment.id, itemKey: it.key });
        } else {
            fetching.add(it.key);
            this.renderSourceOffer();
            const record = await this.materialWorkingCopy(it, this.materialsContext());
            fetching.delete(it.key);
            if (!document.getElementById('source-editor-modal')?.classList.contains('active')) return;
            if (!record) this.showToast(strings.materials.attachFailed);
            else docs.push({ key: `pending:${++pendingN}`, record, itemKey: it.key });
        }
        this.renderSourceDocs();
        document.querySelector<HTMLElement>(`#source-offer .source-offer-tile[data-item="${CSS.escape(it.key)}"]`)?.focus();
    },

    // ==================== EXCERPTS FROM THE EVIDENCE ====================

    /** The evidence that is a picture (to cut an excerpt from). */
    sourceDocPages(): { id: string; dataUrl: string; name: string; title?: string }[] {
        const out: { id: string; dataUrl: string; name: string; title?: string }[] = [];
        for (const d of docs) {
            const r = draftRecord(d);
            if (r && isImage(r)) out.push({ id: d.key, dataUrl: r.dataUrl, name: r.name, title: r.title });
        }
        return out;
    },

    /** A staged working copy's page (an excerpt cut from it before Save). */
    pendingDocPage(id: string): { id: string; dataUrl: string } | null {
        const d = docs.find(x => x.key === id && x.record);
        return d?.record && isImage(d.record) ? { id, dataUrl: d.record.dataUrl } : null;
    },

    /** The title of the file an excerpt was cut from (a staged one too). */
    excerptFileTitle(id: string | undefined): string | null {
        if (!id) return null;
        const d = docs.find(x => x.key === id && x.record);
        const rec = d?.record ?? findMedia(DataManager.getData(), id);
        return rec ? fileTitle(rec) : null;
    },

    /** A file of the tree in the material viewer (the evidence's title, "Excerpt cut from …"). */
    openSourceDocFile(id: string): void {
        const att = DataManager.getMedia(id);
        if (!att) return;
        const item = attachmentItem(att, null);
        if (this.openMaterialPdf(item)) return;
        this.openMaterialViewer([item], 0, { where: 'section', label: fileTitle(att) });
    },

    // ==================== SAVE ====================

    /**
     * Inside the editor's undo step: the evidence (material outside the tree
     * becomes a file of the tree first), excerpts cut from a staged file get
     * its id, and "Cite at" cites the new source. Returns the event's name
     * for the toast (or the person's), null without a citation.
     */
    saveSourceDocs(sourceId: string, isNew: boolean): string | null {
        const place: MediaPlace = { sourceId };
        const ids = new Map<string, string>();
        const person = cite?.personId ?? null;
        for (const d of docs) {
            if (d.record) {
                const places: MediaPlace[] = [place, ...(person ? [{ personId: person }] : [])];
                const [id] = DataManager.linkMedia([{ record: d.record }], places);
                if (id) ids.set(d.key, id);
            } else if (!docsAtOpen.includes(d.key)) {
                DataManager.addMediaPlace(d.key, place);
            }
        }
        for (const key of docsAtOpen) {
            if (docs.some(d => d.key === key)) continue;
            const att = DataManager.getMedia(key);
            if (att && att.places.length > 1) DataManager.removeMediaPlace(key, place);
        }
        if (ids.size) {
            const src = DataManager.getData().sources?.[sourceId];
            const excerpts: SourceExcerpt[] | undefined = src?.excerpts?.map(e => (e.fromAttachmentId && ids.has(e.fromAttachmentId) ? { ...e, fromAttachmentId: ids.get(e.fromAttachmentId)! } : e));
            if (src && excerpts?.some((e, i) => e !== src.excerpts![i])) DataManager.updateSource(sourceId, { excerpts });
        }
        if (!isNew || !cite?.personId) return null;
        const ctx = citationContextOf(cite.place, cite.personId);
        if ('partnershipId' in ctx) {
            if (ctx.eventId) DataManager.citeCoupleEvent(ctx.partnershipId, ctx.eventId, sourceId);
            else DataManager.citePartnership(ctx.partnershipId, sourceId);
        } else if (ctx.eventId) {
            DataManager.citeEvent(ctx.personId, ctx.eventId, sourceId);
        } else {
            DataManager.citePerson(ctx.personId, sourceId, ctx.fact);
        }
        this.noteRecentSource(sourceId);
        return cite.place ? citeEventName(cite.place, cite.personId) : fullName(DataManager.getPerson(cite.personId));
    },

    /** Was the editor opened from a file ("Create a source from this file…")? Its toast says what was made. */
    sourceFromFile(): boolean {
        return fromFile;
    },

    /** The editor closed: nothing staged stays. */
    clearSourceDocs(): void {
        docs = [];
        docsAtOpen = [];
        cite = null;
        fromTitle = false;
        fromFile = false;
        offerShown = false;
        offerQuery = '';
        offerAll = false;
        fetching.clear();
    },

    // ==================== THE VIEWER (§7) ====================

    /** "Taken from": the evidence rows, or the note and "Link evidence…". */
    sourceViewerDocsHtml(src: Source, editable: boolean, excerpts: SourceExcerpt[]): string {
        const s = strings.sources;
        const files = mediaOf(DataManager.getData(), { sourceId: src.id });
        if (!files.length && !editable) return '';
        const cut = new Set(excerpts.map(e => e.fromAttachmentId).filter(Boolean));
        const rows = files.map(att => {
            const title = fileTitle(att);
            const sub = [fileMeta(att), strings.materials.docOf + (cut.has(att.id) ? `, ${s.excerptIsHere}` : '')].join(' · ');
            const canRemove = editable && DataManager.canEditMedia(att.id);
            return `<li class="viewer-doc" data-doc="${esc(att.id)}">${thumbHtml(att, 'viewer-doc-thumb')}
                <span class="viewer-doc-main"><button type="button" class="link-button viewer-doc-title" data-doc-act="open">${esc(title)}</button>
                <span class="viewer-doc-meta">${esc(sub)}</span></span>
                ${canRemove ? `<button type="button" class="viewer-doc-remove" data-doc-act="remove" aria-label="${esc(s.docRemove(title))}" title="${esc(s.docRemove(title))}">×</button>` : ''}</li>`;
        }).join('');
        const body = files.length
            ? `<ul class="viewer-docs">${rows}</ul>`
            : `<div class="viewer-no-doc"><p>${esc(s.noDoc)}</p>${this.sourceOfferPersonIdsFor(src.id).length ? `<button type="button" class="secondary btn-sm" data-doc-act="attach">${esc(s.attachDoc)}</button>` : ''}</div>`;
        return `<section class="viewer-from"><h3 class="viewer-section-title">${esc(s.viewerFrom)}</h3>${body}</section>`;
    },

    /** The people a source cites (whose files "Link evidence…" offers). */
    sourceOfferPersonIdsFor(sourceId: string): PersonId[] {
        const out = new Set<PersonId>();
        for (const ref of DataManager.listSourceCitations(sourceId)) {
            if ('personId' in ref) out.add(ref.personId);
            else {
                const u = DataManager.getPartnership(ref.partnershipId);
                if (u) { out.add(u.person1Id); out.add(u.person2Id); }
            }
        }
        return [...out].filter(pid => this.personMaterialItems(pid).length > 0);
    },

    /** "Excerpt cut from {file} ›" under an excerpt cut from a file of the tree. */
    excerptFromHtml(exc: SourceExcerpt): string {
        const id = exc.fromAttachmentId;
        const title = id && DataManager.getMedia(id) ? this.excerptFileTitle(id) : null;
        return title ? `<button type="button" class="link-button excerpt-from" data-excerpt-from="${esc(id!)}">${esc(strings.sources.excerptFrom(title))}</button>` : '';
    },

    wireSourceViewerDocs(body: HTMLElement, src: Source): void {
        body.querySelectorAll<HTMLElement>('[data-excerpt-from]').forEach(el => el.addEventListener('click', () => this.openSourceDocFile(el.dataset.excerptFrom ?? '')));
        body.querySelectorAll<HTMLElement>('.viewer-from [data-doc-act]').forEach(btn => btn.addEventListener('click', () => {
            const act = btn.dataset.docAct;
            if (act === 'attach') {
                this.attachDocFromSourceViewer();
                return;
            }
            const id = btn.closest<HTMLElement>('[data-doc]')?.dataset.doc ?? '';
            if (act === 'open') this.openSourceDocFile(id);
            else if (act === 'remove') void this.removeSourceDoc(src, id);
        }));
    },

    /** × on an evidence row: the file off the source (one undo step); its last place asks first (§9). */
    async removeSourceDoc(src: Source, id: string): Promise<void> {
        const att = DataManager.getMedia(id);
        if (!att) return;
        const place: MediaPlace = { sourceId: src.id };
        const item = attachmentItem(att, null);
        if (att.places.length === 1) {
            if (await this.removeLastMaterialPlace(item, id, place, src.title, () => {})) this.renderSourceViewer();
            return;
        }
        if (DataManager.removeMediaPlace(id, place, { toast: strings.materials.removedToast(src.title, fileTitle(att)) })) {
            this.renderSourceViewer();
            this.afterMediaChange();
        }
    },

});
