/**
 * Bakes coordinates for the demo trees' places (npm run gen:demo-places).
 *
 * The demo ships with its coordinates so that loading it and opening the map
 * just works — no lookup, nothing sent anywhere. They are generated here rather
 * than typed from memory: same source the app itself would use, so the demo is
 * as right as the app can be, and re-running this shows up any drift.
 *
 * Prints the two records; paste the output into src/demo-trees.ts. It is a
 * developer step, not part of the build — the app never runs this.
 *
 * A few places cannot be found by the name the demo uses (historical Czech
 * exonyms like "Svinibrod" for Schweinfurt). Those are listed in FALLBACK with
 * a note saying what they are, and the script reports anything left unplaced.
 */

import { geocodePlaces } from '../src/geocode.js';
import { getDemoTree } from '../src/demo-trees.js';
import { collectPlaces } from '../src/places.js';
import { PlaceGeo } from '../src/types.js';

/**
 * Places the geocoder does not know under the name the demo uses. Each is a
 * historical Czech name for a place that exists today under another name; the
 * modern name is what gets looked up, the demo keeps the historical one.
 */
const FALLBACK: Record<string, string> = {
    'svinibrod': 'Schweinfurt, Germany',            // Jitka's birthplace
    'misen': 'Meißen, Germany',                     // Míšeň
    'viden': 'Wien, Austria',                       // Vídeň
    'poznan': 'Poznań, Poland',                     // Poznaň
    'hnezdno': 'Gniezno, Poland',                   // Hnězdno
    'vratislav': 'Wrocław, Poland',                 // Vratislav (not the ruler!)
    'tesin': 'Cieszyn, Poland',                     // Těšín
    'suche kruty': 'Dürnkrut, Austria',             // Moravské pole
    'predklasteri': 'Předklášteří, Czechia',
    'levy hradec': 'Levý Hradec, Roztoky, Czechia',
    'pocaply': 'Počaply, Králův Dvůr, Czechia',
    'vysehrad': 'Vyšehrad, Praha, Czechia',
    'praha': 'Praha, Czechia',
    'brno': 'Brno, Czechia',
    'olomouc': 'Olomouc, Czechia',
    'melnik': 'Mělník, Czechia',
    'chrudim': 'Chrudim, Czechia',
    'tetin': 'Tetín, Czechia',
    'stara boleslav': 'Stará Boleslav, Czechia',
    'lysa nad labem': 'Lysá nad Labem, Czechia',
    // Tudor places that are ambiguous without a country/region.
    'westminster': 'Westminster, London, United Kingdom',
    'greenwich': 'Greenwich, London, United Kingdom',
    'winchester': 'Winchester, Hampshire, United Kingdom',
    'blickling': 'Blickling, Norfolk, United Kingdom',
    'wolfhall': 'Wolfhall, Wiltshire, United Kingdom',
    'bletsoe': 'Bletsoe, England',
    'much hadham': 'Much Hadham, Hertfordshire, United Kingdom',
    'methven': 'Methven, Scotland',
    'westhorpe': 'Westhorpe, Suffolk, United Kingdom',
    'kimbolton': 'Kimbolton, Cambridgeshire, United Kingdom',
    'branxton': 'Branxton, Northumberland, United Kingdom',   // Flodden
    'falkland': 'Falkland, Fife, United Kingdom',
    'fotheringhay': 'Fotheringhay, Northamptonshire, United Kingdom',
    'guildford': 'Guildford, Surrey, United Kingdom',
    'hatfield': 'Hatfield, Hertfordshire, United Kingdom',
    'bradgate park': 'Bradgate Park, Leicestershire, United Kingdom',
    'carmarthen': 'Carmarthen, Wales, United Kingdom',
    'sudeley castle': 'Sudeley Castle, Gloucestershire, United Kingdom',
    'ludlow castle': 'Ludlow Castle, Shropshire, United Kingdom',
    'pembroke castle': 'Pembroke Castle, Wales, United Kingdom',
    'hampton court': 'Hampton Court Palace, London, United Kingdom',
    'tower of london': 'Tower of London, United Kingdom',
    'el escorial': 'El Escorial, Spain',
    'linlithgow': 'Linlithgow Palace, United Kingdom',
    'edinburgh': 'Edinburgh, United Kingdom',
};

/**
 * Nominatim rejects anonymous scripts (403) and asks callers to identify
 * themselves. A browser sends its own User-Agent, so the app needs nothing; a
 * Node script must say who it is. Browsers forbid setting this header, which is
 * why it lives here and not in src/geocode.ts.
 */
const identifiedFetch: typeof fetch = (input, init) =>
    fetch(input, {
        ...init,
        headers: { ...init?.headers, 'User-Agent': 'Strom/demo-place-bake (https://stromapp.info)' },
    });

async function bake(lang: 'cs' | 'en', label: string): Promise<void> {
    const data = getDemoTree(lang);
    const places = [...collectPlaces(data)];
    // Ask under the fallback name where there is one, otherwise the name itself.
    const queries = places.map(([key, usage]) => FALLBACK[key] ?? usage.display);
    const found = await geocodePlaces(queries, {
        fetchFn: identifiedFetch,
        onProgress: (done, total, place) => process.stderr.write(`  ${done}/${total} ${place}\n`),
    });

    const lines: string[] = [];
    const missed: string[] = [];
    for (const [key, usage] of places) {
        const geo = found.get(FALLBACK[key] ?? usage.display);
        if (!geo) { missed.push(`${usage.display} (${key})`); continue; }
        // Trim to ~11m precision: this is a town on a map, not a survey.
        const lat = Number(geo.lat.toFixed(4));
        const lon = Number(geo.lon.toFixed(4));
        // JSON-quote the key too: "st james's palace" has an apostrophe in it.
        lines.push(`    ${JSON.stringify(key)}: { lat: ${lat}, lon: ${lon}, label: ${JSON.stringify(geo.label ?? '')} },`);
    }

    process.stdout.write(`\nconst ${label}: Record<string, PlaceGeo> = {\n${lines.join('\n')}\n};\n`);
    if (missed.length > 0) process.stderr.write(`\n!! NOT FOUND for ${label}: ${missed.join(', ')}\n`);
}

async function main(): Promise<void> {
    process.stderr.write('Přemyslids:\n');
    await bake('cs', 'PREMYSLID_PLACES');
    process.stderr.write('Tudors:\n');
    await bake('en', 'TUDOR_PLACES');
}

void main();
