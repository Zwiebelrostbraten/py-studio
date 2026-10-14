let interpreter;
let initialization;
let running = false;

function send(type, payload = {}) {
  self.postMessage({ type, ...payload });
}

function initialize() {
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      send("status", { message: "C++ · JSCPP wird geladen …" });
      const module = await import("https://esm.sh/JSCPP@2.0.9?bundle");
      interpreter = module.default;
      if (typeof interpreter?.run !== "function") throw new Error("JSCPP API nicht verfügbar.");
      send("ready", { version: "JSCPP 2.0.9" });
    } catch (error) {
      send("fatal", { message: error?.stack || String(error) });
    }
  })();
  return initialization;
}

self.addEventListener("message", ({ data }) => {
  if (data?.type === "init") {
    // Initialization reports its own errors; also contain unexpected failures.
    initialize().catch(error => send("fatal", { message: String(error) }));
    return;
  }
  if (data?.type !== "run" || running) return;
  if (!interpreter) {
    send("run-error", { message: "JSCPP ist noch nicht bereit." });
    return;
  }
  running = true;
  send("running");
  let buffer = "";
  function flush() {
    if (buffer) { send("stdout", { text: buffer }); buffer = ""; }
  }
  try {
    const exitCode = interpreter.run(data.code ?? "", "", {
      stdio: { write(text) {
        buffer += String(text);
        if (buffer.length >= 4096 || buffer.includes("\n")) flush();
      } },
    });
    flush();
    send("finished", { exitCode });
  } catch (error) {
    flush();
    send("run-error", { message: error?.stack || String(error) });
  } finally {
    running = false;
  }
});
