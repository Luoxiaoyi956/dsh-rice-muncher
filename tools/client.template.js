/**
 * dsh-rice-muncher · 浏览器半侧
 *
 * 1. 在「深度求索中，用时 N 秒 ···」这一行的末尾挂一个循环播放的小动画；
 * 2. 在「设置」左侧导航注册一个「边吃边想」页，可选动画 / 大小 / 节奏，改完立刻生效。
 *
 * 纯 DOM + CSS，不联网、不读对话内容。设置存在浏览器 localStorage。
 * 构建时由 tools/build.mjs 替换 __XXX__ 占位符。
 */
window.__ModuleLoader__.load({
  id: "dsh-rice-muncher",
  factory: (require) => {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;

    // ---------- 动画素材表（以后加新动画就往这里加一项） ----------
    var VARIANTS = {
      whale: {
        label: "鲸鱼娘吃饭",
        note: "抱着一大碗米饭，一勺一勺吃",
        frames: __FRAME_COUNT__,
        sprite: "__SPRITE_BASE64__",
        size: __FRAME_SIZE__,
        ms: __FRAME_MS__,
      },
    };

    var STORAGE_KEY = "dsh-rice-muncher:settings:v1";
    var SIZES = [32, 40, 48, 56, 64];
    var SPEEDS = [
      { id: "slow", label: "慢", note: "0.09 秒/帧", factor: 1.35 },
      { id: "normal", label: "正常", note: "原速", factor: 1 },
      { id: "fast", label: "快", note: "0.05 秒/帧", factor: 0.72 },
    ];
    var DEFAULT_SETTINGS = { variant: "whale", size: 48, speed: "normal" };

    var MARK = "data-dsh-rice-muncher";
    var STYLE_ID = "dsh-rice-muncher-style";
    var ROW_SELECTOR = "[data-chat-running]";

    // ---------- 设置 ----------
    function defaults() {
      var out = {};
      for (var key in DEFAULT_SETTINGS) out[key] = DEFAULT_SETTINGS[key];
      return out;
    }

    function readSettings() {
      var out = defaults();
      try {
        var raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return out;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return out;
        if (typeof parsed.variant === "string" && VARIANTS[parsed.variant]) out.variant = parsed.variant;
        if (SIZES.indexOf(parsed.size) >= 0) out.size = parsed.size;
        for (var i = 0; i < SPEEDS.length; i++) if (SPEEDS[i].id === parsed.speed) out.speed = parsed.speed;
      } catch (error) {
        /* 隐私模式或存储被禁：用默认值，不吵人 */
      }
      return out;
    }

    function writeSettings(next) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (error) {
        /* 存不下就算了，本次会话内仍然生效 */
      }
    }

    var listeners = [];

    function emit() {
      for (var i = 0; i < listeners.length; i++) {
        try {
          listeners[i]();
        } catch (error) {
          /* 单个订阅者出错不该拖垮别人 */
        }
      }
    }

    function onChange(fn) {
      listeners.push(fn);
      return function off() {
        listeners = listeners.filter(function (item) {
          return item !== fn;
        });
      };
    }

    // ---------- 把设置落到一个动画元素上 ----------
    function variantOf(settings) {
      return VARIANTS[settings.variant] || VARIANTS.whale;
    }

    function frameMs(settings, variant) {
      for (var i = 0; i < SPEEDS.length; i++) {
        if (SPEEDS[i].id === settings.speed) return Math.round(variant.ms * SPEEDS[i].factor);
      }
      return variant.ms;
    }

    function applyToNode(node, settings) {
      var variant = variantOf(settings);
      var strip = variant.frames * settings.size;
      node.style.setProperty("--rb-frames", String(variant.frames));
      node.style.setProperty("--rb-strip", strip + "px");
      node.style.backgroundImage = 'url("' + variant.sprite + '")';
      node.style.width = settings.size + "px";
      node.style.height = settings.size + "px";
      node.style.backgroundSize = strip + "px " + settings.size + "px";
      node.style.animationDuration = variant.frames * frameMs(settings, variant) + "ms";
    }

    // ---------- 样式 ----------
    function buildCss() {
      return (
        ".dsh-rice-muncher{" +
        "display:inline-block;flex:0 0 auto;margin-left:4px;vertical-align:middle;" +
        "background-repeat:no-repeat;background-position:0 0;" +
        "image-rendering:__RENDER__;pointer-events:none;user-select:none;" +
        "animation-name:dsh-rice-muncher-cycle;animation-timing-function:steps(var(--rb-frames));" +
        "animation-iteration-count:infinite;" +
        "}" +
        "@keyframes dsh-rice-muncher-cycle{from{background-position:0 0}to{background-position:calc(-1 * var(--rb-strip)) 0}}" +
        "@media (prefers-reduced-motion:reduce){.dsh-rice-muncher{animation:none !important;background-position:0 0 !important}}" +
        // 设置页
        ".dsh-rb-panel{display:flex;flex-direction:column;gap:22px;max-width:640px;padding:4px 2px 28px}" +
        ".dsh-rb-panel h2{font-size:15px;font-weight:600;margin:0}" +
        ".dsh-rb-lead{font-size:12.5px;line-height:1.75;color:var(--dsw-alias-label-tertiary);margin:0}" +
        ".dsh-rb-sec{display:flex;flex-direction:column;gap:10px}" +
        ".dsh-rb-h{font-size:12px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary)}" +
        ".dsh-rb-opts{display:flex;flex-wrap:wrap;gap:8px}" +
        ".dsh-rb-opt{display:flex;flex-direction:column;gap:2px;align-items:flex-start;text-align:left;" +
        "padding:9px 13px;border-radius:10px;cursor:pointer;font:inherit;font-size:13px;" +
        "border:1px solid var(--dsw-alias-border-l3);background:transparent;color:inherit}" +
        ".dsh-rb-opt:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
        ".dsh-rb-opt[data-on]{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
        ".dsh-rb-opt:disabled{opacity:.45;cursor:default}" +
        ".dsh-rb-opt small{font-size:11px;color:var(--dsw-alias-label-tertiary)}" +
        ".dsh-rb-preview{display:flex;align-items:center;gap:8px;padding:16px 18px;border-radius:12px;" +
        "background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:13px}" +
        ".dsh-rb-dot{width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-deep-diving);opacity:.5;flex:none}" +
        ".dsh-rb-text{color:var(--dsw-alias-label-deep-diving);font-variant-numeric:tabular-nums}" +
        ".dsh-rb-note{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin:0}"
      );
    }

    function installStyle() {
      var existing = document.getElementById(STYLE_ID);
      if (existing) existing.remove();
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = buildCss();
      document.head.appendChild(style);
      return style;
    }

    // ---------- 挂到「运行中」那一行 ----------
    function mount() {
      if (typeof document === "undefined") return;
      var row = document.querySelector(ROW_SELECTOR);
      if (!row) return;
      if (row.querySelector("[" + MARK + "]")) return;
      var host = row.lastElementChild || row;
      var node = document.createElement("span");
      node.className = "dsh-rice-muncher";
      node.setAttribute(MARK, "");
      node.setAttribute("aria-hidden", "true");
      applyToNode(node, readSettings());
      host.appendChild(node);
    }

    function refreshMounted() {
      var settings = readSettings();
      var nodes = document.querySelectorAll("[" + MARK + "]");
      for (var i = 0; i < nodes.length; i++) applyToNode(nodes[i], settings);
    }

    function startWatching() {
      var style = installStyle();
      var throttle = 0;
      var observer = null;
      var backstop = null;

      function soon() {
        if (throttle !== 0) return;
        throttle = window.setTimeout(function () {
          throttle = 0;
          mount();
        }, 150);
      }

      mount();
      if (typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(soon);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      backstop = window.setInterval(mount, 2000);
      var off = onChange(refreshMounted);

      return function stop() {
        off();
        if (throttle !== 0) window.clearTimeout(throttle);
        if (backstop !== null) window.clearInterval(backstop);
        if (observer !== null) observer.disconnect();
        style.remove();
        var injected = document.querySelectorAll("[" + MARK + "]");
        for (var i = 0; i < injected.length; i++) injected[i].remove();
      };
    }

    // ---------- 设置页 ----------
    function buildPanel(React) {
      var h = React.createElement;

      function Mascot(props) {
        var ref = React.useRef(null);
        var settings = props.settings;
        React.useEffect(
          function () {
            if (ref.current) applyToNode(ref.current, settings);
          },
          [settings.variant, settings.size, settings.speed],
        );
        return h("span", { ref: ref, className: "dsh-rice-muncher", "aria-hidden": "true" });
      }

      return function Panel() {
        var pair = React.useState(readSettings());
        var settings = pair[0];
        var setSettings = pair[1];

        React.useEffect(
          function () {
            return onChange(function () {
              setSettings(readSettings());
            });
          },
          [],
        );

        function update(patch) {
          var next = {};
          for (var key in settings) next[key] = settings[key];
          for (var key2 in patch) next[key2] = patch[key2];
          writeSettings(next);
          setSettings(next);
          emit();
        }

        var variant = variantOf(settings);
        var ids = Object.keys(VARIANTS);

        return h(
          "div",
          { className: "dsh-rb-panel" },
          h("h2", null, "边吃边想"),
          h(
            "p",
            { className: "dsh-rb-lead" },
            "等回复的时候，在「深度求索中，用时 N 秒 ···」那一行末尾挂一个循环播放的小动画。改完立刻生效，不用重启。",
          ),
          h(
            "div",
            { className: "dsh-rb-sec" },
            h("div", { className: "dsh-rb-h" }, "动画"),
            h(
              "div",
              { className: "dsh-rb-opts" },
              ids.map(function (id) {
                var item = VARIANTS[id];
                return h(
                  "button",
                  {
                    key: id,
                    className: "dsh-rb-opt",
                    "data-on": settings.variant === id ? "" : undefined,
                    onClick: function () {
                      update({ variant: id });
                    },
                  },
                  item.label,
                  h("small", null, item.note),
                );
              }),
              h(
                "button",
                { className: "dsh-rb-opt", disabled: true },
                "更多动画",
                h("small", null, "还没做，等素材"),
              ),
            ),
          ),
          h(
            "div",
            { className: "dsh-rb-sec" },
            h("div", { className: "dsh-rb-h" }, "大小"),
            h(
              "div",
              { className: "dsh-rb-opts" },
              SIZES.map(function (size) {
                return h(
                  "button",
                  {
                    key: size,
                    className: "dsh-rb-opt",
                    "data-on": settings.size === size ? "" : undefined,
                    onClick: function () {
                      update({ size: size });
                    },
                  },
                  size + "px",
                );
              }),
            ),
          ),
          h(
            "div",
            { className: "dsh-rb-sec" },
            h("div", { className: "dsh-rb-h" }, "节奏"),
            h(
              "div",
              { className: "dsh-rb-opts" },
              SPEEDS.map(function (speed) {
                return h(
                  "button",
                  {
                    key: speed.id,
                    className: "dsh-rb-opt",
                    "data-on": settings.speed === speed.id ? "" : undefined,
                    onClick: function () {
                      update({ speed: speed.id });
                    },
                  },
                  speed.label,
                  h("small", null, speed.note),
                );
              }),
            ),
            h(
              "p",
              { className: "dsh-rb-note" },
              "当前一轮 " + ((variant.frames * frameMs(settings, variant)) / 1000).toFixed(2) + " 秒",
            ),
          ),
          h(
            "div",
            { className: "dsh-rb-sec" },
            h("div", { className: "dsh-rb-h" }, "预览"),
            h(
              "div",
              { className: "dsh-rb-preview" },
              h("span", { className: "dsh-rb-dot" }),
              h("span", { className: "dsh-rb-text" }, "深度求索中，用时 12秒 ···"),
              h(Mascot, { settings: settings }),
            ),
            h("p", { className: "dsh-rb-note" }, "设置存在这台机器的浏览器里（localStorage），不联网。"),
          ),
        );
      };
    }

    // ---------- 插件入口 ----------
    var inject = ["slots"];

    function apply(ctx) {
      if (typeof document === "undefined" || typeof window === "undefined") return;

      ctx.effect(function () {
        return startWatching();
      }, "dsh-rice-muncher: 运行状态动画");

      // 设置页是可选的：拿不到 slots 或 React 就跳过，别把动画一起拖垮
      var slots = (typeof ctx.get === "function" ? ctx.get("slots") : undefined) || ctx.slots;
      if (!slots) return;
      var React = null;
      try {
        React = require("react");
      } catch (error) {
        React = null;
      }
      if (!React || typeof React.createElement !== "function") return;
      var Panel = buildPanel(React);
      ctx.effect(function () {
        return slots.inject("settings.section", function () {
          return slots.register(
            { name: "settings.section", id: "rice-bowl", order: 36, label: "边吃边想" },
            function () {
              return React.createElement(Panel);
            },
          );
        });
      }, "dsh-rice-muncher: 设置页");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
