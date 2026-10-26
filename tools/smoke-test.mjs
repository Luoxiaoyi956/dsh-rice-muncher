// 极简假 DOM + 冒烟测试：挂载位置、重复挂载、自愈、卸载清理，以及设置页注册。
// 只支持 lib/client.js 真正用到的那几个选择器，够用就行。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CODE = readFileSync(join(ROOT, "lib", "client.js"), "utf8");

// ---------- 假 DOM ----------
function matches(el, selector) {
  if (selector.startsWith("#")) return el.attributes.get("id") === selector.slice(1);
  if (selector.startsWith("[") && selector.endsWith("]")) return el.attributes.has(selector.slice(1, -1));
  return el.tagName === selector;
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

/** 极简 React：只够 buildPanel 里用到的几个 hook 跑通（不算真实渲染）。 */
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

// ---------- 每一轮搭一套干净环境 ----------
function makeHarness({ withSlots }) {
  const document = new FakeDocument();
  const storage = new Map();
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
  return { document, window, mod, ctx, disposers, registrations, react, storage };
}

/** 造一行和真实结构一样的「运行中」行。 */
function makeRunningRow(document) {
  const row = document.createElement("div");
  row.setAttribute("data-chat-running", "");
  const hidden = row.appendChild(document.createElement("span"));
  hidden.setAttribute("role", "status");
  const divider = row.appendChild(document.createElement("span"));
  divider.setAttribute("aria-hidden", "true");
  const content = row.appendChild(document.createElement("span"));
  const icon = content.appendChild(document.createElement("span"));
  icon.setAttribute("aria-hidden", "true");
  const label = content.appendChild(document.createElement("span"));
  label.textContent = "深度求索中，用时 3秒 ···";
  document.body.appendChild(row);
  return { row, content, icon, label };
}

const checks = [];
const check = (name, ok) => checks.push({ name, ok });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- 场景一：只有运行状态动画 ----------
{
  const h = makeHarness({ withSlots: false });
  const { content, icon } = makeRunningRow(h.document);
  h.mod.apply(h.ctx);

  check("样式已注入", h.document.getElementById("dsh-rice-bowl-style") !== null);
  const mascot = content.querySelector("[data-dsh-rice-bowl]");
  check("动画挂在文字后面", mascot !== null && content.children[content.children.length - 1] === mascot);
  check("动画带 class", mascot !== null && mascot.className === "dsh-rice-bowl");
  check("动画对读屏隐藏", mascot !== null && mascot.getAttribute("aria-hidden") === "true");
  check("没插到图标前面", content.children[0] === icon);
  check("尺寸落到了元素上", mascot !== null && mascot.style.getPropertyValue("--rb-strip") !== "");

  // 重复 apply 不该叠加（同一个插件实例被调两次的极端情况）
  h.mod.apply(h.ctx);
  check(
    "重复 apply 不叠加",
    content.querySelectorAll("[data-dsh-rice-bowl]").length === 1 &&
      h.document.querySelectorAll("#dsh-rice-bowl-style").length === 1,
  );

  content.children.length = 0;
  const icon2 = content.appendChild(h.document.createElement("span"));
  icon2.setAttribute("aria-hidden", "true");
  const label2 = content.appendChild(h.document.createElement("span"));
  label2.textContent = "深度求索中，用时 4秒 ···";
  FakeMutationObserver.trigger();
  await wait(300);
  const healed = content.querySelector("[data-dsh-rice-bowl]");
  check("行重建后自己补回来", healed !== null && content.children[content.children.length - 1] === healed);

  FakeMutationObserver.instances.length = 0;
  content.children.length = 0;
  content.appendChild(h.document.createElement("span")).textContent = "深度求索中，用时 9秒 ···";
  await wait(2300);
  check("观察者失效靠定时兜底补回来", content.querySelector("[data-dsh-rice-bowl]") !== null);

  const styleEl = h.document.getElementById("dsh-rice-bowl-style");
  for (const dispose of h.disposers) dispose();
  check("卸载后动画移除", h.document.querySelectorAll("[data-dsh-rice-bowl]").length === 0);
  check("卸载后样式移除", h.document.querySelectorAll("#dsh-rice-bowl-style").length === 0);
  check("样式元素确实被摘下", styleEl !== null && styleEl.parentNode === null);
}

// ---------- 场景二：注册设置页 ----------
{
  const h = makeHarness({ withSlots: true });
  h.mod.apply(h.ctx);
  const injectCall = h.registrations.find((item) => item.name === "settings.section" && item.kind === "inject");
  const registerCall = h.registrations.find((item) => item.name === "settings.section" && item.component);
  check("注册到了 settings.section", injectCall !== undefined && registerCall !== undefined);
  check("设置页有中文标签", registerCall !== undefined && registerCall.options.label === "边吃边想");
  check("设置页 id 固定", registerCall !== undefined && registerCall.options.id === "rice-bowl");

  if (registerCall) {
    h.react.__resetHooks();
    // register 包了一层：component() 返回 { type: Panel }，要再调一次才是真正的树
    const wrapper = registerCall.component();
    const tree = typeof wrapper.type === "function" ? wrapper.type({}) : wrapper;
    const text = JSON.stringify(tree);
    check("设置页含动画选项", text.includes("鲸鱼娘吃饭"));
    check("设置页含大小选项", text.includes("48px"));
    check("设置页含节奏选项", text.includes("正常"));
    check("设置页含预览行", text.includes("深度求索中"));
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
