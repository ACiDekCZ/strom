/**
 * WGS 84 → S-JTSK / Krovak East North (EPSG:5514), the system the Czech
 * aerial photos of the 1950s are drawn in (spec 030 §4, the layer
 * `cz-ortho-1950` of the research): the house's point turned into the
 * frame of a WMS GetMap in metres.
 *
 * Pure. Two steps:
 * 1. the datum: WGS 84 → Bessel 1841 by the inverse of the 7-parameter
 *    Helmert transformation EPSG:1623 "S-JTSK to WGS 84 (1)" (position
 *    vector, TOWGS84 570.8, 85.7, 462.8, 4.998″, 1.587″, 5.261″, 3.56 ppm;
 *    about 1 m, enough to put a house in the middle of a picture);
 * 2. the projection: Krovak (EPSG method 9819) after EPSG Guidance Note 7-2,
 *    then East North: easting = −westing, northing = −southing (both
 *    negative over the Czech lands).
 */

interface Ellipsoid { a: number; f: number }

const WGS84: Ellipsoid = { a: 6378137, f: 1 / 298.257223563 };
const BESSEL: Ellipsoid = { a: 6377397.155, f: 1 / 299.1528128 };

/** EPSG:1623, Bessel → WGS 84 (position vector): metres, arc-seconds, ppm. */
export const SJTSK_TOWGS84 = { tx: 570.8, ty: 85.7, tz: 462.8, rx: 4.998, ry: 1.587, rz: 5.261, ds: 3.56 } as const;

const RAD = Math.PI / 180;
const SEC = RAD / 3600;

/** Krovak's parameters (EPSG:5514 / 2065), Greenwich longitudes. */
const KROVAK = {
    latC: 49.5 * RAD,
    lon0: (24 + 50 / 60) * RAD,
    alphaC: (30 + 17 / 60 + 17.30311 / 3600) * RAD,
    latP: 78.5 * RAD,
    kP: 0.9999,
};

type Vec3 = [number, number, number];

function toEcef(latDeg: number, lonDeg: number, e: Ellipsoid): Vec3 {
    const e2 = e.f * (2 - e.f);
    const lat = latDeg * RAD, lon = lonDeg * RAD;
    const N = e.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    return [N * Math.cos(lat) * Math.cos(lon), N * Math.cos(lat) * Math.sin(lon), N * (1 - e2) * Math.sin(lat)];
}

/** ECEF → latitude and longitude in radians (iterated to well under a millimetre). */
function fromEcef([x, y, z]: Vec3, e: Ellipsoid): { lat: number; lon: number } {
    const e2 = e.f * (2 - e.f);
    const p = Math.hypot(x, y);
    let lat = Math.atan2(z, p * (1 - e2));
    for (let i = 0; i < 10; i++) {
        const N = e.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
        const h = p / Math.cos(lat) - N;
        const next = Math.atan2(z, p * (1 - e2 * N / (N + h)));
        if (Math.abs(next - lat) < 1e-13) { lat = next; break; }
        lat = next;
    }
    return { lat, lon: Math.atan2(y, x) };
}

/** WGS 84 ECEF → Bessel ECEF: the inverse of EPSG:1623 (X_wgs = T + (1 + s)·R·X_bessel). */
function wgsToBessel([x, y, z]: Vec3): Vec3 {
    const t = SJTSK_TOWGS84;
    const rx = t.rx * SEC, ry = t.ry * SEC, rz = t.rz * SEC, s = 1 + t.ds * 1e-6;
    const u: Vec3 = [(x - t.tx) / s, (y - t.ty) / s, (z - t.tz) / s];
    // Rᵀ of the position-vector rotation [[1, −rz, ry], [rz, 1, −rx], [−ry, rx, 1]] (small angles).
    return [
        u[0] + rz * u[1] - ry * u[2],
        -rz * u[0] + u[1] + rx * u[2],
        ry * u[0] - rx * u[1] + u[2],
    ];
}

/**
 * Krovak on Bessel 1841 (EPSG GN 7-2): latitude and Greenwich longitude in
 * radians → southing X and westing Y in metres (S-JTSK, positive).
 */
export function krovakForward(lat: number, lon: number): { southing: number; westing: number } {
    const { a, f } = BESSEL;
    const e2 = f * (2 - f), e = Math.sqrt(e2);
    const { latC, lon0, alphaC, latP, kP } = KROVAK;
    const A = a * Math.sqrt(1 - e2) / (1 - e2 * Math.sin(latC) ** 2);
    const B = Math.sqrt(1 + e2 * Math.cos(latC) ** 4 / (1 - e2));
    const g0 = Math.asin(Math.sin(latC) / B);
    const t0 = Math.tan(Math.PI / 4 + g0 / 2) * Math.pow((1 + e * Math.sin(latC)) / (1 - e * Math.sin(latC)), e * B / 2)
        / Math.pow(Math.tan(Math.PI / 4 + latC / 2), B);
    const n = Math.sin(latP);
    const r0 = kP * A / Math.tan(latP);
    const U = 2 * (Math.atan(t0 * Math.pow(Math.tan(lat / 2 + Math.PI / 4), B)
        / Math.pow((1 + e * Math.sin(lat)) / (1 - e * Math.sin(lat)), e * B / 2)) - Math.PI / 4);
    const V = B * (lon0 - lon);
    const T = Math.asin(Math.cos(alphaC) * Math.sin(U) + Math.sin(alphaC) * Math.cos(U) * Math.cos(V));
    const D = Math.asin(Math.cos(U) * Math.sin(V) / Math.cos(T));
    const theta = n * D;
    const r = r0 * Math.pow(Math.tan(Math.PI / 4 + latP / 2), n) / Math.pow(Math.tan(T / 2 + Math.PI / 4), n);
    return { southing: r * Math.cos(theta), westing: r * Math.sin(theta) };
}

/** A WGS 84 point (degrees) → S-JTSK / Krovak East North (EPSG:5514), metres: x = easting, y = northing (negative). */
export function wgs84ToSjtsk(lat: number, lng: number): { x: number; y: number } {
    const b = fromEcef(wgsToBessel(toEcef(lat, lng, WGS84)), BESSEL);
    const k = krovakForward(b.lat, b.lon);
    return { x: -k.westing, y: -k.southing };
}

/**
 * The frame of `width` × `height` metres around a point, in EPSG:5514 as a
 * WMS BBOX wants it: [minx, miny, maxx, maxy] (all negative).
 */
export function sjtskBox(lat: number, lng: number, width: number, height: number): [number, number, number, number] {
    const p = wgs84ToSjtsk(lat, lng);
    return [p.x - width / 2, p.y - height / 2, p.x + width / 2, p.y + height / 2];
}
