const STORAGE_KEY = "py-studio:main.py";
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
const fileRow = document.querySelector("#file-row");
const output = document.querySelector("#terminal-output");
const statusText = document.querySelector("#status-text");
const statusIndicator = document.querySelector("#status-indicator");
const runtimeLabel = document.querySelector("#runtime-label");
const toast = document.querySelector("#toast");

let editor;
let fallbackEditor;
let worker;
let runtimeReady = false;
let isRunning = false;
let toastTimer;
let runtimeTimer;
let runtimeFailed = false;

function savedCode() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CODE;
  } catch {
    return DEFAULT_CODE;
  }
}

function persistCode(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    showToast("Lokales Speichern ist in diesem Browser deaktiviert.");
  }
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
  fallbackEditor.value = savedCode();
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
  ]);
  let timer;
  const loaded = await Promise.race([
    modules,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Editor-CDN Zeitüberschreitung")), 15000);
    }),
  ]).finally(() => clearTimeout(timer));
  const [{ EditorState }, { basicSetup }, { python }, { oneDark }, { EditorView, keymap }, { indentUnit }] = loaded;
  const code = currentCode();
  const container = document.createElement("div");
  editor = new EditorView({
    state: EditorState.create({
      doc: code,
      extensions: [
        keymap.of([{ key: "Mod-Enter", run: () => { runCode(); return true; } }]),
        basicSetup,
        python(),
        indentUnit.of("    "),
        EditorView.contentAttributes.of({ "aria-label": "Python-Code" }),
        oneDark,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) persistCode(update.state.doc.toString());
        }),
      ],
    }),
    parent: container,
  });
  editorHost.replaceChildren(editor.dom);
}

function replaceCode(code) {
  if (editor) {
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: code } });
  } else if (fallbackEditor) {
    fallbackEditor.value = code;
    persistCode(code);
  }
}

function runtimeFailure(message) {
  clearTimeout(runtimeTimer);
  worker?.terminate();
  runtimeReady = false;
  runtimeFailed = true;
  isRunning = false;
  runButton.disabled = false;
  stopButton.disabled = true;
  updateStatus("Runtime-Fehler · Run zum Wiederholen", "error");
  appendOutput(`Python konnte nicht geladen werden. Prüfe deine Internetverbindung.\n${message}\n`, "error");
}

function createWorker() {
  clearTimeout(runtimeTimer);
  runtimeFailed = false;
  worker?.terminate();
  runtimeReady = false;
  isRunning = false;
  runButton.disabled = true;
  stopButton.disabled = true;
  updateStatus("Python-Runtime wird geladen …", "loading");
  try {
    const activeWorker = new Worker(new URL("./pyodide-worker.js", import.meta.url));
    worker = activeWorker;
    activeWorker.addEventListener("message", (event) => {
      if (worker === activeWorker && !runtimeFailed) handleWorkerMessage(event);
    });
    activeWorker.addEventListener("error", (event) => {
      if (worker === activeWorker) runtimeFailure(event.message || "Worker-Fehler");
    });
    activeWorker.addEventListener("messageerror", () => {
      if (worker === activeWorker) runtimeFailure("Worker-Nachricht konnte nicht gelesen werden.");
    });
    runtimeTimer = setTimeout(() => runtimeFailure("Zeitüberschreitung beim Laden (90 Sekunden)."), 90000);
    activeWorker.postMessage({ type: "init" });
  } catch (error) {
    runtimeFailure(error.message);
  }
}

function handleWorkerMessage({ data }) {
  if (!data) return;
  if (data.type === "ready") {
    clearTimeout(runtimeTimer);
    runtimeReady = true;
    runButton.disabled = false;
    updateStatus(`Python ${data.version} bereit`);
    return;
  }
  if (data.type === "status") {
    updateStatus(data.message, "loading");
    return;
  }
  if (data.type === "stdout") {
    appendOutput(data.text || "");
    return;
  }
  if (data.type === "stderr") {
    appendOutput(data.text || "", "error");
    return;
  }
  if (data.type === "running") {
    isRunning = true;
    stopButton.disabled = false;
    runButton.disabled = true;
    updateStatus("Programm läuft …");
    return;
  }
  if (data.type === "finished") {
    isRunning = false;
    stopButton.disabled = true;
    runButton.disabled = false;
    updateStatus("Bereit");
    return;
  }
  if (data.type === "run-error") {
    isRunning = false;
    stopButton.disabled = true;
    runButton.disabled = false;
    appendOutput(`${data.message}\n`, "error");
    updateStatus("Fehler in main.py", "error");
    return;
  }
  if (data.type === "fatal") {
    runtimeFailure(data.message);
  }
}

function runCode() {
  if (runtimeFailed) { createWorker(); return; }
  if (!runtimeReady || isRunning) {
    if (!runtimeReady) showToast("Python wird noch geladen …");
    return;
  }
  appendOutput(`$ python main.py\n`, "command");
  isRunning = true;
  runButton.disabled = true;
  stopButton.disabled = false;
  updateStatus("Programm läuft …", "running");
  worker.postMessage({ type: "run", code: currentCode() });
}

function stopCode() {
  if (!isRunning) return;
  appendOutput("\n[Ausführung gestoppt]\n", "system");
  createWorker();
}

function downloadCode() {
  const blob = new Blob([currentCode()], { type: "text/x-python;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "main.py";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("main.py wurde heruntergeladen.");
}

runButton.addEventListener("click", runCode);
stopButton.addEventListener("click", stopCode);
clearButton.addEventListener("click", clearOutput);
downloadButton.addEventListener("click", downloadCode);
resetButton.addEventListener("click", () => {
  replaceCode(DEFAULT_CODE);
  showToast("Beispielcode wiederhergestellt.");
});
newFileButton.addEventListener("click", () => {
  replaceCode("");
  showToast("Leere main.py geöffnet.");
});
fileRow.addEventListener("click", () => (editor || fallbackEditor)?.focus());

createFallbackEditor();
initializeEditor().catch((error) => {
  appendOutput(`Syntax-Highlighting konnte nicht geladen werden. Der einfache Editor bleibt verfügbar.\n${error.message}\n`, "system");
  showToast("Editor-CDN nicht erreichbar.");
});

createWorker();
