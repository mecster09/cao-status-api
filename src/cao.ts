export type CaoClient = (path: string) => Promise<unknown>;

export function asArray(value: unknown, possibleKeys: string[] = []): any[] {
  if (Array.isArray(value)) return value;
  for (const key of possibleKeys) {
    const candidate = (value as Record<string, unknown> | null)?.[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function normaliseState(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function unwrapWorkflow(value: any): any {
  return value?.workflow ?? value?.definition ?? value?.spec ?? value;
}

function workflowSteps(value: any): any[] {
  const workflow = unwrapWorkflow(value);
  return asArray(workflow, ["steps", "nodes", "workflow_steps"]);
}

export function workflowGraph(value: any): {
  nodes: any[];
  edges: any[];
  visualizable: boolean;
  kind: "graph" | "dynamic" | "unknown";
} {
  const workflow = unwrapWorkflow(value);
  const explicitNodes = Array.isArray(workflow?.nodes) ? workflow.nodes : null;
  const explicitEdges = Array.isArray(workflow?.edges) ? workflow.edges : null;

  if (explicitNodes) {
    return { nodes: explicitNodes, edges: explicitEdges ?? [], visualizable: true, kind: "graph" };
  }

  const source = workflow?.source ?? workflow?.path ?? workflow?.filename;
  const type = String(workflow?.type ?? workflow?.kind ?? "").toLowerCase();
  const isPython = type === "python" || String(source ?? "").endsWith(".py");
  const steps = workflowSteps(value);

  if (!steps.length && isPython) {
    return { nodes: [], edges: [], visualizable: false, kind: "dynamic" };
  }
  if (!steps.length) {
    return { nodes: [], edges: [], visualizable: false, kind: "unknown" };
  }

  const nodes = steps.map((step: any, index) => ({
    id: String(step.id ?? step.name ?? step.step_id ?? `step-${index + 1}`),
    label: step.label ?? step.name ?? step.id ?? `Step ${index + 1}`,
    kind: step.kind ?? "agent-step",
    profile: step.profile ?? step.agent_profile ?? step.agent,
    provider: step.provider,
    inputs: step.inputs ?? step.input
  }));

  return {
    nodes,
    edges: nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id })),
    visualizable: true,
    kind: "graph"
  };
}

export function normaliseWorkflow(value: any): any {
  const workflow = unwrapWorkflow(value);
  return {
    name: workflow?.name ?? workflow?.workflow_name ?? workflow?.id,
    description: workflow?.description,
    source: workflow?.source ?? workflow?.path ?? workflow?.filename,
    inputs: workflow?.inputs ?? workflow?.INPUTS ?? [],
    validation: workflow?.validation ?? workflow?.status,
    ...workflowGraph(value),
    raw: value
  };
}

export function normaliseProfile(value: any): any {
  const profile = value?.profile ?? value;
  return {
    name: profile?.name ?? profile?.id,
    description: profile?.description,
    provider: profile?.provider,
    role: profile?.role,
    source: profile?.source,
    content: profile?.content ?? profile?.body ?? profile?.prompt,
    raw: value
  };
}
