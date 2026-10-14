// Single main-thread producer / worker consumer. Counters wrap modulo 2^32;
// occupancy is always bounded by capacity. SEQUENCE prevents lost wakeups.
(() => {
  const READ = 0, WRITE = 1, EOF = 2, ABORT = 3, SEQUENCE = 4;
  class Channel {
    constructor(buffer = new SharedArrayBuffer(20 + 65536)) {
      this.buffer = buffer;
      this.state = new Int32Array(buffer, 0, 5);
      this.bytes = new Uint8Array(buffer, 20);
    }
    wake() {
      Atomics.add(this.state, SEQUENCE, 1);
      Atomics.notify(this.state, SEQUENCE);
    }
    write(bytes) {
      const read = Atomics.load(this.state, READ) >>> 0;
      const write = Atomics.load(this.state, WRITE) >>> 0;
      const count = Math.min(bytes.length, this.bytes.length - ((write - read) >>> 0));
      for (let i = 0; i < count; i++) this.bytes[(write + i) % this.bytes.length] = bytes[i];
      Atomics.store(this.state, WRITE, (write + count) | 0);
      if (count) this.wake();
      return count;
    }
    close() { Atomics.store(this.state, EOF, 1); this.wake(); }
    abort() { Atomics.store(this.state, ABORT, 1); this.wake(); }
    read(size) {
      if (!size) return new Uint8Array();
      for (;;) {
        const sequence = Atomics.load(this.state, SEQUENCE);
        if (Atomics.load(this.state, ABORT)) throw new Error("stdin aborted");
        const read = Atomics.load(this.state, READ) >>> 0;
        const write = Atomics.load(this.state, WRITE) >>> 0;
        const count = Math.min(size, (write - read) >>> 0);
        if (count) {
          const result = new Uint8Array(count);
          for (let i = 0; i < count; i++) result[i] = this.bytes[(read + i) % this.bytes.length];
          Atomics.store(this.state, READ, (read + count) | 0);
          return result;
        }
        if (Atomics.load(this.state, EOF)) return new Uint8Array();
        Atomics.wait(this.state, SEQUENCE, sequence);
      }
    }
  }
  globalThis.LiveStdin = Channel;
})();
