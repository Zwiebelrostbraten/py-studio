importScripts("./live-stdin.js");
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
    // Reset for every run, including after EOF or a run that left unread input.
    // Byte input preserves Unicode, blank lines and an unterminated final line.
    const stdinBytes = new TextEncoder().encode(data.stdin ?? "");
    let stdinOffset = 0;
    const channel = data.liveStdin ? new LiveStdin(data.liveStdin) : null;
    pyodide.setStdin({
      isatty: false,
      read: buffer => {
        const bytes = channel ? channel.read(buffer.length) :
          stdinBytes.subarray(stdinOffset, stdinOffset + buffer.length);
        buffer.set(bytes);
        stdinOffset += bytes.length;
        return bytes.length;
      },
    });
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
