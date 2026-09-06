import express from "express";

const app = express();

const port = Number(process.env.PORT ?? 3000);
const caoBaseUrl = process.env.CAO_BASE_URL ?? "http://cao:9889";
const requestTimeoutMs = Number(process.env.CAO_TIMEOUT_MS ?? 5000);

async function caoGet(path: string): Promise<any> {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    requestTimeoutMs
  );

  try {
    const response = await fetch(`${caoBaseUrl}${path}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(
        `CAO ${path} returned HTTP ${response.status}`
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function asArray(value: any, possibleKeys: string[] = []): any[] {
  if (Array.isArray(value)) {
    return value;
  }

  for (const key of possibleKeys) {
    if (Array.isArray(value?.[key])) {
      return value[key];
    }
  }

  return [];
}

function normaliseState(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/cao/status", async (_req, res) => {
  try {
    const [health, sessionsRaw, profilesRaw, workflowsRaw] =
      await Promise.all([
        caoGet("/health"),
        caoGet("/sessions"),
        caoGet("/agents/profiles"),
        caoGet("/workflows/runs?limit=100")
      ]);

    const sessions = asArray(
      sessionsRaw,
      ["sessions", "items", "results"]
    );

    const profiles = asArray(
      profilesRaw,
      ["profiles", "items", "results"]
    );

    const workflowRuns = asArray(
      workflowsRaw,
      ["runs", "items", "results"]
    );

    const runningStates = new Set([
      "running",
      "in_progress",
      "pending"
    ]);

    const failedStates = new Set([
      "failed",
      "error"
    ]);

    const completedStates = new Set([
      "completed",
      "complete",
      "succeeded",
      "success"
    ]);

    const approvalStates = new Set([
      "awaiting_publication_approval",
      "approval_required",
      "awaiting_approval"
    ]);

    const workflowCounts = {
      total: workflowRuns.length,
      running: 0,
      failed: 0,
      completed: 0,
      awaitingApproval: 0
    };

    for (const run of workflowRuns) {
      const state = normaliseState(
        run.state ?? run.status
      );

      if (runningStates.has(state)) {
        workflowCounts.running++;
      }

      if (failedStates.has(state)) {
        workflowCounts.failed++;
      }

      if (completedStates.has(state)) {
        workflowCounts.completed++;
      }

      if (approvalStates.has(state)) {
        workflowCounts.awaitingApproval++;
      }

      /*
       * Your SDLC workflows may expose approval state in
       * their retained workflow output rather than the CAO
       * top-level state. If so, extend this adapter once you
       * see the real API response shape.
       */
    }

    const sessionItems = sessions.map((session: any) => ({
      id: session.id ?? session.session_id ?? session.name,
      name: session.name ?? session.id ?? "Session",
      status: session.status ?? session.state ?? "unknown"
    }));

    const recentRuns = workflowRuns.slice(0, 10).map((run: any) => ({
      id: run.run_id ?? run.id,
      workflow: run.workflow_name ?? run.name ?? "workflow",
      state: run.state ?? run.status ?? "unknown"
    }));

    res.json({
      healthy: true,
      health,

      sessions: {
        total: sessions.length,
        active: sessions.filter((session: any) => {
          const state = normaliseState(
            session.status ?? session.state
          );

          return ![
            "stopped",
            "closed",
            "terminated",
            "completed"
          ].includes(state);
        }).length,
        items: sessionItems
      },

      profiles: {
        total: profiles.length
      },

      workflows: workflowCounts,

      attention: {
        total:
          workflowCounts.failed +
          workflowCounts.awaitingApproval
      },

      recentWorkflows: recentRuns,

      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(error);

    res.status(503).json({
      healthy: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown CAO error",
      updatedAt: new Date().toISOString()
    });
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`CAO status API listening on :${port}`);
});