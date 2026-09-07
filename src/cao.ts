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

function descriptionFromContent(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const frontMatter = value.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const description = frontMatter?.[1].match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1];
  return description?.trim();
}

function splitArguments(argumentsText: string): string[] {
  const argumentsList: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";

  for (let index = 0; index < argumentsText.length; index++) {
    const character = argumentsText[index];
    if (quote) {
      if (character === "\\") index++;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "[" || character === "{") depth++;
    else if (character === ")" || character === "]" || character === "}") depth--;
    else if (character === "," && depth === 0) {
      argumentsList.push(argumentsText.slice(start, index).trim());
      start = index + 1;
    }
  }
  argumentsList.push(argumentsText.slice(start).trim());
  return argumentsList;
}

function stringLiteral(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(?:[furb]{0,2})(["'])([\s\S]*)\1$/i);
  return match?.[2];
}

function scriptCalls(source: string): Array<{ name: string; argumentsText: string }> {
  const calls: Array<{ name: string; argumentsText: string }> = [];
  const callPattern = /\b(run_step|step|agent_step)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = callPattern.exec(source))) {
    const openingParenthesis = source.indexOf("(", match.index);
    let depth = 0;
    let quote = "";
    let end = -1;
    for (let index = openingParenthesis; index < source.length; index++) {
      const character = source[index];
      if (quote) {
        if (character === "\\") index++;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      else if (character === "(") depth++;
      else if (character === ")" && --depth === 0) {
        end = index;
        break;
      }
    }
    if (end === -1) continue;
    calls.push({ name: match[1], argumentsText: source.slice(openingParenthesis + 1, end) });
    callPattern.lastIndex = end + 1;
  }
  return calls;
}

function scriptSteps(source: unknown): any[] {
  if (typeof source !== "string") return [];
  const nodes: any[] = [];

  for (const call of scriptCalls(source)) {
    const argumentsList = splitArguments(call.argumentsText);
    const isHelper = call.name === "agent_step";
    const provider = isHelper ? undefined : stringLiteral(argumentsList[0]);
    const profile = stringLiteral(argumentsList[isHelper ? 0 : 1]);
    const positionalStepId = isHelper ? stringLiteral(argumentsList[2]) : undefined;
    const keywordStepId = call.argumentsText.match(/\bstep_id\s*=\s*(?:[furb]{0,2})(["'])([\s\S]*?)\1/i)?.[2];
    if (!profile) continue;
    const stepId = keywordStepId ?? positionalStepId;
    nodes.push({
      id: stepId ?? `step-${nodes.length + 1}`,
      label: stepId ?? profile,
      kind: "agent-step",
      profile,
      provider
    });
  }
  return nodes;
}

export function workflowGraph(value: any): {
  nodes: any[];
  edges: any[];
  visualizable: boolean;
  kind: "graph" | "dynamic" | "unknown";
  reason?: string;
} {
  const workflow = unwrapWorkflow(value);
  const explicitNodes = Array.isArray(workflow?.nodes) ? workflow.nodes : null;
  const explicitEdges = Array.isArray(workflow?.edges) ? workflow.edges : null;

  if (explicitNodes) {
    return { nodes: explicitNodes, edges: explicitEdges ?? [], visualizable: true, kind: "graph" };
  }

  // CAO ScriptSpec uses `path` for the Python filename and `source` for the
  // script contents. Prefer the path when deciding whether this is dynamic
  // Python; otherwise the contents will never end in `.py`.
  const sourcePath = workflow?.path ?? workflow?.filename ?? workflow?.source;
  const type = String(workflow?.type ?? workflow?.kind ?? "").toLowerCase();
  const isPython = type === "python" || String(sourcePath ?? "").endsWith(".py");
  const steps = workflowSteps(value);
  const extractedScriptSteps = isPython ? scriptSteps(workflow?.source) : [];

  if (extractedScriptSteps.length) {
    return {
      nodes: extractedScriptSteps,
      edges: extractedScriptSteps.slice(1).map((node, index) => ({ from: extractedScriptSteps[index].id, to: node.id })),
      visualizable: true,
      kind: "dynamic"
    };
  }

  if (!steps.length && isPython) {
    if (/^\s*def\s+agent_step\s*\(/m.test(String(workflow?.source ?? ""))) {
      return {
        nodes: [],
        edges: [],
        visualizable: false,
        kind: "dynamic",
        reason: "This Python file defines shared workflow helpers; it does not declare an executable workflow."
      };
    }
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
    // ScriptSpec's `source` is the complete Python file. The viewer's source
    // metadata should be a concise location, not several pages of code.
    source: workflow?.path ?? workflow?.filename ?? workflow?.source,
    inputs: workflow?.inputs ?? workflow?.INPUTS ?? [],
    validation: workflow?.validation ?? workflow?.status,
    ...workflowGraph(value),
    raw: value
  };
}

export function normaliseProfile(value: any): any {
  const profile = value?.profile ?? value;
  const content = profile?.content ?? profile?.body ?? profile?.system_prompt ?? profile?.prompt;
  return {
    name: profile?.name ?? profile?.id,
    description: profile?.description ?? profile?.summary ?? descriptionFromContent(content),
    provider: profile?.provider,
    role: profile?.role,
    source: profile?.source,
    content,
    raw: value
  };
}
