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
import { MaterialItem, cachedMaterialList } from '../materials.js';
import { MediaUse, mediaUseLabel, mediaUses } from '../media-uses.js';
import { placePersonId } from '../media.js';
import { researchPersonRef } from '../research-link.js';
import { closeImageViewer } from './image-viewer.js';
import type { MaterialsContext } from './materials-ui.js';
import { uiModule } from './module.js';

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

        const head = h('div', 'mv-uses-head');
        const title = h('h3', 'mv-uses-title', m.used);
        head.appendChild(title);
        if (uses.length) head.appendChild(h('span', 'mv-uses-count', m.places(uses.length)));
        block.appendChild(head);
        if (archive) block.appendChild(h('div', 'mv-uses-sub', m.usedInTree));

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
        } else {
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
            const name = person?.name || known[refn] || refn;
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
                    if (x.getAttribute('aria-disabled') === 'true' || x.getAttribute('aria-busy') === 'true') return;
                    // The research takes seconds to commit: the × waits (a second click sends nothing).
                    x.setAttribute('aria-busy', 'true');
                    this.materialAction('removeFromPerson', [item], {
                        person: refn, where: 'viewer', anchor: chip, settled: () => x.removeAttribute('aria-busy'),
                    });
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
