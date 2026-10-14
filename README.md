# py-studio

Ein minimalistischer Python- und C++-Editor im VS-Code-Stil. CodeMirror liefert Syntax-Highlighting. Python läuft mit CPython/Pyodide in einem Web Worker, C++ mit JSCPP in einem separaten Worker. Alles läuft im Browser, ohne Backend oder Datei-Upload.

## Lokal starten

Die Seite muss über HTTP geöffnet werden, damit ES-Module und Worker funktionieren:

```bash
python3 -m http.server 8000
```

Danach `http://localhost:8000` öffnen. CodeMirror und JSCPP werden von esm.sh geladen, Pyodide 0.26.4 von jsDelivr. Zum Laden der Bibliotheken ist eine Internetverbindung nötig.

## Workspace und Cache

Beim ersten Besuch enthält der Workspace `main.py` und `main.cpp` mit Beispielcode. `localStorage["py-studio:workspace"]` speichert ein Objekt mit `files` (Dateiname → `{content, language}`) und `activeFilename`. Änderungen und Dateiauswahl werden sofort gespeichert und beim Neuladen wiederhergestellt. Vorhandener Code aus dem alten Schlüssel `py-studio:main.py` wird beim ersten Anlegen des Workspace in `main.py` übernommen, auch wenn er leer ist. Der alte Schlüssel bleibt als Sicherung erhalten.

Der Cache gilt für diesen Browser und diese Website-Adresse. Er ist kein Cloud-Speicher und wird beim Löschen der Browserdaten entfernt. Download sichert die aktive Datei. Bei deaktiviertem oder vollem localStorage bleibt der Workspace für die aktuelle Sitzung nutzbar; eine Meldung weist auf den Speicherfehler hin.

Explorer und Tabs zeigen alle Dateien. Anklicken wechselt die aktive Datei. **＋** fragt nach einem neuen Dateinamen und legt eine leere Datei an, ohne bestehende Dateien zu überschreiben. Auf Mobilgeräten steht **＋** neben den horizontal scrollbar angeordneten Tabs. Unterstützt werden `.py` für Python und `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp` für C++. **×** löscht eine Datei erst nach Bestätigung. Die letzte Datei kann nicht gelöscht werden.

Die Dateien sind gespeicherte, unabhängig ausführbare Editor-Dokumente: Run führt die aktive Datei aus. Der Workspace wird nicht als virtuelles Dateisystem in die Interpreter eingebunden; Python-Imports anderer Workspace-Dateien, eigene C++-Header und das Linken mehrerer C++-Dateien sind nicht implementiert.

## Ausführen und Grenzen

**Run** oder **Ctrl/⌘+Enter** führt die aktive Datei mit der passenden Sprache aus. Ausgabe und Interpreterfehler erscheinen im Terminal; Befehlszeile, Runtime-Status und Fehlermeldungen nennen Sprache bzw. Datei. **Stop** beendet laufende Worker auch bei Endlosschleifen und erzeugt sie neu. Wenn beide Sprachen gleichzeitig laufen, stoppt Stop beide. Python-Variablen und das virtuelle Dateisystem gehen beim Neustart verloren. **Clear** leert nur das Terminal. **Zurücksetzen** ersetzt nur den Inhalt der aktiven Datei durch das Beispiel ihrer Sprache. **Download** speichert die aktive Datei unter ihrem Dateinamen.

### C++

`cpp-worker.js` lädt **JSCPP 2.0.9** als ES-Modul von `https://esm.sh/JSCPP@2.0.9?bundle`. Die dokumentierte API `JSCPP.run(code, input, config)` interpretiert den Code synchron im Worker; `config.stdio.write` erfasst stdout. Der Hauptthread bleibt bedienbar. Rückgabewert und Interpreterfehler erscheinen im Terminal.

JSCPP ist ein **Interpreter für eine Teilmenge von C++**, kein natives clang und kein vollständiger moderner C++-Compiler. Nicht alle Sprachmerkmale und Standardbibliotheken werden unterstützt. Die Oberfläche zeigt diesen Hinweis für C++ an. Ein unterstütztes Beispiel:

```cpp
#include <iostream>
using namespace std;

int main() {
    cout << "Hallo, C++!" << endl;
    return 0;
}
```

Siehe [JSCPP-Dokumentation](https://github.com/felixhao28/JSCPP) für API und Grenzen. stdin ist leer; interaktive Eingaben werden nicht unterstützt.

### Python

Das mit Pyodide mitgelieferte `micropip` wird vor der Bereitschaftsmeldung geladen. Python-Dateien können damit Pakete installieren, zum Beispiel NumPy:

```python
import micropip
await micropip.install("numpy")

import numpy as np
print(np.array([1, 2, 3]) * 2)
```

Die Ausgabe ist `[2 4 6]`. Pakete müssen Pyodide-kompatibel sein und werden zur Laufzeit vom CDN geladen; dafür ist eine Internetverbindung nötig. Ein Fehler beim Vorladen von `micropip` wird als Runtime-Ladefehler angezeigt.

Pyodide ist ein CPython-Build für WebAssembly. Viele reine Python-Pakete funktionieren, native Pakete nur mit einem passenden Pyodide-Paket. Server-Frameworks, dauerhafte Hintergrundprozesse und serverseitige Dateisysteme stehen nicht zur Verfügung. `input()` erhält EOF. Wie bisher bleibt der Python-Interpreter zwischen Ausführungen erhalten.

## Ausfallsicherheit

Bei einem CodeMirror-CDN-Fehler oder nach 15 Sekunden Ladezeit bleibt ein einfacher Texteditor verfügbar. Bei Runtime-Ladefehlern oder nach 90 Sekunden Ladezeit kann **Run** die betroffene Runtime erneut laden. Python und C++ laden unabhängig voneinander; ein Fehler einer Sprache verhindert die andere nicht. Ohne Zugriff auf das jeweilige CDN ist keine Ausführung möglich. Ältere Terminalausgabe wird auf 1.000 Fragmente bzw. 200.000 Zeichen begrenzt.

## GitHub Pages

1. Unter **Settings → Actions → General** die Ausführung von Actions erlauben.
2. Unter **Settings → Pages** als Quelle **GitHub Actions** auswählen.
3. Auf `main` pushen oder den Workflow manuell starten.

`.github/workflows/pages.yml` prüft JavaScript und veröffentlicht `index.html`, `styles.css`, `app.js`, `pyodide-worker.js` und `cpp-worker.js` als statische Seite.

Lokale Prüfungen:

```bash
node --check --input-type=module < app.js
node --check pyodide-worker.js
node --check --input-type=module < cpp-worker.js
git diff --check
```
