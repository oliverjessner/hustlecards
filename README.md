# HUSTLE CARDS

Eine bildschirmfüllende Card-Draw-Experience mit 50 englischen Motivationskarten, einem räumlichen Kartenfächer und einer animierten 3D-Enthüllung. Dunkle Oberflächen, eigens gestaltete SVG-Ornamente und Champagner-Akzente funktionieren vollständig ohne externe Schriften, Bilder, APIs oder Laufzeit-Abhängigkeiten.

## Entwicklungsstart

Voraussetzung: Node.js 20 oder neuer. Eine Paketinstallation ist nicht erforderlich.

```sh
npm run dev
```

Die App ist unter `http://127.0.0.1:5173` erreichbar. Änderungen an `src/` werden nach dem Neuladen sichtbar.

```sh
npm run dev -- --port 8080
```

## Build und Export

```sh
npm run build
npm run export
```

Beide Befehle erstellen dieselbe eigenständige Datei: `dist/index.html`. Der Build integriert HTML, CSS, JavaScript, Kartendaten und SVG-Grafiken direkt in diese Datei, schützt schließende Script-/Style-Sequenzen und validiert den Export. `dist/` wird vor dem Schreiben bereinigt und enthält anschließend ausschließlich `index.html`. Die Quelldateien bleiben erhalten. Bei einem Fehler endet der Build mit Exit-Code 1.

Der Export lässt sich direkt im Browser öffnen oder auf jedem statischen HTTP-Server bereitstellen. Zum lokalen Prüfen des fertigen Exports:

```sh
npm run dev -- --dist
```

## Karten und Bedienung

Wähle eine der verdeckten Karten per Klick, Touch oder Tastatur. Tab setzt den Fokus, Enter oder Leertaste zieht die Karte. Nur die gewählte Karte wird aus dem verbleibenden Pool entfernt. Die Auswahl nutzt `crypto.getRandomValues()` mit unverzerrter Zufallsauswahl; angebotene Karten sind innerhalb einer Runde verschieden. Bei zwei oder einer verbleibenden Karte verkleinert sich die Auswahl entsprechend.

Nach einer Ziehung bleibt die aufgedeckte Karte sichtbar. Die nächste Karte lässt sich frühestens 24 Stunden nach der letzten Auswahl ziehen. Der dezente Timer oben rechts zeigt die verbleibende Zeit und aktualisiert sich automatisch. Nach Ablauf erscheint „DRAW AGAIN“; damit öffnet sich der nächste Kartenfächer. Ein Neuladen stellt die zuletzt gezogene Karte und ihre Wartezeit wieder her. Bereits geöffnete Tabs übernehmen neue Ziehungen aus demselben Browser-Speicher.

Die Oberfläche konzentriert sich auf die Karten: ohne Header, Fortschrittsanzeige oder allgemeinen Reset. Unten steht ein dezenter „made by oliverjessner.at“-Link. Nach Karte 50 lässt sich die abgeschlossene Sammlung ansehen. „START A NEW DECK“ wird erst nach Ablauf der aktuellen Wartezeit verfügbar und setzt das Deck nach Bestätigung zurück. Eine bevorzugte reduzierte Bewegung wird berücksichtigt; Fokusmarkierungen und Screenreader-Ankündigungen unterstützen die Bedienung.

## Speicherung und Offline-Nutzung

Die App verwendet ausschließlich den localStorage-Schlüssel `hustle-cards:v1` mit `version`, eindeutigen `drawnIds`, `lastDrawnId`, `lastDrawnAt` und einer internen Deck-ID. `lastDrawnAt` enthält den Zeitpunkt der letzten Auswahl als Unix-Zeit in Millisekunden. Auswahl und Zeitpunkt werden gemeinsam vor Beginn der Reveal-Animation gespeichert. Ein Neuladen schließt bereits gezogene Karten weiterhin aus. Beschädigte Daten, doppelte Einträge und unbekannte IDs werden bereinigt. Ältere Speicherstände ohne gültigen Zeitpunkt behalten ihre gezogenen Karten und erlauben die nächste Ziehung sofort; ab dieser Auswahl gilt die 24-Stunden-Wartezeit. Ein bestätigter Neustart nach Abschluss entfernt ausschließlich diesen App-Schlüssel.

Ist localStorage blockiert oder nicht beschreibbar, arbeitet die App für die aktuelle Sitzung mit einem Speicherzustand im Arbeitsspeicher weiter und zeigt einen dezenten Hinweis. Die Wartezeit gilt dann nur in der aktuellen Sitzung. Ziehungen und Wartezeit können nach dem Schließen oder Neuladen verloren gehen.

Die exportierte HTML-Datei braucht nach dem Laden keine Netzwerkverbindung. Beim direkten Öffnen über `file://` hängt die Verfügbarkeit und Zuordnung von localStorage vom Browser ab. Ein Umbenennen oder Verschieben der Datei kann einen anderen Speicherbereich ergeben. Für zuverlässige Persistenz ist ein stabiler HTTP-Origin der Referenzbetrieb: Protokoll, Hostname und Port müssen gleich bleiben. `localhost`, `127.0.0.1` und verschiedene Ports haben getrennte Speicherbereiche.

## Projektstruktur

```text
src/
  index.html
  styles.css
  app.js
scripts/
  build.mjs
  dev.mjs
tests/
  build.test.mjs
  cooldown.test.mjs
dist/
  index.html
package.json
README.md
```

Der Build und Entwicklungsserver verwenden ausschließlich Node.js-Bordmittel. Die Oberfläche benötigt einen aktuellen Browser mit CSS-3D-Transforms, Web Animations API, Web Crypto und localStorage; bei eingeschränktem Speicher bleibt die aktuelle Sitzung nutzbar.

## Tests

```sh
npm test
```

Der integrierte Node.js-Testlauf prüft den Single-File-Build in isolierten temporären Verzeichnissen: Inline-Inhalte, sichere Script-/Style-Endtags, Bereinigung alter Exportdateien und die Ablehnung separater Ressourcen oder Laufzeit-Netzwerkzugriffe. Weitere Tests führen den unveränderten App-Code mit einem kleinen DOM-Adapter und kontrollierter Uhr aus: Speicherung vor dem Reveal, Schutz vor Mehrfachauswahl, die exakte 24-Stunden-Grenze, Neuladen, Migration älterer Speicherstände, Änderungen aus anderen Tabs und Betrieb ohne localStorage. Diese Tests ersetzen keine visuelle Prüfung im Browser.
