/**
 * Which events offer a godparents/witnesses field (src/events.ts).
 *
 * The rule under test: parish books name other people at the sacramental and
 * legal acts — godparents at a baptism, witnesses at a wedding, the people who
 * attended a burial or reported a death. Nobody ever witnessed a change of
 * address or of trade, so the field only appears where a register would carry
 * it. What a record already names is never hidden, whatever its type.
 */

import { describe, it, expect } from 'vitest';
import { eventTakesParticipants, SELECTABLE_EVENT_TYPES } from '../events.js';
import { LifeEventType } from '../types.js';

describe('eventTakesParticipants', () => {
    it('offers the field for the acts a register records witnesses for', () => {
        for (const type of ['birth', 'death', 'baptism', 'burial'] as LifeEventType[]) {
            expect(eventTakesParticipants(type), type).toBe(true);
        }
    });

    it('keeps it out of events nobody ever witnessed', () => {
        for (const type of ['occupation', 'residence', 'military',
            'emigration', 'immigration', 'education'] as LifeEventType[]) {
            expect(eventTakesParticipants(type), type).toBe(false);
        }
    });

    it('keeps it for a custom event — that is where the importer files stray godparents', () => {
        // A GEDCOM whose BIRT names godparents but has no christening gets a
        // "Birth record" custom event to hang them on (see rehomeParticipants).
        expect(eventTakesParticipants('custom')).toBe(true);
    });

    it('never hides people a record already names', () => {
        // Hiding them would drop them on the next save of that event.
        expect(eventTakesParticipants('residence', true)).toBe(true);
        expect(eventTakesParticipants('occupation', true)).toBe(true);
    });

    it('covers every type a user can pick', () => {
        // A type nobody classified would silently fall to "no field".
        for (const type of SELECTABLE_EVENT_TYPES) {
            expect(typeof eventTakesParticipants(type)).toBe('boolean');
        }
    });
});
