#!/usr/bin/env node
"use strict";
/**
 * gemini-zh-cn —— Gemini Windows 客户端汉化工具
 *
 *   node bin/gemini-zh.js status
 *   node bin/gemini-zh.js apply
 *   node bin/gemini-zh.js restore
 *   node bin/gemini-zh.js dev [--port 9222]     # 打补丁并带调试端口启动（抓取未翻译文案）
 *   node bin/gemini-zh.js harvest               # 汇总运行期收集到的未翻译文案
 *   node bin/gemini-zh.js verify                # 自检补丁完整性
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawn } = require("child_process");
const asar = require("../lib/asar");
const exeLib = require("../lib/exe");

const ROOT = path.resolve(__dirname, "..");
const PATCH_TAG = "GEMINI-ZHCN-BOOTSTRAP";
const VERSION = "1.0.0";
const PAGE_REL = "src/zhcn/page.js";
const DICT_REL = "src/zhcn/dict.json";

const log = (...a) => console.log(...a);
const die = (msg) => { console.error("✗ " + msg); process.exit(1); };

/* ---------- 安装位置探测 ---------- */
function findInstall() {
  const base = path.join(process.env.LOCALAPPDATA || os.homedir(), "Google", "Gemini");
  if (!fs.existsSync(base)) die("未找到 Gemini 客户端安装目录: " + base);
  const dirs = fs.readdirSync(base).filter((d) => /^app-\d/.test(d) && fs.existsSync(path.join(base, d, "resources")));
  if (!dirs.length) die("安装目录下没有 app-* 文件夹: " + base);
  const rank = (v) => v.replace(/^app-/, "").split(".").map((n) => parseInt(n, 10) || 0);
  dirs.sort((a, b) => {
    const x = rank(a), y = rank(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    }
    return 0;
  });
  const appDir = path.join(base, dirs[0]);
  const resources = path.join(appDir, "resources");
  const asarPath = path.join(resources, "app.asar");
  if (!fs.existsSync(asarPath)) die("找不到 app.asar: " + asarPath);
  return { base, appDir, resources, asarPath, backupPath: asarPath + ".zhcn-orig", version: dirs[0].replace(/^app-/, "") };
}

function isAppRunning() {
  try {
    const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq Gemini.exe", "/NH"], { encoding: "utf8" });
    return /Gemini\.exe/i.test(out);
  } catch (e) { return false; }
}

function sleep(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch (e) { const t = Date.now(); while (Date.now() - t < ms) {} }
}

function killApp() {
  try { execFileSync("taskkill", ["/IM", "Gemini.exe", "/F"], { stdio: "ignore" }); } catch (e) {}
  try { execFileSync("taskkill", ["/IM", "GeminiAppLauncher.exe", "/F"], { stdio: "ignore" }); } catch (e) {}
}

/* ---------- 补丁内容 ---------- */
function loadAsset(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function buildBootstrap() {
  let boot = loadAsset("src/zhcn-bootstrap.js");
  boot = boot.replace(/__ZHC_VERSION__/g, VERSION);
  return "/* " + PATCH_TAG + " v" + VERSION + " — 由 gemini-zh-cn 生成，勿手改 */\n" + boot + "\n";
}

function buildPageScript() {
  const dict = JSON.parse(loadAsset("dict/zh-CN.json"));
  const rules = JSON.parse(loadAsset("dict/rules.json"));
  // 规则序列化为 [source, repl] 并就地编译
  let page = loadAsset("src/zhcn-page.js");
  page = page.replace("/*__ZHC_DICT__*/ {}", JSON.stringify(dict, null, 0));
  page = page.replace(
    "/*__ZHC_RULES__*/ []",
    "(" + JSON.stringify(rules) + ").map(function (r) { return [new RegExp(r[0], 'i'), r[1]]; })"
  );
  page = page.replace(/__ZHC_VERSION__/g, VERSION);
  return page;
}

/* ---------- apply / restore ---------- */
function apply(opts = {}) {
  const inst = findInstall();
  log("• 安装目录: " + inst.appDir);
  log("• 客户端版本: " + inst.version);

  if (isAppRunning()) {
    log("• 检测到 Gemini 正在运行，先关闭…");
    killApp();
  }
  const t0 = Date.now();
  while (isAppRunning() && Date.now() - t0 < 8000) sleep(250);

  // 备份：永远以原始 asar 作为补丁基线
  if (!fs.existsSync(inst.backupPath)) {
    fs.copyFileSync(inst.asarPath, inst.backupPath);
    log("• 已备份原始 app.asar → " + path.basename(inst.backupPath));
  }

  const pristine = asar.parseAsar(inst.backupPath);
  const files = asar.readAll(pristine);
  const header = JSON.parse(JSON.stringify(pristine.header));

  const mainRel = "src/main.js";
  const mainBuf = files.get(mainRel);
  if (!mainBuf) die("app.asar 结构异常：缺少 src/main.js");
  let mainSrc = mainBuf.toString("utf8");
  // 去掉可能存在的旧补丁
  mainSrc = mainSrc.replace(/^\/\* GEMINI-ZHCN-BOOTSTRAP[\s\S]*?\*\/\n/, "");
  mainSrc = mainSrc.replace(/^\/\* GEMINI-ZHCN-BOOTSTRAP[\s\S]*?\(function \(\) \{[\s\S]*?\}\)\(\);\n/, "");

  const boot = buildBootstrap();
  const patched = boot + mainSrc;
  files.set(mainRel, Buffer.from(patched, "utf8"));

  const page = buildPageScript();
  files.set(PAGE_REL, Buffer.from(page, "utf8"));
  asar.setFile(header, PAGE_REL, Buffer.from(page, "utf8"));
  const dictJson = loadAsset("dict/zh-CN.json");
  files.set(DICT_REL, Buffer.from(dictJson, "utf8"));
  asar.setFile(header, DICT_REL, Buffer.from(dictJson, "utf8"));

  const res = asar.writeAsar(inst.asarPath, header, files);
  log("✓ 补丁写入完成 (" + Math.round(res.size / 1024) + " KB)");
  log("  注入点: src/zhcn/page.js  |  词条: " + Object.keys(JSON.parse(dictJson)).length + " 条");

  patchExe(inst);
  log("  回滚命令: node bin/gemini-zh.js restore");
  return inst;
}

/* ---------- exe 侧：asar 完整性校验 ---------- */
function patchExe(inst) {
  const exe = path.join(inst.appDir, "Gemini.exe");
  if (!fs.existsSync(exe)) { log("! 未找到 Gemini.exe，跳过 exe 侧处理"); return; }
  if (isAppRunning()) { killApp(); const t = Date.now(); while (isAppRunning() && Date.now() - t < 8000) sleep(250); }

  const oldHash = exeLib.headerHashOfAsar(inst.backupPath).hex;
  const newHash = exeLib.headerHashOfAsar(inst.asarPath).hex;

  const fuse = exeLib.setFuse(exe, exeLib.FUSE_ASAR_INTEGRITY, "0");
  if (fuse.ok) log("• asar 完整性校验 fuse: " + fuse.before + " → 0" + (fuse.before === "0" ? "（已是关闭）" : "（已关闭）"));
  else log("! fuse 处理失败: " + fuse.reason);

  const hs = exeLib.patchAsarIntegrityHash(exe, newHash);
  if (hs.ok) {
    log("• exe 内 ELECTRONASAR 记录已同步 @" + hs.offset + (hs.before === hs.after ? "（无需改动）" : ""));
  } else log("! exe 内哈希未同步（" + hs.reason + "），依靠 fuse 关闭校验");
}

function restore() {
  const inst = findInstall();
  if (!fs.existsSync(inst.backupPath)) {
    log("• 未发现备份文件，当前可能未打补丁。");
    return;
  }
  if (isAppRunning()) { log("• 关闭正在运行的 Gemini…"); killApp(); }
  fs.copyFileSync(inst.backupPath, inst.asarPath);
  const exe = path.join(inst.appDir, "Gemini.exe");
  if (fs.existsSync(exe)) {
    const hs = exeLib.patchAsarIntegrityHash(exe, exeLib.headerHashOfAsar(inst.backupPath).hex);
    const fuse = exeLib.setFuse(exe, exeLib.FUSE_ASAR_INTEGRITY, "1");
    log("• exe 侧校验已复原" + (fuse.ok ? "（fuse " + fuse.before + " → 1）" : "") + (hs.ok && hs.before !== hs.after ? "，内嵌哈希写回原始值" : ""));
  }
  log("✓ 已还原为原始 app.asar（" + inst.version + "）");
}

function status() {
  const inst = findInstall();
  const parsed = asar.parseAsar(inst.asarPath);
  const files = asar.readAll(parsed);
  const mainSrc = (files.get("src/main.js") || Buffer.from("")).toString("utf8");
  const patched = mainSrc.startsWith("/* " + PATCH_TAG);
  log("安装目录 : " + inst.appDir);
  log("版本     : " + inst.version);
  log("补丁状态 : " + (patched ? "已汉化 (v" + VERSION + ")" : "未打补丁（原版）"));
  log("备份     : " + (fs.existsSync(inst.backupPath) ? path.basename(inst.backupPath) + " 存在" : "无"));
  log("页面脚本 : " + (files.has(PAGE_REL) ? PAGE_REL : "无"));
  log("运行中   : " + (isAppRunning() ? "是" : "否"));
  const missFile = path.join(process.env.APPDATA || "", "gemini", "zhcn-missing.ndjson");
  if (fs.existsSync(missFile)) {
    const n = fs.readFileSync(missFile, "utf8").split("\n").filter(Boolean).length;
    log("未翻译日志: " + missFile + "（" + n + " 批）");
  }
}

function verify() {
  const inst = findInstall();
  const parsed = asar.parseAsar(inst.asarPath);
  const files = asar.readAll(parsed);
  const mainSrc = (files.get("src/main.js") || Buffer.from("")).toString("utf8");
  const page = (files.get(PAGE_REL) || Buffer.from("")).toString("utf8");
  const ok = [
    ["main.js 含注入引导", mainSrc.startsWith("/* " + PATCH_TAG)],
    ["页面脚本存在", page.includes("__zhcnInstalled")],
    ["页面脚本含字典", /var DICT = \{"/.test(page) && page.length > 8000],
    ["main.js 语法可解析", (() => { try { new Function(mainSrc.replace(/^#!.*\n/, "")); return true; } catch (e) { return false; } })()],
  ];
  let all = true;
  for (const [name, pass] of ok) { log((pass ? "✓ " : "✗ ") + name); if (!pass) all = false; }
  if (!all) process.exit(1);
}

function dev(port) {
  const inst = apply();
  const exe = path.join(inst.appDir, "Gemini.exe");
  const env = Object.assign({}, process.env, { GEMINI_ZH_CDP: String(port) });
  log("• 以调试模式启动，CDP: http://127.0.0.1:" + port);
  spawn(exe, [], { env, detached: true, stdio: "ignore" }).unref();
}

function harvest() {
  const f = path.join(process.env.APPDATA || "", "gemini", "zhcn-missing.ndjson");
  if (!fs.existsSync(f)) { log("暂无收集数据：先正常运行客户端，再回来看。"); return; }
  const counts = new Map();
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (e) { continue; }
    for (const k of Object.keys(obj)) counts.set(k, (counts.get(k) || 0) + (obj[k] || 1));
  }
  const dict = JSON.parse(loadAsset("dict/zh-CN.json"));
  const rows = [...counts.entries()].filter(([k]) => !(k in dict)).sort((a, b) => b[1] - a[1]);
  log("未命中词条 " + rows.length + " 条（按出现次数排序）：");
  rows.slice(0, 80).forEach(([k, v]) => log("  " + String(v).padStart(5) + "  " + k));
  if (rows.length > 80) log("  … 其余 " + (rows.length - 80) + " 条见 " + f);
}

/* ---------- CLI ---------- */
const argv = process.argv.slice(2);
const cmd = argv[0] || "status";
const portArg = argv.indexOf("--port");
const port = portArg !== -1 ? parseInt(argv[portArg + 1], 10) || 9222 : 9222;

switch (cmd) {
  case "apply": apply(); break;
  case "restore": restore(); break;
  case "status": status(); break;
  case "verify": verify(); break;
  case "dev": dev(port); break;
  case "harvest": harvest(); break;
  case "-h":
  case "--help":
  case "help":
    log("用法: node bin/gemini-zh.js <status|apply|restore|verify|dev|harvest> [--port 9222]");
    break;
  default:
    die("未知命令: " + cmd);
}