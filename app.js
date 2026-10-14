import "./live-stdin.js";
const STORAGE_KEY = "py-studio:workspace";
const LEGACY_KEY = "py-studio:main.py";
const DEFAULT_CODE = `from datetime import datetime

name = "Browser"
print(f"Hallo, {name}!")
print(f"Zeit: {datetime.now():%H:%M:%S}")

for number in range(1, 4):
    print(f"Schritt {number}")
`;

const editorHost = document.querySelector("#editor");
const runButton = document.querySelector("#run-button");
const stopButton = document.querySelector("#stop-button");
const clearButton = document.querySelector("#clear-button");
const resetButton = document.querySelector("#reset-button");
const downloadButton = document.querySelector("#download-button");
const newFileButton = document.querySelector("#new-file-button");

const output = document.querySelector("#terminal-output");
const stdinInput = document.querySelector("#stdin-input");
const eofButton = document.querySelector("#stdin-eof");
const stdinNote = document.querySelector("#stdin-note");
const terminalPanel = document.querySelector(".terminal-panel");
const stdinMode = document.querySelector("#stdin-mode");
const liveStdinAvailable = globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
const encoder = new TextEncoder();

function disposeStdin(rt) {
  rt.input?.channel.abort();
  clearInterval(rt.input?.timer);
  rt.input = null;
  rt.waiting = false;
}

function flushStdin(input) {
  while (input.queue.length) {
    const bytes = input.queue[0];
    const count = input.channel.write(bytes);
    if (count < bytes.length) { input.queue[0] = bytes.subarray(count); return; }
    input.queue.shift();
  }
  if (input.closed) input.channel.close();
}

function appendStdin(input, text, final = false) {
  // Do not encode a high surrogate until its matching low surrogate arrives.
  const end = !final && /[\uD800-\uDBFF]$/.test(text) ? text.length - 1 : text.length;
  if (end > input.sent) input.queue.push(encoder.encode(text.slice(input.sent, end)));
  input.sent = end;
  flushStdin(input);
}

function openInputs() {
  return Object.values(runtimes).filter(rt => rt.running && rt.input && !rt.input.closed);
}

function focusStdin() {
  stdinInput.focus({ preventScroll: true });
  stdinInput.setSelectionRange(stdinInput.value.length, stdinInput.value.length);
}

function refreshStdin() {
  const inputs = Object.values(runtimes).filter(rt => rt.running && rt.input).map(rt => rt.input);
  const live = inputs.some(input => !input.closed);
  const closed = inputs.length > 0 && !live;
  eofButton.disabled = !live;
  stdinInput.readOnly = closed;
  const mode = live ? "LIVE · Eingabe aktiv" : closed ? "EOF · Eingabe beendet" : liveStdinAvailable ? "LIVE · bereit" : "PREFILL · Fallback";
  if (stdinMode.textContent !== mode) stdinMode.textContent = mode;
  stdinInput.closest(".stdin-control").classList.toggle("is-live", live);
  stdinNote.textContent = live
    ? "Hier tippen → laufendes Programm. Enter sendet die Zeile; EOF oder Ctrl/⌘+D beendet stdin."
    : closed ? "EOF gesendet. Gepufferte Eingabe wird noch gelesen."
    : liveStdinAvailable ? "Mehrere Zeilen vor Run vorbereiten oder nach Run direkt im Terminal tippen."
    : "Vorbereitete stdin (Fallback): Alle Eingaben vor Run eingeben; danach automatisch EOF. Live-Eingabe benötigt crossOriginIsolated und SharedArrayBuffer auf HTTPS/localhost mit erlaubtem Service Worker.";
  stdinInput.placeholder = live ? "Eingabe für das laufende Programm …" : "Alle Eingaben vor Run eingeben (mehrere Zeilen möglich).";
}

function closeStdin() {
  for (const rt of Object.values(runtimes)) {
    const input = rt.input;
    if (!rt.running || !input || input.closed) continue;
    input.text = stdinInput.value;
    appendStdin(input, input.text, true);
    input.closed = true;
    flushStdin(input);
  }
  refreshStdin();
}

stdinInput.addEventListener("input", event => {
  if (event.isComposing) return;
  for (const rt of Object.values(runtimes)) {
    const input = rt.input;
    if (!rt.running || !input || input.closed) continue;
    if (!stdinInput.value.startsWith(input.text)) {
      stdinInput.value = input.text;
      showToast("Gesendete Eingabe kann nur ergänzt werden.");
      continue;
    }
    // Only complete lines are submitted. The draft remains editable with native
    // textarea navigation, Backspace, selection, paste and IME composition.
    if (stdinInput.matches(":read-only")) continue;
    const end = stdinInput.value.lastIndexOf("\n") + 1;
    if (end > input.text.length) {
      input.text = stdinInput.value.slice(0, end);
      appendStdin(input, input.text);
    }
  }
});
stdinInput.addEventListener("compositionend", () => stdinInput.dispatchEvent(new Event("input", { bubbles: true })));
stdinInput.addEventListener("beforeinput", event => {
  if (!openInputs().length) return;
  const boundary = Math.max(0, ...openInputs().map(rt => rt.input.text.length));
  if (stdinInput.selectionStart < boundary ||
      (event.inputType === "deleteContentBackward" && stdinInput.selectionStart === boundary && stdinInput.selectionEnd === boundary)) {
    event.preventDefault();
    focusStdin();
    showToast("Gesendete Zeilen können nur ergänzt werden.");
  }
});
stdinInput.addEventListener("keydown", event => {
  if (openInputs().length && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
    event.preventDefault(); closeStdin();
  }
});
eofButton.addEventListener("click", closeStdin);

function terminalWaiting() {
  return openInputs().some(rt => rt.waiting);
}
terminalPanel.addEventListener("click", event => {
  if (terminalWaiting() && !event.target.closest("textarea, input, button, a, [contenteditable]")) focusStdin();
});
terminalPanel.addEventListener("keydown", event => {
  // Only the terminal background/output owns this routing. Editors, controls,
  // shortcuts and idle terminals retain their normal browser behavior.
  const altGraph = event.getModifierState("AltGraph");
  if (!terminalWaiting() || ![terminalPanel, output].includes(event.target) || (event.altKey && !altGraph) || event.isComposing) return;
  const eof = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d";
  if ((event.ctrlKey || event.metaKey) && !altGraph && !eof) return;
  if (!eof && Array.from(event.key).length !== 1 && !["Enter", "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  // Keep the textarea's selection when focus is moved by keyboard.
  stdinInput.focus({ preventScroll: true });
  if (eof) { closeStdin(); return; }
  let start = stdinInput.selectionStart, end = stdinInput.selectionEnd;
  const boundary = Math.max(0, ...openInputs().map(rt => rt.input.text.length));
  if (event.key.startsWith("Arrow")) {
    const value = stdinInput.value;
    let next = start;
    if (event.key === "ArrowLeft") next = Math.max(0, start - (end === start ? 1 : 0));
    if (event.key === "ArrowRight") next = Math.min(value.length, end + (end === start ? 1 : 0));
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const column = start - lineStart;
      const previousStart = value.lastIndexOf("\n", lineStart - 2) + 1;
      const lineEnd = value.indexOf("\n", start);
      const nextEnd = value.indexOf("\n", lineEnd + 1);
      next = event.key === "ArrowUp" ? (lineStart ? Math.min(previousStart + column, lineStart - 1) : 0)
        : (lineEnd < 0 ? value.length : Math.min(lineEnd + 1 + column, nextEnd < 0 ? value.length : nextEnd));
    }
    stdinInput.setSelectionRange(event.shiftKey ? start : next, next);
    return;
  }
  if (event.key === "Backspace") {
    if (start === end) {
      const last = Array.from(stdinInput.value.slice(boundary, start)).at(-1);
      start = Math.max(boundary, start - (last?.length || 0));
    }
    if (start < boundary || end <= boundary) return;
    stdinInput.setRangeText("", start, end, "end");
  } else {
    if (start < boundary) start = end = stdinInput.value.length;
    stdinInput.setRangeText(event.key === "Enter" ? "\n" : event.key, start, end, "end");
  }
  // One edit, one input event; the shared queue deduplicates by sent offset.
  stdinInput.dispatchEvent(new Event("input", { bubbles: true }));
});

const statusText = document.querySelector("#status-text");
const statusIndicator = document.querySelector("#status-indicator");
const runtimeLabel = document.querySelector("#runtime-label");
const toast = document.querySelector("#toast");

let editor;
let fallbackEditor;
const CPP_CODE = `#include <iostream>
using namespace std;

int main() {
    cout << "Hallo, C++!" << endl;
    for (int number = 1; number <= 3; number++) {
        cout << "Schritt " << number << endl;
    }
    return 0;
}
`;
const languageName = { python: "Python", cpp: "C++" };
const runtimes = {
  python: { worker: null, ready: false, failed: false, running: false },
  cpp: { worker: null, ready: false, failed: false, running: false },
};
let toastTimer;
let editorModules;
const workspace = loadWorkspace();

function languageFor(name) {
  if (/\.py$/i.test(name)) return "python";
  if (/\.(cpp|cc|cxx|h|hpp)$/i.test(name)) return "cpp";
  return null;
}

function loadWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.files && typeof saved.files === "object") {
      const files = Object.create(null);
      for (const [name, file] of Object.entries(saved.files)) {
        const language = languageFor(name);
        if (language && file && typeof file.content === "string") {
          files[name] = { content: file.content, language };
        }
      }
      if (Object.keys(files).length) {
        return { files, activeFilename: Object.hasOwn(files, saved.activeFilename) ? saved.activeFilename : Object.keys(files)[0] };
      }
    }
  } catch { /* Missing, invalid, or unavailable storage: use samples. */ }
  let legacy;
  try { legacy = localStorage.getItem(LEGACY_KEY); } catch {}
  return {
    files: { "main.py": { content: legacy ?? DEFAULT_CODE, language: "python" },
      "main.cpp": { content: CPP_CODE, language: "cpp" } },
    activeFilename: "main.py",
  };
}

function activeFile() { return workspace.files[workspace.activeFilename]; }

function persistWorkspace() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); }
  catch { showToast("Lokales Speichern ist in diesem Browser deaktiviert."); }
}

function persistCode(code) {
  activeFile().content = code;
  persistWorkspace();
}

function selectFile(name) {
  if (!Object.hasOwn(workspace.files, name)) return;
  workspace.activeFilename = name;
  if (editor) editor.setState(makeEditorState(activeFile().content));
  else fallbackEditor.value = activeFile().content;
  persistWorkspace();
  renderWorkspace();
  ensureRuntime(activeFile().language);
  refreshRuntimeStatus();
  (editor || fallbackEditor).focus();
}

function fileBadge(language) {
  const badge = document.createElement("span");
  badge.className = "python-badge" + (language === "cpp" ? " cpp-badge" : "");
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = language === "cpp" ? "C++" : "Py";
  return badge;
}

function renderWorkspace() {
  const explorer = document.querySelector("#file-list");
  const tabs = document.querySelector("#file-tabs");
  explorer.replaceChildren();
  tabs.replaceChildren();
  for (const [name, file] of Object.entries(workspace.files)) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "file-row" + (name === workspace.activeFilename ? " is-selected" : "");
    const filename = document.createElement("span");
    filename.textContent = name;
    row.append(fileBadge(file.language), filename);
    row.addEventListener("click", () => selectFile(name));
    explorer.append(row);
    const tab = document.createElement("div");
    tab.className = "editor-tab" + (name === workspace.activeFilename ? " is-active" : "");
    const select = document.createElement("button");
    select.type = "button";
    select.className = "tab-select";
    select.textContent = name;
    select.setAttribute("aria-pressed", String(name === workspace.activeFilename));
    select.addEventListener("click", () => selectFile(name));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-button tab-close";
    close.textContent = "×";
    close.setAttribute("aria-label", name + " löschen");
    close.disabled = Object.keys(workspace.files).length === 1;
    close.addEventListener("click", () => {
      if (Object.keys(workspace.files).length <= 1 || !confirm(name + " aus dem lokalen Workspace löschen?")) return;
      delete workspace.files[name];
      if (workspace.activeFilename === name) selectFile(Object.keys(workspace.files)[0]);
      else { persistWorkspace(); renderWorkspace(); }
    });
    tab.append(fileBadge(file.language), select, close);
    tabs.append(tab);
  }
  const name = workspace.activeFilename;
  document.title = "py-studio · " + name;
  document.querySelector(".window-title span:last-child").textContent = name;
  document.querySelector(".breadcrumbs strong").textContent = name;
  document.querySelector("#language-label").textContent = languageName[activeFile().language];
  document.querySelector("#cpp-note").hidden = activeFile().language !== "cpp";
  editorHost.setAttribute("aria-label", languageName[activeFile().language] + "-Code");
  fallbackEditor?.setAttribute("aria-label", languageName[activeFile().language] + "-Code");
  const activeTab = tabs.querySelector(".is-active");
  if (activeTab) {
    const offset = activeTab.offsetLeft - tabs.offsetLeft;
    tabs.scrollLeft = Math.max(0, offset + activeTab.offsetWidth - tabs.clientWidth);
  }
}

function newFile() {
  let index = 1;
  const extension = activeFile().language === "cpp" ? ".cpp" : ".py";
  while (Object.hasOwn(workspace.files, "untitled" + index + extension)) index++;
  const answer = prompt("Dateiname (.py, .cpp, .cc, .cxx, .h oder .hpp):", "untitled" + index + extension);
  if (answer === null) return;
  const name = answer.trim();
  const language = languageFor(name);
  if (!language || /[/\\\x00-\x1f]/.test(name) || name.length > 120) {
    showToast("Bitte einen gültigen Python- oder C++-Dateinamen eingeben."); return;
  }
  if (Object.hasOwn(workspace.files, name)) { showToast("Diese Datei existiert bereits."); return; }
  workspace.files[name] = { content: "", language };
  selectFile(name);
}

function currentCode() {
  return editor ? editor.state.doc.toString() : fallbackEditor?.value ?? DEFAULT_CODE;
}

function updateStatus(message, state = "ready") {
  statusText.textContent = message;
  runtimeLabel.textContent = message;
  statusIndicator.classList.toggle("status-error", state === "error");
  statusIndicator.classList.toggle("status-ready", state === "ready");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function removePlaceholder() {
  output.querySelector(".terminal-placeholder")?.remove();
}

function appendOutput(text, kind = "") {
  removePlaceholder();
  const line = document.createElement("span");
  if (kind) line.className = `output-${kind}`;
  line.textContent = text;
  output.append(line);
  // Bound DOM growth when programs produce large amounts of output.
  while (output.childNodes.length > 1000 || output.textContent.length > 200000) {
    output.firstChild.remove();
  }
  output.scrollTop = output.scrollHeight;
}

function clearOutput() {
  output.replaceChildren();
  const placeholder = document.createElement("span");
  placeholder.className = "terminal-placeholder";
  placeholder.innerHTML = "Starte dein Programm mit <strong>Run</strong> oder Ctrl/⌘↵";
  output.append(placeholder);
}

function createFallbackEditor() {
  if (fallbackEditor) return;
  fallbackEditor = document.createElement("textarea");
  fallbackEditor.className = "fallback-editor";
  fallbackEditor.setAttribute("aria-label", "Python-Code");
  fallbackEditor.value = activeFile().content;
  fallbackEditor.addEventListener("input", () => persistCode(fallbackEditor.value));
  fallbackEditor.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      runCode();
    }
  });
  editorHost.replaceChildren(fallbackEditor);
}

async function initializeEditor() {
  // Share exact dependency versions to avoid duplicate CodeMirror state instances.
  const deps = "?deps=@codemirror/state@6.7.6,@codemirror/view@6.43.14";
  const modules = Promise.all([
    import("https://esm.sh/@codemirror/state@6.7.6"),
    import(`https://esm.sh/codemirror@6.0.1${deps}`),
    import(`https://esm.sh/@codemirror/lang-python@6.1.7${deps}`),
    import(`https://esm.sh/@codemirror/theme-one-dark@6.1.2${deps}`),
    import(`https://esm.sh/@codemirror/view@6.43.14${deps}`),
    import(`https://esm.sh/@codemirror/language@6.10.8${deps}`),
    import(`https://esm.sh/@codemirror/lang-cpp@6.0.3${deps}`),
  ]);
  let timer;
  const loaded = await Promise.race([
    modules,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Editor-CDN Zeitüberschreitung")), 15000);
    }),
  ]).finally(() => clearTimeout(timer));
  editorModules = loaded;
  editor = new loaded[4].EditorView({
    state: makeEditorState(currentCode()),
    parent: document.createElement("div"),
  });
  editorHost.replaceChildren(editor.dom);
}

function makeEditorState(code) {
  const [{ EditorState }, { basicSetup }, { python }, { oneDark },
    { EditorView, keymap }, { indentUnit }, { cpp }] = editorModules;
  return EditorState.create({
    doc: code,
    extensions: [
      keymap.of([{ key: "Mod-Enter", run: () => { runCode(); return true; } }]),
      basicSetup, activeFile().language === "cpp" ? cpp() : python(),
      indentUnit.of("    "), oneDark,
      EditorView.contentAttributes.of({ "aria-label": languageName[activeFile().language] + "-Code" }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) persistCode(update.state.doc.toString());
      }),
    ],
  });
}

function replaceCode(code) {
  if (editor) {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: code } });
  } else if (fallbackEditor) {
    fallbackEditor.value = code;
    persistCode(code);
  }
}

function refreshRuntimeStatus() {
  refreshStdin();
  const language = activeFile().language;
  const rt = runtimes[language];
  runButton.disabled = rt.running || (!rt.ready && !rt.failed);
  stopButton.disabled = !Object.values(runtimes).some(runtime => runtime.running);
  updateStatus(rt.message || languageName[language] + " wird geladen …", rt.state || "loading");
}

function runtimeFailure(language, message) {
  const rt = runtimes[language];
  clearTimeout(rt.timer);
  disposeStdin(rt);
  rt.worker?.terminate();
  rt.worker = null;
  rt.ready = false;
  rt.failed = true;
  rt.running = false;
  rt.message = languageName[language] + " Runtime-Fehler · Run zum Wiederholen";
  rt.state = "error";
  appendOutput(languageName[language] + " konnte nicht geladen werden. Prüfe deine Internetverbindung.\n" + message + "\n", "error");
  refreshRuntimeStatus();
}

function ensureRuntime(language) {
  if (!runtimes[language].worker && !runtimes[language].failed) createWorker(language);
}

function createWorker(language) {
  const rt = runtimes[language];
  clearTimeout(rt.timer);
  disposeStdin(rt);
  rt.worker?.terminate();
  Object.assign(rt, { ready: false, failed: false, running: false,
    message: languageName[language] + " wird geladen …", state: "loading" });
  try {
    const worker = new Worker(new URL(language === "cpp" ? "./cpp-worker.js" : "./pyodide-worker.js", import.meta.url),
      language === "cpp" ? { type: "module" } : {});
    rt.worker = worker;
    worker.addEventListener("message", ({ data }) => {
      if (rt.worker !== worker || rt.failed || !data) return;
      if (data.type === "ready") {
        clearTimeout(rt.timer);
        rt.ready = true;
        rt.message = languageName[language] + " " + data.version + " bereit";
        rt.state = "ready";
      } else if (data.type === "status") {
        rt.message = data.message; rt.state = rt.running ? "running" : "loading";
      } else if (data.type === "stdout" || data.type === "stderr") {
        appendOutput(data.text || "", data.type === "stderr" ? "error" : "");
      } else if (data.type === "stdin-waiting") {
        rt.waiting = data.waiting;
      } else if (data.type === "running") {
        rt.running = true;
      } else if (data.type === "finished" || data.type === "run-error") {
        disposeStdin(rt);
        rt.running = false;
        rt.message = data.type === "finished" ? (language === "cpp" ? "Clang C++20 · WASI bereit" : languageName[language] + " bereit") : "Fehler in " + rt.filename;
        rt.state = data.type === "finished" ? "ready" : "error";
        if (data.type === "run-error") appendOutput(rt.filename + ": " + data.message + "\n", "error");
        else if (language === "cpp") appendOutput("[Exit " + data.exitCode + "]\n", "system");
      } else if (data.type === "fatal") {
        runtimeFailure(language, data.message); return;
      }
      refreshRuntimeStatus();
    });
    worker.addEventListener("error", event => {
      event.preventDefault();
      if (rt.worker === worker) runtimeFailure(language, event.message || "Worker-Fehler");
    });
    worker.addEventListener("messageerror", () => {
      if (rt.worker === worker) runtimeFailure(language, "Worker-Nachricht konnte nicht gelesen werden.");
    });
    rt.timer = setTimeout(() => {
      if (rt.worker === worker) runtimeFailure(language, "Zeitüberschreitung beim Laden.");
    }, language === "cpp" ? 300000 : 90000);
    worker.postMessage({ type: "init" });
  } catch (error) { runtimeFailure(language, error.message); }
  refreshRuntimeStatus();
}

function runCode() {
  const language = activeFile().language;
  const rt = runtimes[language];
  if (rt.failed) { createWorker(language); return; }
  if (!rt.ready || rt.running) return;
  rt.filename = workspace.activeFilename;
  appendOutput("$ " + (language === "cpp" ? "clang++ -std=c++20 " : "python ") + rt.filename + "\n", "command");
  rt.running = true;
  rt.message = languageName[language] + " · " + rt.filename + (language === "cpp" ? " wird kompiliert …" : " läuft …");
  rt.state = "running";
  refreshRuntimeStatus();
  try {
    const extraFiles = Object.fromEntries(Object.entries(workspace.files)
      .filter(([name, file]) => name !== rt.filename && file.language === "cpp")
      .map(([name, file]) => [name, file.content]));
    if (liveStdinAvailable) {
      rt.input = { channel: new LiveStdin(), queue: [], text: stdinInput.value, sent: 0, closed: false };
      appendStdin(rt.input, rt.input.text);
      rt.input.timer = setInterval(() => flushStdin(rt.input), 10);
    }
    refreshStdin();
    if (rt.input) focusStdin();
    rt.worker.postMessage({ type: "run", liveStdin: rt.input?.channel.buffer, code: currentCode(), filename: rt.filename, stdin: stdinInput.value,
      ...(language === "cpp" ? { extraFiles } : {}) });
  }
  catch (error) { runtimeFailure(language, error.message); }
}

function stopCode() {
  for (const [language, rt] of Object.entries(runtimes)) {
    if (!rt.running) continue;
    appendOutput("\n[" + rt.filename + " gestoppt]\n", "system");
    createWorker(language);
  }
}

function downloadCode() {
  const blob = new Blob([currentCode()], { type: activeFile().language === "cpp" ? "text/x-c++src;charset=utf-8" : "text/x-python;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = workspace.activeFilename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(workspace.activeFilename + " wurde heruntergeladen.");
}

runButton.addEventListener("click", runCode);
stopButton.addEventListener("click", stopCode);
clearButton.addEventListener("click", clearOutput);
downloadButton.addEventListener("click", downloadCode);
resetButton.addEventListener("click", () => {
  replaceCode(activeFile().language === "cpp" ? CPP_CODE : DEFAULT_CODE);
  showToast("Beispielcode wiederhergestellt.");
});
newFileButton.addEventListener("click", newFile);
document.querySelector("#mobile-new-file").addEventListener("click", newFile);

createFallbackEditor();
renderWorkspace();
persistWorkspace();
initializeEditor().catch((error) => {
  appendOutput(`Syntax-Highlighting konnte nicht geladen werden. Der einfache Editor bleibt verfügbar.\n${error.message}\n`, "system");
  showToast("Editor-CDN nicht erreichbar.");
});

ensureRuntime(activeFile().language);
