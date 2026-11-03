/**
 * The "Deceased" box of a person form follows the death fields: a death date
 * or place typed in ticks it (somebody with a death on record has died). A
 * tick put there this way goes again when those fields are emptied, unless
 * the box was clicked meanwhile; a box ticked by hand is never unticked.
 *
 * Shared by the person form (adding and editing) and the form for adding a
 * relative. Call it every time the form opens: the listeners are bound once,
 * the "ticked by the fields" mark starts afresh.
 */
export function bindDeceasedAutoTick(boxId: string, fieldIds: readonly string[]): void {
    const box = document.getElementById(boxId) as HTMLInputElement | null;
    if (!box) return;
    delete box.dataset.autoTicked;
    if (box.dataset.autoTickBound) return;
    box.dataset.autoTickBound = '1';
    // A click on the box is the person's own word: the fields no longer decide.
    box.addEventListener('change', () => { delete box.dataset.autoTicked; });
    const fields = fieldIds
        .map(id => document.getElementById(id) as HTMLInputElement | null)
        .filter((f): f is HTMLInputElement => !!f);
    const follow = (): void => {
        if (box.disabled) return;
        const filled = fields.some(f => f.value.trim() !== '');
        if (filled && !box.checked) {
            box.checked = true;
            box.dataset.autoTicked = '1';
        } else if (!filled && box.checked && box.dataset.autoTicked) {
            box.checked = false;
            delete box.dataset.autoTicked;
        }
    };
    for (const f of fields) {
        f.addEventListener('input', follow);
        f.addEventListener('change', follow);
    }
}
