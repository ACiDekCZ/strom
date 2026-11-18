/**
 * Polish strings of the notice about another window's choice in the main window (spec 110, src/ui/window-notice.ts).
 */

import type { StringsType } from '../strings.js';

export const plPart11: Pick<StringsType, 'mainNotice'> = {
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
};
