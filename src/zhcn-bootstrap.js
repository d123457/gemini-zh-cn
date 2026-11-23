/* Gemini Windows 客户端汉化层 (gemini-zhcn) — bootstrap
 * 由 gemini-zh-cn 工具在打包时整体前置注入到 src/main.js 顶部。
 * 全部逻辑包在 try/catch 内，任何异常都不会影响客户端原本功能。
 *
 * 三条加固线：
 *   1) Chromium/app 语言开关 + 请求头 Accept-Language + 主框架跳转补 hl=zh-CN
 *   2) 用 WebContents.debugger 在“每个新文档建立时”注入页面脚本（可扛 SPA 导航/刷新）
 *   3) 低频巡检补齐（页面若被整体替换，重新注入一次）
 */
;(function () {
  "use strict";
  var ENV = process.env || {};
  var VERSION = "__ZHC_VERSION__";
  var DEBUG = ENV.GEMINI_ZH_DEBUG === "1";
  var APP_NAME = "zhcn";

  var electron, fs, path;
  try {
    electron = require("electron");
    fs = require("fs");
    path = require("path");
  } catch (e) {
    return;
  }
  var app = electron.app;

  function dbg(msg) {
    if (!DEBUG) return;
    try {
      fs.appendFileSync(path.join(app.getPath("userData"), APP_NAME + "-debug.log"),
        new Date().toISOString() + " " + msg + "\n");
    } catch (e) {}
  }

  /* ---- 0. 可选：调试端口（抓取未翻译文案 / 开发验证） ---- */
  try {
    var cdp = ENV.GEMINI_ZH_CDP;
    if (cdp) {
      process.argv = process.argv.filter(function (a) {
        return !/^--(remote-debugging|remote-allow-origins|inspect)/i.test(String(a));
      });
      app.commandLine.appendSwitch("remote-debugging-port", String(cdp));
      app.commandLine.appendSwitch("remote-allow-origins", "*");
    }
  } catch (e) {}

  /* ---- 1. 让 Chromium / 应用自身走简体中文 ---- */
  try { app.commandLine.appendSwitch("lang", "zh-CN"); } catch (e) {}
  try { app.commandLine.appendSwitch("accept-lang", "zh-CN,zh;q=0.9,en;q=0.6"); } catch (e) {}

  var IA = "zh-CN,zh;q=0.9,en;q=0.6";
  var HOSTS = ["gemini.google.com", "accounts.google.com", "gemini.google.cn"];

  var PAGE = null;
  function pageCode() {
    if (PAGE) return PAGE;
    try {
      PAGE = fs.readFileSync(path.join(__dirname, "zhcn", "page.js"), "utf8");
    } catch (e) { PAGE = ""; }
    return PAGE;
  }

  function isGeminiUrl(u) {
    try {
      var h = new URL(u).hostname.toLowerCase();
      return HOSTS.some(function (x) { return h === x || h.endsWith("." + x); });
    } catch (e) { return false; }
  }

  /* ---- 2. 请求层：Accept-Language + hl=zh-CN ---- */
  function hookSession(s) {
    if (!s || s.__zhcnHooked) return;
    try { s.__zhcnHooked = true; } catch (e) {}
    var wr;
    try { wr = s.webRequest; } catch (e) { return; }
    if (!wr) return;

    try {
      wr.onBeforeSendHeaders({ urls: ["*://*.google.com/*", "*://*.google.cn/*"] }, function (d, cb) {
        try {
          var h = d.requestHeaders || {};
          var hit = null;
          for (var k in h) { if (k.toLowerCase() === "accept-language") { hit = k; break; } }
          h[hit || "Accept-Language"] = IA;
          cb({ requestHeaders: h });
        } catch (e) { cb({}); }
      });
    } catch (e) {}

    try {
      wr.onBeforeRequest({ urls: ["*://gemini.google.com/*"] }, function (d, cb) {
        try {
          if (d.resourceType === "mainFrame" && !/[?&]hl=/i.test(d.url)) {
            var u = new URL(d.url);
            u.searchParams.set("hl", "zh-CN");
            return cb({ redirectURL: u.toString() });
          }
        } catch (e) {}
        cb({});
      });
    } catch (e) {}
  }

  try {
    app.on("session-created", hookSession);
    app.whenReady().then(function () {
      try { hookSession(electron.session.defaultSession); } catch (e) {}
    }).catch(function () {});
  } catch (e) {}

  /* ---- 3. 页面注入（debugger 通道；该版本 executeJavaScript 对视图不返回） ---- */
  var SRC_URL = "\n//# sourceURL=gemini-zhcn-page.js";

  function evaluate(wc, why) {
    try {
      if (!wc || wc.isDestroyed()) return;
      var u = "";
      try { u = wc.getURL(); } catch (e) { return; }
      if (!isGeminiUrl(u)) return;
      var d = wc.debugger;
      if (!d || !d.isAttached()) return;
      var code = pageCode();
      if (!code) return;
      var expr = "if (window.__zhcnInstalled !== true) {" + code + "\n}" + SRC_URL;
      d.sendCommand("Runtime.evaluate", {
        expression: expr,
        returnByValue: true,
        awaitPromise: false,
        userGesture: true,
      }).then(function (r) {
        dbg("eval ok (" + why + ") " + u + " => " + JSON.stringify((r && r.result && r.result.type) || null));
      }).catch(function (e) { dbg("eval fail (" + why + ") " + u + " : " + (e && e.message)); });
    } catch (e) { dbg("eval throw " + (e && e.message)); }
  }

  function harden(wc) {
    try {
      if (!wc || wc.isDestroyed() || wc.__zhcnHooked) return;
      wc.__zhcnHooked = true;
      var d = wc.debugger;
      if (!d) { dbg("no debugger api"); return; }
      if (!d.isAttached()) d.attach("1.3");
      dbg("debugger attached type=" + (wc.getType ? wc.getType() : "?"));
      d.on("detach", function () {
        dbg("debugger detached");
        try { wc.__zhcnHooked = false; } catch (e) {}
      });
      var code = pageCode();
      d.sendCommand("Page.enable")
        .then(function () {
          if (!code) return null;
          // 关键：新文档一建立就注入，抗 SPA 导航与刷新
          return d.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: code + SRC_URL });
        })
        .then(function (r) { dbg("registered " + JSON.stringify(r || null)); })
        .catch(function (e) { dbg("harden fail " + (e && e.message)); });
    } catch (e) { dbg("harden throw " + (e && e.message)); }
  }

  try {
    app.on("web-contents-created", function (_evt, wc) {
      dbg("wc-created");
      harden(wc);
      try {
        wc.on("dom-ready", function () { evaluate(wc, "dom-ready"); });
        wc.on("did-finish-load", function () { evaluate(wc, "finish"); });
        wc.on("did-navigate-in-page", function () { evaluate(wc, "in-page"); });
      } catch (e) {}
    });
  } catch (e) {}

  /* 低频巡检：页面被整体替换或 debugger 掉线时补注入 */
  try {
    var guard = setInterval(function () {
      var all;
      try { all = electron.webContents.getAllWebContents(); } catch (e) { return; }
      all.forEach(function (wc) {
        try {
          if (wc.isDestroyed()) return;
          if (!wc.__zhcnHooked || !wc.debugger || !wc.debugger.isAttached()) { harden(wc); return; }
          evaluate(wc, "tick");
        } catch (e) {}
      });
    }, 6000);
    if (guard.unref) guard.unref();
  } catch (e) {}

  /* ---- 4. 未命中文案回收（扩充词库用） ---- */
  function appendMiss(json) {
    try {
      fs.appendFileSync(path.join(app.getPath("userData"), "zhcn-missing.ndjson"), json + "\n");
    } catch (e) {}
  }
  try {
    if (ENV.GEMINI_ZH_HARVEST !== "0") {
      var timer = setInterval(function () {
        var all;
        try { all = electron.webContents.getAllWebContents(); } catch (e) { return; }
        all.forEach(function (wc) {
          try {
            if (wc.isDestroyed() || !wc.debugger || !wc.debugger.isAttached()) return;
            wc.debugger.sendCommand("Runtime.evaluate", {
              expression: "(function(){try{var m=window.__zhcnMiss;if(!m)return null;var o={};for(var k in m){o[k]=m[k]}window.__zhcnMiss={};return JSON.stringify(o)}catch(e){return null}})()",
              returnByValue: true,
            }).then(function (r) {
              var s = r && r.result && r.result.value;
              if (s && s !== "{}") appendMiss(s);
            }).catch(function () {});
          } catch (e) {}
        });
      }, 30000);
      if (timer.unref) timer.unref();
    }
  } catch (e) {}

  /* ---- 4b. 诊断快照（GEMINI_ZH_DUMP=1 时把页面文本写到 userData/zhcn-dump.txt） ---- */
  try {
    if (ENV.GEMINI_ZH_DUMP === "1") {
      var dumper = setInterval(function () {
        var all;
        try { all = electron.webContents.getAllWebContents(); } catch (e) { return; }
        all.forEach(function (wc) {
          try {
            if (wc.isDestroyed() || !wc.debugger || !wc.debugger.isAttached()) return;
            var u = wc.getURL();
            if (!isGeminiUrl(u)) return;
            wc.debugger.sendCommand("Runtime.evaluate", {
              expression: "JSON.stringify({u:location.href,inst:window.__zhcnInstalled===true,dict:window.__zhcn?window.__zhcn.dictSize:0,miss:window.__zhcnMiss?Object.keys(window.__zhcnMiss).slice(0,60):null,text:(document.body?document.body.innerText:'').replace(/\\n{2,}/g,'\\n').slice(0,2500)})",
              returnByValue: true,
            }).then(function (r) {
              var s = r && r.result && r.result.value;
              if (s) fs.writeFileSync(path.join(app.getPath("userData"), "zhcn-dump.txt"), s);
            }).catch(function () {});
          } catch (e) {}
        });
      }, 5000);
      if (dumper.unref) dumper.unref();
    }
  } catch (e) {}

  /* ---- 4c. 截图快照（GEMINI_ZH_SNAP=1 时存一张 page.png，用于验收/贴图） ---- */
  try {
    if (ENV.GEMINI_ZH_SNAP === "1") {
      var snapped = false;
      var snapper = setInterval(function () {
        if (snapped) return;
        var all;
        try { all = electron.webContents.getAllWebContents(); } catch (e) { return; }
        all.forEach(function (wc) {
          try {
            if (snapped || wc.isDestroyed() || !wc.debugger || !wc.debugger.isAttached()) return;
            if (!isGeminiUrl(wc.getURL())) return;
            wc.debugger.sendCommand("Page.enable")
              .then(function () {
                return wc.debugger.sendCommand("Runtime.evaluate", {
                  expression: "window.__zhcnInstalled===true && (document.body?document.body.innerText.length:0) > 250",
                  returnByValue: true,
                });
              })
              .then(function (gate) {
                if (!gate || !gate.result || gate.result.value !== true) return null;
                return wc.debugger.sendCommand("Page.captureScreenshot", { format: "png" });
              })
              .then(function (r) {
                if (!r || !r.data) return;
                fs.writeFileSync(path.join(app.getPath("userData"), "zhcn-shot.png"), Buffer.from(r.data, "base64"));
                snapped = true;
              })
              .catch(function () {});
          } catch (e) {}
        });
      }, 4000);
      if (snapper.unref) snapper.unref();
    }
  } catch (e) {}

  /* ---- 5. 版本标记（供工具自检） ---- */
  try { global.__GEMINI_ZHCN__ = VERSION; } catch (e) {}
})();