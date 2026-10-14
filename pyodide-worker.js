const PYODIDE_VERSION = "0.26.4";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
let pyodide;
let initialized = false;
let initialization;
let running = false;

function send(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

async function initialize() {
  if (initialized) return;
  if (initialization) return initialization;
  initialization = (async () => {
    send("status", { message: "Python-Runtime wird geladen …" });
    try {
      importScripts(`${PYODIDE_BASE}pyodide.js`);
      pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
      send("status", { message: "Python-Paket micropip wird geladen …" });
      await pyodide.loadPackage("micropip");
      function stream(type) {
        const decoder = new TextDecoder();
        return { write(buffer) {
          send(type, { text: decoder.decode(buffer, { stream: true }) });
          return buffer.length;
        } };
      }
      pyodide.setStdout(stream("stdout"));
      pyodide.setStderr(stream("stderr"));
      pyodide.setStdin({ stdin: () => null });
      initialized = true;
      send("ready", { version: pyodide.runPython("import sys; sys.version.split()[0]") });
    } catch (error) {
      send("fatal", { message: error?.stack || String(error) });
    }
  })();
  return initialization;
}

self.addEventListener("message", async ({ data }) => {
  if (data?.type === "init") {
    await initialize();
    return;
  }

  if (data?.type !== "run") return;
  if (!initialized) {
    send("run-error", { message: "Python ist noch nicht bereit." });
    return;
  }

  if (running) return;
  running = true;
  send("running");
  try {
    try {
      await pyodide.runPythonAsync(data.code ?? "");
    } finally {
      pyodide.runPython("import sys; sys.stdout.flush(); sys.stderr.flush()");
    }
    send("finished");
  } catch (error) {
    send("run-error", { message: error?.stack || String(error) });
  } finally {
    running = false;
  }
});
