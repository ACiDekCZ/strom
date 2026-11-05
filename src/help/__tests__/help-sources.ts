/**
 * Test helper: the Markdown files of a strom-doc tree as the converter takes
 * them (path relative to the tree → text), the way scripts/bundle.js reads
 * vendor/strom-doc.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const VENDOR_DIR = join(__dirname, '..', '..', '..', 'vendor', 'strom-doc');

export function readHelpSources(dir: string): Record<string, string> {
    const files: Record<string, string> = {};
    const walk = (path: string, rel: string): void => {
        for (const name of readdirSync(path).sort()) {
            const full = join(path, name);
            const key = rel ? `${rel}/${name}` : name;
            if (statSync(full).isDirectory()) {
                if (!rel && !['cs', 'en', 'de', 'pl'].includes(name)) continue; // scripts/, _work/ of a clone
                walk(full, key);
            } else if (name.endsWith('.md')) files[key] = readFileSync(full, 'utf-8');
        }
    };
    walk(dir, '');
    return files;
}

export function vendorPin(): string {
    const pin = join(VENDOR_DIR, 'PIN');
    return existsSync(pin) ? readFileSync(pin, 'utf-8').trim() : '';
}
