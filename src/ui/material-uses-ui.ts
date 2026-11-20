/**
 * "Where used" of a material (spec 102 §3): the block in the viewer's panel
 * (also the phone's sheet) and in the Attachment dialog. In the tree: the
 * file's places, the portraits and excerpts cut from it and the couple photos
 * taken from it, each a link, a place with "×" that takes the file off it
 * (one undo step, a toast with Undo). In the archive (a tree with one): the
 * people the archive assigned it to and what the research says it uses it
 * for (`material.uses`, remembered while the bridge is down).
 *
 * See src/ui/module.ts for the composition pattern.
 */

import { DataManager } from '../data.js';
import { PersonId } from '../types.js';
import { strings, getCurrentLanguage } from '../strings.js';
import { MaterialItem, MaterialSourceOf, cachedMaterialList } from '../materials.js';
import { MediaUse, materialPersonLabel, mediaUseLabel, mediaUses } from '../media-uses.js';
import { placePersonId } from '../media.js';
import { nameWithoutYears } from '../materials-overview.js';
import { researchPersonRef, researchSourceRef } from '../research-link.js';
import { treeFileSource } from '../material-delete.js';
import { closeImageViewer } from './image-viewer.js';
import type { MaterialsContext } from './materials-ui.js';
import { uiModule } from './module.js';
import { runBusy } from './busy.js';

/** The longest a material write takes: its own 30 s and the research's busy retries (§10.3). */
const MATERIAL_WRITE_MS = 45_000;

/** Up to this many places all show; more: the first COLLAPSED_ROWS and "+ N more". */
const COLLAPSE_OVER = 5;
const COLLAPSED_ROWS = 4;

export interface MaterialUsesOpts {
    /** The places beyond the first four are shown. */
    expanded: boolean;
    /** "+ N more" clicked (the caller keeps the state and redraws). */
    expand: () => void;
    /** Where it is drawn: the viewer's panel or the Attachment dialog. */
    where: 'viewer' | 'dialog';
    /** Before a link leaves for a person or a source (the dialog closes). */
    leave?: () => void;
    /** A place was taken off (the dialog draws the block again; the viewer redraws on the commit). */
    changed?: () => void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
}

function clockTime(ms: number): string {
    return new Date(ms).toLocaleTimeString(getCurrentLanguage(), { hour: '2-digit', minute: '2-digit' });
}

export const materialUsesMethods = uiModule({
    /** The block "Where used" of `item` (3a–3d). */
    materialUsesBlock(item: MaterialItem, ctx: MaterialsContext | null, opts: MaterialUsesOpts): HTMLElement {
        const m = strings.materials;
        const data = DataManager.getData();
        const att = item.attachment ? DataManager.getMedia(item.attachment.id) : undefined;
        const uses = att && att.places.length ? mediaUses(data, att.id) : [];
        const archive = !!ctx?.caps.list;
        const block = h('section', 'mv-uses');
        block.dataset.uses = String(uses.length);

        // The file of a source (spec 102 §7, set only with `material.sourceOf`): its sources first.
        // A family tree file (spec 117 §5): what refers to it, the live source made of it or none.
        const treeSource = item.tree ? treeFileSource(item) : null;
        const of = archive ? item.sourceOf ?? (treeSource ? [treeSource] : []) : [];
        const head = h('div', 'mv-uses-head');
        const title = h('h3', 'mv-uses-title', item.tree ? m.del.refs(1) : m.used);
        head.appendChild(title);
        const count = item.tree ? '' : [of.length ? m.agentSort.sourcesN(of.length) : '', uses.length ? m.places(uses.length) : ''].filter(Boolean).join(' · ');
        if (count) head.appendChild(h('span', 'mv-uses-count', count));
        block.appendChild(head);
        if (item.tree) {
            // "the file of the source {title}", else that none was made of it; never in the tree itself: no places, no Link to….
            block.appendChild(treeSource ? h('p', 'mv-uses-treeof', m.treeFileOf(treeSource.title ?? treeSource.source)) : h('p', 'mv-uses-none', m.del.noRefsTree));
            return block;
        }
        if (of.length) block.appendChild(this.materialSourceOfRows(of, ctx!, opts));
        // In the tree only through a source and nowhere of its own: no "Not in the tree yet." (Link to… stays an action).
        const viaSourceOnly = !uses.length && of.some(s => s.inTree);
        if (archive && !viaSourceOnly) block.appendChild(h('div', 'mv-uses-sub', m.usedInTree));

        if (uses.length) {
            const collapse = uses.length > COLLAPSE_OVER && !opts.expanded;
            const shown = collapse ? uses.slice(0, COLLAPSED_ROWS) : uses;
            const grid = h('div', 'mv-uses-grid');
            for (const use of shown) this.materialUseRow(grid, item, att!.id, use, ctx, opts);
            block.appendChild(grid);
            if (collapse) {
                const more = h('button', 'link-button mv-uses-more', m.moreN(uses.length - COLLAPSED_ROWS));
                more.type = 'button';
                more.setAttribute('aria-expanded', 'false');
                more.addEventListener('click', () => opts.expand());
                block.appendChild(more);
            }
        } else if (!viaSourceOnly) {
            const none = h('p', 'mv-uses-none', m.nowhereYet);
            // Link to… (spec 102 §4): the tree's file, or material outside the tree while the bridge runs (Q2).
            const canLink = !DataManager.isReadOnly() && !item.removedId
                && (att ? DataManager.canEditMedia(att.id) : !!item.file && !!ctx?.caps.assign && !!ctx.caps.bridgeUp && !!ctx.base);
            if (canLink) {
                const link = h('button', 'link-button mv-uses-attach', m.attach);
                link.type = 'button';
                link.addEventListener('click', () => {
                    if (opts.where === 'dialog') opts.leave?.();
                    this.openAttachDialog([item], { personId: this.materialContextPerson(), done: () => opts.changed?.() });
                });
                none.append(' ', link);
            }
            block.appendChild(none);
        }

        if (archive && item.file) {
            const arch = h('div', 'mv-uses-archive');
            arch.appendChild(h('div', 'mv-uses-sub', m.usedInArchive));
            if (item.origin === 'archive' && item.persons.length) arch.appendChild(this.materialArchivePersons(item, ctx!));
            if (ctx!.caps.uses) {
                const u = item.file.uses;
                const text = u ? m.usesArchive(u.excerpts, u.sources.length, u.tasks) : '';
                if (text) {
                    const at = ctx!.caps.bridgeUp ? null : cachedMaterialList(ctx!.treeId)?.fetchedAt;
                    arch.appendChild(h('p', 'mv-uses-arch', at ? `${text} · ${m.usesStale(clockTime(at))}` : text));
                }
            } else {
                arch.appendChild(h('p', 'mv-uses-arch is-faint', m.usesOlder));
            }
            if (arch.childElementCount > 1) block.appendChild(arch);
        }
        return block;
    },

    /**
     * "File of a source" (spec 102 §7): one row per source, its title a link to the tree's source (none: the
     * title alone), under it how the file belongs to it and who cites it.
     */
    materialSourceOfRows(of: readonly MaterialSourceOf[], ctx: MaterialsContext, opts: MaterialUsesOpts): HTMLElement {
        const m = strings.materials;
        const s = m.agentSort;
        const data = DataManager.getData();
        const wrap = h('div', 'mv-uses-sourceof');
        wrap.appendChild(h('div', 'mv-uses-sub', s.usesSourceOf));
        const grid = h('div', 'mv-uses-grid');
        const bySourceRef = new Map<string, string>();
        for (const src of Object.values(data.sources ?? {})) {
            const ref = researchSourceRef(src.refn);
            if (ref && !bySourceRef.has(ref)) bySourceRef.set(ref, src.id);
        }
        const names = this.materialRefnNames(ctx);
        for (const use of of) {
            grid.appendChild(h('span', 'mv-use-type', m.usedType.source));
            const main = h('div', 'mv-use-main');
            const sourceId = bySourceRef.get(use.source);
            const label = use.title ?? (sourceId ? data.sources?.[sourceId]?.title : undefined) ?? use.source;
            if (sourceId) {
                const link = h('button', 'mv-use-link', label);
                link.type = 'button';
                link.dataset.use = 'sourceof';
                link.addEventListener('click', () => this.openMaterialUse({ kind: 'source', sourceId }, opts));
                main.appendChild(link);
            } else {
                main.appendChild(h('span', 'mv-use-text', label));
            }
            const sub = h('span', 'mv-use-sub', use.via === 'input' ? s.viaInput : use.via === 'media' ? s.viaMedia : s.viaExcerpt);
            if (use.cited.length) {
                // "Cited by: <name>, + 2": the first person's name in serif, the rest counted.
                const [before, after = ''] = s.citedBy('\u0000', use.citedCount - 1).split('\u0000');
                sub.append(` · ${before}`, h('span', 'is-person', nameWithoutYears(names(use.cited[0]))), after);
            }
            main.appendChild(sub);
            grid.appendChild(main);
            grid.appendChild(h('span'));
        }
        wrap.appendChild(grid);
        return wrap;
    },

    /** A REFN's name: the tree's person (without a name: what the research calls them), else the research's name, else the REFN. */
    materialRefnNames(ctx: MaterialsContext): (refn: string) => string {
        const tree = new Map<string, string>();
        for (const p of DataManager.getAllPersons()) {
            const refn = researchPersonRef(p.refn);
            const own = `${p.firstName} ${p.lastName}`.trim();
            if (refn && !tree.has(refn) && own && own !== '?') tree.set(refn, own);
        }
        const known = cachedMaterialList(ctx.treeId)?.people ?? {};
        return refn => tree.get(refn) ?? (known[refn] ? materialPersonLabel(known[refn]) : refn);
    },

    /** One place's row: its kind, the link (and its sentence), "×" for a place of its own. */
    materialUseRow(grid: HTMLElement, item: MaterialItem, mediaId: string, use: MediaUse, ctx: MaterialsContext | null, opts: MaterialUsesOpts): void {
        const m = strings.materials;
        const label = mediaUseLabel(DataManager.getData(), use);
        grid.appendChild(h('span', 'mv-use-type', label.type));
        const main = h('div', 'mv-use-main');
        const link = h('button', `mv-use-link${label.person ? ' is-person' : ''}`, label.text);
        link.type = 'button';
        link.dataset.use = use.kind;
        link.addEventListener('click', () => this.openMaterialUse(use, opts));
        main.appendChild(link);
        if (label.sub) main.appendChild(h('span', 'mv-use-sub', label.sub));
        grid.appendChild(main);
        const pid = use.place ? placePersonId(use.place) : undefined;
        const removable = !!use.place && DataManager.canEditMedia(mediaId) && !(pid && DataManager.isPersonLocked(pid));
        if (removable) {
            const x = h('button', 'mv-use-x', '×');
            x.type = 'button';
            x.setAttribute('aria-label', m.unlink(label.text));
            x.title = m.unlink(label.text);
            x.addEventListener('click', () => void this.removeMaterialUse(item, mediaId, use, label.text, ctx, opts));
            grid.appendChild(x);
        } else {
            grid.appendChild(h('span'));
        }
    },

    /** The people the archive assigned an archive file to (today's chips, × through the bridge). */
    materialArchivePersons(item: MaterialItem, ctx: MaterialsContext): HTMLElement {
        const m = strings.materials;
        const row = h('div', 'mv-uses-persons');
        row.appendChild(h('span', 'mv-label', m.archivePersons));
        const chips = h('div', 'mv-chips');
        const byRefn = new Map<string, { id: PersonId; name: string }>();
        for (const p of DataManager.getAllPersons()) {
            const refn = researchPersonRef(p.refn);
            if (refn && !byRefn.has(refn)) byRefn.set(refn, { id: p.id, name: `${p.firstName} ${p.lastName}`.trim() });
        }
        const known = cachedMaterialList(ctx.treeId)?.people ?? {};
        const up = ctx.caps.bridgeUp && !!ctx.base;
        for (const refn of item.persons) {
            const person = byRefn.get(refn);
            const own = person?.name && person.name !== '?' ? person.name : '';
            const name = own || (known[refn] ? materialPersonLabel(known[refn]) : person ? materialPersonLabel(person.name) : refn);
            const chip = h('span', 'mv-chip');
            if (person) {
                const link = h('button', 'mv-chip-link', name);
                link.type = 'button';
                const id = person.id;
                link.addEventListener('click', () => this.focusMaterialPerson(id));
                chip.appendChild(link);
            } else {
                const plain = h('span', 'mv-chip-name', name);
                plain.title = ctx.agent ? m.personNotInTreeResearch : m.personNotInTree;
                plain.tabIndex = 0;
                chip.appendChild(plain);
            }
            if (item.viaBatch.includes(refn)) chip.appendChild(h('span', 'mv-chip-via', m.viaBatch));
            if (ctx.caps.assign && !DataManager.isReadOnly()) {
                const x = h('button', 'mv-chip-x', '×');
                x.type = 'button';
                x.setAttribute('aria-label', m.removePerson(name));
                x.title = up ? m.removeFromThis : m.actionsWhenRunning;
                if (!up) x.setAttribute('aria-disabled', 'true');
                x.addEventListener('click', () => {
                    if (x.getAttribute('aria-disabled') === 'true') return;
                    // §5 (B100): the research takes seconds to commit; the spinner takes the ×'s place (a second
                    // click sends nothing) and a refusal is a sentence under the chip with "Try again".
                    void runBusy(x, ctl => new Promise<void>(resolve => {
                        this.materialAction('removeFromPerson', [item], {
                            person: refn, where: 'viewer', anchor: chip, settled: () => resolve(),
                            refused: end => ctl.end({
                                ok: false, kind: 'error', text: end.text,
                                ...(end.retry ? { retry: () => { if (x.isConnected) x.click(); else end.retry!(); } } : {}),
                                ...(end.alt ? { alt: end.alt } : {}),
                            }),
                        });
                    }), { kind: 'write', timeoutMs: MATERIAL_WRITE_MS });
                });
                chip.appendChild(x);
            }
            chips.appendChild(chip);
        }
        row.appendChild(chips);
        return row;
    },

    /** A use's link: the person (a couple: its first partner) in the tree, or the source. */
    openMaterialUse(use: MediaUse, opts: MaterialUsesOpts): void {
        opts.leave?.();
        if (use.kind === 'source' || use.kind === 'excerpt') {
            if (!use.sourceId) return;
            closeImageViewer();
            if (document.getElementById('materials-modal')) this.closeMaterials();
            if (document.getElementById('person-modal')?.classList.contains('active')) {
                this.closeModal();
                // Unsaved changes: their dialog decides.
                if (document.getElementById('person-modal')?.classList.contains('active')) return;
            }
            this.showSourceViewer(use.sourceId, null);
            return;
        }
        const personId = use.personId ?? (use.partnershipId ? DataManager.getPartnership(use.partnershipId)?.person1Id : undefined);
        if (personId) this.focusMaterialPerson(personId);
    },

    /**
     * "×": the file off that place (one undo step, the toast "Removed: …").
     * Its last place where nothing else keeps the file (no archive holding
     * the original) deletes it, so that asks first.
     */
    async removeMaterialUse(item: MaterialItem, mediaId: string, use: MediaUse, what: string, ctx: MaterialsContext | null, opts: MaterialUsesOpts): Promise<void> {
        const place = use.place;
        const att = DataManager.getMedia(mediaId);
        if (!place || !att) return;
        // The last place (spec 102 §9): with an archive the file stays there (toast); without one it asks (9d).
        if (att.places.length === 1) {
            const leave = () => { if (opts.where === 'viewer') closeImageViewer(); else opts.leave?.(); };
            if (await this.removeLastMaterialPlace({ ...item, attachment: att }, mediaId, place, what, leave)) opts.changed?.();
            return;
        }
        if (DataManager.removeMediaPlace(mediaId, place, { toast: strings.materials.removedToast(what, item.title) })) opts.changed?.();
    },
});
