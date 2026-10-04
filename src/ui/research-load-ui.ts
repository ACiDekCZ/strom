/**
 * "Load the research version?": before the research's version replaces a
 * tree, every value here it would change or remove, one row each (person ·
 * fact · here → from research), what it adds, and that a backup is saved.
 * Only loading from the research: said in amber that these values go, the
 * button "Load and overwrite". The last send left changes unwritten: said
 * the same way (they would go too). Resolves 'load', 'copy' or null.
 */

import { strings } from '../strings.js';
import { StromData, LifeEventType, Gender } from '../types.js';
import { diffValues, ValueChange } from '../research-changes.js';
import { formatFlexDate } from '../dates.js';
import { uiModule } from './module.js';
import { normalizeModal } from './modal-skeleton.js';

const LOAD_ID = 'research-load-modal';
/** Rows shown before "and N more". */
const ROWS_SHOWN = 8;
/** People with a sex left unknown named one by one, more counted. */
const SEX_LINES = 3;

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function eventLabel(type: string | undefined): string {
    if (!type) return '';
    if (type === 'birth') return strings.events.types.birth;
    if (type === 'death') return strings.events.types.death;
    if (type === 'person') return '';
    return (strings.events.types as Record<string, string>)[type as LifeEventType] ?? type;
}

/** The fact a row is about, in words ("Birth · Place", "Occupation", "Citation · Birth"). */
function fieldLabel(row: ValueChange): string {
    const s = strings.sync;
    const e = strings.events;
    const birth = strings.events.types.birth;
    const death = strings.events.types.death;
    switch (row.field) {
        case 'name': return s.fieldName;
        case 'gender': return s.fieldGender;
        case 'birthDate': return `${birth} · ${e.date}`;
        case 'birthPlace': return `${birth} · ${e.place}`;
        case 'deathDate': return `${death} · ${e.date}`;
        case 'deathPlace': return `${death} · ${e.place}`;
        case 'deathCause': return s.fieldCause;
        case 'notes': return s.fieldNote;
        case 'person': return s.fieldPerson;
        case 'event': case 'eventValue': return eventLabel(row.of);
        case 'eventDate': return `${eventLabel(row.of)} · ${e.date}`;
        case 'eventPlace': return `${eventLabel(row.of)} · ${e.place}`;
        case 'citation': return s.fieldCitation(eventLabel(row.of));
        case 'marriageDate': return `${s.fieldMarriage} · ${e.date}`;
        case 'marriagePlace': return `${s.fieldMarriage} · ${e.place}`;
    }
}

function valueText(row: ValueChange, value: string): string {
    if (!value) return row.field === 'person' ? '' : '–';
    if (row.field === 'gender') return value === 'male' ? strings.gender.male : value === 'female' ? strings.gender.female : value;
    return row.date ? formatFlexDate(value) || value : value;
}

export const researchLoadMethods = uiModule({
    /**
     * Ask before the research's version (`there`, stabilized to this tree's
     * ids) replaces `here`. `off`: the tree only loads from the research;
     * `notWritten`: changes of the last send the research did not write.
     * `sexUnknown`: people whose sex the research leaves unknown, their sex here kept;
     * `sexUnknownRefns`: the reference numbers of all whose sex it leaves unknown.
     */
    askResearchLoad(treeName: string, versionDate: string, here: StromData, there: StromData,
        opts: { off?: boolean; notWritten?: number; images?: { label: string; detail: string; checked: boolean }; sexUnknown?: { name: string; gender: Gender }[]; sexUnknownRefns?: ReadonlySet<string> } = {}): Promise<{ choice: 'load' | 'copy'; images: boolean } | null> {
        document.querySelectorAll(`#${LOAD_ID}`).forEach(el => el.remove());
        const s = strings.sync;
        const diff = diffValues(here, there);
        const people = new Set(diff.rows.map(r => r.personId)).size;
        const theirs = there;
        const row = (r: ValueChange, first: boolean): string => {
            const here = valueText(r, r.here);
            // A sex the research gives none for: the sex here is the app's guess, said so (N61-2).
            const noSex = r.field === 'gender' && !!opts.sexUnknownRefns?.has(theirs.persons[r.personId]?.refn?.trim() ?? '');
            const there = r.field === 'person' ? s.fieldPersonGone
                : noSex ? s.loadSexUnknownThere(valueText(r, r.there).toLocaleLowerCase()) : valueText(r, r.there);
            return `<tr${first ? ' class="is-first"' : ''}>`
                + `<td class="research-load-who">${first ? esc(r.name) : ''}</td>`
                + `<td class="research-load-field">${esc(fieldLabel(r))}${r.conflict ? ` <span class="research-load-conflict">${esc(s.conflictTag)}</span>` : ''}</td>`
                + `<td class="research-load-change"><span class="research-load-here">${esc(here)}</span> <span aria-hidden="true">→</span> <span class="research-load-there">${esc(there)}</span></td>`
                + '</tr>';
        };
        const rows = diff.rows.map((r, i) => row(r, i === 0 || diff.rows[i - 1].personId !== r.personId || diff.rows[i - 1].name !== r.name));
        const more = Math.max(0, rows.length - ROWS_SHOWN);
        const overwrite = !!opts.off || (opts.notWritten ?? 0) > 0;
        const warn = [opts.off ? s.offOverwrite : '', (opts.notWritten ?? 0) > 0 ? s.loadOverNotWritten(opts.notWritten!) : ''].filter(Boolean);
        const added = diff.addedPersons + diff.addedFacts > 0 ? s.loadAdded(diff.addedPersons, diff.addedFacts) : '';
        const unknownSex = opts.sexUnknown ?? [];
        const sexLines = unknownSex.length > SEX_LINES
            ? [s.loadSexUnknownMany(unknownSex.length)]
            : unknownSex.map(p => s.loadSexUnknown(p.name, (p.gender === 'male' ? strings.gender.male : strings.gender.female).toLocaleLowerCase()));
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay active';
        overlay.id = LOAD_ID;
        overlay.innerHTML = `
            <div class="modal modal--lg research-load" role="dialog" data-dialog-kind="decision" aria-modal="true" aria-labelledby="research-load-title">
                <div class="modal-header">
                    <div class="audit-log-heading">
                        <h2 id="research-load-title">${esc(s.loadTitle)}</h2>
                        <div class="audit-log-subtitle">${esc(s.loadSub(treeName, versionDate))}</div>
                    </div>
                </div>
                <div class="research-load-body">
                    ${warn.map(w => `<p class="research-load-warn">${esc(w)}</p>`).join('')}
                    ${rows.length ? `
                    <div class="research-load-table-wrap" id="research-load-table-wrap">
                        <table class="research-load-table">
                            <thead><tr><th>${esc(s.loadColPerson(people))}</th><th>${esc(s.loadColField)}</th><th>${esc(s.loadColChange)}</th></tr></thead>
                            <tbody>${rows.map((r, i) => i < ROWS_SHOWN ? r : r.replace('<tr', '<tr data-more hidden')).join('')}</tbody>
                        </table>
                    </div>
                    ${more ? `<button type="button" class="link-button research-load-more" id="research-load-more" aria-expanded="false" data-more-label="${esc(s.loadMore(more))}">${esc(s.loadMore(more))}</button>` : ''}`
                    : `<p class="research-load-nothing">${esc(s.nothingOverwritten)}</p>`}
                    ${added ? `<p class="research-load-added">${esc(added)}</p>` : ''}
                    ${sexLines.map(l => `<p class="research-load-sex">${esc(l)}</p>`).join('')}
                    ${opts.images ? `
                    <label class="research-load-images"><input type="checkbox" id="research-load-images"${opts.images.checked ? ' checked' : ''}>
                        <span>${esc(opts.images.label)} <span class="research-adopt-size">${esc(opts.images.detail)}</span></span></label>` : ''}
                    <p class="research-load-backup-narrow">${esc(s.loadBackupNote)}</p>
                </div>
                <div class="buttons research-load-foot">
                    <span class="research-send-dialog-note research-load-backup">${esc(s.loadBackupNote)}</span>
                    <button type="button" class="secondary" id="research-load-cancel" data-dismiss>${esc(strings.buttons.cancel)}</button>
                    ${overwrite ? `<button type="button" class="secondary" id="research-load-copy">${esc(strings.research.openCopy)}</button>` : ''}
                    <button type="button" class="primary" id="research-load-ok">${esc(overwrite ? s.loadOverwrite : s.load)}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this.pushDialog(LOAD_ID);
        normalizeModal(overlay.querySelector('.modal') as HTMLElement);
        const moreBtn = overlay.querySelector<HTMLButtonElement>('#research-load-more');
        moreBtn?.addEventListener('click', () => {
            const open = moreBtn.getAttribute('aria-expanded') !== 'true';
            overlay.querySelectorAll<HTMLElement>('tr[data-more]').forEach(tr => { tr.hidden = !open; });
            moreBtn.setAttribute('aria-expanded', String(open));
            moreBtn.textContent = open ? s.loadHide : moreBtn.dataset.moreLabel ?? '';
            overlay.querySelector('#research-load-table-wrap')?.classList.toggle('is-open', open);
        });
        return new Promise(resolve => {
            const finish = (choice: 'load' | 'copy' | null): void => {
                const images = overlay.querySelector<HTMLInputElement>('#research-load-images')?.checked ?? false;
                this.closeResearchLoad();
                resolve(choice ? { choice, images } : null);
            };
            this.researchLoadResolve = () => finish(null);
            (overlay.querySelector('#research-load-cancel') as HTMLButtonElement).onclick = () => finish(null);
            overlay.querySelector<HTMLButtonElement>('#research-load-copy')?.addEventListener('click', () => finish('copy'));
            (overlay.querySelector('#research-load-ok') as HTMLButtonElement).onclick = () => finish('load');
            (overlay.querySelector('#research-load-ok') as HTMLButtonElement).focus();
        });
    },

    /** Escape (the dialog's Cancel): nothing loads. */
    cancelResearchLoad(): void {
        const resolve = this.researchLoadResolve;
        if (resolve) resolve();
        else this.closeResearchLoad();
    },

    closeResearchLoad(): void {
        this.researchLoadResolve = null;
        document.querySelectorAll(`#${LOAD_ID}`).forEach(el => el.remove());
        this.dialogStack = this.dialogStack.filter(d => d !== LOAD_ID);
    },
});
