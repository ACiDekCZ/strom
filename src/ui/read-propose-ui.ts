/**
 * "Read a document" (spec 013 §5): the tree suggestion, a step of the read
 * dialog. The scan stays on the left; the right column lists the entry's
 * persons (new / link / no), its events and relationships, and the source
 * that is written with them. Nothing is written without the button; the
 * write is one undo step. A reading by one reader offers a second reader
 * first (`read.secondBeforeApply`); a watched (live) tree shows the
 * suggestion but writes only after watching ends.
 */

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeRenderer } from '../renderer.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { Person, PersonId, PartnershipId, SourceExcerpt } from '../types.js';
import { PersonPicker } from '../person-picker.js';
import { shownName } from '../person-name.js';
import { displayYear, formatFlexDate } from '../dates.js';
import { gedcomTagEventType } from '../ged-parser.js';
import { excerptFromDataUrl } from '../excerpts.js';
import { cropToJpeg } from './crop-editor.js';
import { ReadEntry, ReadPerson, ReadResult, ReadPage, ReadRegion, readDocYear } from '../research-read.js';
import { entryName } from '../read-result.js';
import {
    ProposeState, ProposeChoice, ProposeItem, initialPropose, carryPropose, proposeItems, proposeCounts, linkAdditions,
    linkedPerson, readGender, readEventDate, personVariants, variantsText, variantKey, LinkAddition,
} from '../read-propose.js';
import { researchSendMode } from './research-sync-ui.js';
import { readDialogState, readCropHtml, regionStyle } from './read-document-ui.js';
import { uiModule } from './module.js';

const SECOND_KEY = 'read.secondBeforeApply';

/** What the click wrote ([5c]). */
interface Written {
    newPersons: { id: PersonId; name: string; uncertain: boolean }[];
    linked: { id: PersonId; name: string; kinds: LinkAddition['kind'][] }[];
    events: string[];
    relations: number;
    source: string;
    /** Who "Show" goes to. */
    show: { id: PersonId; name: string } | null;
}

/** The suggestion of the dialog's entry (null: none open). */
let ps: ProposeState | null = null;
/** The person whose card shows the tree person picker ('' = none). */
let pickingRef = '';
let picker: PersonPicker | null = null;
/** "First have a second reader read it" ticked. */
let secondOn = true;
/** The readers' variants of the result the suggestion opened with, and the ones a second reader added. */
let seenVariants = new Set<string>();
let freshVariants = new Set<string>();
let written: Written | null = null;
let writing = false;

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function storedSecond(): boolean {
    try { return localStorage.getItem(SECOND_KEY) !== '0'; } catch { return true; }
}

function storeSecond(on: boolean): void {
    try { localStorage.setItem(SECOND_KEY, on ? '1' : '0'); } catch { /* storage off */ }
}

/** A read person's name as read (or as typed for a new one). */
function readName(p: Pick<ReadPerson, 'given' | 'surname'>): string {
    return [p.given, p.surname].filter(Boolean).join(' ');
}

/** "Václav Novák (*1812)". */
function treeLabel(person: Person): string {
    const y = displayYear(person.birthDate);
    return `${shownName(person)}${y ? ` (*${y})` : ''}`;
}

/** The source's title: the kind, the place and the year ("Baptism entry, Lhota 1846"). */
export function readSourceTitle(res: ReadResult, entry: ReadEntry): string {
    const t = strings.read;
    const kind = t.kindTitles[res.doc.kind] ?? t.kindTitles.other;
    const ev = entry.events.find(e => e.place?.text || e.date) ?? null;
    const place = ev?.place?.text?.trim() ?? '';
    const year = (readEventDate(ev ?? { date: null }).match(/\d{4}/)?.[0]) ?? readDocYear(res.doc.date);
    const where = [place, year].filter(Boolean).join(' ');
    return where ? `${kind}, ${where}` : kind;
}

/** A SHA-256 as the app keeps it, or ''. */
function cleanSha(sha: string | undefined): string {
    const s = (sha ?? '').trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(s) ? s : '';
}

/** Load an image from a blob (raster or SVG) for drawing. */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
        img.src = url;
    });
}

/** The entry's crop of its page as an excerpt (null: no page image, or it could not be cut). */
async function entryExcerpt(imageUrl: string, page: ReadPage | null, region: ReadRegion | null, caption: string): Promise<SourceExcerpt | null> {
    if (!imageUrl || !page) return null;
    try {
        const reply = await fetch(imageUrl);
        if (!reply.ok) return null;
        const img = await loadImage(await reply.blob());
        const w = img.naturalWidth || page.w;
        const h = img.naturalHeight || page.h;
        if (!w || !h) return null;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, w, h);
        const r = region ?? [0, 0, 1, 1];
        const crop = cropToJpeg(canvas, { x: r[0], y: r[1], w: r[2], h: r[3] });
        const sha = cleanSha(page.sha);
        return excerptFromDataUrl(crop.dataUrl, {
            width: crop.width, height: crop.height, caption,
            region: { x: r[0], y: r[1], w: r[2], h: r[3] }, ...(sha ? { originalSha: sha } : {}),
        });
    } catch (err) {
        console.warn('Entry crop unavailable', err);
        return null;
    }
}

export const readProposeMethods = uiModule({
    /** Open the suggestion of the dialog's chosen entry (choices kept when it is the same entry again). */
    openReadPropose(): void {
        const s = readDialogState();
        const sel = this.readDocumentSelection();
        if (!s || !sel) return;
        const data = DataManager.getData();
        if (!ps || ps.readId !== sel.readId || ps.entryId !== sel.entry.id) {
            ps = initialPropose(sel.readId, sel.entry, data);
            secondOn = storedSecond();
            seenVariants = new Set(sel.entry.variants.map(variantKey));
            freshVariants = new Set();
        }
        written = null;
        pickingRef = '';
        s.phase = 'propose';
        s.notice = '';
        s.line = -1;
        s.page = sel.entry.page;
        this.renderReadDialog();
    },

    /** Leave the suggestion: the dialog closed, or another reading shown. */
    resetReadPropose(): void {
        ps = null;
        written = null;
        pickingRef = '';
        picker?.destroy();
        picker = null;
        writing = false;
        freshVariants = new Set();
    },

    /** A new result of the same reading (a second reader): the suggestion again, the choices kept. */
    refreshReadPropose(before: ReadResult | null): void {
        const sel = this.readDocumentSelection();
        if (!ps || !sel) return;
        ps = carryPropose(ps, sel.readId, sel.entry, DataManager.getData());
        if (before && before !== sel.result) {
            freshVariants = new Set(sel.entry.variants.map(variantKey).filter(k => !seenVariants.has(k)));
            for (const k of freshVariants) seenVariants.add(k);
        }
    },

    /** The second reader is offered: one reader read it and the research has two. */
    readSecondOffered(): boolean {
        const res = readDialogState()?.result;
        return !!res && res.readers.ran === 1 && (this.readDocumentAccepts()?.readers ?? 1) >= 2;
    },

    /** Why the button does not write now ('' = it does). */
    readProposeBlocked(): 'live' | 'locked' | '' {
        if (DataManager.isLiveFollowing()) return 'live';
        if (DataManager.isTreeLocked() || DataManager.isReadOnly()) return 'locked';
        return '';
    },

    /** The suggestion's or the summary's title, subtitle, body, footer and the header's lead (back). */
    readProposeView(base: string): { title: string; sub: string; body: string; foot: string; wide: boolean; lead: string } {
        const t = strings.read;
        if (readDialogState()?.phase === 'written' && written) {
            return { title: t.written, sub: '', body: this.readWrittenHtml(), foot: this.readWrittenFootHtml(), wide: false, lead: '' };
        }
        const s = readDialogState()!;
        const res = s.result!;
        const entry = res.entries[s.entry];
        const lead = `<button type="button" class="link-button read-back" data-act="propose-back">${esc(t.proposeBack)}</button>`;
        const body = `
                <div class="read-result read-result--propose" id="read-result" data-read="${esc(res.id)}" data-entry="${s.entry}">
                    <div class="read-scan" id="read-scan">${this.readScanHtml(res, base)}</div>
                    <div class="read-text read-propose" id="read-propose">${this.readProposeHtml()}</div>
                </div>`;
        return {
            title: t.proposeTitle, sub: t.proposeEntry(s.entry + 1, entry ? entryName(entry) : ''),
            body, foot: this.readProposeFootHtml(), wide: true, lead,
        };
    },

    /** The right column: the second reader, the persons, the events and relationships, the source line. */
    readProposeHtml(): string {
        const s = readDialogState();
        const sel = this.readDocumentSelection();
        if (!s || !sel || !ps) return '';
        const t = strings.read;
        const data = DataManager.getData();
        const entry = sel.entry;
        const parts: string[] = [];
        if (s.second) {
            const live = this.readLiveOf(s.readId);
            // The second reader makes two (a bridge may still say one before it starts).
            const readers = Math.max(live?.readers ?? 0, 2);
            const done = Math.min(live?.done ?? 0, readers);
            const step = live?.state === 'checking' ? t.checking : live?.state === 'queued' ? t.queued : '';
            const sub = [step, t.readersDone(done, readers)].filter(Boolean).join(' · ');
            parts.push(`<div class="read-p-progress" role="status">
                    <span class="read-p-progress-text">${esc(t.secondReading)}<span class="read-p-progress-sub">${esc(sub)}</span></span>
                    <span class="batch-bar read-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${readers}" aria-valuenow="${done}" aria-label="${esc(t.readersDone(done, readers))}"><span style="width:${Math.round(done / readers * 100)}%"></span></span>
                    <button type="button" class="secondary read-cancel" data-act="cancel"${s.busy ? ' disabled' : ''}>${esc(t.cancel)}</button>
                </div>`);
        } else if (this.readSecondOffered()) {
            parts.push(`<label class="read-p-second${secondOn ? ' is-on' : ''}">
                    <input type="checkbox" id="read-p-second" data-act="p-second"${secondOn ? ' checked' : ''}>
                    <span class="read-p-second-text"><strong>${esc(t.second)}</strong><span>${esc(t.secondSub)}</span></span>
                </label>`);
        }
        parts.push(`<h3 class="read-section-title read-p-heading">${esc(t.pPersons(entry.persons.length))}</h3>`);
        parts.push(`<div class="read-p-persons">${entry.persons.map(p => this.readProposeCardHtml(p, entry, sel.imageUrl, sel.page)).join('')}</div>`);
        const items = proposeItems(entry, ps, data);
        if (items.length > 0) {
            parts.push(`<h3 class="read-section-title read-p-heading">${esc(t.pEvents)}</h3>`);
            parts.push(`<ul class="read-p-items">${items.map(i => this.readProposeItemHtml(i, entry)).join('')}</ul>`);
        }
        parts.push(`<p class="read-p-info">${esc(t.info(readSourceTitle(sel.result, entry)))}</p>`);
        return parts.join('');
    },

    /** A person's card: crop, role, as written, what the choice does, the choice. */
    readProposeCardHtml(p: ReadPerson, entry: ReadEntry, imageUrl: string, page: ReadPage | null): string {
        const t = strings.read;
        const c = ps!.persons[p.ref];
        if (!c) return '';
        const data = DataManager.getData();
        const role = (p.roleText || t.roles[p.role] || t.roles.other).toLocaleUpperCase(getCurrentLanguage());
        const region = p.region ?? entry.region;
        const crop = readCropHtml(imageUrl, page, region, 96, 34);
        const variants = personVariants(p, entry.variants);
        const fresh = variants.some(v => freshVariants.has(variantKey(v)));
        let main = '';
        if (c.choice === 'skip') {
            main = `<span class="read-p-line"><span class="read-p-name">${esc(readName(p) || p.written)}</span> <span class="read-p-muted">· ${esc(t.skipped)}</span></span>`;
        } else if (c.choice === 'new') {
            const field = (key: 'given' | 'surname', label: string): string => {
                const unsure = p.uncertain.includes(key) && !c.edited[key];
                return `<label class="read-p-field${unsure ? ' is-uncertain' : ''}"><span class="read-sr">${esc(label)}</span>`
                    + `<input type="text" data-p-field="${key}" data-ref="${esc(p.ref)}" value="${esc(c[key])}" aria-label="${esc(label)}" autocomplete="off" spellcheck="false">`
                    + `${unsure ? `<span class="read-p-tag">${esc(t.uncertainTag)}</span>` : ''}</label>`;
            };
            const unsure = (p.uncertain.includes('given') && !c.edited.given) || (p.uncertain.includes('surname') && !c.edited.surname);
            const note = unsure ? `<span class="read-p-unsure${fresh ? ' is-fresh' : ''}">${esc(t.uncertainNote(variantsText(variants)))}</span>` : '';
            main = `<span class="read-p-fields">${field('given', t.givenLabel)}${field('surname', t.surnameLabel)}${note}</span>`
                + `<span class="read-p-muted">${esc(c.candidate ? t.newPicked : t.newNoMatch)}</span>`;
        } else {
            const tree = c.target ? data.persons[c.target] : undefined;
            if (pickingRef === p.ref || !tree) {
                main = `<div class="read-p-picker"><div id="read-p-pick-${esc(p.ref)}"></div></div>`;
            }
            if (tree) {
                const why = c.candidate && c.candidate.id === tree.id ? this.readMatchWhy(c.candidate.byResearch, c.candidate.reasons, c.candidate.why, p, entry) : '';
                main = `<span class="read-p-match"><strong>${esc(treeLabel(tree))}</strong>${why ? `<span class="read-p-why">${esc(why)}</span>` : ''}`
                    + `<button type="button" class="link-button read-p-other" data-act="p-other" data-ref="${esc(p.ref)}">${esc(t.pickOther)}</button></span>` + (pickingRef === p.ref ? main : '');
                const { adds, diffs } = linkAdditions(p, tree);
                const sexWord = (g: string): string => strings.gender[g as 'male'] ?? g;
                main += adds.length > 0
                    ? `<span class="read-p-adds">${esc(t.adds(adds.map(a => t.addWhat[a.kind](a.kind === 'sex' ? sexWord(a.value) : a.value)).join(' · ')))}</span>`
                    // Nothing of its own, but every linked person cites the new source (writeReadPropose).
                    : `<span class="read-p-muted read-p-cites">${esc(t.addCitation)}</span>`;
                for (const d of diffs) {
                    const tv = d.what === 'sex' ? sexWord(d.tree) : d.tree;
                    const ev = d.what === 'sex' ? sexWord(d.entry) : d.entry;
                    main += `<span class="read-p-differs">${esc(t.differs(t.diffWhat[d.what] ?? d.what, tv, ev))}</span>`;
                }
            }
        }
        if (variants.length > 0 && !(c.choice === 'new' && main.includes('read-p-unsure'))) {
            main += `<span class="read-p-variants${fresh ? ' is-fresh' : ''}">${esc(t.readersSay(variantsText(variants)))}</span>`;
        }
        const seg = (choice: ProposeChoice, label: string): string =>
            `<button type="button" role="radio" class="read-p-seg-btn${c.choice === choice ? ' is-on' : ''}" aria-checked="${c.choice === choice}"`
            + ` data-act="p-choice" data-ref="${esc(p.ref)}" data-choice="${choice}">${esc(label)}</button>`;
        const linkLabel = c.choice !== 'link' && !c.candidate ? `${t.choiceLink}…` : t.choiceLink;
        const who = readName(p) || role;
        return `<div class="read-p-card is-${c.choice}${fresh ? ' has-fresh' : ''}" data-ref="${esc(p.ref)}">
                    <span class="read-p-crop" aria-hidden="true">${crop}</span>
                    <div class="read-p-main">
                        <span class="read-p-head"><span class="read-p-role">${esc(role)}</span>${p.written ? `<span class="read-p-written">${esc(p.written)}</span>` : ''}</span>
                        ${main}
                    </div>
                    <div class="read-p-seg" role="radiogroup" aria-label="${esc(t.choiceGroup(who))}">${seg('new', t.choiceNew)}${seg('link', linkLabel)}${seg('skip', t.choiceSkip)}</div>
                </div>`;
    },

    /** "matching name, birth, wife Anna" / "per the research · name, place". */
    readMatchWhy(byResearch: boolean, reasons: readonly string[], why: string, p: ReadPerson, entry: ReadEntry): string {
        const t = strings.read;
        if (byResearch) return why ? `${t.matchByResearch} · ${why}` : t.matchByResearch;
        const words = reasons.map(r => {
            if (r !== 'partner') return t.matchReasons[r] ?? r;
            const rel = entry.relations.find(x => x.type === 'spouse' && (x.a === p.ref || x.b === p.ref));
            const other = rel && rel.type === 'spouse' ? entry.persons.find(x => x.ref === (rel.a === p.ref ? rel.b : rel.a)) : undefined;
            return other?.given ? t.matchSpouse(readGender(other) === 'female', other.given) : t.matchReasons.partner;
        });
        return t.matchWhy(words.join(', '));
    },

    /** The name a person of the entry has in the suggestion. */
    readProposeName(ref: string, entry: ReadEntry): string {
        const p = entry.persons.find(x => x.ref === ref);
        const c = ps?.persons[ref];
        if (!p || !c) return ref;
        if (c.choice === 'link') {
            const tree = linkedPerson(ps!, ref, DataManager.getData());
            if (tree) return shownName(tree);
        }
        if (c.choice === 'new') return [c.given, c.surname].filter(Boolean).join(' ') || readName(p);
        return readName(p) || p.written;
    },

    /** An event or relationship row. */
    readProposeItemHtml(item: ProposeItem, entry: ReadEntry): string {
        const t = strings.read;
        const lang = getCurrentLanguage();
        let text = '';
        let note = '';
        if (item.kind === 'event') {
            const ev = entry.events[item.index];
            const tag = ev.type.toUpperCase();
            const type = tag === 'BIRT' ? 'birth' : tag === 'DEAT' ? 'death' : gedcomTagEventType(tag);
            const label = tag === 'MARR' ? t.marriage : (type ? strings.events.types[type] : '') || tag;
            const date = readEventDate(ev);
            text = [label, date ? formatFlexDate(date, lang) : ev.date?.text ?? '', ev.place?.text ?? ''].filter(Boolean).join(' · ');
            note = item.refs.map(r => this.readProposeName(r, entry)).join(', ');
        } else {
            const r = entry.relations[item.index];
            text = r.type === 'parent'
                ? t.relParent(this.readProposeName(r.parent, entry), this.readProposeName(r.child, entry))
                : t.relSpouse(this.readProposeName(r.a, entry), this.readProposeName(r.b, entry));
            note = t.newRelation;
        }
        if (item.inTree) note = t.inTree;
        else if (item.skipped) note = t.personSkipped;
        else if (item.differs) {
            const what = item.differs.what === 'marriage' ? t.marriage : t.diffWhat[item.differs.what] ?? item.differs.what;
            note = t.differs(what, formatFlexDate(item.differs.tree, lang), item.differs.entry ? formatFlexDate(item.differs.entry, lang) : t.notSaid);
        }
        return `<li class="read-p-item${item.enabled ? '' : ' is-off'}" data-key="${esc(item.key)}">
                    <label><input type="checkbox" data-act="p-tick" data-key="${esc(item.key)}"${item.checked ? ' checked' : ''}${item.enabled ? '' : ' disabled'}>
                    <span class="read-p-item-text">${esc(text)}</span>
                    <span class="read-p-item-note">${esc(note)}</span></label>
                </li>`;
    },

    /** The suggestion's footer: the second reader or the write, the watched tree's line and its stop. */
    readProposeFootHtml(): string {
        const t = strings.read;
        const s = readDialogState();
        const sel = this.readDocumentSelection();
        if (!s || !sel || !ps) return '';
        const blocked = this.readProposeBlocked();
        const second = this.readSecondOffered() && secondOn && !s.second;
        const { n, m } = proposeCounts(sel.entry, ps, DataManager.getData());
        const nothing = n === 0 && m === 0;
        const disabled = s.second || writing || s.busy || (!second && (blocked !== '' || nothing));
        const label = second
            ? `${esc(t.secondButton)}<span class="research-ai-badge" aria-hidden="true">${esc(strings.research.aiBadge)}</span>`
            : esc(t.apply(n, m));
        const note = blocked === 'live' && !second ? t.watched : blocked === 'locked' && !second ? t.locked : t.noButton;
        const stop = blocked === 'live' && !second
            ? `<button type="button" class="secondary" data-act="p-stop-live">${esc(strings.research.stop)}</button>` : '';
        return `<span class="batch-foot-note read-p-foot-note${blocked && !second ? ' is-blocked' : ''}">${esc(note)}</span>${stop}
                <button type="button" class="secondary" data-act="propose-back">${esc(t.proposeBackButton)}</button>
                <button type="button" class="primary read-p-apply" data-act="p-apply"${disabled ? ' disabled' : ''}>${label}</button>`;
    },

    /** Redraw the footer (the live tree ended, counts changed). */
    refreshReadProposeFoot(): void {
        const foot = document.querySelector<HTMLElement>('#read-document-modal .read-footer');
        if (foot && readDialogState()?.phase === 'propose') foot.innerHTML = this.readProposeFootHtml();
    },

    /** Redraw the right column and the footer (the scan stays). */
    redrawReadPropose(): void {
        const col = document.getElementById('read-propose');
        const overlay = document.getElementById('read-document-modal');
        if (!col || !overlay) return;
        const keep = col.scrollTop;
        col.innerHTML = this.readProposeHtml();
        col.scrollTop = keep;
        this.refreshReadProposeFoot();
        this.wireReadPropose(overlay);
    },

    /** Inputs, hover over a card (its crop on the scan), the picker. */
    wireReadPropose(overlay: HTMLElement): void {
        const s = readDialogState();
        if (!s || !ps) return;
        overlay.querySelectorAll<HTMLInputElement>('input[data-p-field]').forEach(input => {
            input.addEventListener('input', () => {
                const c = ps?.persons[input.dataset.ref ?? ''];
                const key = input.dataset.pField as 'given' | 'surname';
                if (!c) return;
                c[key] = input.value;
                if (!c.edited[key]) {
                    c.edited[key] = true;
                    const field = input.closest('.read-p-field');
                    field?.classList.remove('is-uncertain');
                    field?.querySelector('.read-p-tag')?.remove();
                    const card = input.closest('.read-p-card');
                    const p = this.readDocumentSelection()?.entry.persons.find(x => x.ref === c.ref);
                    if (p && !((p.uncertain.includes('given') && !c.edited.given) || (p.uncertain.includes('surname') && !c.edited.surname))) {
                        card?.querySelector('.read-p-unsure')?.remove();
                    }
                }
                // The names in the events and relationships follow.
                const list = overlay.querySelector('.read-p-items');
                const sel = this.readDocumentSelection();
                if (list && sel && ps) list.innerHTML = proposeItems(sel.entry, ps, DataManager.getData()).map(i => this.readProposeItemHtml(i, sel.entry)).join('');
            });
        });
        // A card's crop on the scan while the pointer is over it.
        const marks = overlay.querySelector<HTMLElement>('#read-scan-marks');
        const sel = this.readDocumentSelection();
        if (marks && sel) {
            let hl = marks.querySelector<HTMLElement>('.read-scan-person');
            if (!hl) {
                hl = document.createElement('span');
                hl.className = 'read-scan-person';
                hl.hidden = true;
                marks.appendChild(hl);
            }
            const box = hl;
            overlay.querySelectorAll<HTMLElement>('.read-p-card').forEach(card => {
                const p = sel.entry.persons.find(x => x.ref === card.dataset.ref);
                const region = p?.region;
                if (!region || sel.entry.page !== s.page) return;
                const show = (): void => { box.setAttribute('style', regionStyle(region)); box.hidden = false; };
                const hide = (): void => { box.hidden = true; };
                card.addEventListener('mouseenter', show);
                card.addEventListener('mouseleave', hide);
                card.addEventListener('focusin', show);
                card.addEventListener('focusout', hide);
            });
        }
        picker?.destroy();
        picker = null;
        const host = pickingRef ? overlay.querySelector<HTMLElement>(`#read-p-pick-${CSS.escape(pickingRef)}`) : null;
        const noTarget = overlay.querySelector<HTMLElement>('.read-p-card.is-link .read-p-picker > div');
        const target = host ?? noTarget;
        if (target) {
            const ref = target.id.replace(/^read-p-pick-/, '');
            try {
                const data = DataManager.getData();
                const taken = new Set(Object.values(ps.persons).filter(x => x.ref !== ref && x.choice === 'link' && x.target).map(x => x.target));
                picker = new PersonPicker({
                    containerId: target.id,
                    onSelect: (id) => {
                        const c = ps?.persons[ref];
                        if (!c) return;
                        c.choice = 'link';
                        c.target = id;
                        pickingRef = '';
                        this.redrawReadPropose();
                    },
                    persons: Object.values(data.persons).filter(x => !x.isPlaceholder && !taken.has(x.id)),
                    showBirthYear: true,
                });
                target.querySelector('input')?.setAttribute('aria-label', strings.read.pickLabel);
                if (host) target.querySelector<HTMLInputElement>('input')?.focus();
            } catch (err) {
                console.warn('Person picker unavailable', err);
            }
        }
    },

    /** The suggestion's actions (`data-act` in the dialog). */
    readProposeAct(el: HTMLElement): void {
        const s = readDialogState();
        if (!s) return;
        const ref = el.dataset.ref ?? '';
        switch (el.dataset.act) {
            case 'propose-back':
                if (s.phase !== 'propose') return;
                s.phase = 'result';
                s.notice = '';
                pickingRef = '';
                this.renderReadDialog();
                break;
            case 'p-choice': {
                const c = ps?.persons[ref];
                const choice = el.dataset.choice as ProposeChoice;
                if (!c || !choice) return;
                if (choice === 'link' && c.choice === 'link') { pickingRef = pickingRef === ref ? '' : ref; this.redrawReadPropose(); return; }
                c.choice = choice;
                if (choice === 'link') {
                    // The candidate, else a person picked in the tree.
                    if (!c.target && c.candidate) c.target = c.candidate.id;
                    pickingRef = c.target ? '' : ref;
                } else if (pickingRef === ref) pickingRef = '';
                this.redrawReadPropose();
                break;
            }
            case 'p-other':
                pickingRef = pickingRef === ref ? '' : ref;
                this.redrawReadPropose();
                break;
            case 'p-tick': {
                const key = el.dataset.key ?? '';
                if (!ps || !key) return;
                ps.ticks[key] = (el as HTMLInputElement).checked;
                this.refreshReadProposeFoot();
                break;
            }
            case 'p-second':
                secondOn = (el as HTMLInputElement).checked;
                el.closest('.read-p-second')?.classList.toggle('is-on', secondOn);
                this.refreshReadProposeFoot();
                break;
            case 'p-stop-live':
                this.stopLiveFollow();
                this.refreshReadProposeFoot();
                break;
            case 'p-apply': void this.applyReadPropose(); break;
            case 'show-person': {
                const id = written?.show?.id;
                this.closeReadDocumentDialog();
                if (id && DataManager.getPerson(id)) void TreeRenderer.setFocus(id);
                break;
            }
        }
    },

    /** The button: a second reader first (when ticked), else the write. */
    async applyReadPropose(): Promise<void> {
        const s = readDialogState();
        const sel = this.readDocumentSelection();
        if (!s || !sel || !ps || writing || s.second || s.busy) return;
        if (this.readSecondOffered()) {
            storeSecond(secondOn);
            if (secondOn) {
                s.readers = 2;
                s.second = true;
                this.redrawReadPropose();
                await this.readDocumentAgain();
                const now = readDialogState();
                if (now === s && now.phase !== 'propose') now.second = false;
                return;
            }
        }
        if (this.readProposeBlocked()) { this.refreshReadProposeFoot(); return; }
        writing = true;
        this.refreshReadProposeFoot();
        const title = readSourceTitle(sel.result, sel.entry);
        const excerpt = await entryExcerpt(sel.imageUrl, sel.page, sel.entry.region, title);
        writing = false;
        if (readDialogState() !== s || s.phase !== 'propose' || !ps) return;
        if (this.readProposeBlocked()) { this.refreshReadProposeFoot(); return; }
        let result: Written | null = null;
        try {
            result = DataManager.runBatch(strings.read.undoApply, () => this.writeReadPropose(sel.result, sel.entry, sel.page, title, excerpt));
        } catch (err) {
            console.warn('Writing the read document failed', err);
        }
        if (!result) {
            this.showToast(strings.read.applyFailed);
            this.refreshReadProposeFoot();
            return;
        }
        written = result;
        TreeRenderer.render();
        s.phase = 'written';
        s.notice = '';
        this.renderReadDialog();
    },

    /** The write itself (inside one batch): the source, the persons, their facts and relationships, all citing it. */
    writeReadPropose(res: ReadResult, entry: ReadEntry, page: ReadPage | null, title: string, excerpt: SourceExcerpt | null): Written | null {
        const state = ps!;
        const t = strings.read;
        const data = DataManager.getData();
        const items = proposeItems(entry, state, data);
        const sha = cleanSha(page?.sha);
        const source = DataManager.addSource({
            title, transcript: entry.transcript, reading: res.id, readingEntry: entry.id,
            ...(sha ? { readingSha: sha } : {}), ...(excerpt ? { excerpts: [excerpt] } : {}),
        });
        if (!source) return null;
        const out: Written = { newPersons: [], linked: [], events: [], relations: 0, source: title, show: null };
        const ids: Record<string, PersonId> = {};
        for (const p of entry.persons) {
            const c = state.persons[p.ref];
            if (!c || c.choice === 'skip') continue;
            if (c.choice === 'new') {
                const person = DataManager.createPerson({ firstName: c.given.trim(), lastName: c.surname.trim(), gender: readGender(p) });
                ids[p.ref] = person.id;
                const unsure = p.uncertain.filter(f => !((f === 'given' || f === 'surname') && c.edited[f]));
                if (unsure.length > 0) {
                    DataManager.updatePerson(person.id, { notes: `${t.uncertain}: ${unsure.map(f => t.uncertainFields[f] ?? f).join(', ')} (${title})` });
                }
                if (p.occupation.trim()) DataManager.addLifeEvent(person.id, { type: 'occupation', note: p.occupation.trim(), sourceIds: [source.id] });
                if (p.residence.trim()) DataManager.addLifeEvent(person.id, { type: 'residence', place: p.residence.trim(), sourceIds: [source.id] });
                out.newPersons.push({ id: person.id, name: shownName(person), uncertain: unsure.includes('given') || unsure.includes('surname') });
            } else {
                const tree = linkedPerson(state, p.ref, data);
                if (!tree) continue;
                ids[p.ref] = tree.id;
                const { adds } = linkAdditions(p, tree);
                for (const a of adds) {
                    if (a.kind === 'variant') DataManager.updatePerson(tree.id, { nameVariants: [...(tree.nameVariants ?? []), a.value] });
                    else if (a.kind === 'sex') DataManager.updatePerson(tree.id, { gender: a.value as Person['gender'] });
                    else if (a.kind === 'occupation') DataManager.addLifeEvent(tree.id, { type: 'occupation', note: a.value, sourceIds: [source.id] });
                    else DataManager.addLifeEvent(tree.id, { type: 'residence', place: a.value, sourceIds: [source.id] });
                }
                if (adds.length > 0) out.linked.push({ id: tree.id, name: shownName(tree), kinds: adds.map(a => a.kind) });
            }
        }
        const lang = getCurrentLanguage();
        const partnershipOf = (a: PersonId, b: PersonId): PartnershipId | null => {
            const u = DataManager.getPartnershipBetween(a, b) ?? DataManager.createPartnership(a, b, 'married');
            return u?.id ?? null;
        };
        // Events first (a marriage makes the couple), then the relationships.
        for (const item of items) {
            if (!item.checked || item.kind !== 'event') continue;
            const ev = entry.events[item.index];
            const tag = ev.type.toUpperCase();
            const date = readEventDate(ev);
            const place = ev.place?.text?.trim() ?? '';
            const who = item.refs.map(r => ids[r]).filter(Boolean);
            if (who.length !== item.refs.length) continue;
            let done = false;
            if (tag === 'MARR') {
                const u = partnershipOf(who[0], who[1]);
                if (u) {
                    const cur = DataManager.getData().partnerships[u];
                    const upd: { startDate?: string; startPlace?: string } = {};
                    if (date && !cur?.startDate) upd.startDate = date;
                    if (place && !cur?.startPlace) upd.startPlace = place;
                    if (Object.keys(upd).length > 0) DataManager.updatePartnership(u, upd);
                    DataManager.citePartnership(u, source.id);
                    done = true;
                }
            } else if (tag === 'BIRT' || tag === 'DEAT') {
                const birth = tag === 'BIRT';
                for (const id of who) {
                    const cur = DataManager.getPerson(id);
                    if (!cur) continue;
                    const upd: Partial<Person> = {};
                    if (date && !(birth ? cur.birthDate : cur.deathDate)) upd[birth ? 'birthDate' : 'deathDate'] = date;
                    if (place && !(birth ? cur.birthPlace : cur.deathPlace)) upd[birth ? 'birthPlace' : 'deathPlace'] = place;
                    if (Object.keys(upd).length > 0) DataManager.updatePerson(id, upd);
                    DataManager.citePerson(id, source.id, birth ? 'birth' : 'death');
                    done = true;
                }
            } else {
                const type = gedcomTagEventType(tag);
                if (type) {
                    for (const id of who) {
                        const added = DataManager.addLifeEvent(id, { type, ...(date ? { date } : {}), ...(place ? { place } : {}), sourceIds: [source.id] });
                        if (added) done = true;
                    }
                }
            }
            if (done) {
                const label = tag === 'MARR' ? t.marriage
                    : strings.events.types[tag === 'BIRT' ? 'birth' : tag === 'DEAT' ? 'death' : gedcomTagEventType(tag) ?? 'custom'];
                out.events.push([label, date ? formatFlexDate(date, lang) : ''].filter(Boolean).join(' '));
            }
        }
        const rels = items.filter(i => i.checked && i.kind === 'relation').map(i => entry.relations[i.index]);
        for (const r of rels) {
            if (r.type !== 'spouse' || !ids[r.a] || !ids[r.b]) continue;
            const u = partnershipOf(ids[r.a], ids[r.b]);
            if (u) { DataManager.citePartnership(u, source.id); out.relations++; }
        }
        for (const r of rels) {
            if (r.type !== 'parent') continue;
            const parent = ids[r.parent];
            const child = ids[r.child];
            if (!parent || !child || !DataManager.canAddParentChild(parent, child)) continue;
            // The child's other parent of this entry: the couple's family takes the child.
            const cur = DataManager.getPerson(child);
            const other = cur?.parentIds.find(id => id !== parent);
            const u = other ? DataManager.getPartnershipBetween(parent, other)?.id : undefined;
            if (DataManager.addParentChild(parent, child, u)) {
                if (u) {
                    // The first parent went in before the couple's family existed for this child.
                    const fam = DataManager.getData().partnerships[u];
                    if (fam && !fam.childIds.includes(child)) DataManager.addParentChild(other!, child, u);
                }
                out.relations++;
            }
        }
        DataManager.ensureSingleParentFamilies();
        // Every person written or linked cites the source.
        for (const id of new Set(Object.values(ids))) DataManager.citePerson(id, source.id);
        const first = out.newPersons[0];
        const main = entry.persons.find(p => ids[p.ref] && !['godparent', 'witness', 'midwife', 'priest', 'informant', 'mentioned', 'writer', 'other'].includes(p.role));
        const showId = first?.id ?? (main ? ids[main.ref] : undefined);
        const showPerson = showId ? DataManager.getPerson(showId) : null;
        out.show = showPerson ? { id: showPerson.id, name: shownName(showPerson) } : null;
        return out;
    },

    /** [5c]: what was written. */
    readWrittenHtml(): string {
        const t = strings.read;
        const w = written!;
        const rows: string[] = [];
        for (const p of w.newPersons) {
            rows.push(`<li>+ ${esc(p.name)}${p.uncertain ? ` <span class="read-w-unsure">· ${esc(t.writtenUncertain)}</span>` : ''}</li>`);
        }
        for (const l of w.linked) {
            rows.push(`<li>${esc(t.writtenLinked(l.name, [...new Set(l.kinds)].map(k => t.writtenLinkedWhat[k] ?? k).join(', ')))}</li>`);
        }
        const facts = [...w.events, ...(w.relations > 0 ? [t.writtenRelations(w.relations)] : [])];
        if (facts.length > 0) rows.push(`<li>${esc(facts.join(' · '))}</li>`);
        rows.push(`<li>${esc(t.writtenSource(w.source))}</li>`);
        const link = this.researchOriginalsLink();
        const research = link ? TreeManager.getTreeMetadata(link.treeId)?.research : undefined;
        const mode = researchSendMode(research);
        const sent = mode === 'auto' ? t.sentAuto : mode === 'manual' ? t.sentManual : t.sentOff;
        return `<ul class="read-written">${rows.join('')}</ul>
                <p class="read-w-sent" role="status">${esc(sent)}</p>`;
    },

    readWrittenFootHtml(): string {
        const t = strings.read;
        const show = written?.show;
        return `<span class="batch-foot-note"></span>
                <button type="button" class="${show ? 'secondary' : 'primary'}" data-act="close">${esc(t.close)}</button>
                ${show ? `<button type="button" class="primary" data-act="show-person">${esc(t.showPerson(show.name))}</button>` : ''}`;
    },
});
