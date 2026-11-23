/* Gemini Windows 客户端汉化层 (gemini-zhcn) — 页面注入脚本
 * 运行在 gemini.google.com 主世界：字典精确替换 + 正则规则 + MutationObserver 增量翻译。
 */
(function () {
  "use strict";
  if (window.__zhcnInstalled) return;
  window.__zhcnInstalled = true;

  var DICT = /*__ZHC_DICT__*/ {};
  var RULES = /*__ZHC_RULES__*/ [];
  var VERSION = "__ZHC_VERSION__";

  try { document.documentElement.setAttribute("lang", "zh-CN"); } catch (e) {}

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1,
    KBD: 1, SAMP: 1, SVG: 1, CANVAS: 1, IFRAME: 1, VIDEO: 1, AUDIO: 1, MATH: 1
  };
  var SKIP_SEL =
    "user-query,model-response,rich-textarea,code-block,message-content,.query-text," +
    ".model-response-text,.markdown,pre,code,[contenteditable=''],[contenteditable='true']," +
    "[contenteditable='plaintext-only'],[data-zhcn-skip],.cdk-visually-hidden," +
    ".material-icons,.material-icons-extended,.material-symbols-outlined,.google-symbols," +
    "[class*='material-symbols'],[class*='material-icons'],.gds-icon,mat-icon";

  var ATTRS = ["placeholder", "aria-label", "title", "alt", "data-tooltip", "label", "value"];

  function blocked(el) {
    var n = 0;
    while (el && el.nodeType === 1 && n++ < 40) {
      if (SKIP_TAGS[el.tagName]) return true;
      if (el.hasAttribute && (el.hasAttribute("contenteditable") || el.hasAttribute("data-zhcn-skip"))) return true;
      el = el.parentElement;
    }
    if (el && el.nodeType === 1) {
      try { if (el.closest && el.closest(SKIP_SEL)) return true; } catch (e) {}
    }
    return false;
  }

  var miss = (window.__zhcnMiss = window.__zhcnMiss || {});
  function record(s) {
    if (!s) return;
    s = s.trim();
    if (s.length < 2 || s.length > 90) return;
    if (!/[A-Za-z]{2}/.test(s)) return;
    if (/[\u4e00-\u9fff]/.test(s)) return;
    if (/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(s)) return;      // 邮箱
    if (/^[a-z0-9_]+$/.test(s)) return;                          // 单个标识符/图标名
    if (/^[\x20-\x7e\u00a0-\u024f]+$/.test(s) === false) return;
    if (miss[s] === undefined) {
      if (Object.keys(miss).length > 400) return;
      miss[s] = 0;
    }
    miss[s]++;
  }

  function lookup(t) {
    if (Object.prototype.hasOwnProperty.call(DICT, t)) return DICT[t];
    var low = t.toLowerCase();
    if (low !== t && Object.prototype.hasOwnProperty.call(DICT, low)) return DICT[low];
    for (var i = 0; i < RULES.length; i++) {
      var m = t.match(RULES[i][0]);
      if (m) return typeof RULES[i][1] === "function" ? RULES[i][1](m) : t.replace(RULES[i][0], RULES[i][1]);
    }
    return null;
  }

  /** 返回替换后的完整字符串；无命中返回 null */
  function translate(raw) {
    if (!raw) return null;
    if (!/[A-Za-z]/.test(raw)) return null;
    var lead = raw.match(/^\s*/)[0];
    var tail = raw.match(/\s*$/)[0];
    var core = raw.trim();
    if (!core) return null;
    if (/[\u4e00-\u9fff]/.test(core)) return null;
    var hit = lookup(core);
    if (hit === null) { record(core); return null; }
    return lead + hit + tail;
  }

  function doText(node) {
    if (!node || node.nodeType !== 3) return;
    var parent = node.parentElement;
    if (!parent || blocked(parent)) return;
    var out = translate(node.nodeValue);
    if (out !== null && out !== node.nodeValue) node.nodeValue = out;
  }

  function doAttrs(el) {
    if (!el || el.nodeType !== 1 || blocked(el)) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      var v = el.getAttribute(a);
      var out = translate(v);
      if (out !== null && out !== v) {
        try { el.setAttribute(a, out); } catch (e) {}
      }
    }
  }

  var queue = [];
  var queued = new Set();
  var scheduled = false;

  function push(fn) { queue.push(fn); schedule(); }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    var run = function () {
      scheduled = false;
      var batch = queue;
      queue = [];
      for (var i = 0; i < batch.length; i++) {
        try { batch[i](); } catch (e) {}
      }
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  var MAX_NODES = 4000;

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    doAttrs(root);
    if (blocked(root)) return;
    var walker;
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    } catch (e) { return; }
    var count = 0, n = walker.currentNode;
    while (n && count++ < MAX_NODES) {
      if (n.nodeType === 3) doText(n);
      else if (n.nodeType === 1) doAttrs(n);
      n = walker.nextNode();
    }
  }

  function scanAll() {
    walk(document.body);
    try { doAttrs(document.documentElement); } catch (e) {}
  }

  var mo = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === "characterData") {
        var t = r.target;
        if (queued.has(t)) continue;
        queued.add(t);
        push(function (node) { return function () { queued.delete(node); doText(node); }; }(t));
      } else if (r.type === "attributes") {
        var el = r.target;
        push(function (node) { return function () { doAttrs(node); }; }(el));
      } else if (r.type === "childList") {
        for (var j = 0; j < r.addedNodes.length; j++) {
          var a = r.addedNodes[j];
          push(function (node) { return function () { walk(node); }; }(a));
        }
      }
    }
  });

  function start() {
    scanAll();
    try {
      mo.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ATTRS
      });
    } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  /* 页面视图切换后再扫一次，兜底虚拟列表 */
  try {
    var reseed = function () { push(scanAll); };
    window.addEventListener("hashchange", reseed);
    window.addEventListener("popstate", reseed);
    setInterval(function () { if (document.visibilityState === "visible") reseed(); }, 8000);
  } catch (e) {}

  window.__zhcn = {
    version: VERSION,
    translate: translate,
    scan: scanAll,
    dictSize: Object.keys(DICT).length,
    dumpMiss: function () { return JSON.stringify(miss); }
  };
})();