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
        agent: 'Śledzenie agenta – osoba wybrana w innym oknie jest tylko zaznaczana.',
        hidden: 'Wybrana osoba jest w tym oknie ukryta.',
        deleted: 'Wybranej osoby nie ma już w drzewie.',
    },
    satFollow: {
        label: 'Wybrana osoba:',
        menu: 'Wybrana osoba',
        groupThis: 'To okno',
        groupThisSub: 'osoba wybrana w innym oknie',
        groupMain: 'Okno główne',
        groupMainSub: 'osoba wybrana w tym oknie',
        recvSwitch: 'przełączaj',
        recvSwitchNote: 'Osoba wybrana w innym oknie staje się tu środkiem.',
        recvMark: 'tylko zaznaczaj',
        recvMarkNote: 'Osoba wybrana w innym oknie jest tu tylko zaznaczana.',
        recvOff: 'wyłączone',
        recvOffNote: 'Okno ma własną wybraną osobę i niczego nie wysyła.',
        sendMark: 'tylko zaznaczaj',
        sendMarkNote: 'Okno główne zaznacza osobę, środek pozostaje.',
        sendFocusNote: 'Osoba staje się środkiem okna głównego, a drzewo jest wokół niej przerysowywane.',
        sendDisabled: 'Niedostępne – udostępnianie wybranej osoby jest w tym oknie wyłączone.',
        noMain: 'Okno główne nie jest otwarte.',
        agentSuffix: '(agent)',
        agentNote: 'Okno główne śledzi agenta – wybrana osoba jest tam tylko zaznaczana.',
        aria: (recv: string, send: string) => `Wybrana osoba między oknami. Z innych okien: ${recv}. Do okna głównego: ${send}.`,
        ariaRecv: (recv: string) => `Wybrana osoba między oknami. Z innych okien: ${recv}.`,
        ariaOff: 'Wybrana osoba między oknami: wyłączone.',
    },
};
