/**
 * Settings → Person card: the preview card (one for the density and the
 * signals) and, for the "Custom" density, the list of details its lines show
 * (src/card-fields.ts). A row per event: a checkbox, the mark and the name,
 * small toggles for what the line adds (place, cause, the baptism or burial
 * standing in) and arrows to reorder — no dragging, seven rows is few enough.
 * At most five lines: with five ticked the rest wait, greyed, with a sentence
 * saying why.
 */

import { TreeRenderer } from '../renderer.js';
import { SettingsManager, CardSignals } from '../settings.js';
import { strings } from '../strings.js';
import { Person, PersonId, Partnership, PartnershipId, StromData } from '../types.js';
import { ActionSignal, ACTION_GLYPH, stateStripesHtml } from '../card-signals.js';
import {
    CardFieldKey, CardFieldSettings, CARD_MARKS, MAX_CARD_LINES, PLACE_KEYS, cardLines,
} from '../card-fields.js';
import { uiModule } from './module.js';

const esc = (text: string): string => text.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The name of a row: the event types, the couple's two from the relationships panel. */
function fieldLabel(key: CardFieldKey): string {
    if (key === 'marriage') return strings.fields.marriageRow;
    if (key === 'divorce') return strings.fields.divorceRow;
    return strings.events.types[key];
}

/** A made-up person for the preview: a miller who died of consumption, married once. */
function samplePerson(): { person: Person; data: StromData } {
    const jan = 'sample_jan' as PersonId;
    const marie = 'sample_marie' as PersonId;
    const union = 'sample_union' as PartnershipId;
    const d = strings.cardDensity;
    const person: Person = {
        id: jan, firstName: 'Jan', lastName: 'Vlk', gender: 'male', isPlaceholder: false,
        birthDate: '1862', birthPlace: 'Horní Lhota',
        deathDate: '1919-03-12', deathPlace: 'Horní Lhota', deathCause: d.sampleCause,
        partnerships: [union], parentIds: [], childIds: [],
        events: [
            { id: 'e1', type: 'baptism', date: '1862-03-02', place: 'Horní Lhota' },
            { id: 'e2', type: 'burial', date: '1919-03-15', place: 'Horní Lhota' },
            { id: 'e3', type: 'occupation', note: d.sampleOccupation },
        ],
    };
    const partnership: Partnership = {
        id: union, person1Id: jan, person2Id: marie, childIds: [], status: 'married',
        startDate: '1888-02-14', startPlace: 'Dolní Lhota',
    };
    return { person, data: { persons: { [jan]: person }, partnerships: { [union]: partnership } } };
}

export const cardFieldsUiMethods = uiModule({
    /** The preview card under the density select, with the card's size. */
    renderCardPreview(): void {
        const host = document.getElementById('card-preview-settings');
        if (!host) return;
        const size = SettingsManager.getCardSize();
        host.innerHTML = `
            <div class="card-preview-head">
                <span class="card-signals-preview-title">${esc(strings.cardDensity.cardPreview)}</span>
                <span class="card-preview-size">${esc(strings.cardDensity.size(size.cardWidth, size.cardHeight))}</span>
            </div>
            <div class="card-signals-preview" aria-hidden="true">${this.cardPreviewHtml(SettingsManager.getCardSignals())}</div>`;
    },

    /** A made-up card in the current density with the chosen signals. */
    cardPreviewHtml(on: CardSignals): string {
        const density = SettingsManager.getCardDensity();
        const stripes = stateStripesHtml(on.evidence ? 'partial' : null, on.story ? 'draft' : null);
        const action: ActionSignal | null = on.waiting ? 'waiting' : on.conflict ? 'conflict' : on.question ? 'question' : null;
        const badge = action ? `<span class="card-signal signal-${action}">${ACTION_GLYPH[action]}</span>` : '';
        const dot = action ? `<span class="card-signal-dot signal-${action}"></span>` : '';
        const avatar = (initials: string) =>
            `<div class="card-avatar-wrap"><div class="card-avatar"><span class="avatar-initials">${initials}</span></div>${badge}</div>`;
        if (density === 'custom') {
            const { person, data } = samplePerson();
            const lines = cardLines(person, data, SettingsManager.getCardFields());
            return `
                <div class="person-card male preview-card${action ? ' has-signal' : ''}" data-density="custom">
                    <div class="card-body card-body--custom">
                        <div class="card-head">${avatar('JV')}<div class="name"><span class="name-text">Jan Vlk</span></div></div>
                        <div class="card-lines">${lines.map(l =>
                            `<div class="card-line"><span class="card-line-mark">${esc(l.mark)}</span><span class="card-line-text">${esc(l.text)}</span></div>`).join('')}</div>
                    </div>
                    ${stripes}
                    ${dot}
                </div>`;
        }
        const compact = density === 'compact';
        return `
            <div class="person-card male preview-card${action ? ' has-signal' : ''}" data-density="${density}">
                ${compact ? '' : avatar('JV')}
                <div class="card-body">
                    <div class="name"><span class="name-text">Jan Vlk</span></div>
                    ${compact ? '' : '<div class="birth-date"><span class="meta-text">1862 – 1919 · Horní Lhota</span></div>'}
                </div>
                ${stripes}
                ${dot}
            </div>`;
    },

    /** "Details on the card": only for the custom density. */
    renderCardFieldsSettings(): void {
        const host = document.getElementById('card-fields-settings');
        if (!host) return;
        const custom = SettingsManager.getCardDensity() === 'custom';
        host.hidden = !custom;
        if (!custom) { host.innerHTML = ''; return; }
        const d = strings.cardDensity;
        const s = SettingsManager.getCardFields();
        const full = s.on.length >= MAX_CARD_LINES;
        const chip = (key: CardFieldKey, opt: string, label: string, pressed: boolean) =>
            `<button type="button" class="card-field-chip" data-key="${key}" data-opt="${opt}" aria-pressed="${pressed}">${esc(label)}</button>`;
        const rows = s.order.map((key, i) => {
            const on = s.on.includes(key);
            const disabled = !on && full;
            const chips = !on ? [] : [
                PLACE_KEYS.includes(key) ? chip(key, 'place', d.optPlace, s.place.includes(key)) : '',
                key === 'death' ? chip(key, 'cause', d.optCause, s.cause) : '',
                key === 'birth' && !s.on.includes('baptism') ? chip(key, 'baptism', d.optBaptism, s.baptismFallback) : '',
                key === 'death' && !s.on.includes('burial') ? chip(key, 'burial', d.optBurial, s.burialFallback) : '',
            ].filter(Boolean);
            const label = fieldLabel(key);
            return `
                <div class="card-field-row${on ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}" data-key="${key}">
                    <label class="card-field-main">
                        <input type="checkbox" data-key="${key}"${on ? ' checked' : ''}${disabled ? ' disabled aria-disabled="true"' : ''}>
                        <span class="card-field-mark" aria-hidden="true">${esc(CARD_MARKS[key])}</span>
                        <span class="card-field-name">${esc(label)}</span>
                    </label>
                    ${chips.length ? `<div class="card-field-chips" role="group" aria-label="${esc(label)}">${chips.join('')}</div>` : ''}
                    <div class="card-field-move">
                        <button type="button" class="card-field-up" data-key="${key}" aria-label="${esc(`${d.moveUp}: ${label}`)}"${i === 0 ? ' disabled' : ''}>↑</button>
                        <button type="button" class="card-field-down" data-key="${key}" aria-label="${esc(`${d.moveDown}: ${label}`)}"${i === s.order.length - 1 ? ' disabled' : ''}>↓</button>
                    </div>
                </div>`;
        }).join('');
        host.innerHTML = `
            <div class="card-fields-head">
                <span class="settings-name">${esc(d.fieldsTitle)}</span>
                <div class="segment card-fields-date" role="group" aria-label="${esc(d.fieldsTitle)}">
                    <button type="button" class="segment-btn${s.fullDate ? '' : ' active'}" data-full="0" aria-pressed="${!s.fullDate}">${esc(d.yearOnly)}</button>
                    <button type="button" class="segment-btn${s.fullDate ? ' active' : ''}" data-full="1" aria-pressed="${s.fullDate}">${esc(d.fullDate)}</button>
                </div>
            </div>
            <div class="card-fields-list">${rows}</div>
            <div class="card-fields-status${full ? ' is-full' : ''}" role="status">${esc(full ? d.max : d.count(s.on.length))}</div>`;

        const apply = (next: CardFieldSettings, focus?: string): void => {
            SettingsManager.setCardFields(next);
            this.renderCardFieldsSettings();
            this.renderCardPreview();
            TreeRenderer.render();
            if (focus) host.querySelector<HTMLElement>(focus)?.focus();
        };
        host.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-key]').forEach(input => {
            input.onchange = () => {
                const key = input.dataset.key as CardFieldKey;
                const on = input.checked ? [...s.on, key] : s.on.filter(k => k !== key);
                apply({ ...s, on: s.order.filter(k => on.includes(k)) }, `input[data-key="${key}"]`);
            };
        });
        host.querySelectorAll<HTMLButtonElement>('.card-field-chip').forEach(btn => {
            btn.onclick = () => {
                const key = btn.dataset.key as CardFieldKey;
                const opt = btn.dataset.opt;
                const sel = `.card-field-chip[data-key="${key}"][data-opt="${opt}"]`;
                if (opt === 'place') {
                    const place = s.place.includes(key) ? s.place.filter(k => k !== key) : [...s.place, key];
                    apply({ ...s, place }, sel);
                } else if (opt === 'cause') apply({ ...s, cause: !s.cause }, sel);
                else if (opt === 'baptism') apply({ ...s, baptismFallback: !s.baptismFallback }, sel);
                else if (opt === 'burial') apply({ ...s, burialFallback: !s.burialFallback }, sel);
            };
        });
        host.querySelectorAll<HTMLButtonElement>('.card-field-up, .card-field-down').forEach(btn => {
            btn.onclick = () => {
                const key = btn.dataset.key as CardFieldKey;
                const up = btn.classList.contains('card-field-up');
                const order = [...s.order];
                const i = order.indexOf(key);
                const j = up ? i - 1 : i + 1;
                if (j < 0 || j >= order.length) return;
                [order[i], order[j]] = [order[j], order[i]];
                const edge = up ? j === 0 : j === order.length - 1;
                // Keep the keyboard on the row it moved; at the end, on the other arrow.
                const cls = edge ? (up ? 'card-field-down' : 'card-field-up') : (up ? 'card-field-up' : 'card-field-down');
                apply({ ...s, order, on: order.filter(k => s.on.includes(k)) }, `.${cls}[data-key="${key}"]`);
            };
        });
        host.querySelectorAll<HTMLButtonElement>('.card-fields-date .segment-btn').forEach(btn => {
            btn.onclick = () => apply({ ...s, fullDate: btn.dataset.full === '1' }, `.card-fields-date [data-full="${btn.dataset.full}"]`);
        });
    },
});
