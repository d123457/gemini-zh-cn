"use strict";
/**
 * Electron fuse / asar 完整性校验处理。
 *
 * 官方客户端在 Windows 上把 <header> 的 SHA256 以十六进制字符串嵌进了
 * Gemini.exe（偏移处可见 64 个 hex 字符），同时启用了 Electron fuse
 * `EnableEmbeddedAsarIntegrityValidation`（fuse 序号 4）。只要 asar 头被
 * 重新打包，二者就会失配，进程直接 FATAL。
 *
 * 处理方式：
 *   1) 把 fuse 4 置 '0'（关闭校验，永久生效，之后重新打补丁不需要再动 exe）；
 *   2) 顺手把嵌在 exe 里的 header 哈希改写成当前值（双保险）。
 */
const fs = require("fs");
const crypto = require("crypto");

const SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX", "utf8");
const FUSE_ASAR_INTEGRITY = 4; // 0 RunAsNode, 1 CookieEncryption, 2 NodeOptionsEnv, 3 NodeCliInspect, 4 AsarIntegrity, 5 OnlyLoadAppFromAsar, ...

function findFuses(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const chunk = 1 << 22;
    let carry = Buffer.alloc(0);
    for (let pos = 0; pos < size; pos += chunk) {
      const len = Math.min(chunk, size - pos);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      const hay = carry.length ? Buffer.concat([carry, buf]) : buf;
      const at = hay.indexOf(SENTINEL);
      if (at !== -1) {
        const wire = at + SENTINEL.length;
        const version = hay[wire];
        const count = hay[wire + 1];
        const states = Array.from(hay.subarray(wire + 2, wire + 2 + count)).map((b) => String.fromCharCode(b));
        return { file, wireOffset: pos + wire - carry.length, version, count, states };
      }
      carry = hay.subarray(Math.max(0, hay.length - SENTINEL.length));
    }
    return { file, wireOffset: -1 };
  } finally {
    fs.closeSync(fd);
  }
}

function setFuse(file, index, value) {
  const info = findFuses(file);
  if (info.wireOffset < 0) return { ok: false, reason: "fuse wire 未找到" };
  const off = info.wireOffset + 2 + index;
  const fd = fs.openSync(file, "r+");
  try {
    const cur = Buffer.alloc(1);
    fs.readSync(fd, cur, 0, 1, off);
    const before = String.fromCharCode(cur[0]);
    if (before !== value) {
      fs.writeSync(fd, Buffer.from(value, "utf8"), 0, 1, off);
    }
    return { ok: true, before, after: value, offset: off };
  } finally {
    fs.closeSync(fd);
  }
}

function headerHashOfAsar(file) {
  const raw = fs.readFileSync(file);
  const jsonLen = raw.readUInt32LE(12);
  const headerStr = raw.subarray(16, 16 + jsonLen);
  return {
    hex: crypto.createHash("sha256").update(headerStr).digest("hex"),
    length: jsonLen,
  };
}

/** 在 exe 里找到 PE 资源 INTEGRITY\ELECTRONASAR 中记录的 asar 头哈希并改写。
 *  资源体形如：[{"file":"resources\\app.asar","alg":"SHA256","value":"<64 hex>"}]
 */
const HASH_ANCHOR = Buffer.from('{"file":"resources\\\\app.asar","alg":"SHA256","value":"', "latin1");

function patchAsarIntegrityHash(file, newHex) {
  const fd = fs.openSync(file, "r+");
  try {
    const size = fs.fstatSync(fd).size;
    const chunk = 1 << 22;
    let carry = Buffer.alloc(0);
    for (let pos = 0; pos < size; pos += chunk) {
      const len = Math.min(chunk, size - pos);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      const hay = carry.length ? Buffer.concat([carry, buf]) : buf;
      const at = hay.indexOf(HASH_ANCHOR);
      if (at !== -1) {
        const valStart = pos + at - carry.length + HASH_ANCHOR.length;
        const cur = Buffer.alloc(64);
        fs.readSync(fd, cur, 0, 64, valStart);
        const before = cur.toString("latin1");
        if (!/^[0-9a-f]{64}$/.test(before)) return { ok: false, reason: "锚点后不是 64 位 hex（" + before.slice(0, 16) + "…）" };
        if (before !== newHex) fs.writeSync(fd, Buffer.from(newHex, "latin1"), 0, 64, valStart);
        return { ok: true, offset: valStart, before, after: newHex };
      }
      carry = hay.subarray(Math.max(0, hay.length - HASH_ANCHOR.length));
    }
    return { ok: false, reason: "exe 内未找到 ELECTRONASAR 完整性资源" };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  findFuses,
  setFuse,
  headerHashOfAsar,
  patchAsarIntegrityHash,
  FUSE_ASAR_INTEGRITY,
};