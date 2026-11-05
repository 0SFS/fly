// Two WebAssembly call costs behind docs/performance/2026-11-05/README.md.
// Plain Node, no dependencies: `node docs/performance/2026-11-05/harness/wasm-call-overheads.mjs`
//
// 1. An Emscripten JavaScript exception trampoline (invoke_ii, as JSBSim's
//    glue defines it) against a plain call_indirect to the same function.
// 2. A WebAssembly loop calling an imported Math function: the function
//    itself, a .bind(Math) copy (as terrain-WASM imports them), an arrow
//    wrapper, the native instruction, and the same loop in JavaScript.
//
// The modules are hand-encoded so the script needs no assembler.

const leb = value => { const out = []; do { let byte = value & 0x7f; value >>>= 7; if (value) byte |= 0x80; out.push(byte); } while (value); return out; };
const name = text => [...leb(text.length), ...Buffer.from(text)];
const vec = items => [...leb(items.length), ...items.flat()];
const section = (id, bytes) => [id, ...leb(bytes.length), ...bytes];
const body = (locals, code) => { const bytes = [...locals, ...code]; return [...leb(bytes.length), ...bytes]; };
const f64 = value => { const bytes = Buffer.alloc(8); bytes.writeDoubleLE(value); return [0x44, ...bytes]; };
// local0 (the count) decrements to zero; the loop result stays in local1.
const loopTail = [0x20, 0x00, 0x41, 0x01, 0x6b, 0x22, 0x00, 0x0d, 0x00, 0x0b, 0x20, 0x01, 0x0b];
const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

function trampolineModule() {
  return new Uint8Array([
    ...HEADER,
    ...section(1, vec([[0x60, 2, 0x7f, 0x7f, 1, 0x7f], [0x60, 1, 0x7f, 1, 0x7f], [0x60, 0, 1, 0x7f]])),
    ...section(2, vec([[...name("env"), ...name("invoke_ii"), 0x00, 0x00]])),
    ...section(3, vec([[1], [1], [1], [2]])),
    ...section(4, vec([[0x70, 0x00, 0x01]])),
    ...section(6, vec([[0x7f, 0x01, 0x41, 0x00, 0x0b]])),
    ...section(7, vec([[...name("viaInvoke"), 0x00, 2], [...name("direct"), 0x00, 3], [...name("stackSave"), 0x00, 4], [...name("table"), 0x01, 0]])),
    ...section(9, vec([[0x00, 0x41, 0x00, 0x0b, ...vec([[1]])]])),
    ...section(10, vec([
      body([0x00], [0x20, 0x00, 0x41, 0x01, 0x6a, 0x0b]),
      body([0x01, 0x01, 0x7f], [0x03, 0x40, 0x41, 0x00, 0x20, 0x01, 0x10, 0x00, 0x21, 0x01, ...loopTail]),
      body([0x01, 0x01, 0x7f], [0x03, 0x40, 0x20, 0x01, 0x41, 0x00, 0x11, 0x01, 0x00, 0x21, 0x01, ...loopTail]),
      body([0x00], [0x23, 0x00, 0x0b]),
    ])),
  ]);
}

function mathModule(fn) {
  const op = fn === "sqrt" ? [0x9f] : fn === "floor" ? [0x9c] : [0x10, 0x00];
  // acc = 0.5; repeat n times: acc = op(acc + 1.25) * 0.5
  const loop = call => body([0x01, 0x01, 0x7c], [...f64(0.5), 0x21, 0x01, 0x03, 0x40,
    0x20, 0x01, ...f64(1.25), 0xa0, ...call, ...f64(0.5), 0xa2, 0x21, 0x01, ...loopTail]);
  return new Uint8Array([
    ...HEADER,
    ...section(1, vec([[0x60, 1, 0x7c, 1, 0x7c], [0x60, 1, 0x7f, 1, 0x7c]])),
    ...section(2, vec([[...name("Math"), ...name(fn), 0x00, 0x00]])),
    ...section(3, vec([[1], [1]])),
    ...section(7, vec([[...name("imported"), 0x00, 1], [...name("native"), 0x00, 2]])),
    ...section(10, vec([loop([0x10, 0x00]), loop(op)])),
  ]);
}

const N = 20_000_000;
const nsPerCall = run => { const started = performance.now(); run(N); return (performance.now() - started) * 1e6 / N; };
const best = run => { for (let i = 0; i < 2; i++) nsPerCall(run); return Math.min(...[0, 1, 2].map(() => nsPerCall(run))); };

class EmscriptenEH {}
let instance;
const mirror = [];
instance = new WebAssembly.Instance(new WebAssembly.Module(trampolineModule()), { env: {
  // The shape of Emscripten's generated invoke_ii.
  invoke_ii(index, a1) {
    const sp = instance.exports.stackSave();
    try { return (mirror[index] ??= instance.exports.table.get(index))(a1); }
    catch (error) { if (!(error instanceof EmscriptenEH)) throw error; return sp; }
  },
} });
const viaInvoke = best(instance.exports.viaInvoke), direct = best(instance.exports.direct);

const math = {};
for (const fn of ["sqrt", "floor", "sin"]) {
  const real = Math[fn];
  const make = imported => new WebAssembly.Instance(new WebAssembly.Module(mathModule(fn)), { Math: { [fn]: imported } }).exports;
  const plain = make(real), bound = make(real.bind(Math)), arrow = make(x => real(x));
  const js = n => { let acc = 0.5; for (let i = 0; i < n; i++) acc = real(acc + 1.25) * 0.5; return acc; };
  math[fn] = {
    importNs: +best(plain.imported).toFixed(2),
    boundImportNs: +best(bound.imported).toFixed(2),
    arrowImportNs: +best(arrow.imported).toFixed(2),
    nativeInstructionNs: fn === "sin" ? null : +best(plain.native).toFixed(2),
    javascriptNs: +best(js).toFixed(2),
  };
}

console.log(JSON.stringify({
  node: process.version, v8: process.versions.v8,
  trampoline: { invokeNsPerCall: +viaInvoke.toFixed(2), directNsPerCall: +direct.toFixed(2), overheadNs: +(viaInvoke - direct).toFixed(2) },
  mathImports: math,
}, null, 1));
