/**
 * History in the life timeline is no longer a feature on trial (spec 020
 * K1.5): its Settings row sits in "Person card", the empty "Experimental
 * features" group stays hidden, and no history text speaks of a trial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getStringsForLang, Language } from '../strings.js';

const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

/** The markup of the Settings group whose title id is `titleId`. */
function group(titleId: string): string {
    const start = html.indexOf(`aria-labelledby="${titleId}"`);
    expect(start).toBeGreaterThan(0);
    return html.slice(start, html.indexOf('</section>', start));
}

/** Every string value of an object, functions called with sample arguments. */
function texts(o: unknown): string[] {
    if (typeof o === 'string') return [o];
    if (typeof o === 'function') return [String((o as (...a: unknown[]) => unknown)(2, 'x'))];
    if (o && typeof o === 'object') return Object.values(o).flatMap(texts);
    return [];
}

describe('history in the life timeline is not experimental', () => {
    it('the toggle, its status row and the hidden events row are in Person card', () => {
        const card = group('settings-group-card');
        for (const id of ['history-setting-toggle', 'history-setting-status', 'history-hidden-link']) {
            expect(card).toContain(`id="${id}"`);
        }
    });

    it('the Experimental features group has no row and starts hidden', () => {
        const exp = group('settings-group-experiments');
        expect(html).toMatch(/id="settings-experiments" hidden>/);
        expect(exp).toMatch(/<div class="settings-group-body"><\/div>/);
    });

    it.each(['en', 'cs', 'de'] as Language[])('no history text speaks of a trial (%s)', (lang) => {
        const all = texts(getStringsForLang(lang).history).join('\n');
        expect(all).not.toMatch(/on trial|experiment|ve zkoušce|experimentáln|Erprobung|experimentell/i);
    });
});
