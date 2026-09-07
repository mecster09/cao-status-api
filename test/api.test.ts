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
    : { name: "developer", description: "Builds software", system_prompt: "secret prompt" };

  await withServer(caoGet, async (baseUrl) => {
    const list = await fetch(`${baseUrl}/api/cao/profiles`).then((response) => response.json());
    assert.deepEqual(list.items[0], { name: "developer", description: "Builds software" });

    const detail = await fetch(`${baseUrl}/api/cao/profiles/developer`).then((response) => response.json());
    assert.equal(detail.content, "secret prompt");
  });
});

test("profile list enriches a missing description from profile front matter", async () => {
  const caoGet = async (path: string) => path === "/agents/profiles"
    ? [{ name: "change-publisher" }]
    : {
      name: "change-publisher",
      system_prompt: [
        "---",
        "description: Publishes a user-approved worktree diff by committing, pushing and creating/updating the PR.",
        "---",
        "# Change Publisher"
      ].join("\n")
    };

  await withServer(caoGet, async (baseUrl) => {
    const list = await fetch(`${baseUrl}/api/cao/profiles`).then((response) => response.json());
    assert.equal(list.items[0].description, "Publishes a user-approved worktree diff by committing, pushing and creating/updating the PR.");
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

test("a Python helper module explains that it is not an executable workflow", async () => {
  const caoGet = async () => ({
    name: "sdlc_common",
    path: "sdlc_common.py",
    source: [
      "from cao_workflow import run_step",
      "def agent_step(profile, prompt, step_id, working_directory):",
      "    return run_step(\"codex\", profile, prompt, step_id=step_id)"
    ].join("\n")
  });

  await withServer(caoGet, async (baseUrl) => {
    const detail = await fetch(`${baseUrl}/api/cao/workflows/sdlc_common`).then((response) => response.json());
    assert.equal(detail.visualizable, false);
    assert.equal(detail.hidden, true);
    assert.equal(detail.reason, "This Python file defines shared workflow helpers; it does not declare an executable workflow.");
  });
});

test("workflow list hides shared Python helper modules", async () => {
  const caoGet = async () => ([
    {
      name: "sdlc_common",
      path: "sdlc_common.py",
      source: "def agent_step(agent, prompt, step_id, wd):\n    return run_step(\"codex\", agent, prompt, step_id=step_id)"
    },
    { name: "sdlc_bootstrap", path: "sdlc_bootstrap.py", source: "agent_step(\"repo-setup-worker\", \"Set up\", \"setup\", wd)" }
  ]);

  await withServer(caoGet, async (baseUrl) => {
    const list = await fetch(`${baseUrl}/api/cao/workflows`).then((response) => response.json());
    assert.deepEqual(list.items.map((workflow: any) => workflow.name), ["sdlc_bootstrap"]);
    assert.equal(list.total, 1);
  });
});

test("Python workflow source produces best-effort visual steps", async () => {
  const caoGet = async () => ({
    name: "sdlc_common",
    path: "sdlc_common.py",
    source: [
      "from cao_workflow import run_step",
      "run_step(\"codex\", \"developer\", \"Implement the change\", step_id=\"implement\")",
      "run_step(\"claude_code\", \"reviewer\", \"Review the change\", step_id=\"review\")"
    ].join("\n")
  });

  await withServer(caoGet, async (baseUrl) => {
    const detail = await fetch(`${baseUrl}/api/cao/workflows/sdlc_common`).then((response) => response.json());
    assert.equal(detail.visualizable, true);
    assert.equal(detail.source, "sdlc_common.py");
    assert.deepEqual(detail.nodes.map((node: any) => node.id), ["implement", "review"]);
    assert.deepEqual(detail.edges, [{ from: "implement", to: "review" }]);
  });
});

test("Python workflow preserves step IDs after nested prompt expressions", async () => {
  const caoGet = async () => ({
    name: "engineering_flow",
    path: "engineering_flow.py",
    source: [
      "run_step(\"codex\", \"requirements-analyst\", \"Gather requirements\", step_id=\"requirements\")",
      "run_step(\"codex\", \"spec-reviewer\", (",
      "  f\"Review {tickets}\"",
      "), step_id=\"final-review\")"
    ].join("\n")
  });

  await withServer(caoGet, async (baseUrl) => {
    const detail = await fetch(`${baseUrl}/api/cao/workflows/engineering_flow`).then((response) => response.json());
    assert.deepEqual(detail.nodes.map((node: any) => node.id), ["requirements", "final-review"]);
  });
});

test("Python workflow recognises CAO agent_step helper calls", async () => {
  const caoGet = async () => ({
    name: "sdlc_bootstrap",
    path: "sdlc_bootstrap.py",
    source: [
      "from sdlc_common import agent_step",
      "agent_step(\"change-publisher\", f\"Publish {issue}\", \"publish-bootstrap\", wt, model)",
      "agent_step(\"repo-setup-worker\", \"Set up the repository\", \"setup\", wt, model)"
    ].join("\n")
  });

  await withServer(caoGet, async (baseUrl) => {
    const detail = await fetch(`${baseUrl}/api/cao/workflows/sdlc_bootstrap`).then((response) => response.json());
    assert.equal(detail.visualizable, true);
    assert.deepEqual(detail.nodes.map((node: any) => node.id), ["publish-bootstrap", "setup"]);
    assert.deepEqual(detail.nodes.map((node: any) => node.profile), ["change-publisher", "repo-setup-worker"]);
  });
});

test("workflow detail falls back to the matching workflow list item", async () => {
  const caoGet = async (path: string) => {
    if (path === "/workflows/fallback") throw Object.assign(new Error("not found"), { status: 404 });
    return [{ name: "fallback", steps: [{ id: "only-step", label: "Only step" }] }];
  };

  await withServer(caoGet, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/cao/workflows/fallback`);
    const detail = await response.json();
    assert.equal(response.status, 200);
    assert.equal(detail.nodes[0].id, "only-step");
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
