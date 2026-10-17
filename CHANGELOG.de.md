# Änderungsprotokoll

[English](CHANGELOG.md) · [Čeština](CHANGELOG.cs.md) · Deutsch

## 3.13.0

*Diese Version ist in Vorbereitung; dieser Abschnitt wächst mit jeder Testversion.*

- **Rand des Stammbaums**: Eine Hypothese, deren Versionen jeweils eine andere Familie außerhalb des Stammbaums verbinden würden, zeigt alle. Die Blase am Rand des Stammbaums und *Über der Person* führen jede Familie mit ihren Versionen, Personen und wartenden Aufgaben auf, jede als Link zu ihr; die Pille zeigt *+ 2 Familien* und bietet jede an. Mit Strom Research 1.16 oder neuer.
- **Forschung für diesen Stammbaum**: Ein Satz sagt, wo das Terminal gewählt wird, in dem sich die Forschung öffnet: in den Einstellungen der Forschung, mit *Einstellungen in der Forschung* gleich daneben. Am Computer, mit einer Forschung, die ihre Einstellungen aus der App anbietet; die Wahl selbst (Terminal oder iTerm2 auf dem Mac) kommt mit Strom Research 1.16.
- **Fehlerbehebungen**: Die Pille *+ Familie · N* am Rand des Stammbaums zählt die Familie, die sie zeigt: Bei einer Hypothese, deren Varianten jeweils eine andere Familie außerhalb des Stammbaums verbinden würden, gehören die Zahl der Personen und der wartenden Aufgaben jetzt zu der Familie, die nach einem Klick erscheint.

## 3.12.0

*Veröffentlicht am 16. Oktober 2026.*

- **Strom-Archiv**: Der Forschungsmodus ohne KI-Agent heißt in der ganzen App *Strom-Archiv*, von der Wahl in *Ahnenforschung* bis zum Etikett im Menü Forschung. Ein Archiv und eine Forschung, die auf ihren Agenten wartet, zeigen keine Aktionen des Agenten, und ihre Materialien und Stapel werden so gespeichert, wie sie sind.
- **Forschungsübersicht**: *Jetzt* steht über *Wartet auf Bearbeitung*. Arbeit außerhalb der Forschungsrichtungen erscheint in der Zeile *Außerhalb der Richtungen*, und das Live-Feld nennt die Person, an der jeder Lauf arbeitet; eine Person, die der Stammbaum in der App nicht hat, wird mit der Kennung der Forschung genannt. Das Live-Folgen endet sofort, wenn die Forschung endet, zum Archiv wird oder auf ihren Agenten wartet.
- **Verschieben von einer Karte aus**: Ein Ziehen, das auf einer Personenkarte beginnt, verschiebt die Fläche, mit der Maus und mit einem Finger; ein kurzer Druck bleibt Klick, Tippen oder langer Druck. Die Hover-Karte verschwindet, solange sich die Fläche bewegt.
- **Hover-Karte**: Jede Verbindung einer Person hat eine eigene Zeile, in der Reihenfolge der Ehen, mit ihren eigenen Kindern.
- **Verwandtschaft finden…**: Der Partner eines Geschwisters des Partners ist *Schwager* oder *Schwägerin*, und jede andere Verbindung über Ehen ist *verschwägert*, mit ihrem Pfad zum Hervorheben, statt „Keine Verwandtschaft gefunden“.
- **Karten und Personenbearbeitung**: Das † folgt den eigenen Daten der Person, nicht dem Tod eines Nachkommen; die Bearbeitung listet Geburt, Ereignisse und Tod in der Reihenfolge des Lebens; der Kartenstil *Symbole*, der Fotokreis neben einem zweizeiligen Namen und lange Orte neben der Pille ⇄ (die Person ist auch in einem anderen Stammbaum) sind ausgerichtet. Die Zahl bei *Jahrestage* sagt, was sie zählt („3 Jahrestage in den nächsten 7 Tagen“).
- **Fehlerbehebungen**: „Auch in:“ hält gleichnamige Schwestern nicht mehr für eine Person; *Zu stromapp.info gehen* in einer exportierten Datei öffnet die App mit dem Stammbaum bereit zum Import; die Zusammenfassung des GEDCOM-Imports schneidet ihre Beschriftungen nicht mehr ab; in Firefox wartet der Hinweis auf Änderungen nur im Browser nicht mehr auf die Speicherabfrage.
- **Über Strom**: Ein Link *Was ist neu ↗* öffnet dieses Änderungsprotokoll in der Sprache der App. Beim ersten Start einer neuen Version zeigt ein Fenster *Was ist neu* einmal die Punkte dieser Version, mit *Alle Änderungen ↗* und *Nächstes Mal nicht anzeigen*; *Einstellungen → Sprache und Erscheinungsbild → „Was ist neu“ nach einem Update* schaltet es wieder ein. Auf einem Computer mit Strom Research fügt eine neuere Version der Forschung dem Fenster ihre eigenen Punkte hinzu (*Forschung X.Y.Z*, mit *Alle Änderungen der Forschung ↗*), und *Über Strom* zeigt *Forschung X.Y.Z • Was ist neu ↗*.

## 3.11.0

- **Nur in der Ansicht verbunden**: Eine Familie, die eine Hypothese der Forschung verbinden würde, lässt sich dort zeigen, wo die Hypothese sie hinstellt, als schraffierte Geisterkarten, ohne Änderung des Stammbaums. Zählungen, die anderen Ansichten, das Senden und alle Ausgaben lassen die gezeigten Verbindungen weg. Eine Anzeige über der Ansicht öffnet die Liste der gezeigten Verbindungen.
- **Was die Forschung weiß** listet die Hypothesen einer Person mit Stand und Versionen, und einen Schalter für jede Version, die sich zeigen lässt.
- **Widersprüche aus einer Bearbeitung in der App** zeigen zwei Seiten, *Aus der App* und *In der Forschung*; auf dem Computer mit der Forschung lässt sich einer der Werte in einem Schritt behalten.
- **Wartendes in der Forschungsübersicht**: Chips nach Art, zwei Phasen (*Zu erledigen* und *Wartet auf Antwort*), Einträge nach Ort gruppiert, und *Gesendet* direkt in die Forschung geschrieben, mit Rückgängig.
- **Forschung**: *Letzte 24 Std.* nimmt die Zahlen der Forschung, *Diesen Monat* enthält die Kosten der Leser der Scans, ein abgelehntes Senden nennt den Grund in der Sprache der App, und ein leerer Stammbaum bietet *Forschung mit diesem Stammbaum starten* an.
- **Über Strom**: In der tschechischen Oberfläche ein Link zur Nutzergruppe auf Facebook.
- **Fehlerbehebungen**: Ein einzelner Elternteil in einer Ehekette steht über seinem eigenen Kind; das Löschen eines Stammbaums direkt nach dem Hinzufügen von Personen nennt die richtige Zahl der Personen; untere Leisten auf Touchscreens sind vom ersten Bild an deckend.
- **Daten**: Datenversion 12, wie in 3.10; nichts umzustellen. Die neuen Teile der Forschung brauchen Strom Research 1.14.
