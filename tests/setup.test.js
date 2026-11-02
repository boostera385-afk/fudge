const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "drive-setup.js"), "utf8");
const template = fs.readFileSync(path.join(root, "apps-script.gs"), "utf8");
const version = template.match(/const FUDGE_CONNECTOR_VERSION = (\d+);/)[1];
const secret = "fixture-secret-not-for-real-use-0123456789";

function harness(options = {}) {
  const nodes = new Map();
  const writes = [], messages = [];
  const state = { secret, url: "", database: null };
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { disabled: ["#copyScript", "#connectButton"].includes(id), hidden: true,
      textContent: "", innerHTML: "", value: "", dataset: {}, listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      querySelector() { return this.label || (this.label = { textContent: "" }); } });
    return nodes.get(id);
  }
  const context = {
    document: { querySelector: node },
    navigator: { clipboard: { writeText: async (value) => { if (options.clipboardFailure) throw new Error("denied"); writes.push(value); } } },
    setTimeout: () => 1, clearTimeout() {},
    fetch: options.fetch || (async () => ({ ok: options.fetchOk !== false, text: async () => options.template ?? template })),
    chrome: { runtime: {
      getURL: (name) => `chrome-extension://fixture/${name}`,
      sendMessage: async (message) => {
        messages.push(message);
        if (message.type === "GET_SCRIPT_SETUP") return { ok: true, appsScriptSecret: options.secret ?? state.secret, appsScriptUrl: state.url, sheetsDatabase: state.database };
        if (message.type === "GET_SHEETS_STATUS") return { ok: true, connectionReady: Boolean(state.database) };
        if (message.type === "SAVE_SCRIPT_SETUP") {
          state.secret = options.recoveredSecret || state.secret;
          state.url = "https://script.google.com/macros/s/fixture/exec";
          state.database = { spreadsheetId: "fixture-sheet" };
          return { ok: true, database: state.database };
        }
        if (message.type === "DISCONNECT_SCRIPT") {
          if (options.disconnectFailure) throw new Error("Disconnected worker unavailable");
          state.url = ""; state.database = null;
          return { ok: true };
        }
        throw new Error("Unexpected message");
      }
    } }
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  return { context, node, writes, messages, state, ready: vm.runInContext("setupReady", context),
    click: (id) => node(id).listeners.click() };
}

test("connector copy/connect stay disabled while loading; an early click copies nothing", async () => {
  let release;
  const loaded = new Promise((resolve) => { release = resolve; });
  const h = harness({ fetch: () => loaded });
  assert.equal(h.node("#copyScript").disabled, true);
  assert.equal(h.node("#connectButton").disabled, true);
  await h.click("#copyScript");
  assert.deepEqual(h.writes, []);
  assert.match(h.node("#toast").innerHTML, /not ready/);
  release({ ok: true, text: async () => template });
  await h.ready;
  assert.equal(h.node("#copyScript").disabled, false);
});

test("preview reports the actual connector version without displaying its secret", async () => {
  const h = harness(); await h.ready;
  assert.match(h.node("#scriptPreview").textContent, new RegExp(`v${version}`));
  assert.ok(!h.node("#scriptPreview").textContent.includes(secret));
  await h.click("#copyScript");
  assert.ok(h.writes[0].includes(JSON.stringify(secret)));
  assert.ok(!h.writes[0].includes('const FUDGE_SECRET = "__FUDGE_SECRET__";'));
});

test("generated secret is a valid JS literal even with quotes, newlines and replacement tokens", async () => {
  const unusual = secret + '"\\\n$&$`$\'';
  const h = harness({ secret: unusual }); await h.ready; await h.click("#copyScript");
  const actual = vm.runInNewContext(h.writes[0] + "\nFUDGE_SECRET");
  assert.equal(actual, unusual);
});

test("missing or broken template and short secrets fail closed", async () => {
  for (const options of [{ fetchOk: false }, { template: "not the connector" }, { secret: "short" }]) {
    const h = harness(options); await h.ready;
    assert.equal(h.node("#copyScript").disabled, true);
    assert.equal(h.node("#connectButton").disabled, true);
    await h.click("#copyScript"); assert.equal(h.writes.length, 0);
    await h.click("#connectButton");
    assert.ok(!h.messages.some((message) => message.type === "SAVE_SCRIPT_SETUP"));
  }
});

test("clipboard refusal is caught and never reported as copied", async () => {
  const h = harness({ clipboardFailure: true }); await h.ready; await h.click("#copyScript");
  assert.match(h.node("#toast").innerHTML, /Could not copy/);
  assert.equal(h.writes.length, 0);
});

test("reconnect refreshes the generated connector with the secret that actually worked", async () => {
  const recovered = "another-fixture-connection-secret-0123456789";
  const h = harness({ recoveredSecret: recovered }); await h.ready;
  h.node("#webAppUrl").value = "FUDGE1|fixture|shared-secret";
  await h.click("#connectButton"); await h.click("#copyScript");
  assert.ok(h.writes[0].includes(JSON.stringify(recovered)));
  assert.equal(h.node("#connectionTitle").textContent, "Fudge Sheet connection saved");
  assert.ok(!h.node("#connectionDetail").textContent.includes("turned automation on"));
});

test("connect success does not claim collection started", async () => {
  const h = harness(); await h.ready; await h.click("#connectButton");
  assert.match(h.node("#toast").innerHTML, /Collection stays stopped/);
  assert.ok(!h.messages.some((message) => /START/.test(message.type)));
});

test("disconnect failures are surfaced without an unhandled rejection", async () => {
  const h = harness({ disconnectFailure: true }); await h.ready; await h.click("#disconnectButton");
  assert.match(h.node("#toast").innerHTML, /unavailable/);
});

function connector(properties, responder) {
  const requests = [], saved = [];
  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || "", setProperty: (key, value) => saved.push([key, value]) }) },
    UrlFetchApp: { fetch: (url, options) => { requests.push({ url, options }); return responder(url, options); } }
  };
  vm.createContext(context); vm.runInContext(template, context);
  return { context, requests, saved };
}

test("model access check reads only model metadata, with no review text or property writes", () => {
  const properties = { FUDGE_OPENAI_API_KEY: "private-fixture-key", FUDGE_OPENAI_MODEL: "fixture-model" };
  const h = connector(properties, () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ object: "model", id: "fixture-model" }) }));
  const result = h.context.writerCheckAccess_();
  assert.equal(result.ok, true);
  assert.equal(h.requests[0].url, "https://api.openai.com/v1/models/fixture-model");
  assert.equal(h.requests[0].options.method, "get");
  assert.equal(h.requests[0].options.payload, undefined);
  assert.equal(h.requests[0].options.headers.Authorization, "Bearer private-fixture-key");
  assert.deepEqual(h.saved, []);
  assert.match(result.message, /does not prove generation/);
  assert.ok(!result.message.includes("private-fixture-key"));
});

test("missing key and invalid model refuse network requests", () => {
  for (const properties of [{}, { FUDGE_OPENAI_API_KEY: "fixture", FUDGE_OPENAI_MODEL: "https://not-a-model" }]) {
    const h = connector(properties, () => { throw new Error("network forbidden"); });
    assert.equal(h.context.writerCheckAccess_().ok, false);
    assert.equal(h.requests.length, 0);
  }
});

test("model denial and raw provider errors never expose the key", () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const h = connector({ FUDGE_OPENAI_API_KEY: "private-fixture-key" }, () => ({ getResponseCode: () => status, getContentText: () => "private-fixture-key" }));
    const result = h.context.writerCheckAccess_();
    assert.equal(result.ok, false);
    assert.match(result.message, new RegExp(`HTTP ${status}`));
    assert.ok(!result.message.includes("private-fixture-key"));
  }
});

test("model access is not confirmed for malformed or different model metadata", () => {
  for (const body of ["not json", JSON.stringify({ id: "other-model", object: "model" })]) {
    const h = connector({ FUDGE_OPENAI_API_KEY: "fixture" }, () => ({ getResponseCode: () => 200, getContentText: () => body }));
    assert.equal(h.context.writerCheckAccess_().ok, false);
  }
});

test("provider error details redact known keys and reject raw non-JSON bodies", () => {
  const h = connector({ FUDGE_OPENAI_API_KEY: "private-fixture-key" }, () => {});
  const parsed = h.context.writerResponseDetail_({ getContentText: () => JSON.stringify({ error: { message: "Incorrect key: private-fixture-key or sk-fixture" } }) });
  assert.ok(!parsed.includes("private-fixture-key")); assert.ok(!parsed.includes("sk-fixture"));
  const raw = h.context.writerResponseDetail_({ getContentText: () => "debug body private-fixture-key" });
  assert.match(raw, /withheld/);
});

test("model changes require a non-secret ID and do not rewrite any Sheet cell", () => {
  for (const input of ["fixture-model", "sk-do-not-save-a-key-here", "https://bad-model", ""]) {
    const h = connector({}, () => { throw new Error("network forbidden"); });
    const alerts = [];
    h.context.SpreadsheetApp = { getUi: () => ({ Button: { OK: "OK" }, ButtonSet: { OK_CANCEL: "OK_CANCEL" },
      prompt: () => ({ getSelectedButton: () => "OK", getResponseText: () => input }), alert: (message) => alerts.push(message) }) };
    h.context.fudgeSetWriterModel();
    assert.equal(h.saved.length, input === "fixture-model" ? 1 : 0);
    assert.equal(h.requests.length, 0);
    assert.equal(alerts.length, 1);
  }
});
