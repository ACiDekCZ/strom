import { describe, it, expect } from 'vitest';
import { formatLiveTime, formatLiveClock } from '../live-time.js';

// Local times (the panel shows the viewer's clock).
const at = (h: number, m: number, s = 0, day = 25) => new Date(2026, 8, day, h, m, s).getTime();

describe('live panel times', () => {
    const now = at(14, 36, 30);

    it('under a minute is "just now"', () => {
        expect(formatLiveTime(at(14, 36, 0), now, 'cs', 'právě teď')).toBe('právě teď');
        expect(formatLiveTime(at(14, 35, 31), now, 'en', 'just now')).toBe('just now');
    });

    it('from a minute to an hour: minutes ago, short', () => {
        expect(formatLiveTime(at(14, 35, 30), now, 'cs', '')).toBe('před 1 min');
        expect(formatLiveTime(at(14, 31, 30), now, 'en', '')).toMatch(/^5 min\.? ago$/);
        expect(formatLiveTime(at(13, 37, 0), now, 'de', '')).toMatch(/^vor 59 Min\.?$/);
    });

    it('an hour and more today: the clock', () => {
        expect(formatLiveTime(at(13, 36, 30), now, 'cs', '')).toBe('13:36');
        expect(formatLiveTime(at(9, 5), now, 'de', '')).toBe('09:05');
    });

    it('before midnight: the date too', () => {
        const justAfterMidnight = at(0, 10, 0);
        expect(formatLiveTime(at(23, 50, 0, 24), justAfterMidnight, 'cs', '')).toBe('před 20 min');
        expect(formatLiveClock(at(23, 50, 0, 24), justAfterMidnight, 'cs')).toBe('24. 9. 23:50');
        expect(formatLiveTime(at(22, 0, 0, 24), justAfterMidnight, 'cs', '')).toBe('24. 9. 22:00');
        expect(formatLiveClock(at(0, 5), justAfterMidnight, 'en')).toMatch(/^12:05\s?AM$|^00:05$/);
    });
});
