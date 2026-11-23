// Compare original vs patched asar: bytes, offsets, integrity hashes.
const path = require("path");
const crypto = require("crypto");
const asar = require("../lib/asar");

const APP = path.join(process.env.LOCALAPPDATA, "Google", "Gemini", "app-1.21.1", "resources");
const orig = asar.parseAsar(path.join(APP, "app.asar.zhcn-orig"));
const mod = asar.parseAsar(path.join(APP, "app.asar"));

const of = asar.readAll(orig);
const mf = asar.readAll(mod);
console.log("orig files:", of.size, "modified files:", mf.size);

const diff = [];
for (const [k, v] of of) {
  const m = mf.get(k);
  if (!m) { diff.push("MISSING " + k); continue; }
  if (!m.equals(v)) diff.push("CHANGED " + k + " " + v.length + " -> " + m.length);
}
for (const k of mf.keys()) if (!of.has(k)) diff.push("ADDED " + k + " (" + mf.get(k).length + " bytes)");
console.log("diff:", diff);

function structCheck(p, name) {
  const bad = [];
  const dataLen = p.raw.length - p.base;
  const walk = (node, prefix) => {
    for (const k of Object.keys(node.files || {})) {
      const e = node.files[k];
      const rel = prefix ? prefix + "/" + k : k;
      if (e.files) { walk(e, rel); continue; }
      if (e.unpacked || e.link) continue;
      const off = Number(e.offset);
      if (!Number.isFinite(off)) { bad.push(rel + " bad offset " + e.offset); continue; }
      if (off + e.size > dataLen) bad.push(rel + " out of range");
      const buf = p.raw.subarray(p.base + off, p.base + off + e.size);
      const intg = e.integrity;
      if (intg && intg.hash) {
        const alg = intg.algorithm === "SHA256" ? "sha256" : String(intg.algorithm).toLowerCase();
        const h = crypto.createHash(alg).update(buf).digest("hex");
        if (h !== intg.hash) bad.push(rel + " integrity mismatch");
        if (intg.blocks) {
          const blocks = [];
          for (let i = 0; i < buf.length; i += intg.blockSize) {
            blocks.push(crypto.createHash(alg).update(buf.subarray(i, i + intg.blockSize)).digest("hex"));
          }
          if (blocks.length !== intg.blocks.length) bad.push(rel + " block count " + blocks.length + " vs " + intg.blocks.length);
        }
      }
    }
  };
  walk(p.header, "");
  console.log(name + " struct problems:", bad.length ? bad : "none");
}
structCheck(orig, "ORIG");
structCheck(mod, "MOD");
console.log("base:", orig.base, mod.base, "file size:", orig.raw.length, mod.raw.length);