const apiBase = import.meta.env.VITE_API_BASE
  ?? `${window.location.protocol}//${window.location.hostname}:31847`;

export type ProfileSummary = {
  name?: string;
  description?: string;
  provider?: string;
  role?: string;
  source?: string;
};

export type ProfileDetail = ProfileSummary & {
  content?: string;
};

export type WorkflowNode = {
  id: string;
  label: string;
  kind?: string;
  profile?: string;
  provider?: string;
};

export type Workflow = {
  name?: string;
  description?: string;
  source?: string;
  inputs?: unknown;
  nodes: WorkflowNode[];
  edges: Array<{ from: string; to: string }>;
  visualizable: boolean;
  kind: "graph" | "dynamic" | "unknown";
  reason?: string;
  hidden?: boolean;
  raw?: unknown;
};

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  profiles: () => get<{ items: ProfileSummary[]; total: number }>("/api/cao/profiles"),
  profile: (name: string) => get<ProfileDetail>(`/api/cao/profiles/${encodeURIComponent(name)}`),
  workflows: () => get<{ items: Workflow[]; total: number }>("/api/cao/workflows"),
  workflow: (name: string) => get<Workflow>(`/api/cao/workflows/${encodeURIComponent(name)}`)
};
