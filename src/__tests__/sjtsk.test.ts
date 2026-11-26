/**
 * WGS 84 → S-JTSK / Krovak East North (EPSG:5514) for the aerial photos of
 * the 1950s (spec 030 §4): the projection against the worked example of
 * EPSG Guidance Note 7-2 (Krovak, on Bessel 1841), the whole conversion
 * against points converted by PROJ 9 with the same transformation (EPSG:1623)
 * within 2 m, and the frame of a GetMap around a point.
 */
import { describe, expect, it } from 'vitest';
import { krovakForward, sjtskBox, wgs84ToSjtsk } from '../sjtsk.js';

const RAD = Math.PI / 180;

describe('S-JTSK', () => {
    it('Krovak: the EPSG Guidance Note 7-2 example (50°12′32.442″ N, 16°50′59.179″ E on Bessel)', () => {
        const k = krovakForward((50 + 12 / 60 + 32.442 / 3600) * RAD, (16 + 50 / 60 + 59.179 / 3600) * RAD);
        expect(k.southing).toBeCloseTo(1050538.643, 1);
        expect(k.westing).toBeCloseTo(568990.997, 1);
    });

    it.each([
        ['Prague', 50.0876, 14.4213, -742804.366, -1042998.464],
        ['Vysočina', 49.6118, 15.2251, -692432.784, -1103030.947],
        ['Ostrava', 49.8347, 18.2625, -472050.383, -1101533.557],
        ['the west', 50.2, 12.8, -855585.899, -1013591.397],
        ['Brno', 49.1951, 16.6068, -598248.812, -1160744.686],
    ])('WGS 84 → EPSG:5514 within 2 m (%s)', (_name, lat, lng, x, y) => {
        const p = wgs84ToSjtsk(lat, lng);
        expect(Math.abs(p.x - x)).toBeLessThan(2);
        expect(Math.abs(p.y - y)).toBeLessThan(2);
    });

    it('the frame around a point: minx, miny, maxx, maxy, all negative, the point in the middle', () => {
        const [minx, miny, maxx, maxy] = sjtskBox(49.6118, 15.2251, 400, 280);
        expect(maxx - minx).toBeCloseTo(400, 6);
        expect(maxy - miny).toBeCloseTo(280, 6);
        expect(maxx).toBeLessThan(0);
        expect(maxy).toBeLessThan(0);
        const p = wgs84ToSjtsk(49.6118, 15.2251);
        expect((minx + maxx) / 2).toBeCloseTo(p.x, 6);
        expect((miny + maxy) / 2).toBeCloseTo(p.y, 6);
    });
});
