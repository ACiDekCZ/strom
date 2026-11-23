/**
 * A source tree linked to a research merged into another tree (spec 134
 * §11, 11g/11h, K9.6): the link and the research's numbers of the source do
 * not carry over. What is the source research's own goes: its numbers (a
 * person's `P…`, a source's `S…`, a family's `F…`, a fact's `E…` in
 * researchVerify), what it knows of the people (`research`, the facts'
 * origins and re-verification), the reading marks of its sources, its place
 * records and its lines. The target's research would read a number of the
 * other one as its own (a person "P0007" joined to its own P0007, a source
 * S0042 folded into its own S0042); without them the source's people are
 * new in the target's research. What the people are stays: names, facts,
 * links, citations, notes, files, a confirmation made by hand, a REFN of
 * another program.
 */

import type { StromData } from '../types.js';

const PERSON_NUMBER = /^P\d{1,9}$/;
const SOURCE_NUMBER = /^S\d{1,9}$/;

/** A copy of `data` without the marks of the research it is linked to (see the module's note). */
export function withoutResearchMarks(data: StromData): StromData {
    const copy = structuredClone(data);
    for (const p of Object.values(copy.persons)) {
        delete p.research;
        delete p.researchOrigins;
        delete p.researchVerify;
        if (p.refn && PERSON_NUMBER.test(p.refn.trim())) {
            delete p.refn;
            delete p.refnType;
        }
    }
    for (const u of Object.values(copy.partnerships)) {
        delete u.researchId;
        delete u.researchOrigins;
        delete u.researchVerify;
    }
    for (const s of Object.values(copy.sources ?? {})) {
        if (s.refn && SOURCE_NUMBER.test(s.refn.trim())) delete s.refn;
        delete s.readConfirmed;
        delete s.readMark;
        delete s.reading;
        delete s.readingEntry;
        delete s.readingSha;
        delete s.originalInResearch;
        delete s.imageHeld;
        delete s.heldClips;
    }
    delete copy.placeRecords;
    delete copy.placeRefs;
    delete copy.researchAsOf;
    delete copy.researchDirections;
    return copy;
}
