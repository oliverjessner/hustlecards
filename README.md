# HUSTLE CARDS

Eine bildschirmfüllende Card-Draw-Experience mit 50 englischen Motivationskarten, einem räumlichen Kartenfächer und einer animierten 3D-Enthüllung. Die aktuellen Standardkarten nutzen dunkle Oberflächen, eigens gestaltete SVG-Ornamente und Champagner-Akzente ohne externe Schriften, Bilder, APIs oder Laufzeit-Abhängigkeiten. Für spätere Legendary-Porträts liegen fünf separate WebP-Bilddateien bereit. Die Collection zeigt eine verdeckte Legendary-Vorschau; Legendary-Karten sind noch nicht ziehbar.

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

Einmalig die Entwicklungsabhängigkeit für die Minifizierung installieren:

```sh
npm install
```

```sh
npm run build
npm run export
```

Beide Befehle erstellen dieselbe minifizierte Distribution im Ordner `dist/`. HTML, CSS, JavaScript einschließlich des Porträt-Helfers, Kartendaten und die bisherigen SVG-Ornamente bleiben vollständig in `dist/index.html` gebündelt. Vorhandene WebP-Porträts kopiert der Build unverändert aus `src/assets/legendary/` nach `dist/assets/legendary/`; sie werden niemals als Base64, Data-URL oder Inline-Bild eingebettet. `html-minifier-terser` verkleinert HTML sowie eingebettetes CSS und JavaScript; schließende Script-/Style-Sequenzen bleiben geschützt. Der Export und die freigegebenen Bilddateien werden validiert. Anschließend wird `dist/` von alten Dateien bereinigt und neu geschrieben. Die Quelldateien bleiben lesbar erhalten. Bei einem Fehler endet der Build mit Exit-Code 1.

**Der gesamte Ordner `dist/` ist die Distribution, nicht allein `index.html`.** Beim Kopieren oder Hochladen muss `assets/legendary/` neben der HTML-Datei erhalten bleiben. Nur bei einem leeren Porträt-Quellordner besteht der Export allein aus `index.html`. Es gibt keine separaten CSS- oder JavaScript-Dateien im Build.

Der Export lässt sich direkt im Browser öffnen oder auf jedem statischen HTTP-Server bereitstellen. Zum lokalen Prüfen des fertigen Exports:

```sh
npm run dev -- --dist
```

## Vorbereitete Porträt-Assets

Porträts gehören als bereits optimierte WebP-Dateien in diesen Pfad:

```text
src/assets/legendary/alexhormozi.webp
                ↓ npm run build
dist/assets/legendary/alexhormozi.webp
```

Erlaubt sind flache Dateinamen mit Kleinbuchstaben, Ziffern, Bindestrichen oder Unterstrichen und der Endung `.webp`, beginnend mit einem Buchstaben oder einer Ziffer. Unterordner, symbolische Links und andere Dateitypen werden nicht exportiert. Die leere `.gitkeep` und reguläre macOS-Dateien namens `.DS_Store` werden ignoriert und nicht ausgeliefert. Keine Fotos herunterladen oder Assets ohne geklärte Nutzungsrechte hinzufügen.

Diese fünf Dateien liegen im Quellordner bereit und werden unverändert kopiert:

| Datei | Abmessungen |
| --- | --- |
| `alexhormozi.webp` | 400 × 400 Pixel |
| `davidgoggings.webp` | 400 × 502 Pixel |
| `garyvee.webp` | 400 × 490 Pixel |
| `images.webp` | 400 × 400 Pixel |
| `saranblakely.webp` | 400 × 577 Pixel |

Eine künftige Kartendefinition kann folgende optionale Metadaten verwenden; dies aktiviert derzeit keine Legendary-Karte:

```js
portrait: {
  src: './assets/legendary/alexhormozi.webp',
  width: 400,
  height: 400
}
```

Der relative Pfad wird vom Dokument aus aufgelöst. Dadurch funktioniert dieselbe Distribution beispielsweise unter `/hustlecards/` oder `/experiments/hustlecards/`, ohne einen Root-Pfad oder eine Hostadresse fest einzubauen. Ein führendes `/`, externe URLs, Data-URLs, Query-Parameter und Pfadwechsel mit `..` werden vom Helfer nicht akzeptiert.

`src/portraits.js` stellt den wiederverwendbaren Helfer `window.HustlePortraits.create(portrait, { loading: 'lazy' })` und die Pfadprüfung `isPortraitPath(src)` bereit. `create` liefert ein dekoratives Porträt-Element mit dunklem Fallback; ohne zulässigen Bildpfad entsteht keine Bildanfrage. Die `img`-Elemente verwenden feste intrinsische Abmessungen, standardmäßig 600 × 900 Pixel, `decoding="async"`, `object-fit: cover` und dunkle Verlaufsüberlagerungen. In Karten ist das Bild standardmäßig dekorativ und hat einen leeren Alternativtext: Identität und Zitat müssen über den zugänglichen Karteninhalt vermittelt werden. Für eigenständige, inhaltliche Bilder unterstützt der Helfer `{ decorative: false }` mit einem beschreibenden `portrait.alt`. Ein fehlendes oder fehlgeschlagenes Bild lässt die Karte mit dunklem Hintergrund lesbar; es gibt keine automatischen Wiederholungsanfragen. Ein fehlgeschlagener Pfad wird in derselben Sitzung bis zum Neuladen nicht erneut angefordert.

Die vorbereiteten Renderpfade laden Porträts einer enthüllten Karte und der geöffneten Detailansicht mit `loading="eager"`. Die sichtbare Sammlung erzeugt nur für bereits entdeckte Karten Bilder mit `loading="lazy"`; verdeckte Karten und die noch geschlossene Sammlung erzeugen keine Porträtanfragen. Die nativen Browserregeln bestimmen bei Lazy Loading den Abstand zum sichtbaren Bereich. Aktuell besitzen alle 50 Standardkarten keine Porträt-Metadaten und verursachen daher keine Bildanfragen.

Für mobile Bandbreite Porträts vor dem Hinzufügen zuschneiden, auf höchstens etwa 600 × 900 Pixel begrenzen und als WebP komprimieren; kleinere Quellen nicht hochskalieren. Etwa 100 KiB pro Datei ist ein sinnvolles Ziel, keine Build-Grenze. Es gibt keine Vorabdownloads des gesamten Bildbestands, keine Cache-Busting-Parameter und keine Laufzeitbibliothek für Bilder.

Porträts nutzen den normalen HTTP-Cache des Browsers. Der Entwicklungsserver liefert sie als `image/webp` mit `Cache-Control: public, max-age=3600`, ETag und Last-Modified sowie `304 Not Modified` bei gültigen bedingten Anfragen. HTML, CSS und JavaScript bleiben für die Entwicklung mit `no-store` versehen. Beim statischen Hosting MIME-Typ und Cache-Control entsprechend konfigurieren; die tatsächliche Cache-Dauer legt der Host fest. Wird ein Porträt ersetzt, einen neuen Dateinamen wie `example-v2.webp` verwenden und die Metadaten anpassen. Es gibt keinen Service Worker und keine Garantie, dass ein zuvor geladenes Bild im Browser-Cache verbleibt.

## Karten und Bedienung

Wähle eine der verdeckten Karten per Klick, Touch oder Tastatur. Tab setzt den Fokus, Enter oder Leertaste zieht die Karte. Nur die gewählte Karte wird aus dem verbleibenden Pool entfernt. Die Auswahl nutzt `crypto.getRandomValues()` mit unverzerrter Zufallsauswahl; angebotene Karten sind innerhalb einer Runde verschieden. Bei zwei oder einer verbleibenden Karte verkleinert sich die Auswahl entsprechend.

Nach einer Ziehung bleibt die aufgedeckte Karte sichtbar. Die nächste Karte lässt sich frühestens 24 Stunden nach der letzten Auswahl ziehen. Der dezente Timer oben rechts zeigt die verbleibende Zeit und aktualisiert sich automatisch. Nach Ablauf erscheint „DRAW AGAIN“; damit öffnet sich der nächste Kartenfächer. Ein Neuladen stellt die zuletzt gezogene Karte und ihre Wartezeit wieder her. Bereits geöffnete Tabs übernehmen neue Ziehungen aus demselben Browser-Speicher.

Mit einer Maus neigt sich die aufgedeckte Karte beim Bewegen des Zeigers über die Karte im 3D-Raum, bis maximal 14 Grad pro Achse. Sie folgt dem Zeiger außerdem um bis zu acht Pixel und hebt sich dabei leicht an. Beim Verlassen kehrt sie sanft in ihre Ausgangslage zurück. Der Effekt funktioniert auch mit einer nach dem Neuladen wiederhergestellten Karte. Finger- und Stiftbewegungen lösen diesen Maus-Effekt nicht aus; die Systemeinstellung für reduzierte Bewegung deaktiviert das Kippen vollständig.

Auf Mobilgeräten reagiert die aufgedeckte Karte zusätzlich auf das Neigen des Geräts, sofern der Browser Orientierungsdaten ohne neue Zustimmung liefert. Die erste gültige Messung kalibriert die aktuelle Haltung als neutral; Hoch- und Querformat werden berücksichtigt. Die App ruft niemals `requestPermission()` auf. Bietet der Browser diese Methode an, liest die App nur den bestehenden Status für Beschleunigungs- und Gyroskopsensoren aus und aktiviert den Effekt ausschließlich, wenn beide bereits erlaubt sind. Bei ausstehender Zustimmung, verweigertem oder nicht auslesbarem Status bleibt die Karte ruhig. Browser ohne diese Berechtigungsmethode können Orientierungsereignisse direkt liefern. Voraussetzung ist ein sicherer Kontext, beim Hosting also HTTPS. Sensordaten werden nur für die sichtbare aufgedeckte Karte verarbeitet und weder gespeichert noch übertragen. Bei Fokusverlust, Hintergrundwechsel, Bildschirmrotation oder reduzierter Bewegung wird der Effekt zurückgesetzt und gegebenenfalls neu kalibriert.

Der dezente Eintrag „COLLECTION“ öffnet jederzeit eine eigene, vertikal scrollbare Sammlung, auch während der Wartezeit und nach Abschluss des Decks. Alle 50 Karten stehen nach Nummer sortiert in einem Raster mit zwei Spalten auf Mobilgeräten, drei auf Tablets und vier bis fünf auf Desktop-Bildschirmen. Noch nicht entdeckte Karten bleiben verdeckt; ihre Zitate stehen weder im Sammlungs-Markup noch in Screenreader-Beschriftungen. Entdeckte Karten lassen sich als große Karte ansehen, ohne eine Ziehung oder neue Wartezeit auszulösen. „BACK TO COLLECTION“ stellt Scrollposition und Tastaturfokus wieder her; Escape führt von der Detailansicht zur Sammlung und dann zum Deck zurück. „X OF 50 DISCOVERED“ und eine schmale Linie zeigen den lebenslangen Fortschritt.

Unter den 50 regulären Karten stehen fünf verdeckte Legendary-Plätze mit „COMING SOON“. Diese Vorschau bleibt auch nach Abschluss oder Neustart eines Decks verdeckt. Sie lädt keine Porträts, verrät keine Namen oder Zitate und verändert weder den Entdeckungsfortschritt noch die Wartezeit.

Unten im Deck steht ein dezenter „made by oliverjessner.at“-Link. Nach Karte 50 öffnet „COMPLETE DECK“ die Abschlussansicht. „START A NEW DECK“ wird erst nach Ablauf der aktuellen Wartezeit verfügbar und setzt nach Bestätigung nur das aktuelle Deck zurück. Alle entdeckten Karten bleiben in der Sammlung erhalten. Eine bevorzugte reduzierte Bewegung wird berücksichtigt; Fokusmarkierungen und Screenreader-Ankündigungen unterstützen die Bedienung.

## Speicherung und Offline-Nutzung

Die App verwendet weiterhin ausschließlich den localStorage-Schlüssel `hustle-cards:v1`; das darin gespeicherte Format hat jetzt `version: 2`. `drawnIds` enthält die eindeutigen Karten des aktuellen Decks, `discoveredIds` unabhängig davon alle bisher entdeckten Karten. Bestehende Version-1-Speicherstände werden automatisch migriert: Jede gültige gezogene Karte wird auch als entdeckt übernommen; Deck-ID, letzte Karte und Wartezeit bleiben erhalten. Interne `deckId` und `deckGeneration` unterscheiden neue Decks und verhindern, dass ein verspäteter Tab alte Deck-Fortschritte wiederherstellt. Kartendatensätze enthalten eine erweiterbare `rarity`-Eigenschaft; derzeit gibt es ausschließlich Standardkarten.

`lastDrawnAt` enthält den Zeitpunkt der letzten Auswahl als Unix-Zeit in Millisekunden. Auswahl, Entdeckung und Zeitpunkt werden gemeinsam vor Beginn der Reveal-Animation gespeichert. Ein Neuladen schließt bereits gezogene Karten weiterhin aus. Doppelte Einträge und unbekannte IDs werden bereinigt. Ältere Speicherstände ohne gültigen Zeitpunkt behalten ihre gezogenen Karten und erlauben die nächste Ziehung sofort; ab dieser Auswahl gilt die 24-Stunden-Wartezeit. Ein bestätigter Neustart speichert ein leeres aktuelles Deck und behält `discoveredIds`. Änderungen anderer Tabs werden auch in einer offenen Sammlung übernommen, ohne Detailansicht, Scrollposition oder Fokus zu verlieren. Beschädigte oder gelöschte Daten aus anderen Tabs überschreiben keinen gültigen laufenden Sitzungszustand. Auf Browsern mit Web Locks API werden Ziehungen und Neustarts zwischen Tabs serialisiert; ohne diese API werden Speicherstände vor jeder Änderung erneut gelesen und über Speicherereignisse zusammengeführt.

Ist localStorage blockiert oder nicht beschreibbar, arbeitet die App für die aktuelle Sitzung mit einem Speicherzustand im Arbeitsspeicher weiter und zeigt einen dezenten Hinweis. Die Wartezeit gilt dann nur in der aktuellen Sitzung. Ziehungen und Wartezeit können nach dem Schließen oder Neuladen verloren gehen.

Die in `index.html` gebündelte Oberfläche und die aktuellen Standardkarten brauchen nach dem Laden keine Netzwerkverbindung. Spätere Porträts werden separat bei Bedarf angefordert; offline erscheinen nur lokal verfügbare oder noch im Browser-Cache vorhandene Dateien. Für andere Bilder bleibt der dunkle Fallback sichtbar, ohne Ziehungen, Sammlung oder Wartezeit zu verändern. Beim direkten Öffnen über `file://` hängt die Verfügbarkeit und Zuordnung von localStorage vom Browser ab; normale HTTP-Caching-Regeln gelten dort nicht. Ein Umbenennen oder Verschieben der Datei kann einen anderen Speicherbereich ergeben. Für zuverlässige Persistenz ist ein stabiler HTTP-Origin der Referenzbetrieb: Protokoll, Hostname und Port müssen gleich bleiben. `localhost`, `127.0.0.1` und verschiedene Ports haben getrennte Speicherbereiche.

## Projektstruktur

```text
src/
  index.html
  styles.css
  app.js
  portraits.js
  assets/legendary/  # fünf vorbereitete WebP-Bilddateien
scripts/
  build.mjs
  dev.mjs
tests/
  build.test.mjs
  cooldown.test.mjs
  dev.test.mjs
dist/
  index.html
  assets/legendary/  # nur wenn Porträtdateien enthalten sind
package.json
README.md
```

Der Entwicklungsserver verwendet ausschließlich Node.js-Bordmittel. Für den Build wird `html-minifier-terser` als Entwicklungsabhängigkeit benötigt; die exportierte Oberfläche hat weiterhin keine Laufzeit-Abhängigkeiten. Sie benötigt einen aktuellen Browser mit CSS-3D-Transforms, Web Animations API, Web Crypto und localStorage; bei eingeschränktem Speicher bleibt die aktuelle Sitzung nutzbar.

## Tests

```sh
npm test
```

Der integrierte Node.js-Testlauf prüft den gebündelten Build und separate freigegebene Porträt-Assets in isolierten temporären Verzeichnissen: Minifizierung mit Erhalt bedeutungsvoller Leerzeichen und JavaScript-Werte, Inline-Inhalte, sichere Script-/Style-Endtags, Bereinigung alter Exportdateien, unverändertes Kopieren zugelassener WebP-Dateien, relative Bildpfade und die Ablehnung zusätzlicher Code-Ressourcen oder beliebiger Laufzeit-Netzwerkzugriffe. Weitere Tests führen den unveränderten App-Code mit einem kleinen DOM-Adapter und kontrollierter Uhr aus: Speicherung vor dem Reveal, Schutz vor Mehrfachauswahl, die exakte 24-Stunden-Grenze, Neuladen, Migration älterer Speicherstände, Änderungen aus anderen Tabs und Betrieb ohne localStorage. Sie prüfen außerdem Maus- und Sensor-Tilt, Kalibrierung, Bildschirmachsen, ungültige Messwerte, den Verzicht auf Berechtigungsanfragen sowie das Zurücksetzen bei Zeiger-, Fenster- und Medieneinstellungsänderungen. Die Sammlungstests prüfen alle 50 Karten und verdeckte Inhalte, Migration und lebenslange Entdeckungen, Neustarts, unabhängige Wartezeiten, Detailnavigation mit Scroll- und Fokuswiederherstellung sowie die Zusammenführung verschiedener Tabs und beschädigter Speicherstände. Porträttests prüfen bedarfsgesteuertes Laden, die gesperrten Renderpfade, feste Abmessungen, Fehler-Fallbacks und unveränderte Spielzustände. HTTP-Tests starten ausschließlich kurzlebige Testserver auf freien lokalen Ports und prüfen WebP-MIME-Typ, Cache-Header, bedingte Anfragen und Inhaltsänderungen. Diese Tests ersetzen keine visuelle Prüfung im Browser oder auf einem echten Mobilgerät.
