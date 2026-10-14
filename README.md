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

### Terminal-Eingabe (stdin)

Die **Terminal-Eingabe direkt unter der Ausgabe** ist die Eingabezeile für beide Sprachen. Das Badge zeigt **LIVE · bereit**, **LIVE · Eingabe aktiv**, **EOF** oder **PREFILL · Fallback**; Live/EOF werden auch für Screenreader angekündigt.

1. Python- oder C++-Datei wählen, Runtime laden lassen und **Run** (oder Ctrl/⌘↵ im Code) starten. Im Live-Modus erhält die Terminal-Eingabe automatisch den Fokus, auch bei leerem Feld.
2. Nach einem Prompt wie `NAME:` direkt tippen. Ein Klick auf die Terminal-Ausgabe oder den freien Panelbereich fokussiert die Eingabe, solange das Programm auf stdin wartet. Hat Ausgabe/Panel den Tastaturfokus, werden druckbare Zeichen, Enter, Backspace, Pfeile und Ctrl/⌘+D zur Eingabe geroutet. Andere Eingabefelder, Editor, Buttons und Browser-Shortcuts behalten ihre Funktion.
3. **Enter sendet die aktuelle Zeile** über den bestehenden SharedArrayBuffer-Kanal. Bis dahin lässt sie sich mit Backspace, Pfeilen, Auswahl, Paste und IME bearbeiten. Bereits gesendete Zeilen bleiben unveränderlich und sichtbar; neue Eingabe wird angehängt. Das Programm kann in C++ `getline`/`cin` oder in Python `input()` verwenden.
4. **EOF** oder **Ctrl/⌘+D im Terminal** sendet auch eine letzte Zeile ohne Zeilenumbruch und schließt stdin nach den gepufferten Bytes. **Stop** bricht einen wartenden Run ab und startet den Worker neu. Nach Ende/Stop ist das Feld wieder frei editierbar.

Mehrzeilige Eingabe kann weiterhin **vor Run** vorbereitet werden: dieser Text wird beim Start vollständig gesendet (auch ohne abschließenden Zeilenumbruch). Vor dem nächsten Run das Feld bei Bedarf leeren; vorhandener Text wird wieder als Prefill verwendet. Ein leeres Live-Feld wartet auf Eingabe oder EOF.

Die sichtbare stdin-Notiz zeigt den tatsächlich verfügbaren Modus. Live-Eingabe benötigt `crossOriginIsolated` und `SharedArrayBuffer`. GitHub Pages kann COOP/COEP-Header nicht selbst setzen: das vendorte, gleichursprüngliche `coi-serviceworker.js` wird vor `app.js` geladen, registriert sich auf HTTPS/localhost und lädt die Seite zur Isolation neu. Service Worker müssen erlaubt sein. CDN-Ressourcen benötigen unter COEP passende CORS-Freigaben. Der erste Besuch kann deshalb automatisch neu laden. Der Test unten prüft diese Isolation auf einem Server ohne eigene COOP/COEP-Header. Private Modi, blockierte Service Worker, unsichere HTTP-Origins (außer localhost) oder Browser ohne SharedArrayBuffer können Live-Eingabe verhindern; dort ist Prefill erforderlich. Bei Registrierungs-/Netzwerkfehlern bleiben die Browser-Konsole und Runtime-Fehler sichtbar. Ein Browser-WASI-Terminal ist kein OS-Terminal/PTY: keine Shell, rohen Tastendrücke, Terminal-Steuersequenzen oder nativen OS-APIs; Live-Eingabe erfolgt zeilenweise.

Fehlt Isolation oder SharedArrayBuffer, bleibt automatisch der **Fallback mit vorbereiteter Eingabe** aktiv: alle Eingaben vor Run eintragen, danach folgt automatisch EOF. Änderungen während des Runs gelten dort erst beim nächsten Run. Beispiel für beide Modi:

```text
Anna
42
```

Jeder Run liest den Feldinhalt neu von Anfang an. Leere Zeilen und Unicode bleiben erhalten. Das Feld bleibt bei Clear erhalten, wird aber nicht in localStorage gespeichert und ist nach Neuladen leer. Bei gleichzeitig laufenden Sprachen gehen neue Eingaben und EOF an beide laufenden Live-Kanäle.

`live-stdin.js` implementiert einen gemeinsamen UTF-8-Ringpuffer mit atomaren Lese-/Schreibpositionen, EOF, Abort und einem Weckzähler. Der Hauptthread schreibt neue Bytes aus den Eingabeereignissen, puffert Überlauf ohne Blockieren und weckt mit `Atomics.notify`. Der C++-Worker verwendet einen eigenen WASI-`Fd` für fd 0, der Python-Worker denselben Kanal über `setStdin`. Leere Kanäle warten im Worker mit `Atomics.wait`; Stop setzt vor dem Terminieren Abort und weckt den Kanal. Jeder Run bekommt einen neuen Kanal.

C++ mit `getline` und numerischem `cin` (mit obiger Eingabe: `Hallo Anna, Zahl: 42`):

```cpp
#include <iostream>
#include <string>

int main() {
    std::string eingabe;
    int zahl;
    if (!std::getline(std::cin, eingabe) || !(std::cin >> zahl)) {
        std::cerr << "Bitte Name und Zahl eingeben.\n";
        return 1;
    }
    std::cout << "Hallo " << eingabe << ", Zahl: " << zahl << '\n';
}
```

Python mit denselben Eingaben:

```python
name = input("Name: ")
zahl = int(input("Zahl: "))
print(f"Hallo {name}, Zahl: {zahl}")
```

### C++

`cpp-worker.js` importiert `compile` aus `vendor/browsercc/index.js` und die WASI-Laufzeit aus `vendor/browser-wasi-shim/index.js`. Echter Clang kompiliert C++20, LLD linkt gegen die vendorte WASI-Sysroot mit libc++, anschließend führt WebAssembly mit `@bjorn3/browser_wasi_shim` das Programm aus. Dies ist ein echter Compiler, kein Interpreter für eine Grammatik-Teilmenge. stdout, stderr, Compiler-/Linkerdiagnosen und Exit-Code erscheinen im Terminal; Statusmeldungen zeigen Laden, Kompilieren, Linken und Ausführen.

Die Flags sind `-std=c++20 -O0 -fno-exceptions -fno-threadsafe-statics -Wall -Wextra -fno-color-diagnostics -I. -Wl,--max-memory=268435456`. Der WASI-/Browser-Build begrenzt Exceptions (hier deaktiviert), Threads, Sockets und native OS-APIs. Standard-C++20-Sprachmerkmale und die mitgelieferte Standardbibliothek werden vom echten Compiler verarbeitet; Verfügbarkeit einzelner Bibliotheksfunktionen hängt vom WASI-Build ab. Programmspeicher ist auf 256 MiB begrenzt; Compiler und Linker benötigen zusätzlich Browserspeicher. stdin liest im Live-Modus den gemeinsamen UTF-8-Kanal bis EOF; im Fallback liest es den vor Run vorbereiteten Text. Jede Ausführung erstellt eine neue WASI-Instanz.

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

Pyodide ist ein CPython-Build für WebAssembly. Viele reine Python-Pakete funktionieren, native Pakete nur mit einem passenden Pyodide-Paket. Server-Frameworks, dauerhafte Hintergrundprozesse und serverseitige Dateisysteme stehen nicht zur Verfügung. `input()` liest im Live-Modus auch nach Run eingegebene Zeilen; nach EOF folgt `EOFError`. Im Fallback liest es ausschließlich den vor Run vorbereiteten Text. Wie bisher bleibt der Python-Interpreter zwischen Ausführungen erhalten.

## Ausfallsicherheit

Bei einem CodeMirror-CDN-Fehler oder nach 15 Sekunden Ladezeit bleibt ein einfacher Texteditor verfügbar. Bei Runtime-Ladefehlern oder nach 90 Sekunden Python- bzw. fünf Minuten C++-Ladezeit kann **Run** die betroffene Runtime erneut laden. Python und C++ laden unabhängig voneinander; ein Fehler einer Sprache verhindert die andere nicht. Python benötigt Zugriff auf sein CDN; C++ benötigt die lokalen Toolchain-Assets. Ältere Terminalausgabe wird auf 1.000 Fragmente bzw. 200.000 Zeichen begrenzt.

## GitHub Pages

1. Unter **Settings → Actions → General** die Ausführung von Actions erlauben.
2. Unter **Settings → Pages** als Quelle **GitHub Actions** auswählen.
3. Auf `main` pushen oder den Workflow manuell starten.

`.github/workflows/pages.yml` prüft JavaScript und veröffentlicht `index.html`, `styles.css`, `app.js`, `pyodide-worker.js`, `cpp-worker.js`, `live-stdin.js` und `coi-serviceworker.js` sowie die vollständigen Verzeichnisse `vendor/browsercc` und `vendor/browser-wasi-shim` als statische Seite, einschließlich `clang.wasm`, `lld.wasm`, `sysroot.tar` und aller benötigten JS-Module.

Lokale Prüfungen:

```bash
node --check --input-type=module < app.js
node --check live-stdin.js
node --check coi-serviceworker.js
node --check pyodide-worker.js
node --check --input-type=module < cpp-worker.js
git diff --check
```

Browser-Smoke-Test (Playwright mit installiertem Chromium, lokaler Server wie oben):

```bash
node tests/live-stdin-smoke.cjs
```

Der Test prüft echte Isolation durch den Service Worker, Eingabe über fokussierte Ausgabe/Panel erst nach sichtbarem Prompt für C++ und Python (ohne ersten Klick auf stdin), Autofokus, Zeilenbearbeitung, Exit 0, Unicode, numerische Eingabe, EOF per Tastatur und Button, Stop beim Warten, Worker-Neustart, Ringpuffer-Überlauf und den nicht isolierten Fallback beider Sprachen. Optional setzen `TEST_URL` und `CHROMIUM_PATH` die Serveradresse bzw. Chromium-Binärdatei. Playwright muss über Node auflösbar sein.
