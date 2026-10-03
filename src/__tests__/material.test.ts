/**
 * "Send material…": which files may go (the research's `accepts.media.types`,
 * never programs, keys, archives or family trees) and how the types are read
 * from an untrusted `/status`. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { materialAccepted } from '../ui/material-ui.js';
import { sanitizeAccepts } from '../research-link.js';

describe('material for the research', () => {
    it('refuses programs, keys, archives and family trees whatever the research says', () => {
        for (const name of ['setup.exe', 'run.sh', 'id.pem', 'krabice.zip', 'tree.ged', 'x.dmg']) {
            expect(materialAccepted(name, 'application/octet-stream', null)).toBe(false);
        }
        expect(materialAccepted('dopis.txt', 'text/plain', null)).toBe(true);
        expect(materialAccepted('scan.TIF', 'image/tiff', null)).toBe(true);
    });

    it('keeps to the kinds the research names, by type or extension', () => {
        const types = [{ mime: 'image/jpeg', ext: ['.jpg', '.jpeg'] }, { mime: 'application/pdf', ext: ['.pdf'] }];
        expect(materialAccepted('a.jpg', 'image/jpeg', types)).toBe(true);
        expect(materialAccepted('a.JPEG', '', types)).toBe(true);
        expect(materialAccepted('b.pdf', 'application/pdf', types)).toBe(true);
        expect(materialAccepted('c.mp3', 'audio/mpeg', types)).toBe(false);
    });

    it('reads accepts.media.types from the status, dropping what is not a type', () => {
        const a = sanitizeAccepts({ media: { max: 1, types: [
            { mime: 'image/jpeg', ext: ['.jpg', 'jpg', '.<script>'] }, { mime: 'not a type' }, 'x', { ext: ['.mp3'] },
        ] } });
        expect(a?.mediaTypes).toEqual([{ mime: 'image/jpeg', ext: ['.jpg'] }, { mime: '', ext: ['.mp3'] }]);
        expect(sanitizeAccepts({ media: { max: 1 } })?.mediaTypes).toBeNull();
    });
});
