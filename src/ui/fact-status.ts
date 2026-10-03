/**
 * The research's status of a fact (FactStatus, GEDCOM _STROM_STATUS) as a
 * small label beside the fact: lead, possible, probable, proven. Read-only —
 * the research decides it, the app only shows it. No status, no label.
 */

import { FactStatus } from '../types.js';
import { strings } from '../strings.js';

/** The status's name in the UI language ('' for none). */
export function factStatusLabel(status: FactStatus | undefined): string {
    return status ? strings.factStatus[status] : '';
}

/** The label's HTML ('' for none). */
export function factStatusHtml(status: FactStatus | undefined): string {
    if (!status) return '';
    const label = factStatusLabel(status);
    const title = strings.factStatus.title(label).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `<span class="fact-status fact-status-${status}" data-fact-status="${status}" title="${title}">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`;
}
