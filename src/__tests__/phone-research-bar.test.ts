/**
 * The bottom bar of a phone's Research screen (spec 094 K3.13 §1 point 3,
 * variant A): Research | Family | (+) | Table | More only on a phone in the
 * device mode whose research gives the screen's data; a tablet, the app
 * outside the device mode and an older research keep Family | Descendants |
 * (+) | Table | More.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { phoneBarItems, phoneScreenFor, PHONE_SECTIONS, PHONE_COLUMNS } from '../ui/phone-research-ui';
import { NO_RESEARCH_FEATURES } from '../device/device-research-data';

const PHONE_BAR = ['research', 'family', 'add', 'table', 'more'];
const USUAL_BAR = ['family', 'descendants', 'add', 'table', 'more'];

describe('the bottom bar by where the app runs', () => {
    it.each([
        { name: 'a phone in the device mode', deviceMode: true, phone: true, offered: true, bar: PHONE_BAR },
        { name: 'a tablet in the device mode', deviceMode: true, phone: false, offered: true, bar: USUAL_BAR },
        { name: 'a phone outside the device mode', deviceMode: false, phone: true, offered: true, bar: USUAL_BAR },
        { name: 'a tablet outside the device mode', deviceMode: false, phone: false, offered: false, bar: USUAL_BAR },
        { name: 'a phone whose research gives the screen nothing', deviceMode: true, phone: true, offered: false, bar: USUAL_BAR },
    ])('$name', ({ deviceMode, phone, offered, bar }) => {
        expect(phoneBarItems({ deviceMode, phone, offered })).toEqual(bar);
    });

    it('the screen stands first when the research gives its data, or its last state is held here', () => {
        expect(phoneScreenFor({ features: { ...NO_RESEARCH_FEATURES, glance: true }, held: false })).toBe(true);
        expect(phoneScreenFor({ features: null, held: true })).toBe(true);
        expect(phoneScreenFor({ features: NO_RESEARCH_FEATURES, held: false })).toBe(false);
        expect(phoneScreenFor({ features: null, held: false })).toBe(false);
    });

    it('the sections in their order, held sideways Now and Waiting on the left', () => {
        expect(PHONE_SECTIONS).toEqual(['now', 'waiting', 'finds', 'lines']);
        expect(PHONE_SECTIONS.filter(s => PHONE_COLUMNS[s] === 'a')).toEqual(['now', 'waiting']);
        expect(PHONE_SECTIONS.filter(s => PHONE_COLUMNS[s] === 'b')).toEqual(['finds', 'lines']);
    });

    it('the page: Research the bar\'s first tab, shown and Descendants hidden only on a phone in the device mode', () => {
        const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
        const bar = html.slice(html.indexOf('<nav id="bottom-bar"'), html.indexOf('</nav>', html.indexOf('<nav id="bottom-bar"')));
        const ids = [...bar.matchAll(/<button[^>]*\sid="([^"]+)"/g)].map(m => m[1]);
        expect(ids).toEqual(['bb-view-research', 'bb-view-family', 'bb-view-descendants', 'bottom-bar-fab', 'bb-view-table', 'bb-view-more']);
        expect(html).toMatch(/#bb-view-research \{ display: none; \}/);
        expect(html).toMatch(/body\.device-mode\.device-phone\.phone-research-ready #bb-view-research \{ display: flex; \}/);
        expect(html).toMatch(/body\.device-mode\.device-phone\.phone-research-ready #bb-view-descendants \{ display: none; \}/);
        // The (+) hidden on the screen, its place kept.
        expect(html).toMatch(/body\.phone-research-on \.bottom-bar-fab \{ visibility: hidden; \}/);
    });
});
