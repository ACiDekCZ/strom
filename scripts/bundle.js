/**
 * Build script - creates a single strom.html file with inlined JS
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { deflateRawSync } from 'zlib';
import { buildSync } from 'esbuild';

// Build the TypeScript bundle first. Inject the app version from package.json
// so the About dialog and export metadata always match the released version.
console.log('Building TypeScript...');
const pkgVersion = JSON.parse(readFileSync('package.json', 'utf-8')).version;

// "What's new" after an update: the section of this version from each
// changelog (CHANGELOG.md, .cs.md, .de.md, .pl.md), cut by the same code the app's
// tests check (src/release-notes.ts), embedded so the dialog needs no network.
const notesHelper = buildSync({
    entryPoints: ['src/release-notes.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false,
});
const { changelogSection, changelogFileName, CHANGELOG_LANGUAGES } = await import(
    'data:text/javascript;base64,' + Buffer.from(notesHelper.outputFiles[0].text).toString('base64'));
const sections = {};
for (const lang of CHANGELOG_LANGUAGES) {
    const file = changelogFileName(lang);
    sections[lang] = existsSync(file) ? changelogSection(readFileSync(file, 'utf-8'), pkgVersion) : null;
}
const releaseNotes = { version: pkgVersion, sections };
console.log('What\'s new sections: ' + CHANGELOG_LANGUAGES.map(l => `${l} ${sections[l] ? 'yes' : 'none'}`).join(', '));

// "How Strom works": strom-doc at the commit package.json "stromDoc" pins,
// vendored in vendor/strom-doc (scripts/pin-strom-doc.mjs). Converted by the
// code the tests check (src/help/help-convert.ts; it throws on a link to a
// missing number or a chapter missing in a language), each language deflated
// and embedded: the help needs no network and no file next to the app.
const helpData = await buildHelpData();
console.log('Help: strom-doc ' + helpData.docVersion.slice(0, 12) + ', '
    + Object.entries(helpData.langs).map(([l, b64]) => `${l} ${Math.round(b64.length / 1024)}kb`).join(', '));

async function buildHelpData() {
    const pin = JSON.parse(readFileSync('package.json', 'utf-8')).stromDoc;
    const dir = 'vendor/strom-doc';
    const vendored = existsSync(`${dir}/PIN`) ? readFileSync(`${dir}/PIN`, 'utf-8').trim() : '';
    if (!pin || vendored !== pin) {
        throw new Error(`help: vendor/strom-doc is at "${vendored}", package.json "stromDoc" is "${pin}" (npm run help:pin)`);
    }
    const files = {};
    const walk = (path, rel) => {
        for (const name of readdirSync(path).sort()) {
            const full = `${path}/${name}`;
            const key = rel ? `${rel}/${name}` : name;
            if (statSync(full).isDirectory()) walk(full, key);
            else if (name.endsWith('.md')) files[key] = readFileSync(full, 'utf-8');
        }
    };
    walk(dir, '');
    const helper = buildSync({
        entryPoints: ['src/help/help-convert.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false,
    });
    const { convertHelp, embedHelp } = await import(
        'data:text/javascript;base64,' + Buffer.from(helper.outputFiles[0].text).toString('base64'));
    return embedHelp(convertHelp(files, pin), data => deflateRawSync(data, { level: 9 }));
}

buildSync({
    entryPoints: ['src/main.ts'],
    bundle: true,
    minify: true,
    outfile: 'dist/bundle.js',
    define: {
        __APP_VERSION__: JSON.stringify(pkgVersion),
        __RELEASE_NOTES__: JSON.stringify(releaseNotes),
        __HELP_DATA__: JSON.stringify(helpData),
    },
    logLevel: 'warning',
});

// Read the HTML template and JS bundle
const html = readFileSync('index.html', 'utf-8');
const js = readFileSync('dist/bundle.js', 'utf-8');

// Replace external script with inline script
// Note: We must escape $ in the replacement string to prevent backreference interpretation
// $$ in the replacement string becomes a literal $
const escapedJs = js.replace(/\$/g, '$$$$');
const output = html.replace(
    '<script src="dist/bundle.js"></script>',
    `<script>${escapedJs}</script>`
)
    // Stamp the About dialog's version into the static HTML too. The runtime
    // overwrites it anyway (ui/misc.ts), but the release process polls the
    // deployed page for '>X.Y.Z<' — that marker must exist in the raw HTML.
    .replace(/(<span id="about-version">)[^<]*(<\/span>)/, `$1${pkgVersion}$2`);

// Write the single-file output
writeFileSync('strom.html', output);

console.log('✓ Created strom.html (single file, ' + Math.round(output.length / 1024) + 'kb)');
