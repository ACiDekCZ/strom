/**
 * What a satellite's editors bring back when the main window refuses an edit
 * (spec 079 §3.4, 3d): nothing typed is dropped silently. An edit carries its
 * editor's draft (DataManager.runWithEditContext); refused, the fresh tree
 * comes in and the last draft opens again —
 *
 * - a Table cell: its editor over the cell with the text typed, framed as a
 *   draft ("Draft kept · Enter applies, Esc discards");
 * - the person dialog: open again for that person with the fields as they
 *   were, the conflict said at its top; Save sends a new edit.
 *
 * An editor still open when the fresh tree comes stays open with its text.
 */

/** A Table cell's text the satellite sent. */
export interface CellDraft {
    kind: 'cell';
    tree: string;
    rowType: string;
    /** The row's key (lineKey) and the column's id. */
    key: string;
    colId: string;
    text: string;
}

/** A form field's state: its value, or for a checkbox whether it is checked. */
export interface DraftField {
    value?: string;
    checked?: boolean;
}

/** The person dialog's fields the satellite sent. */
export interface PersonDraft {
    kind: 'person';
    tree: string;
    personId: string;
    /** By the field's id. */
    fields: Record<string, DraftField>;
}

export type WindowDraft = CellDraft | PersonDraft;

export function cellDraft(tree: string, rowType: string, key: string, colId: string, text: string): CellDraft {
    return { kind: 'cell', tree, rowType, key, colId, text };
}

export function isWindowDraft(d: unknown): d is WindowDraft {
    if (!d || typeof d !== 'object') return false;
    const k = (d as { kind?: unknown }).kind;
    return k === 'cell' || k === 'person';
}

/** The draft to bring back: the last one of the refused edits (the newest typing). */
export function draftToRestore(drafts: readonly unknown[]): WindowDraft | null {
    for (let i = drafts.length - 1; i >= 0; i--) {
        const d = drafts[i];
        if (isWindowDraft(d)) return d;
    }
    return null;
}

/**
 * The fields of a form by their ids (inputs, selects, text areas with an id):
 * text as typed, checkboxes and radios by `checked`. Files are left out.
 */
export function readFormFields(root: ParentNode): Record<string, DraftField> {
    const fields: Record<string, DraftField> = {};
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[id], select[id], textarea[id]').forEach((f) => {
        if (f instanceof HTMLInputElement && (f.type === 'file' || f.type === 'button' || f.type === 'submit')) return;
        if (f instanceof HTMLInputElement && (f.type === 'checkbox' || f.type === 'radio')) fields[f.id] = { checked: f.checked };
        else fields[f.id] = { value: f.value };
    });
    return fields;
}

/**
 * Put the fields back as they were (only those that differ; each changed one
 * gets its `input` and `change`, so what follows a field follows it). Returns
 * how many changed.
 */
export function writeFormFields(root: ParentNode, fields: Record<string, DraftField>): number {
    let changed = 0;
    for (const [id, want] of Object.entries(fields)) {
        const f = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${CSS.escape(id)}`);
        if (!f) continue;
        if (want.checked !== undefined && f instanceof HTMLInputElement) {
            if (f.checked === want.checked) continue;
            f.checked = want.checked;
        } else if (want.value !== undefined) {
            if (f.value === want.value) continue;
            f.value = want.value;
        } else continue;
        changed++;
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return changed;
}

/** What the satellite's drafts need from the client (SatelliteClient fits). */
export interface DraftsClient {
    on(event: 'conflict', cb: (e: { drafts: unknown[] }) => void): () => void;
    on(event: 'tree', cb: (e: { afterConflict: boolean }) => void): () => void;
}

export interface DraftsDeps {
    reopenCell: (draft: CellDraft) => boolean;
    reopenPerson: (draft: PersonDraft) => boolean;
    /** An editor still open: framed as a draft (true when there was one). */
    markOpenCell: () => boolean;
}

/** Refused edits bring their last draft back once the fresh tree is in. */
export function wireWindowDrafts(client: DraftsClient, deps: DraftsDeps): void {
    let waiting: WindowDraft | null = null;
    let refused = false;
    client.on('conflict', (e) => {
        refused = true;
        waiting = draftToRestore(e.drafts);
    });
    client.on('tree', (e) => {
        if (!e.afterConflict || !refused) return;
        refused = false;
        const draft = waiting;
        waiting = null;
        if (draft?.kind === 'person') { deps.reopenPerson(draft); return; }
        if (draft?.kind === 'cell' && deps.reopenCell(draft)) return;
        deps.markOpenCell();
    });
}
