/**
 * The research's status of a fact (`2 _STROM_STATUS lead|possible|probable|proven`
 * under a fact of a person or a couple). Strom Research writes it in place of a
 * note ("Lead — not documented by a record"); the app reads it onto the fact,
 * shows it, never changes it, and sends it back as it came, so a tree passes
 * through the app with no change. A value the app does not know is not read.
 * Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StromData, Person, Partnership, parseFactStatus } from '../types.js';
import { factStatusLabel } from '../ui/fact-status.js';

const TREE_GED = `0 HEAD
1 SOUR STROM-RESEARCH
1 CHAR UTF-8
1 _STROM_TREE 7d3f0c2e-1111-4222-8333-944455556666
1 _STROM_HEAD 0123456789abcdef0123456789abcdef01234567
0 @P0001@ INDI
1 NAME Josef /Víšek/
1 SEX M
1 REFN P0001
1 BIRT
2 DATE 1860
2 PLAC Čáslav
2 _STROM_STATUS lead
1 BAPM
2 DATE 4 MAR 1860
2 _STROM_STATUS proven
1 OCCU rolník
2 _STROM_STATUS probable
1 DEAT
2 DATE 1 JAN 1930
2 _STROM_STATUS possible
1 FAMS @F0001@
0 @P0002@ INDI
1 NAME Anna /Novotná/
1 SEX F
1 REFN P0002
1 BIRT
2 DATE 1862
2 _STROM_STATUS certain
1 FAMS @F0001@
0 @F0001@ FAM
1 HUSB @P0001@
1 WIFE @P0002@
1 MARR
2 DATE 12 FEB 1885
2 PLAC Čáslav
2 _STROM_STATUS proven
1 DIV
2 DATE 1900
2 _STROM_STATUS lead
1 MARB
2 DATE 25 JAN 1885
2 _STROM_STATUS probable
0 TRLR`;

const RESEARCH = {
    id: '7d3f0c2e-1111-4222-8333-944455556666',
    head: '0123456789abcdef0123456789abcdef01234567',
    appTree: 'tree_1_abc',
};

const importGed = (text: string): StromData => convertToStrom(parseGedcom(text)).data;
const sendGed = (data: StromData): string => exportToGedcom(data, 'Víškovi', { research: RESEARCH }).content;
const byName = (data: StromData, first: string): Person =>
    Object.values(data.persons).find(p => p.firstName === first)!;
const union = (data: StromData): Partnership => Object.values(data.partnerships)[0];

/** Every status of a tree, keyed by where it stands (ids left out, they are new on each import). */
function statuses(data: StromData): Record<string, string | undefined> {
    const josef = byName(data, 'Josef');
    const anna = byName(data, 'Anna');
    const u = union(data);
    return {
        josefBirth: josef.birthStatus,
        josefBaptism: josef.events?.find(e => e.type === 'baptism')?.status,
        josefOccupation: josef.events?.find(e => e.type === 'occupation')?.status,
        josefDeath: josef.deathStatus,
        annaBirth: anna.birthStatus,
        wedding: u.startStatus,
        divorce: u.endStatus,
        banns: u.events?.find(e => e.type === 'banns')?.status,
    };
}

const EXPECTED = {
    josefBirth: 'lead',
    josefBaptism: 'proven',
    josefOccupation: 'probable',
    josefDeath: 'possible',
    annaBirth: undefined,
    wedding: 'proven',
    divorce: 'lead',
    banns: 'probable',
};

describe('the research\'s status of a fact (_STROM_STATUS)', () => {
    it('reads the status of the birth, death and events of a person and of the wedding, divorce and events of a couple', () => {
        expect(statuses(importGed(TREE_GED))).toEqual(EXPECTED);
    });

    it('does not read a value it does not know, and puts nothing of it in a note', () => {
        const anna = byName(importGed(TREE_GED), 'Anna');
        expect(anna.birthStatus).toBeUndefined();
        expect(anna.notes ?? '').not.toContain('certain');
        expect(parseFactStatus(' Proven ')).toBe('proven');
        expect(parseFactStatus('certain')).toBeUndefined();
        expect(parseFactStatus(undefined)).toBeUndefined();
    });

    it('sends the status back as it came, so the tree goes there and back with no change', () => {
        const first = importGed(TREE_GED);
        const sent = sendGed(first);
        for (const line of ['2 _STROM_STATUS lead', '2 _STROM_STATUS proven', '2 _STROM_STATUS probable', '2 _STROM_STATUS possible']) {
            expect(sent).toContain(line);
        }
        expect(sent).not.toContain('certain');
        // Read again and sent again: the same statuses, the same file.
        const again = importGed(sent);
        expect(statuses(again)).toEqual(EXPECTED);
        expect(sendGed(again)).toBe(sent);
    });

    it('writes each status under its own fact', () => {
        const sent = sendGed(importGed(TREE_GED));
        const block = (fact: string, after = 0): string => {
            const lines = sent.split('\n');
            let i = lines.indexOf(fact, after);
            const out = [lines[i]];
            for (i++; i < lines.length && !/^[01] /.test(lines[i]); i++) out.push(lines[i]);
            return out.join('\n');
        };
        expect(block('1 MARR')).toContain('2 _STROM_STATUS proven');
        expect(block('1 DIV')).toContain('2 _STROM_STATUS lead');
        expect(block('1 MARB')).toContain('2 _STROM_STATUS probable');
        expect(block('1 BAPM')).toContain('2 _STROM_STATUS proven');
    });

    it('names each known status in the UI language and none for a missing one', () => {
        expect(factStatusLabel('lead')).toBeTruthy();
        expect(new Set(['lead', 'possible', 'probable', 'proven'].map(s => factStatusLabel(s as 'lead')))).toHaveProperty('size', 4);
        expect(factStatusLabel(undefined)).toBe('');
    });
});
