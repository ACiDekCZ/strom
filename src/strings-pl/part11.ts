/**
 * Polish strings of the notice about another window's choice in the main window (spec 110, src/ui/window-notice.ts)
 * and of the satellite header's "Selection" control (src/windows/sat-header.ts).
 */

import type { StringsType } from '../strings.js';

export const plPart11: Pick<StringsType, 'mainNotice' | 'satFollow'> = {
    mainNotice: {
        focusFromWindow: 'Środek wybrany w innym oknie',
        restoreAria: (name: string) => `Przywróć poprzedni środek: ${name}`,
        close: 'Zamknij komunikat',
        notInView: (name: string) => `${name} – brak w tym widoku.`,
        goTo: 'Przejdź do',
        agent: 'Śledzenie agenta – wybór z innego okna jest tylko zaznaczany.',
        hidden: 'Wybrana osoba jest w tym oknie ukryta.',
        deleted: 'Wybranej osoby nie ma już w drzewie.',
    },
    satFollow: {
        label: 'Wybór:',
        menu: 'Wybór',
        groupThis: 'To okno',
        groupThisSub: 'wybór z innych okien',
        groupMain: 'Okno główne',
        groupMainSub: 'wybór w tym oknie',
        recvSwitch: 'przełączaj',
        recvSwitchNote: 'Osoba wybrana w innym oknie staje się tu środkiem.',
        recvMark: 'tylko zaznaczaj',
        recvMarkNote: 'Osoba wybrana w innym oknie jest tu tylko zaznaczana.',
        recvOff: 'wyłączone',
        recvOffNote: 'Okno ma własny wybór osoby i niczego nie wysyła.',
        sendMark: 'tylko zaznaczaj',
        sendMarkNote: 'Okno główne zaznacza osobę, środek pozostaje.',
        sendFocusNote: 'Osoba staje się środkiem okna głównego, a drzewo jest wokół niej przerysowywane.',
        sendDisabled: 'Niedostępne – udostępnianie wyboru jest w tym oknie wyłączone.',
        noMain: 'Okno główne nie jest otwarte.',
        agentSuffix: '(agent)',
        agentNote: 'Okno główne śledzi agenta – wybór jest tam tylko zaznaczany.',
        aria: (recv: string, send: string) => `Wybór osoby między oknami. Z innych okien: ${recv}. Do okna głównego: ${send}.`,
        ariaRecv: (recv: string) => `Wybór osoby między oknami. Z innych okien: ${recv}.`,
        ariaOff: 'Wybór osoby między oknami: wyłączone.',
    },
};
