import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/server.js";

async function withServer(caoGet: (path: string) => Promise<unknown>, run: (baseUrl: string) => Promise<void>) {
  const server = createApp(caoGet).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("profile list omits prompt content while profile detail includes it", async () => {
  const caoGet = async (path: string) => path === "/agents/profiles"
    ? [{ name: "developer", description: "Builds software", content: "secret prompt" }]
    : { name: "developer", description: "Builds software", content: "secret prompt" };

  await withServer(caoGet, async (baseUrl) => {
    const list = await fetch(`${baseUrl}/api/cao/profiles`).then((response) => response.json());
    assert.deepEqual(list.items[0], { name: "developer", description: "Builds software" });

    const detail = await fetch(`${baseUrl}/api/cao/profiles/developer`).then((response) => response.json());
    assert.equal(detail.content, "secret prompt");
  });
});

test("workflow detail returns a visual graph for sequential steps", async () => {
  const caoGet = async (path: string) => path === "/workflows"
    ? [{ name: "review", steps: [
      { id: "build", label: "Build", profile: "developer", provider: "codex" },
      { id: "check", label: "Check", profile: "reviewer", provider: "claude_code" }
    ] }]
    : { name: "review", steps: [{ id: "build" }, { id: "check" }] };

  await withServer(caoGet, async (baseUrl) => {
    const list = await fetch(`${baseUrl}/api/cao/workflows`).then((response) => response.json());
    assert.equal(list.items[0].visualizable, true);

    const detail = await fetch(`${baseUrl}/api/cao/workflows/review`).then((response) => response.json());
    assert.equal(detail.nodes.length, 2);
    assert.deepEqual(detail.edges, [{ from: "build", to: "check" }]);
  });
});

test("dynamic workflow detail remains inspectable without a false graph", async () => {
  const caoGet = async () => ({ name: "loop", type: "python", source: "loop.py" });

  await withServer(caoGet, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/cao/workflows/loop`);
    const detail = await response.json();
    assert.equal(detail.kind, "dynamic");
    assert.equal(detail.visualizable, false);
    assert.deepEqual(detail.nodes, []);
  });
});

test("CAO failure is exposed as a service-unavailable response", async () => {
  const caoGet = async () => { throw new Error("CAO unavailable"); };

  await withServer(caoGet, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/cao/workflows`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "CAO unavailable");
  });
});
