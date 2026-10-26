/**
 * dsh-rice-muncher · 浏览器半侧
 *
 * 两个动画，互斥显示：
 *   · 思考中 ——「深度求索中，用时 N 秒 ···」那一行末尾
 *   · 待机   ——「用量」药丸后面（回复完成后、下一个问题开始前）
 *
 * 外加「设置」左侧导航里的一页：大小 / 节奏 / 待机开关，改完立刻生效。
 * 纯 DOM + CSS，不联网、不读对话内容。设置存在浏览器 localStorage。
 * 构建时由 tools/build.mjs 把占位符替换成素材。
 */
window.__ModuleLoader__.load({
  id: "dsh-rice-muncher",
  factory: (require) => {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;

    // ---------- 两套动画素材 ----------
    var SPRITES = {
      run: {
        label: "思考中 · 干饭",
        note: "一勺一勺吃白米饭",
        frames: __FRAME_COUNT__,
        sprite: "__SPRITE_BASE64__",
        size: __FRAME_SIZE__,
        ms: __FRAME_MS__,
      },
      idle: {
        label: "待机 · 撑地晃脚",
        note: "等你问下一句",
        frames: __IDLE_FRAME_COUNT__,
        sprite: "__IDLE_SPRITE_BASE64__",
        size: __IDLE_FRAME_SIZE__,
        ms: __IDLE_FRAME_MS__,
      },
    };

    var STORAGE_KEY = "dsh-rice-muncher:settings:v1";
    var SIZES = [32, 40, 48, 56, 64];
    var SPEEDS = [
      { id: "slow", label: "慢", factor: 1.35 },
      { id: "normal", label: "正常", factor: 1 },
      { id: "fast", label: "快", factor: 0.72 },
    ];
    var DEFAULT_SETTINGS = { size: 48, speed: "normal", showIdle: true };

    var MARK = "data-dsh-rice-muncher";
    var STYLE_ID = "dsh-rice-muncher-style";
    var ROW_SELECTOR = "[data-chat-running]";
    // 每条回答底部那行：复制/点赞/用量/时间戳。clock="end" 表示时间戳在右端。
    var FOOTER_SELECTOR = '[data-turn-tail] [data-clock="end"]';
    var CLASS = "dsh-rice-muncher";

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
        if (SIZES.indexOf(parsed.size) >= 0) out.size = parsed.size;
        for (var i = 0; i < SPEEDS.length; i++) if (SPEEDS[i].id === parsed.speed) out.speed = parsed.speed;
        if (typeof parsed.showIdle === "boolean") out.showIdle = parsed.showIdle;
      } catch (error) {
        /* 隐私模式或存储被禁：用默认值 */
      }
      return out;
    }

    function writeSettings(next) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (error) {
        /* 存不下就在本次会话内生效 */
      }
    }

    var listeners = [];

    function emit() {
      for (var i = 0; i < listeners.length; i++) {
        try {
          listeners[i]();
        } catch (error) {
          /* 单个订阅者出错别拖垮别人 */
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

    // ---------- 把设置落到元素上 ----------
    function frameMs(settings, sprite) {
      for (var i = 0; i < SPEEDS.length; i++) {
        if (SPEEDS[i].id === settings.speed) return Math.round(sprite.ms * SPEEDS[i].factor);
      }
      return sprite.ms;
    }

    function applyToNode(node, sprite, settings) {
      var strip = sprite.frames * settings.size;
      node.style.setProperty("--rb-frames", String(sprite.frames));
      node.style.setProperty("--rb-strip", strip + "px");
      node.style.backgroundImage = 'url("' + sprite.sprite + '")';
      node.style.width = settings.size + "px";
      node.style.height = settings.size + "px";
      node.style.backgroundSize = strip + "px " + settings.size + "px";
      node.style.animationDuration = sprite.frames * frameMs(settings, sprite) + "ms";
      node.setAttribute(MARK, sprite === SPRITES.idle ? "idle" : "run");
    }

    function createSpriteNode(sprite, settings) {
      var node = document.createElement("span");
      node.className = CLASS;
      node.setAttribute("aria-hidden", "true");
      applyToNode(node, sprite, settings);
      return node;
    }

    // ---------- 样式 ----------
    function buildCss() {
      return (
        "." + CLASS + "{" +
        "display:inline-block;flex:0 0 auto;margin-left:4px;vertical-align:middle;" +
        "background-repeat:no-repeat;background-position:0 0;" +
        "image-rendering:__RENDER__;pointer-events:none;user-select:none;" +
        "animation-name:dsh-rice-muncher-cycle;animation-timing-function:steps(var(--rb-frames));" +
        "animation-iteration-count:infinite;" +
        "}" +
        "@keyframes dsh-rice-muncher-cycle{from{background-position:0 0}to{background-position:calc(-1 * var(--rb-strip)) 0}}" +
        "@media (prefers-reduced-motion:reduce){." + CLASS + "{animation:none !important;background-position:0 0 !important}}" +
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
        "background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:13px;margin-bottom:8px}" +
        ".dsh-rb-dot{width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-deep-diving);opacity:.5;flex:none}" +
        ".dsh-rb-text{color:var(--dsw-alias-label-deep-diving);font-variant-numeric:tabular-nums}" +
        ".dsh-rb-chip{font-size:12px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l3);" +
        "border-radius:999px;padding:1px 8px}" +
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

    // ---------- 挂载 ----------
    function removeAll(kind) {
      var selector = kind ? "[" + MARK + '="' + kind + '"]' : "[" + MARK + "]";
      var nodes = document.querySelectorAll(selector);
      for (var i = 0; i < nodes.length; i++) nodes[i].remove();
    }

    /** 思考中：塞进「运行中」那一行的文字后面。 */
    function mountRun(settings) {
      var row = document.querySelector(ROW_SELECTOR);
      if (!row) {
        removeAll("run");
        return;
      }
      if (row.querySelector("[" + MARK + '="run"]')) return;
      var host = row.lastElementChild || row;
      host.appendChild(createSpriteNode(SPRITES.run, settings));
    }

    /** 待机：接在最新一条回答的底部那行末尾（时间戳后面）。 */
    function mountIdle(settings) {
      if (!settings.showIdle) {
        removeAll("idle");
        return;
      }
      var footers = document.querySelectorAll(FOOTER_SELECTOR);
      if (footers.length === 0) {
        removeAll("idle");
        return;
      }
      // 只挂在最新那一轮上，历史上滚掉的回答不再挂
      var target = footers[footers.length - 1];
      var existing = document.querySelector("[" + MARK + '="idle"]');
      if (existing) {
        if (existing.parentNode !== target) target.appendChild(existing);
        else if (target.lastElementChild !== existing) target.appendChild(existing);
        return;
      }
      target.appendChild(createSpriteNode(SPRITES.idle, settings));
    }

    /** 两个状态互斥：思考中只显示干饭，其余时间只显示待机。 */
    function sync() {
      var settings = readSettings();
      if (document.querySelector(ROW_SELECTOR)) {
        removeAll("idle");
        mountRun(settings);
      } else {
        removeAll("run");
        mountIdle(settings);
      }
    }

    function refreshMounted() {
      var settings = readSettings();
      var nodes = document.querySelectorAll("[" + MARK + "]");
      for (var i = 0; i < nodes.length; i++) {
        var kind = nodes[i].getAttribute(MARK);
        applyToNode(nodes[i], kind === "idle" ? SPRITES.idle : SPRITES.run, settings);
      }
      sync();
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
          sync();
        }, 150);
      }

      sync();
      if (typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(soon);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      backstop = window.setInterval(sync, 2000);
      var off = onChange(refreshMounted);

      return function stop() {
        off();
        if (throttle !== 0) window.clearTimeout(throttle);
        if (backstop !== null) window.clearInterval(backstop);
        if (observer !== null) observer.disconnect();
        style.remove();
        removeAll();
      };
    }

    // ---------- 设置页 ----------
    function buildPanel(React) {
      var h = React.createElement;

      function Sprite(props) {
        var ref = React.useRef(null);
        var sprite = props.sprite;
        var settings = props.settings;
        React.useEffect(
          function () {
            if (ref.current) applyToNode(ref.current, sprite, settings);
          },
          [settings.size, settings.speed],
        );
        return h("span", { ref: ref, className: CLASS, "aria-hidden": "true" });
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

        return h(
          "div",
          { className: "dsh-rb-panel" },
          h("h2", null, "边吃边想"),
          h(
            "p",
            { className: "dsh-rb-lead" },
            "两个动画，互斥显示：思考时在「深度求索中」那一行末尾干饭，回复完了在回答底部那行的时间戳后面撑地晃脚等你。改完立刻生效，不用重启。",
          ),
          h(
            "div",
            { className: "dsh-rb-sec" },
            h("div", { className: "dsh-rb-h" }, "待机动画"),
            h(
              "div",
              { className: "dsh-rb-opts" },
              h(
                "button",
                {
                  className: "dsh-rb-opt",
                  "data-on": settings.showIdle ? "" : undefined,
                  onClick: function () {
                    update({ showIdle: true });
                  },
                },
                "显示",
                h("small", null, "回复完成后、下一个问题前"),
              ),
              h(
                "button",
                {
                  className: "dsh-rb-opt",
                  "data-on": settings.showIdle ? undefined : "",
                  onClick: function () {
                    update({ showIdle: false });
                  },
                },
                "不显示",
                h("small", null, "只在思考时出现"),
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
                );
              }),
            ),
            h(
              "p",
              { className: "dsh-rb-note" },
              "干饭一轮 " +
                ((SPRITES.run.frames * frameMs(settings, SPRITES.run)) / 1000).toFixed(2) +
                " 秒 · 待机一轮 " +
                ((SPRITES.idle.frames * frameMs(settings, SPRITES.idle)) / 1000).toFixed(2) +
                " 秒",
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
              h(Sprite, { sprite: SPRITES.run, settings: settings }),
            ),
            h(
              "div",
              { className: "dsh-rb-preview" },
              h("span", { className: "dsh-rb-chip" }, "用量 12.4K"),
              h("span", { className: "dsh-rb-chip" }, "18:27"),
              settings.showIdle ? h(Sprite, { sprite: SPRITES.idle, settings: settings }) : null,
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
      }, "dsh-rice-muncher: 状态动画");

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
            { name: "settings.section", id: "rice-muncher", order: 36, label: "边吃边想" },
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
