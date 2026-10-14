# py-studio

Ein minimalistischer Python- und C++-Editor im VS-Code-Stil. CodeMirror liefert Syntax-Highlighting. Python läuft mit CPython/Pyodide in einem Web Worker, C++ mit echtem Clang C++20 und LLD als WASI-WebAssembly in einem separaten Modul-Worker. Alles läuft im Browser, ohne Backend oder Datei-Upload.

## Lokal starten

Die Seite muss über HTTP geöffnet werden, damit ES-Module und Worker funktionieren:

```bash
python3 -m http.server 8000
```

Danach `http://localhost:8000` öffnen. CodeMirror wird von esm.sh geladen, Pyodide 0.26.4 von jsDelivr. Zum Laden der Bibliotheken ist eine Internetverbindung nötig.

## Workspace und Cache

Beim ersten Besuch enthält der Workspace `main.py` und `main.cpp` mit Beispielcode. `localStorage["py-studio:workspace"]` speichert ein Objekt mit `files` (Dateiname → `{content, language}`) und `activeFilename`. Änderungen und Dateiauswahl werden sofort gespeichert und beim Neuladen wiederhergestellt. Vorhandener Code aus dem alten Schlüssel `py-studio:main.py` wird beim ersten Anlegen des Workspace in `main.py` übernommen, auch wenn er leer ist. Der alte Schlüssel bleibt als Sicherung erhalten.

Der Cache gilt für diesen Browser und diese Website-Adresse. Er ist kein Cloud-Speicher und wird beim Löschen der Browserdaten entfernt. Download sichert die aktive Datei. Bei deaktiviertem oder vollem localStorage bleibt der Workspace für die aktuelle Sitzung nutzbar; eine Meldung weist auf den Speicherfehler hin.

Explorer und Tabs zeigen alle Dateien. Anklicken wechselt die aktive Datei. **＋** fragt nach einem neuen Dateinamen und legt eine leere Datei an, ohne bestehende Dateien zu überschreiben. Auf Mobilgeräten steht **＋** neben den horizontal scrollbar angeordneten Tabs. Unterstützt werden `.py` für Python und `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp` für C++. **×** löscht eine Datei erst nach Bestätigung. Die letzte Datei kann nicht gelöscht werden.

Run kompiliert bzw. führt die aktive Datei aus. Andere gespeicherte C++-Dateien werden als `extraFiles` in das Compiler-Dateisystem eingebunden; eigene Header können mit `#include "name.hpp"` verwendet werden. Separates Kompilieren und Linken mehrerer Translation Units ist noch nicht implementiert. Python-Imports anderer Workspace-Dateien bleiben unverändert nicht implementiert.

## Ausführen und Grenzen

**Run** oder **Ctrl/⌘+Enter** führt die aktive Datei mit der passenden Sprache aus. Ausgabe und Interpreterfehler erscheinen im Terminal; Befehlszeile, Runtime-Status und Fehlermeldungen nennen Sprache bzw. Datei. **Stop** beendet laufende Worker auch bei Endlosschleifen und erzeugt sie neu. Wenn beide Sprachen gleichzeitig laufen, stoppt Stop beide. Python-Variablen und das virtuelle Dateisystem gehen beim Neustart verloren. **Clear** leert nur das Terminal. **Zurücksetzen** ersetzt nur den Inhalt der aktiven Datei durch das Beispiel ihrer Sprache. **Download** speichert die aktive Datei unter ihrem Dateinamen.

### C++

`cpp-worker.js` importiert `compile` aus `vendor/browsercc/index.js` und die WASI-Laufzeit aus `vendor/browser-wasi-shim/index.js`. Echter Clang kompiliert C++20, LLD linkt gegen die vendorte WASI-Sysroot mit libc++, anschließend führt WebAssembly mit `@bjorn3/browser_wasi_shim` das Programm aus. Dies ist ein echter Compiler, kein Interpreter für eine Grammatik-Teilmenge. stdout, stderr, Compiler-/Linkerdiagnosen und Exit-Code erscheinen im Terminal; Statusmeldungen zeigen Laden, Kompilieren, Linken und Ausführen.

Die Flags sind `-std=c++20 -O0 -fno-exceptions -fno-threadsafe-statics -Wall -Wextra -fno-color-diagnostics -I. -Wl,--max-memory=268435456`. Der WASI-/Browser-Build begrenzt Exceptions (hier deaktiviert), Threads, Sockets und native OS-APIs. Standard-C++20-Sprachmerkmale und die mitgelieferte Standardbibliothek werden vom echten Compiler verarbeitet; Verfügbarkeit einzelner Bibliotheksfunktionen hängt vom WASI-Build ab. Programmspeicher ist auf 256 MiB begrenzt; Compiler und Linker benötigen zusätzlich Browserspeicher. stdin erhält EOF; interaktive Eingaben werden nicht unterstützt. Jede Ausführung erstellt eine neue WASI-Instanz.

Beim ersten Laden ist mit ungefähr **100 MB Downloads** von den **same-origin GitHub-Pages-Assets** zu rechnen (die aktuell vendorten Clang-/LLD-Wasm-Dateien und Sysroot sind zusammen etwa 92 MiB; Transfer und Caching hängen vom Browser ab). Kein Compiler-Backend und kein Quellcode-Upload. Heruntergeladene Toolchain-Dateien werden innerhalb des Workers wiederverwendet; nach Stop wird der Worker neu erzeugt und der HTTP-Cache kann Downloads vermeiden. C++ hat wegen der großen Assets ein Ladezeitlimit von fünf Minuten.

```cpp
#include <iostream>
#include <vector>

int main() {
    std::vector<int> values{1, 2, 3};
    for (int value : values) std::cout << value << '\n';
    return 0;
}
```

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

Bei einem CodeMirror-CDN-Fehler oder nach 15 Sekunden Ladezeit bleibt ein einfacher Texteditor verfügbar. Bei Runtime-Ladefehlern oder nach 90 Sekunden Python- bzw. fünf Minuten C++-Ladezeit kann **Run** die betroffene Runtime erneut laden. Python und C++ laden unabhängig voneinander; ein Fehler einer Sprache verhindert die andere nicht. Python benötigt Zugriff auf sein CDN; C++ benötigt die lokalen Toolchain-Assets. Ältere Terminalausgabe wird auf 1.000 Fragmente bzw. 200.000 Zeichen begrenzt.

## GitHub Pages

1. Unter **Settings → Actions → General** die Ausführung von Actions erlauben.
2. Unter **Settings → Pages** als Quelle **GitHub Actions** auswählen.
3. Auf `main` pushen oder den Workflow manuell starten.

`.github/workflows/pages.yml` prüft JavaScript und veröffentlicht `index.html`, `styles.css`, `app.js`, `pyodide-worker.js` und `cpp-worker.js` sowie die vollständigen Verzeichnisse `vendor/browsercc` und `vendor/browser-wasi-shim` als statische Seite, einschließlich `clang.wasm`, `lld.wasm`, `sysroot.tar` und aller benötigten JS-Module.

Lokale Prüfungen:

```bash
node --check --input-type=module < app.js
node --check pyodide-worker.js
node --check --input-type=module < cpp-worker.js
git diff --check
```
