"use strict";
/**
 * Minimal, dependency-free ASAR reader/writer.
 * Format (Electron/Chromium pickle):
 *   [0:4]   uint32 = 4
 *   [4:8]   uint32 = headerSize
 *   [8:12]  uint32 = 4 + jsonLen + pad
 *   [12:16] uint32 = jsonLen
 *   [16:16+jsonLen] json
 *   padding to align (8 + headerSize) to 4
 *   data section starts at 8 + headerSize, each file 4-byte aligned.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function parseAsar(file) {
  const raw = fs.readFileSync(file);
  const headerSize = raw.readUInt32LE(4);
  const jsonLen = raw.readUInt32LE(12);
  const header = JSON.parse(raw.slice(16, 16 + jsonLen).toString("utf8"));
  const base = 8 + headerSize;
  return { raw, header, base, file };
}

/** Return Map<relPath, Buffer> for every packed (non-unpacked) entry. */
function readAll(parsed) {
  const out = new Map();
  (function walk(node, prefix) {
    const files = node.files || {};
    for (const name of Object.keys(files)) {
      const ent = files[name];
      const rel = prefix ? prefix + "/" + name : name;
      if (ent.files) { walk(ent, rel); continue; }
      if (ent.unpacked || ent.link) continue;
      const off = parsed.base + Number(ent.offset);
      out.set(rel, Buffer.from(parsed.raw.slice(off, off + Number(ent.size))));
    }
  })(parsed.header, "");
  return out;
}

function integrityFor(buf) {
  const BLOCK = 4194304;
  const blocks = [];
  for (let i = 0; i < buf.length || i === 0; i += BLOCK) {
    blocks.push(crypto.createHash("sha256").update(buf.slice(i, i + BLOCK)).digest("hex"));
    if (buf.length === 0) break;
  }
  return {
    algorithm: "SHA256",
    hash: crypto.createHash("sha256").update(buf).digest("hex"),
    blockSize: BLOCK,
    blocks,
  };
}

/**
 * Write a new asar. `data` maps rel path -> Buffer for every packed entry.
 * Entries flagged `unpacked` stay in the header untouched (their bytes live
 * in <asar>.unpacked/).
 */
function writeAsar(file, header, data) {
  const chunks = [];
  let cursor = 0;
  const seen = new Set();

  (function walk(node, prefix) {
    const files = node.files || {};
    for (const name of Object.keys(files)) {
      const ent = files[name];
      const rel = prefix ? prefix + "/" + name : name;
      if (ent.files) { walk(ent, rel); continue; }
      if (ent.unpacked || ent.link) continue;
      const buf = data.get(rel);
      if (!buf) throw new Error("asar pack: missing data for " + rel);
      const pad = (4 - (cursor % 4)) % 4;
      if (pad) { chunks.push(Buffer.alloc(pad)); cursor += pad; }
      ent.size = buf.length;
      ent.offset = String(cursor);
      ent.integrity = integrityFor(buf);
      chunks.push(buf);
      cursor += buf.length;
      seen.add(rel);
    }
  })(header, "");

  for (const rel of data.keys()) {
    if (!seen.has(rel)) throw new Error("asar pack: header has no entry for " + rel);
  }

  const json = Buffer.from(JSON.stringify(header), "utf8");
  const jsonLen = json.length;
  const pad = (4 - (jsonLen % 4)) % 4;
  const headerSize = 8 + jsonLen + pad;
  const base = 8 + headerSize;

  const head = Buffer.alloc(base);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(headerSize, 4);
  head.writeUInt32LE(4 + jsonLen + pad, 8);
  head.writeUInt32LE(jsonLen, 12);
  json.copy(head, 16);

  const tmp = file + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, head);
    for (const c of chunks) fs.writeSync(fd, c);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  return { size: base + cursor };
}

/** Ensure a directory entry exists in the header (creates {files:{}} chain). */
function ensureDir(header, relDir) {
  const parts = relDir.split("/").filter(Boolean);
  let node = header;
  let prefix = "";
  for (const p of parts) {
    prefix = prefix ? prefix + "/" + p : p;
    node.files = node.files || {};
    if (!node.files[p]) node.files[p] = { files: {} };
    if (!node.files[p].files) node.files[p].files = {};
    node = node.files[p];
  }
  return node;
}

function setFile(header, rel, buf) {
  const dir = path.posix.dirname(rel);
  const name = path.posix.basename(rel);
  const node = dir === "." ? header : ensureDir(header, dir);
  node.files[name] = { size: buf.length, offset: "0" };
}

function getFile(header, rel) {
  const parts = rel.split("/").filter(Boolean);
  let node = header;
  for (const p of parts) {
    if (!node.files || !node.files[p]) return null;
    node = node.files[p];
  }
  return node.files ? null : node;
}

function removeFile(header, rel) {
  const parts = rel.split("/").filter(Boolean);
  let node = header;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node.files || !node.files[parts[i]]) return false;
    node = node.files[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (node.files && node.files[last]) { delete node.files[last]; return true; }
  return false;
}

module.exports = { parseAsar, readAll, writeAsar, setFile, getFile, removeFile, ensureDir };