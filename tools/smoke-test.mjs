// 极简假 DOM + 冒烟测试：状态互斥（待机 ↔ 思考）、自愈、卸载清理、设置页注册。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CODE = readFileSync(join(ROOT, "lib", "client.js"), "utf8");
const MARK = "data-dsh-rice-muncher";

// ---------- 假 DOM ----------
function matchesPart(el, part) {
  if (part.startsWith("#")) return el.attributes.get("id") === part.slice(1);
  if (part.startsWith("[") && part.endsWith("]")) {
    const body = part.slice(1, -1);
    const eq = body.indexOf("=");
    if (eq < 0) return el.attributes.has(body);
    const name = body.slice(0, eq);
    const value = body.slice(eq + 1).replace(/^["']|["']$/g, "");
    return el.attributes.get(name) === value;
  }
  return el.tagName === part;
}

/** 支持简单的后代组合（"A B"），够这个插件用。 */
function matches(el, selector) {
  const parts = selector.trim().split(/\s+/);
  if (!matchesPart(el, parts[parts.length - 1])) return false;
  let node = el.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (node && !matchesPart(node, parts[i])) node = node.parentNode;
    if (!node) return false;
    node = node.parentNode;
  }
  return true;
}

function makeStyle() {
  const props = new Map();
  return {
    setProperty: (name, value) => props.set(name, value),
    getPropertyValue: (name) => props.get(name) ?? "",
  };
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.style = makeStyle();
    this.className = "";
    this.textContent = "";
  }
  get id() {
    return this.attributes.get("id") ?? "";
  }
  set id(value) {
    this.attributes.set("id", value);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  appendChild(child) {
    if (child.parentNode) child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }
  get lastElementChild() {
    return this.children.length ? this.children[this.children.length - 1] : null;
  }
  *walk() {
    for (const child of this.children) {
      yield child;
      yield* child.walk();
    }
  }
  querySelector(selector) {
    for (const el of this.walk()) if (matches(el, selector)) return el;
    return null;
  }
  querySelectorAll(selector) {
    return [...this.walk()].filter((el) => matches(el, selector));
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement("html");
    this.head = new FakeElement("head");
    this.body = new FakeElement("body");
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag) {
    return new FakeElement(tag);
  }
  getElementById(id) {
    for (const el of this.documentElement.walk()) if (el.id === id) return el;
    return null;
  }
  querySelector(selector) {
    return this.documentElement.querySelector(selector);
  }
  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    FakeMutationObserver.instances.push(this);
  }
  observe() {}
  disconnect() {
    FakeMutationObserver.instances = FakeMutationObserver.instances.filter((o) => o !== this);
  }
  static trigger() {
    for (const instance of [...FakeMutationObserver.instances]) instance.callback([]);
  }
}
FakeMutationObserver.instances = [];

function fakeReact() {
  const hooks = [];
  let cursor = 0;
  return {
    createElement(type, props, ...children) {
      return { type, props: { ...(props || {}), children } };
    },
    useState(initial) {
      const index = cursor++;
      if (hooks[index] === undefined) hooks[index] = initial;
      return [
        hooks[index],
        (next) => {
          hooks[index] = typeof next === "function" ? next(hooks[index]) : next;
        },
      ];
    },
    useEffect() {},
    useRef(initial) {
      const index = cursor++;
      if (hooks[index] === undefined) hooks[index] = { current: initial ?? null };
      return hooks[index];
    },
    __resetHooks() {
      cursor = 0;
    },
  };
}

function makeHarness({ withSlots, settings } = {}) {
  const document = new FakeDocument();
  const storage = new Map();
  if (settings) storage.set("dsh-rice-muncher:settings:v1", JSON.stringify(settings));
  const window = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
  };
  const registrations = [];
  const react = fakeReact();
  const sandbox = {
    window,
    document,
    MutationObserver: FakeMutationObserver,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  window.document = document;
  window.MutationObserver = FakeMutationObserver;
  window.__ModuleLoader__ = {
    load(registration) {
      sandbox.__registration = registration;
    },
  };
  sandbox.window = window;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(CODE, sandbox, { filename: "lib/client.js" });

  const mod = sandbox.__registration.factory((specifier) => {
    if (specifier === "react") return react;
    throw new Error(`不认识的模块请求: ${specifier}`);
  });

  const slots = withSlots
    ? {
        inject(name, fn) {
          registrations.push({ name, kind: "inject" });
          return fn();
        },
        register(options, component) {
          registrations.push({ name: options.name, options, component });
          return () => {};
        },
      }
    : undefined;

  const disposers = [];
  const ctx = {
    get: (name) => (name === "slots" ? slots : undefined),
    slots,
    effect(fn) {
      disposers.push(fn());
    },
  };
  return { document, mod, ctx, disposers, registrations, react, storage };
}

/** 每条回答底部那行：动作按钮 + 用量 + 时间戳。 */
function makeFooter(document) {
  const tail = document.createElement("div");
  tail.setAttribute("data-turn-tail", "1");
  const actions = tail.appendChild(document.createElement("div"));
  actions.setAttribute("data-clock", "end");
  actions.appendChild(document.createElement("span")).textContent = "用量 28.3M tok";
  actions.appendChild(document.createElement("span")).textContent = "18:27";
  document.body.appendChild(tail);
  return { tail, actions };
}

/** 思考中那一行。 */
function makeRunningRow(document) {
  const row = document.createElement("div");
  row.setAttribute("data-chat-running", "");
  const hidden = row.appendChild(document.createElement("span"));
  hidden.setAttribute("role", "status");
  const content = row.appendChild(document.createElement("span"));
  const icon = content.appendChild(document.createElement("span"));
  icon.setAttribute("aria-hidden", "true");
  const label = content.appendChild(document.createElement("span"));
  label.textContent = "深度求索中，用时 3秒 ···";
  document.body.appendChild(row);
  return { row, content, icon };
}

const checks = [];
const check = (name, ok) => checks.push({ name, ok });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 场景一：待机 ↔ 思考 互斥 ----------
{
  const h = makeHarness();
  const { tail, actions } = makeFooter(h.document);
  h.mod.apply(h.ctx);

  check("样式已注入", h.document.getElementById("dsh-rice-muncher-style") !== null);
  const idle = h.document.querySelector(`[${MARK}="idle"]`);
  check("空闲时有待机动画", idle !== null);
  check("待机挂在回答底部那行", idle !== null && idle.parentNode === actions);
  check("待机在时间戳后面（行末）", idle !== null && actions.lastElementChild === idle);
  check("待机默认 48px", idle !== null && idle.style.getPropertyValue("--rb-strip") === `${49 * 48}px`);

  const { row, content } = makeRunningRow(h.document);
  FakeMutationObserver.trigger();
  await wait(300);
  check("思考时待机消失", h.document.querySelector(`[${MARK}="idle"]`) === null);
  const run = content.querySelector(`[${MARK}="run"]`);
  check("思考时干饭挂在文字后", run !== null && content.lastElementChild === run);

  row.remove();
  FakeMutationObserver.trigger();
  await wait(300);
  check("思考结束后干饭消失", h.document.querySelector(`[${MARK}="run"]`) === null);
  const idleAgain = h.document.querySelector(`[${MARK}="idle"]`);
  check("思考结束后待机回来", idleAgain !== null && idleAgain.parentNode === actions);

  // 观察者失效时靠定时兜底：整行重建
  FakeMutationObserver.instances.length = 0;
  actions.remove();
  const fresh = h.document.createElement("div");
  fresh.setAttribute("data-clock", "end");
  fresh.appendChild(h.document.createElement("span")).textContent = "18:31";
  tail.appendChild(fresh);
  await wait(2300);
  const healed = h.document.querySelector(`[${MARK}="idle"]`);
  check("行重建后待机补回来", healed !== null && healed.parentNode === fresh && fresh.lastElementChild === healed);

  for (const dispose of h.disposers) dispose();
  check("卸载后动画清空", h.document.querySelectorAll(`[${MARK}]`).length === 0);
  check("卸载后样式移除", h.document.getElementById("dsh-rice-muncher-style") === null);
}

// ---------- 场景二：关掉待机 ----------
{
  const h = makeHarness({ settings: { size: 56, speed: "fast", showIdle: false } });
  makeFooter(h.document);
  h.mod.apply(h.ctx);
  check("关掉待机后不出现", h.document.querySelector(`[${MARK}="idle"]`) === null);
  const { row, content } = makeRunningRow(h.document);
  FakeMutationObserver.trigger();
  await wait(300);
  const run = content.querySelector(`[${MARK}="run"]`);
  check("关掉待机后思考动画照常", run !== null);
  check("设置里的 56px 生效", run !== null && run.style.getPropertyValue("--rb-strip") === `${62 * 56}px`);
  row.remove();
  for (const dispose of h.disposers) dispose();
}

// ---------- 场景三：设置页注册 ----------
{
  const h = makeHarness({ withSlots: true });
  makeFooter(h.document);
  h.mod.apply(h.ctx);
  const registerCall = h.registrations.find((item) => item.name === "settings.section" && item.component);
  check("注册到了 settings.section", registerCall !== undefined);
  check("设置页标签", registerCall !== undefined && registerCall.options.label === "边吃边想");

  if (registerCall) {
    h.react.__resetHooks();
    const wrapper = registerCall.component();
    const tree = typeof wrapper.type === "function" ? wrapper.type({}) : wrapper;
    const text = JSON.stringify(tree);
    check("设置页含待机开关", text.includes("待机动画"));
    check("设置页含大小选项", text.includes("48px"));
    check("设置页含节奏选项", text.includes("正常"));
    check("设置页含两个预览", text.includes("深度求索中") && text.includes("用量"));
  }
  for (const dispose of h.disposers) dispose();
}

// ---------- 结果 ----------
const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
if (failed.length) {
  console.error(`\n${failed.length} 项失败`);
  process.exit(1);
}
console.log(`\n全部 ${checks.length} 项通过`);
process.exit(0);
