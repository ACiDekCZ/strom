# Přehled změn

[English](CHANGELOG.md) · Čeština · [Deutsch](CHANGELOG.de.md)

## 3.13.0

*Tato verze se připravuje; oddíl se doplňuje s každou testovací verzí.*

- **Kraj stromu**: hypotéza, jejíž verze by napojily každá jinou rodinu mimo strom, ukáže všechny. Bublina na kraji stromu i *Nad osobou* vypíšou každou rodinu s jejími verzemi, lidmi a čekajícími úkoly, každou jako odkaz na ni; pilulka ukáže *+ 2 rodiny* a nabídne každou z nich. Se Strom Research 1.16 a novějším.
- **Výzkum u tohoto stromu**: jedna věta říká, kde se volí terminál, ve kterém se výzkum otevírá: v nastavení výzkumu, s tlačítkem *Nastavení ve výzkumu* hned vedle. Na počítači, se Strom Research 1.16 nebo novějším, který samotnou volbu přináší (Terminál nebo iTerm2 na Macu).
- **Příjmení po sňatku**: import GEDCOM drží příjmení po sňatku (druhé `NAME` s `TYPE married` nebo `_MARNM`) zvlášť od rodného, místo aby z něj dělal další tvar jména, export a odeslání do výzkumu ho zapíšou zpět a hledání osobu najde i podle něj. Karty, nabídka osoby, panely osoby a hledání ukazují příjmení po sňatku s rodným jako tichou poznámkou (*roz. Dvořáková*); *Nastavení → Karta osoby → Zobrazení příjmení* přepne na rodné příjmení nebo jen to po sňatku. Rejstřík knihy rodu uvádí osobu pod oběma příjmeními a *Tvary příjmení* ukazují, kdo příjmení nosí po sňatku, vedle počtů, které dál vycházejí z rodných příjmení. Editor osoby má pod příjmením pole *Příjmení po sňatku* (u ženy se svazkem vždy, jinak za odkazem *+ příjmení po sňatku*) a pod prázdným polem návrh z příjmení manžela, přechýlený podle českých pravidel, kde platí (*Novák → Nováková*): *Použít* ho vyplní, × ho skryje a stejný návrh se už nenabídne. Verze výzkumu, která vrací příjmení po sňatku vyprázdněné tady, ho v dialogu *Načíst verzi výzkumu?* ukáže jako řádek.
- **Opravy**: pilulka *+ rodina · N* na kraji stromu počítá rodinu, kterou ukáže: u hypotézy, jejíž varianty by napojily každá jinou rodinu mimo strom, patří počet lidí a čekajících úkolů k rodině, která se po kliknutí objeví.

## 3.12.0

*Vydáno 16. října 2026.*

- **Archiv Stromu**: režim výzkumu bez AI agenta se v celé aplikaci jmenuje *Archiv Stromu*, od volby ve *Výzkumu předků* po štítek v menu Výzkum. Archiv i výzkum, který čeká na agenta, neukazují akce agenta a materiály a dávky se v nich ukládají tak, jak jsou.
- **Přehled výzkumu**: *Teď* je nad *Čeká na vyřízení*. Práce mimo linie výzkumu se ukáže v řádku *Mimo linie* a živý panel u každé práce jmenuje osobu; osobu, kterou strom v aplikaci nemá, jmenuje identifikátorem výzkumu. Sledování živě skončí hned, když výzkum skončí, stane se archivem nebo čeká na agenta.
- **Posun z karty**: tah začatý na kartě osoby posouvá plátno, myší i jedním prstem; krátký stisk zůstává kliknutím, ťuknutím nebo dlouhým stiskem. Při posunu se karta s náhledem osoby schová.
- **Náhled osoby**: každý svazek osoby má vlastní řádek v pořadí manželství a s vlastními dětmi.
- **Zjistit vztah…**: partner sourozence partnera je *švagr* nebo *švagrová* a každé jiné spojení přes sňatky je *příbuzný sňatkem* / *příbuzná sňatkem* s cestou ke zvýraznění, místo „Žádný vztah nenalezen“.
- **Karty a úprava osoby**: † se řídí vlastními údaji osoby, ne úmrtím potomka; úprava osoby řadí narození, události a úmrtí v pořadí života; styl karty *Značky*, kolečko s fotkou u dvouřádkového jména a dlouhá místa vedle pilulky ⇄ (osoba je i v jiném stromu) jsou srovnané. Počet u *Výročí* říká, co počítá („3 výročí v příštích 7 dnech“).
- **Opravy**: „Také v:“ už nebere jmenovkyně sestry za jednu osobu; *Přejít na stromapp.info* v exportovaném souboru otevře aplikaci se stromem připraveným k importu; souhrn importu GEDCOM už neořezává popisky; ve Firefoxu upozornění na úpravy jen v prohlížeči nečeká na dotaz k úložišti.
- **O aplikaci**: odkaz *Co je nového ↗* otevře tento přehled změn v jazyce aplikace. Při prvním spuštění nové verze se jednou ukáže okno *Co je nového* s body té verze, s odkazem *Všechny změny ↗* a volbou *Příště nezobrazovat*; zpět ho zapne *Nastavení → Jazyk a vzhled → Co je nového po aktualizaci*. Na počítači se Strom Research přidá nová verze výzkumu do okna své body (*Výzkum X.Y.Z*, s odkazem *Všechny změny výzkumu ↗*) a O aplikaci ukáže *Výzkum X.Y.Z • Co je nového ↗*.

## 3.11.0

- **Připojeno jen v zobrazení**: rodinu, kterou by připojila hypotéza výzkumu, jde ukázat tam, kam ji hypotéza staví, jako šrafované karty duchů, beze změny stromu. Počty, ostatní pohledy, poslání i všechny výstupy ukázaná připojení vynechají. Ukazatel nad pohledem otevře seznam ukázaných připojení.
- **Co ví výzkum** vypíše hypotézy osoby se stavem a verzemi a s přepínačem u každé verze, kterou jde ukázat.
- **Rozpory z úpravy v aplikaci** ukazují dvě strany, *Z aplikace* a *Ve výzkumu*; na počítači s výzkumem jde jednu z hodnot ponechat jedním krokem.
- **Čekající v přehledu výzkumu**: čipy podle druhu, dvě fáze (*K vyřízení* a *Čeká na odpověď*), položky seskupené podle místa a *Odesláno* zapsané rovnou do výzkumu, s možností Vrátit.
- **Výzkum**: *Posledních 24 h* bere čísla od výzkumu, *Tento měsíc* zahrnuje náklady na čtenáře skenů, odmítnuté poslání řekne důvod v jazyce aplikace a prázdný strom nabídne *Začít výzkum s tímto stromem*.
- **O aplikaci**: v českém rozhraní odkaz na skupinu uživatelů na Facebooku.
- **Opravy**: jediný rodič v řetězu manželství stojí nad svým dítětem; smazání stromu hned po přidání osob uvede správný počet osob; spodní panely na dotykové obrazovce jsou neprůhledné od prvního snímku.
- **Data**: datová verze 12 jako v 3.10, nic se nepřevádí. Nové části výzkumu potřebují Strom Research 1.14.
