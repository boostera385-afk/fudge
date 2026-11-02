const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const test = require("node:test");
const root = path.resolve(__dirname, "..");

async function render(status, reject = false) {
  const extension = { textContent: "" }, detail = { textContent: "" };
  let listener;
  const context = {
    document: { querySelectorAll: (selector) => selector === "[data-extension-version]" ? [extension] : [detail] },
    chrome: { runtime: { getManifest: () => ({ version: "2.0.1" }), sendMessage: async () => { if (reject) throw new Error("offline"); return status; } },
      storage: { onChanged: { addListener: (fn) => { listener = fn; } } } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "release-info.js"), "utf8"), context);
  await new Promise((resolve) => setImmediate(resolve));
  return { extension, detail, listener };
}

test("frontend versions use actual manifest/last response and never expose connector credentials", async () => {
  const h = await render({ ok: true, connectionReady: true, expectedConnectorVersion: 43, connectorVersion: 42,
    connectorObservedAt: "2026-11-02T16:00:00Z", appsScriptUrl: "https://private-fixture.example", appsScriptSecret: "private-fixture-secret" });
  assert.equal(h.extension.textContent, "2.0.1");
  assert.match(h.detail.textContent, /last response v42/);
  assert.match(h.detail.textContent, /expected v43/);
  assert.match(h.detail.textContent, /Cached response/);
  assert.ok(!h.detail.textContent.includes("private-fixture"));
});
test("missing metadata and disconnected targets never claim a deployed connector version", async () => {
  const h = await render({ ok: true, connectionReady: false, connectorVersion: 43, expectedConnectorVersion: 43 });
  assert.match(h.detail.textContent, /last response not checked/);
  const offline = await render({}, true);
  assert.match(offline.detail.textContent, /expected unknown/);
});
test("malformed version values never become HTML or a false version", async () => {
  const h = await render({ ok: true, connectionReady: true, connectorVersion: "<script>bad</script>", expectedConnectorVersion: -1 });
  assert.match(h.detail.textContent, /last response unknown/);
  assert.ok(!h.detail.textContent.includes("<script>"));
});
test("lowercase public brand preserves the original unpacked extension identity", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.short_name, "fudge");
  assert.ok(manifest.name.startsWith("fudge"));
  const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
  const id = [...digest].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join("");
  assert.equal(id, "bhpbiejhocblflacbgkohbiejnhopdan");
  for (const file of ["sidepanel.html", "drive-setup.html", "backend-setup.html"]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(html, /class="brand-name">fudge<\/span>/);
    assert.ok(html.includes('src="release-info.js"'));
    assert.ok(html.includes("data-release-info"));
  }
});
