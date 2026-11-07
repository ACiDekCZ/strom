/**
 * "Reading documents" in "Research for this tree" (spec 059 §4): the
 * research's setting "Task from a new reading" (`accepts.read.sourceTask`) as
 * a collapsible group of three choices. Plain data in, HTML out; the dialog
 * writes a choice through the bridge (`POST sourceTask`).
 */

import { strings } from '../strings.js';
import type { ReadTaskSetting } from '../research-read-task.js';

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** What stands under the choices: the write on its way, the research's confirmation, a sentence (bridge down, a refusal). */
export type ReadTaskSettingNote = { kind: 'busy' } | { kind: 'ok' } | { kind: 'text'; text: string };

export interface ReadTaskSettingInput {
    value: ReadTaskSetting;
    /** The group is open. */
    open: boolean;
    /** The research's bridge answers (else the choices rest, dimmed). */
    up: boolean;
    note?: ReadTaskSettingNote | null;
}

export function readTaskSettingLabel(v: ReadTaskSetting): string {
    const t = strings.treeSettings;
    return v === 'always' ? t.readTaskAlways : v === 'never' ? t.readTaskNever : t.readTaskAsk;
}

export function readTaskSettingHtml(o: ReadTaskSettingInput): string {
    const t = strings.treeSettings;
    const busy = o.note?.kind === 'busy';
    const off = !o.up || busy ? ' disabled' : '';
    const option = (v: ReadTaskSetting, desc: string): string => `
            <label class="settings-checkbox research-readtask-row">
                <input type="radio" name="research-read-task" value="${v}"${v === o.value ? ' checked' : ''}${off}>
                <span class="settings-text"><span class="settings-name">${esc(readTaskSettingLabel(v))}${v === 'ask'
                    ? ` <span class="research-transcripts-default">${esc(t.default)}</span>` : ''}</span><span class="settings-desc">${esc(desc)}</span></span>
            </label>`;
    const n = o.note;
    const note = !n ? '' : n.kind === 'busy'
        ? `<p class="research-stories-note research-readtask-note" id="research-readtask-note" role="status"><span class="read-task-spin" aria-hidden="true"></span><span>${esc(t.rtBusy)}</span></p>`
        : n.kind === 'ok'
            ? `<p class="research-stories-note research-readtask-note is-ok" id="research-readtask-note" role="status"><span class="research-readtask-ok" aria-hidden="true">✓</span><span>${esc(t.rtOk)}</span></p>`
            : `<p class="research-stories-note research-readtask-note" id="research-readtask-note" role="status"><span>${esc(n.text)}</span></p>`;
    const label = readTaskSettingLabel(o.value);
    return `
        <details class="research-group research-readtask-group" id="research-readtask-group"${o.open ? ' open' : ''}>
            <summary class="research-group-summary">
                <span class="research-group-caret" aria-hidden="true"></span>
                <span class="research-group-title">${esc(t.readGroup)}</span>
                <span class="research-group-value"><span class="research-group-value-full">${esc(t.readTaskSum(label))}</span><span class="research-group-value-short">${esc(label)}</span></span>
            </summary>
            <fieldset class="research-transcripts research-readtask${o.up ? '' : ' is-down'}" id="research-readtask">
                <legend>${esc(t.readTask)}</legend>
                ${option('ask', t.readTaskAskDesc)}
                ${option('always', t.readTaskAlwaysDesc)}
                ${option('never', t.readTaskNeverDesc)}
                ${note}
            </fieldset>
        </details>`;
}
