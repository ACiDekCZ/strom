/**
 * The details a record adds to an event beyond its date and place — cause,
 * age as recorded, house / address — in the person dialog, the event editor and
 * the relationships panel.
 *
 * Kept quiet on purpose: a field with a value is always shown (an imported one
 * too), an empty one waits behind one line of quiet text under the date and
 * place ("+ cause, age, address"). A click shows them all and focuses the first;
 * fields still empty after saving hide again the next time. Someone who never
 * reads a register sees one extra line, nothing more. Independent of the
 * advanced-fields setting: a cause of death is an ordinary fact.
 *
 * Markup: a group element holds `.detail-field[data-detail=cause|age|address]`
 * (each with its input or inputs) and one `button.detail-more`.
 */

import { strings } from '../strings.js';
import { LifeEventType } from '../types.js';
import { checkRecordedAge } from '../recorded-age.js';
export { ageBirthDate } from '../recorded-age.js';

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The details of an event (LifeEvent fields). */
export type EventDetailKey = 'cause' | 'age' | 'address';
export const DETAIL_KEYS: readonly EventDetailKey[] = ['cause', 'age', 'address'];
/** …and 'title': the titles of a person's name, the same quiet pattern under the name fields. */
export type DetailKey = EventDetailKey | 'title';
const GROUP_KEYS: readonly DetailKey[] = [...DETAIL_KEYS, 'title'];

/** Which details an event type offers behind the link (one that has a value shows anyway). */
export function offeredDetails(type: LifeEventType | 'marriage'): DetailKey[] {
    switch (type) {
        case 'death':
        case 'custom': return ['cause', 'age', 'address'];
        case 'burial': return ['age'];
        case 'birth':
        case 'baptism':
        case 'residence': return ['address'];
        case 'marriage': return ['age', 'address'];
        default: return [];
    }
}

const shortName = (key: DetailKey): string =>
    key === 'cause' ? strings.fields.causeShort : key === 'age' ? strings.fields.ageShort
        : key === 'title' ? strings.fields.titleShort : strings.fields.addressShort;

const fieldOf = (group: HTMLElement, key: DetailKey): HTMLElement | null =>
    group.querySelector<HTMLElement>(`.detail-field[data-detail="${key}"]`);

const hasValue = (field: HTMLElement): boolean =>
    [...field.querySelectorAll<HTMLInputElement>('input, textarea')].some(i => i.value.trim() !== '');

/**
 * Show the fields that have a value (and, once the link was clicked, every
 * offered one); the link names the offered fields still hidden.
 */
export function refreshDetailGroup(group: HTMLElement, offered: DetailKey[], readOnly = false): void {
    const open = group.dataset.open === '1';
    const hidden: DetailKey[] = [];
    for (const key of GROUP_KEYS) {
        const field = fieldOf(group, key);
        if (!field) continue;
        const show = hasValue(field) || (open && offered.includes(key));
        field.hidden = !show;
        if (!show && offered.includes(key)) hidden.push(key);
    }
    // A row of the grid with nothing in it takes no room.
    group.querySelectorAll<HTMLElement>('.detail-row').forEach(row => {
        row.hidden = ![...row.querySelectorAll<HTMLElement>('.detail-field')].some(f => !f.hidden);
    });
    const more = group.querySelector<HTMLButtonElement>('.detail-more');
    if (!more) return;
    more.hidden = readOnly || hidden.length === 0;
    more.textContent = strings.fields.addMore(hidden.map(shortName));
    more.onclick = () => {
        group.dataset.open = '1';
        refreshDetailGroup(group, offered, readOnly);
        const first = hidden.map(k => fieldOf(group, k)).find(Boolean);
        // The first input on screen (a couple's event hides the single age input).
        const inputs = [...(first?.querySelectorAll<HTMLInputElement>('input, textarea') ?? [])];
        (inputs.find(i => !i.closest('[hidden]')) ?? inputs[0])?.focus();
    };
}

/** Start a group closed again (each time its dialog opens). */
export function resetDetailGroup(group: HTMLElement | null, offered: DetailKey[], readOnly = false): void {
    if (!group) return;
    delete group.dataset.open;
    refreshDetailGroup(group, offered, readOnly);
}

/**
 * The quiet second line under an event in a list: "consumption · 54 years ·
 * No. 13" — cause, age, house in that order. In the life timeline the age
 * says it is the recorded one ("recorded as 54 years"). '' without details.
 */
export function eventDetailLine(d: { cause?: string; age?: string; address?: string } | undefined,
    recordedWords = false): string {
    if (!d) return '';
    const age = d.age?.trim();
    return [
        d.cause?.trim() ?? '',
        age ? (recordedWords ? strings.fields.ageRecorded(age) : age) : '',
        d.address?.trim() ?? '',
    ].filter(Boolean).join(' · ');
}

/**
 * The line under an age field: "Calculated 56–57 years", or in amber
 * "Differs from calculation (56–57 years) by 2 years" when the record lies
 * outside what the dates allow — a lead, never an error. Hidden without a
 * birth date. `prefix` names the partner in the relationships panel.
 */
export function renderAgeCheck(el: HTMLElement | null, recorded: string, birth?: string, eventDate?: string,
    prefix?: string): void {
    if (!el) return;
    const check = checkRecordedAge(recorded, birth, eventDate);
    el.classList.toggle('age-check--warn', !!check?.differs);
    if (!check) {
        el.innerHTML = prefix ? escapeHtml(prefix) : '';
        el.hidden = !prefix;
        return;
    }
    el.hidden = false;
    const f = strings.fields;
    if (check.differs) {
        el.innerHTML = `${prefix ? `${escapeHtml(prefix)} · ` : ''}<strong>${escapeHtml(f.ageDiffersLead)}</strong> `
            + escapeHtml(f.ageDiffers(check.range, check.differs));
    } else {
        el.innerHTML = escapeHtml(prefix ? f.partnerAge(prefix, check.range) : f.ageComputed(check.range));
    }
}
