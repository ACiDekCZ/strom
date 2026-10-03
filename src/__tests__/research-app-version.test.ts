/**
 * Every request to a research bridge carries the app's version (`app=`), so
 * the research knows what the app can show (the status of a fact). Only
 * addresses on this computer get it. Invented data.
 */

import { describe, it, expect } from 'vitest';
import { withAppVersion } from '../research-link.js';
import { APP_VERSION } from '../types.js';

const BASE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';

describe('the app\'s version on bridge requests', () => {
    it('adds app=<version> to bridge addresses, keeping what is there', () => {
        expect(withAppVersion(`${BASE}/status`, '3.9.0-beta.10')).toBe(`${BASE}/status?app=3.9.0-beta.10`);
        expect(withAppVersion(`${BASE}/status?poll=1`, '3.9.0')).toBe(`${BASE}/status?poll=1&app=3.9.0`);
        expect(withAppVersion(`http://localhost:5998/x/tree.ged`, '3.9.0')).toBe('http://localhost:5998/x/tree.ged?app=3.9.0');
        // Twice: still one.
        expect(withAppVersion(withAppVersion(`${BASE}/sync`, '3.9.0'), '3.9.0')).toBe(`${BASE}/sync?app=3.9.0`);
        expect(withAppVersion(`${BASE}/sync`)).toBe(`${BASE}/sync?app=${encodeURIComponent(APP_VERSION).replace(/%2B/g, '+')}`);
    });

    it('leaves any other address alone', () => {
        expect(withAppVersion('https://stromapp.info/research/', '3.9.0')).toBe('https://stromapp.info/research/');
        expect(withAppVersion('data:image/png;base64,AAAA', '3.9.0')).toBe('data:image/png;base64,AAAA');
        expect(withAppVersion('http://127.0.0.1.evil.com/x', '3.9.0')).toBe('http://127.0.0.1.evil.com/x');
    });
});
