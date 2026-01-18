/**
 * Build script - creates a single strom.html file with inlined JS
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// Build the TypeScript bundle first
console.log('Building TypeScript...');
execSync('npx esbuild src/main.ts --bundle --minify --outfile=dist/bundle.js', { stdio: 'inherit' });

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
);

// Write the single-file output
writeFileSync('strom.html', output);

console.log('✓ Created strom.html (single file, ' + Math.round(output.length / 1024) + 'kb)');
