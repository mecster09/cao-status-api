import express, { type Express } from "express";
import { fileURLToPath } from "node:url";
import {
  asArray,
  normaliseProfile,
  normaliseState,
  normaliseWorkflow,
  type CaoClient
} from "./cao.js";

const port = Number(process.env.PORT ?? 3000);
const caoBaseUrl = process.env.CAO_BASE_URL ?? "http://cao:9889";
const requestTimeoutMs = Number(process.env.CAO_TIMEOUT_MS ?? 5000);

async function defaultCaoGet(path: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`${caoBaseUrl}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`CAO ${path} returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function sendUpstreamError(res: express.Response, error: unknown): void {
  console.error(error);
  res.status(503).json({
    healthy: false,
    error: error instanceof Error ? error.message : "Unknown CAO error",
    updatedAt: new Date().toISOString()
  });
}

export function createApp(caoGet: CaoClient = defaultCaoGet): Express {
  const app = express();

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.get("/api/cao/profiles", async (_req, res) => {
    try {
      const raw = await caoGet("/agents/profiles");
      const profiles = asArray(raw, ["profiles", "items", "results"]);
      res.json({
        items: profiles.map((profile) => {
          const normalised = normaliseProfile(profile);
          const { content: _content, raw: _raw, ...summary } = normalised;
          return summary;
        }),
        total: profiles.length
      });
    } catch (error) {
      sendUpstreamError(res, error);
    }
  });

  app.get("/api/cao/profiles/:name", async (req, res) => {
    try {
      const raw = await caoGet(`/agents/profiles/${encodeURIComponent(req.params.name)}`);
      res.json(normaliseProfile(raw));
    } catch (error) {
      sendUpstreamError(res, error);
    }
  });

  app.get("/api/cao/workflows", async (_req, res) => {
    try {
      const raw = await caoGet("/workflows");
      const workflows = asArray(raw, ["workflows", "items", "results"]);
      res.json({
        items: workflows.map((workflow) => {
          const normalised = normaliseWorkflow(workflow);
          return {
            name: normalised.name,
            description: normalised.description,
            source: normalised.source,
            inputs: normalised.inputs,
            visualizable: normalised.visualizable,
            kind: normalised.kind
          };
        }),
        total: workflows.length
      });
    } catch (error) {
      sendUpstreamError(res, error);
    }
  });

  app.get("/api/cao/workflows/:name", async (req, res) => {
    try {
      const raw = await caoGet(`/workflows/${encodeURIComponent(req.params.name)}`);
      res.json(normaliseWorkflow(raw));
    } catch (error) {
      sendUpstreamError(res, error);
    }
  });

  app.get("/api/cao/status", async (_req, res) => {
    try {
      const [health, sessionsRaw, profilesRaw, workflowsRaw] = await Promise.all([
        caoGet("/health"),
        caoGet("/sessions"),
        caoGet("/agents/profiles"),
        caoGet("/workflows/runs?limit=100")
      ]);
      const sessions = asArray(sessionsRaw, ["sessions", "items", "results"]);
      const profiles = asArray(profilesRaw, ["profiles", "items", "results"]);
      const workflowRuns = asArray(workflowsRaw, ["runs", "items", "results"]);
      const runningStates = new Set(["running", "in_progress", "pending"]);
      const failedStates = new Set(["failed", "error"]);
      const completedStates = new Set(["completed", "complete", "succeeded", "success"]);
      const approvalStates = new Set(["awaiting_publication_approval", "approval_required", "awaiting_approval"]);
      const workflowCounts = { total: workflowRuns.length, running: 0, failed: 0, completed: 0, awaitingApproval: 0 };

      for (const run of workflowRuns) {
        const state = normaliseState(run.state ?? run.status);
        if (runningStates.has(state)) workflowCounts.running++;
        if (failedStates.has(state)) workflowCounts.failed++;
        if (completedStates.has(state)) workflowCounts.completed++;
        if (approvalStates.has(state)) workflowCounts.awaitingApproval++;
      }

      res.json({
        healthy: true,
        health,
        sessions: {
          total: sessions.length,
          active: sessions.filter((session: any) => !["stopped", "closed", "terminated", "completed"].includes(normaliseState(session.status ?? session.state))).length,
          items: sessions.map((session: any) => ({
            id: session.id ?? session.session_id ?? session.name,
            name: session.name ?? session.id ?? "Session",
            status: session.status ?? session.state ?? "unknown"
          }))
        },
        profiles: { total: profiles.length },
        workflows: workflowCounts,
        attention: { total: workflowCounts.failed + workflowCounts.awaitingApproval },
        recentWorkflows: workflowRuns.slice(0, 10).map((run: any) => ({
          id: run.run_id ?? run.id,
          workflow: run.workflow_name ?? run.name ?? "workflow",
          state: run.state ?? run.status ?? "unknown"
        })),
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      sendUpstreamError(res, error);
    }
  });

  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createApp().listen(port, "0.0.0.0", () => {
    console.log(`CAO status API listening on :${port}`);
  });
}
