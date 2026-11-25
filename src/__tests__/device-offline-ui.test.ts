import { describe, it, expect, afterEach } from 'vitest';
import { deviceDownKindOf, deviceDownText, deviceDownNow } from '../ui/device-offline-ui';
import { strings, setLanguage } from '../strings';

afterEach(() => setLanguage('en'));

describe('a device without its computer (spec 094 §7)', () => {
    it('five states: switched off reads as not reachable; a try between failures keeps the state it had', () => {
        expect(deviceDownKindOf('connected', 'unreachable')).toBeNull();
        expect(deviceDownKindOf('unreachable', null)).toBe('unreachable');
        expect(deviceDownKindOf('disabled', null)).toBe('unreachable');
        expect(deviceDownKindOf('otherAddress', null)).toBe('moved');
        expect(deviceDownKindOf('offline', null)).toBe('offline');
        expect(deviceDownKindOf('unpaired', 'offline')).toBe('unpaired');
        expect(deviceDownKindOf('connecting', 'moved')).toBe('moved');
        expect(deviceDownKindOf('connecting', null)).toBeNull();
        // outside the device mode nothing is down
        expect(deviceDownNow()).toBeNull();
    });

    it('the quiet line says why and what is shown', () => {
        expect(deviceDownText('unreachable', 'Pracovna', '14:05', true)).toBe('The computer Pracovna is not reachable. The state shown is the last one known (14:05).');
        expect(deviceDownText('unreachable', 'Pracovna', '', false)).toBe('The computer Pracovna is not reachable. This device holds no last copy of the tree.');
        expect(deviceDownText('moved', 'Pracovna', '', true)).toBe('The computer Pracovna is now at another address. On the computer: Research → Devices → new QR code.');
        expect(deviceDownText('offline', 'Pracovna', '', true)).toBe('The research is available only on the home network of Pracovna.');
        expect(deviceDownText('unpaired', 'Pracovna', '', true)).toBe('This device is no longer paired with Pracovna. To pair again: scan the QR code on the computer with the research.');
        setLanguage('cs');
        expect(deviceDownText('moved', 'Pracovna', '', true)).toBe('Počítač Pracovna je teď na jiné adrese. Na počítači: Výzkum → Zařízení → nový QR kód.');
    });

    it('counts in each language, a zero left out', () => {
        expect(strings.device.back(6, 2)).toBe('Reconnected – sending 6 photos and 2 edits.');
        expect(strings.device.back(1, 0)).toBe('Reconnected – sending 1 photo.');
        expect(strings.device.discardText(0, 1)).toBe('1 edit will be deleted from this device and will not reach the research. This cannot be undone.');
        setLanguage('cs');
        expect(strings.device.back(6, 2)).toBe('Znovu připojeno – odesílá se 6 fotek a 2 úpravy.');
        expect(strings.device.discardText(6, 2)).toBe('6 fotek a 2 úpravy se smažou z tohoto zařízení a do výzkumu se nedostanou. Vrátit to nejde.');
        expect(strings.device.discardText(5, 0)).toBe('5 fotek se smaže z tohoto zařízení a do výzkumu se nedostane. Vrátit to nejde.');
        expect(strings.device.discardText(0, 3)).toBe('3 úpravy se smažou z tohoto zařízení a do výzkumu se nedostanou. Vrátit to nejde.');
        setLanguage('de');
        expect(strings.device.back(1, 0)).toBe('Wieder verbunden – 1 Foto wird gesendet.');
        expect(strings.device.discardText(7, 1)).toBe('7 Fotos und 1 Änderung werden von diesem Gerät gelöscht und erreichen die Forschung nicht. Das lässt sich nicht rückgängig machen.');
        setLanguage('pl');
        expect(strings.device.back(2, 5)).toBe('Połączono ponownie – wysyła się 2 zdjęcia i 5 zmian.');
    });
});
