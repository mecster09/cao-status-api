import { useEffect, useState } from "react";
import { api, type ProfileDetail, type ProfileSummary, type Workflow } from "./api";

type View = { type: "workflow" | "profile"; name: string } | { type: "home" };

function initialView(): View {
  const hash = window.location.hash.replace(/^#\/?/, "").split("/");
  if (hash[0] === "workflow" && hash[1]) return { type: "workflow", name: decodeURIComponent(hash.slice(1).join("/")) };
  if (hash[0] === "profile" && hash[1]) return { type: "profile", name: decodeURIComponent(hash.slice(1).join("/")) };
  return { type: "home" };
}

function navigate(view: View): void {
  window.location.hash = view.type === "home" ? "/" : `/${view.type}/${encodeURIComponent(view.name)}`;
}

export default function App() {
  const [view, setView] = useState<View>(initialView);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onHashChange = () => setView(initialView());
    window.addEventListener("hashchange", onHashChange);
    Promise.all([api.profiles(), api.workflows()])
      .then(([profileResult, workflowResult]) => {
        setProfiles(profileResult.items);
        setWorkflows(workflowResult.items);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load CAO data"));
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <main className="shell">
      <header className="header">
        <button className="brand" onClick={() => navigate({ type: "home" })}>CAO Status</button>
        <span className="subtitle">Read-only profiles and workflows</span>
      </header>
      {error && <div className="alert">{error}</div>}
      {view.type === "home" && <Home profiles={profiles} workflows={workflows} />}
      {view.type === "profile" && <ProfilePage name={view.name} onBack={() => navigate({ type: "home" })} />}
      {view.type === "workflow" && <WorkflowPage name={view.name} profiles={profiles} onBack={() => navigate({ type: "home" })} />}
    </main>
  );
}

function Home({ profiles, workflows }: { profiles: ProfileSummary[]; workflows: Workflow[] }) {
  return (
    <>
      <section className="hero"><p className="eyebrow">CLI Agent Orchestrator</p><h1>Choose something to inspect</h1><p>Explore installed agent profiles and saved workflow definitions.</p></section>
      <section className="columns">
        <ResourceList title="Workflow definitions" items={workflows} type="workflow" empty="No workflow definitions found." />
        <ResourceList title="Agent profiles" items={profiles} type="profile" empty="No profiles found." />
      </section>
    </>
  );
}

function ResourceList({ title, items, type, empty }: { title: string; items: Array<Workflow | ProfileSummary>; type: "workflow" | "profile"; empty: string }) {
  return <section className="panel"><div className="panel-heading"><h2>{title}</h2><span className="count">{items.length}</span></div>{items.length === 0 ? <p className="muted">{empty}</p> : <div className="list">{items.map((item) => <button className="list-item" key={item.name} onClick={() => navigate({ type, name: item.name ?? "" })}><span><strong>{item.name ?? "Unnamed"}</strong><small>{item.description ?? item.source ?? "No description"}</small></span><span className="arrow">→</span></button>)}</div>}</section>;
}

function ProfilePage({ name, onBack }: { name: string; onBack: () => void }) {
  const [profile, setProfile] = useState<ProfileDetail>();
  const [error, setError] = useState<string>();
  useEffect(() => { api.profile(name).then(setProfile).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load profile")); }, [name]);
  return <DetailLayout title={profile?.name ?? name} eyebrow="Agent profile" onBack={onBack} error={error}>{profile && <><p className="lead">{profile.description}</p><div className="metadata"><span>{profile.provider ?? "provider unknown"}</span><span>{profile.role ?? "role unknown"}</span><span>{profile.source ?? "source unknown"}</span></div><pre className="content">{profile.content ?? "This profile has no content field."}</pre></>}</DetailLayout>;
}

function WorkflowPage({ name, profiles, onBack }: { name: string; profiles: ProfileSummary[]; onBack: () => void }) {
  const [workflow, setWorkflow] = useState<Workflow>();
  const [error, setError] = useState<string>();
  useEffect(() => { api.workflow(name).then(setWorkflow).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load workflow")); }, [name]);
  return <DetailLayout title={workflow?.name ?? name} eyebrow="Workflow definition" onBack={onBack} error={error}>{workflow && <><p className="lead">{workflow.description ?? "No description provided."}</p><div className="metadata"><span>{workflow.kind}</span><span>{workflow.source ?? "source unknown"}</span><span>{workflow.visualizable ? `${workflow.nodes.length} nodes` : "dynamic workflow"}</span></div>{workflow.visualizable ? <Graph workflow={workflow} profiles={profiles} /> : <div className="fallback"><h2>{workflow.reason ? "Not an executable workflow" : "Dynamic workflow"}</h2><p>{workflow.reason ?? "This workflow contains runtime control flow and cannot be represented as a fixed graph."}</p><details><summary>Inspect raw CAO definition</summary><pre className="content">{JSON.stringify(workflow.raw, null, 2)}</pre></details></div>}</>}</DetailLayout>;
}

function DetailLayout({ title, eyebrow, onBack, error, children }: { title: string; eyebrow: string; onBack: () => void; error?: string; children: React.ReactNode }) {
  return <><button className="back" onClick={onBack}>← Back</button><section className="detail"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{error && <div className="alert">{error}</div>}{children || (!error && <p className="muted">Loading…</p>)}</section></>;
}

function Graph({ workflow, profiles }: { workflow: Workflow; profiles: ProfileSummary[] }) {
  const descriptions = new Map(profiles.map((profile) => [profile.name, profile.description]));
  for (const node of workflow.nodes) {
    const description = node.profile ? descriptions.get(node.profile) : undefined;
    if (description && !node.profile?.includes(": ")) node.profile = `${node.profile}: ${description}`;
  }
  return <div className="graph">{workflow.nodes.map((node, index) => <div className="graph-step" key={node.id}><div className="node"><span className="node-kind">{node.kind ?? "step"}</span><strong>{node.label}</strong><small>{[node.profile, node.provider].filter(Boolean).join(" · ") || "agent details unavailable"}</small></div>{index < workflow.nodes.length - 1 && <div className="connector">↓</div>}</div>)}</div>;
}
