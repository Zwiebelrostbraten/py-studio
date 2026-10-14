import "./live-stdin.js";
import { compile, loadToolchain } from "./vendor/browsercc/index.js";
import { WASI, File, OpenFile, ConsoleStdout, Fd, wasi as defs } from "./vendor/browser-wasi-shim/index.js";

class LiveInputFd extends Fd {
  constructor(buffer) { super(); this.channel = new LiveStdin(buffer); }
  fd_fdstat_get() {
    const fdstat = new defs.Fdstat(defs.FILETYPE_CHARACTER_DEVICE, 0);
    fdstat.fs_rights_base = BigInt(defs.RIGHTS_FD_READ);
    return { ret: 0, fdstat };
  }
  fd_read(size) { return { ret: 0, data: this.channel.read(size) }; }
}

let initialization;
let ready = false;
let running = false;
const flags = ["-std=c++20", "-O0", "-fno-exceptions", "-fno-threadsafe-statics",
  "-Wall", "-Wextra", "-fno-color-diagnostics", "-I.", "-Wl,--max-memory=268435456"];
const phases = {
  loading: "C++ · Clang-C++20-Toolchain wird geladen …",
  compiling: "C++ · Clang C++20 kompiliert …",
  linking: "C++ · LLD linkt WASI-WebAssembly …",
  running: "C++ · WASI-WebAssembly läuft …",
};
function send(type, payload = {}) { self.postMessage({ type, ...payload }); }
function status(phase) { send("status", { message: phases[phase], phase }); }
function initialize() {
  if (!initialization) initialization = (async () => {
    status("loading");
    await loadToolchain();
    ready = true;
    send("ready", { version: "Clang C++20 · WASI" });
  })().catch(error => send("fatal", { message: error?.stack || String(error) }));
  return initialization;
}

self.addEventListener("message", async ({ data }) => {
  if (data?.type === "init") { await initialize(); return; }
  if (data?.type !== "run" || running) return;
  if (!ready) { send("run-error", { message: "Clang C++20 ist noch nicht bereit." }); return; }
  running = true;
  const decoders = [];
  const stream = type => {
    const decoder = new TextDecoder();
    decoders.push({ type, decoder });
    return new ConsoleStdout(bytes => {
      const text = decoder.decode(bytes, { stream: true });
      if (text) send(type, { text });
    });
  };
  try {
    const fileName = data.filename || "main.cpp";
    const extraFiles = Object.create(null);
    for (const [name, content] of Object.entries(data.extraFiles || {})) {
      if (name !== fileName && !/[/\\\x00-\x1f]/.test(name) && /\.(cpp|cc|cxx|h|hpp)$/i.test(name)
          && typeof content === "string") extraFiles[name] = content;
    }
    const result = await compile({ source: data.code ?? "", fileName, flags, extraFiles, onStatus: status });
    if (result.compileOutput) send("stderr", { text: result.compileOutput });
    if (!result.module) {
      send("run-error", { message: "Kompilieren/Linken fehlgeschlagen (Exit " + result.exitCode + ").", exitCode: result.exitCode });
      return;
    }
    const wasi = new WASI([fileName], [], [data.liveStdin ? new LiveInputFd(data.liveStdin) : new OpenFile(new File(new TextEncoder().encode(data.stdin ?? ""))), stream("stdout"), stream("stderr")]);
    const instance = await WebAssembly.instantiate(result.module, { wasi_snapshot_preview1: wasi.wasiImport });
    status("running");
    send("running");
    const exitCode = wasi.start(instance);
    for (const { type, decoder } of decoders) {
      const text = decoder.decode();
      if (text) send(type, { text });
    }
    send("finished", { exitCode });
  } catch (error) {
    send("run-error", { message: error?.stack || String(error) });
  } finally { running = false; }
});
