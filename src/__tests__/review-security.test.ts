/**
 * Security & privacy fixes from the 2026-09 application review (batch A):
 * - K1: the export clone drops every runtime-filled container (no on-screen
 *   tree leaks into an export of another, filtered/encrypted tree),
 * - K2: data embedded into the exported HTML cannot close its <script> and
 *   cannot trigger String.replace "$" patterns,
 * - K3: no inline JS handlers carrying data ids; non-image attachments open
 *   only as application/pdf,
 * - K4: living-privacy modes strip name variants, questions, REFNs and the
 *   details of couples where either partner is living,
 * - CSV formula injection.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
    EXPORT_DYNAMIC_CONTAINER_IDS, sanitizeExportClone, jsonForScript, injectBeforeHeadEnd,
} from '../export.js';
import { pdfBlobFromDataUrl } from '../attachments.js';
import { applyLivingPrivacy, PrivacyMode } from '../privacy.js';
import { buildPersonsCsv, csvField } from '../csv-export.js';
import { initLanguage } from '../strings.js';
import { StromData, Person, PersonId, PartnershipId, Partnership } from '../types.js';

// ---------- K1: export clone sanitizer ----------

/** Minimal element tree: just what sanitizeExportClone touches. */
class FakeEl {
    children: FakeEl[] = [];
    parent: FakeEl | null = null;
    constructor(public id: string, public text = '') {}
    append(...kids: FakeEl[]): this {
        for (const k of kids) { k.parent = this; this.children.push(k); }
        return this;
    }
    remove(): void {
        if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this);
        this.parent = null;
    }
    replaceChildren(): void {
        for (const c of [...this.children]) c.remove();
        this.text = '';
    }
    querySelector(sel: string): FakeEl | null {
        const id = sel.replace(/^#/, '');
        for (const c of this.children) {
            if (c.id === id) return c;
            const hit = c.querySelector(sel);
            if (hit) return hit;
        }
        return null;
    }
    serialize(): string {
        return `${this.id}:${this.text}[${this.children.map(c => c.serialize()).join(',')}]`;
    }
}

describe('K1 export clone sanitizer', () => {
    it('covers the tree view, alternative views and the person dialog', () => {
        for (const id of ['tree-canvas', 'tree-lines', 'gen-labels', 'timeline-container', 'map-container',
            'fan-chart', 'pm-name', 'events-list', 'photo-preview', 'attachments-list', 'relationships-content',
            'current-tree-name', 'tree-switcher-dropdown', 'toolbar-focus-name', 'places-datalist']) {
            expect(EXPORT_DYNAMIC_CONTAINER_IDS).toContain(id);
        }
    });

    it('every listed container is empty in the page template (emptying never drops static markup)', () => {
        const html = readFileSync('index.html', 'utf-8');
        for (const id of EXPORT_DYNAMIC_CONTAINER_IDS) {
            if (id === 'tree-canvas' || id === 'current-tree-name') continue; // kept child / placeholder text
            const m = new RegExp(`<(\\w+)\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
            expect(m, id).not.toBeNull();
            expect(m![2].replace(/<!--[\s\S]*?-->/g, '').trim(), id).toBe('');
        }
    });

    it('drops rendered cards and lines but keeps the empty #tree-lines SVG', () => {
        const lines = new FakeEl('tree-lines').append(new FakeEl('', '<path d="M0 0"/>'));
        const card = new FakeEl('', 'Secret Living Person');
        const canvas = new FakeEl('tree-canvas').append(lines, card);
        const timeline = new FakeEl('timeline-container').append(new FakeEl('', 'Secret row'));
        const name = new FakeEl('pm-name', 'Secret Name');
        const staticEl = new FakeEl('about-version', '1.0.0');
        const root = new FakeEl('html').append(new FakeEl('body').append(canvas, timeline, name, staticEl));

        sanitizeExportClone(root);

        const out = root.serialize();
        expect(out).not.toContain('Secret');
        expect(out).not.toContain('<path');
        expect(canvas.children.map(c => c.id)).toEqual(['tree-lines']);
        expect(lines.children).toHaveLength(0);
        expect(out).toContain('1.0.0');
    });
});

// ---------- K2: embedded JSON ----------

describe('K2 embedded JSON', () => {
    const note = 'x</script><script>alert(1)</script> <!-- $\' $& $`   ';
    const envelope = { data: { persons: { a: { notes: note } } } };

    it('cannot close the script element and stays valid JSON', () => {
        const json = jsonForScript(envelope);
        expect(json).not.toMatch(/<\/script/i);
        expect(json).not.toContain('<');
        expect(json).not.toContain(' ');
        expect(json).not.toContain(' ');
        expect(JSON.parse(json)).toEqual(envelope);
    });

    it('splices data before </head> literally, without "$" replacement patterns', () => {
        const html = '<html><head><title>t</title></head><body>BODY</body></html>';
        const script = `<script>window.STROM_EMBEDDED_DATA = ${jsonForScript(envelope)};<\/script>`;
        const out = injectBeforeHeadEnd(html, script);
        expect(out).toBe(`<html><head><title>t</title>${script}\n</head><body>BODY</body></html>`);
        // Exactly one body: "$'" must not have copied the rest of the document into the data.
        expect(out.split('BODY')).toHaveLength(2);
    });

    it('is read back by the importer regex (same pattern as extractEnvelopeFromHtml)', () => {
        const html = injectBeforeHeadEnd('<html><head></head><body></body></html>',
            `<script>window.STROM_EMBEDDED_DATA = ${jsonForScript(envelope)};<\/script>`);
        const matches = [...html.matchAll(/window\.STROM_EMBEDDED_DATA\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/g)];
        expect(matches).toHaveLength(1);
        expect(JSON.parse(matches[0][1])).toEqual(envelope);
    });
});

// ---------- K3: inline handlers + attachments ----------

describe('K3 no data ids in inline JS handlers', () => {
    it.each(['src/ui/anniversaries-ui.ts', 'src/ui/duplicate-suggest.ts', 'src/ui/attachments-ui.ts',
        'src/ui/person-events.ts', 'src/ui/sources.ts'])(
        '%s wires handlers through data attributes', (file) => {
            const src = readFileSync(file, 'utf-8');
            expect(src).not.toMatch(/on(click|change)="[^"]*\$\{/);
        });
});

describe('K3 attachment preview blob', () => {
    const b64 = (s: string) => Buffer.from(s, 'binary').toString('base64');

    it('opens a PDF as application/pdf', () => {
        const blob = pdfBlobFromDataUrl(`data:application/pdf;base64,${b64('%PDF-1.4')}`, 'application/pdf');
        expect(blob).not.toBeNull();
        expect(blob!.type).toBe('application/pdf');
        expect(blob!.size).toBe(8);
    });

    it('refuses HTML, SVG and mislabelled payloads', () => {
        const html = b64('<script>alert(1)</script>');
        expect(pdfBlobFromDataUrl(`data:text/html;base64,${html}`, 'application/pdf')).toBeNull();
        expect(pdfBlobFromDataUrl(`data:text/html;base64,${html}`, 'text/html')).toBeNull();
        expect(pdfBlobFromDataUrl(`data:image/svg+xml;base64,${html}`, 'application/pdf')).toBeNull();
        expect(pdfBlobFromDataUrl(`data:application/pdf;base64,${html}`, 'text/html')).toBeNull();
        expect(pdfBlobFromDataUrl('data:application/pdf,<script>', 'application/pdf')).toBeNull();
        expect(pdfBlobFromDataUrl('javascript:alert(1)', 'application/pdf')).toBeNull();
        expect(pdfBlobFromDataUrl('data:application/pdf;base64,!!!not base64', 'application/pdf')).toBeNull();
    });
});

// ---------- K4: living privacy ----------

const NOW = 2026;

function person(id: string, over: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: 'Jana', lastName: 'Testová', gender: 'female',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...over,
    };
}

function couple(p1: Person, p2: Person, over: Partial<Partnership> = {}): StromData {
    const uid = 'u1' as PartnershipId;
    p1.partnerships = [uid];
    p2.partnerships = [uid];
    return {
        persons: { [p1.id]: p1, [p2.id]: p2 } as StromData['persons'],
        partnerships: {
            [uid]: {
                id: uid, person1Id: p1.id, person2Id: p2.id, childIds: [], status: 'divorced',
                startDate: '2010-06-12', startPlace: 'Brno', endDate: '2015', note: 'private',
                participants: [{ id: 'w1', role: 'witness', name: 'Karel Svědek', note: 'soused' }],
                ...over,
            },
        } as StromData['partnerships'],
    };
}

const MODES: PrivacyMode[] = ['initials', 'anonymous', 'minimal'];

describe('K4 living privacy', () => {
    it('strips name variants, question and REFN of a living person in every mode', () => {
        for (const mode of MODES) {
            const data: StromData = {
                persons: {
                    ['l' as PersonId]: person('l', {
                        firstName: 'Living person', birthDate: '1990',
                        nameVariants: ['Jana Testová-Nová'], question: 'Kdy se narodila?',
                        refn: 'ID-123', refnType: 'Other program',
                    }),
                } as StromData['persons'],
                partnerships: {},
            };
            const out = applyLivingPrivacy(data, mode, NOW).persons['l' as PersonId];
            expect(out.nameVariants, mode).toBeUndefined();
            expect(out.question, mode).toBeUndefined();
            expect(out.refn, mode).toBeUndefined();
            expect(out.refnType, mode).toBeUndefined();
            expect(JSON.stringify(out), mode).not.toContain('Testová-Nová');
        }
    });

    it('keeps them on deceased persons', () => {
        const data: StromData = {
            persons: {
                ['d' as PersonId]: person('d', { birthDate: '1850', deathDate: '1920', nameVariants: ['Johanna'], refn: 'R1', question: 'Q' }),
            } as StromData['persons'],
            partnerships: {},
        };
        const out = applyLivingPrivacy(data, 'anonymous', NOW).persons['d' as PersonId];
        expect(out.nameVariants).toEqual(['Johanna']);
        expect(out.refn).toBe('R1');
        expect(out.question).toBe('Q');
    });

    it('strips the details of a couple where either partner is living', () => {
        for (const mode of MODES) {
            const data = couple(
                person('h', { gender: 'male', firstName: 'Petr', birthDate: '1920', deathDate: '2000' }),
                person('w', { birthDate: '1985' }),
            );
            const u = Object.values(applyLivingPrivacy(data, mode, NOW).partnerships)[0];
            expect(u.startPlace, mode).toBeUndefined();
            expect(u.endDate, mode).toBeUndefined();
            expect(u.note, mode).toBeUndefined();
            expect(u.participants, mode).toBeUndefined();
            // 'initials' keeps only the year, like the birth year it keeps on persons.
            expect(u.startDate, mode).toBe(mode === 'initials' ? '2010' : undefined);
            // Structure stays.
            expect(u.status).toBe('divorced');
            expect(u.person1Id).toBe('h');
        }
    });

    it('keeps the details of a couple where both are deceased', () => {
        const data = couple(
            person('h', { gender: 'male', birthDate: '1850', deathDate: '1920' }),
            person('w', { birthDate: '1855', deathDate: '1930' }),
            { startDate: '1875', endDate: undefined },
        );
        const u = Object.values(applyLivingPrivacy(data, 'anonymous', NOW).partnerships)[0];
        expect(u.startDate).toBe('1875');
        expect(u.startPlace).toBe('Brno');
        expect(u.note).toBe('private');
        expect(u.participants).toHaveLength(1);
    });

    it("'full' changes nothing", () => {
        const data = couple(person('h', { gender: 'male' }), person('w', { nameVariants: ['X'] }));
        expect(applyLivingPrivacy(data, 'full', NOW)).toEqual(data);
    });
});

// ---------- CSV formula injection ----------

describe('CSV formula injection', () => {
    it('prefixes formula-like cells with an apostrophe', () => {
        expect(csvField('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
        expect(csvField('+1+1')).toBe("'+1+1");
        expect(csvField('-2+3')).toBe("'-2+3");
        expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
        expect(csvField('\t=1')).toBe("'\t=1");
        expect(csvField('\r=1')).toBe(`"'\r=1"`);
    });

    it('leaves ordinary text, dates and plain numbers alone', () => {
        expect(csvField('Jan')).toBe('Jan');
        expect(csvField('~1900')).toBe('~1900');
        expect(csvField('1900-05-01')).toBe('1900-05-01');
        expect(csvField('-5')).toBe('-5');
        expect(csvField('+3.5')).toBe('+3.5');
        expect(csvField('')).toBe('');
    });

    it('applies to person cells of the export', () => {
        initLanguage('en');
        const data: StromData = {
            persons: { ['a' as PersonId]: person('a', { firstName: '=cmd|\' /C calc\'!A0', notes: '@evil' }) } as StromData['persons'],
            partnerships: {},
        };
        const row = buildPersonsCsv(data).split('\r\n')[1];
        expect(row.startsWith("'=cmd")).toBe(true);
        expect(row).toContain(";'@evil");
    });
});
