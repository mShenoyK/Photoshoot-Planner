"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Shoot } from "@framecraft/shared";
import { api, human } from "./client";
import { InputWorkspace } from "./input-workspace";
import { PlanStudio } from "./plan-studio";
import { StylingStudio } from "./styling-studio";
const tools = ["POSES", "LIGHTING", "WARDROBE"] as const;
const names = {
  POSES: "Posing guide",
  LIGHTING: "Lighting Lab",
  WARDROBE: "Wardrobe Stylist",
};
export function ToolLauncher() {
  const router = useRouter();
  const [list, setList] = useState<Shoot[] | null>(null);
  const [kind, setKind] = useState<(typeof tools)[number]>("POSES");
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState("INDOOR");
  const [scene, setScene] = useState("STUDIO");
  const [occasion, setOccasion] = useState("");
  const [lightMode, setLightMode] = useState("NATURAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<Shoot[]>("workflows")
      .then(setList)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="hero">
        <div>
          <p className="eyebrow">Independent creative tools</p>
          <h1>Create your way.</h1>
          <p>
            Use posing, lighting or wardrobe on its own. No photoshoot plan
            required. Each session keeps its own context, people and private
            references.
          </p>
        </div>
      </div>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const result = await api<Shoot>("workflows", "POST", {
              kind,
              name,
              environment,
              scene,
              occasion,
              lightMode,
            });
            router.push(`/tools/${kind.toLowerCase()}/${result.id}`);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <h2>Start a standalone session</h2>
        <div className="field">
          <label htmlFor="tool-kind">Creative tool</label>
          <select
            id="tool-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            {tools.map((t) => (
              <option value={t} key={t}>
                {names[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tool-name">Session name</label>
          <input
            id="tool-name"
            value={name}
            minLength={3}
            maxLength={120}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="tool-environment">Environment</label>
          <select
            id="tool-environment"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
          >
            <option>INDOOR</option>
            <option>OUTDOOR</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="tool-scene">Scene / surroundings</label>
          <input
            id="tool-scene"
            required
            maxLength={120}
            value={scene}
            onChange={(e) => setScene(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="tool-occasion">Occasion (optional)</label>
          <input
            id="tool-occasion"
            maxLength={200}
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="tool-light">Light mode</label>
          <select
            id="tool-light"
            value={lightMode}
            onChange={(e) => setLightMode(e.target.value)}
          >
            {["NATURAL", "ARTIFICIAL", "MIXED"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
        {error && <p role="alert">{error}</p>}
        <button disabled={busy}>{busy ? "Opening…" : "Open tool"}</button>
      </form>
      <section className="panel">
        <h2>Your tool sessions</h2>
        {!list ? (
          <p role="status">Loading sessions…</p>
        ) : !list.length ? (
          <p>No sessions yet. Choose a tool above.</p>
        ) : (
          list.map((s) => (
            <article className="media-row" key={s.id}>
              <Link href={`/tools/${s.workflowKind!.toLowerCase()}/${s.id}`}>
                {s.name}
              </Link>
              <p>
                {names[s.workflowKind!]} · {human(s.shootType)} ·{" "}
                {s.settings.occasion || s.settings.sceneCategory}
              </p>
            </article>
          ))
        )}
      </section>
    </>
  );
}
export function ToolWorkspace({ id, kind }: { id: string; kind: string }) {
  const [workspace, setWorkspace] = useState<Shoot | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    api<Shoot>(`workflows/${id}`)
      .then((s) => {
        if (s.workflowKind?.toLowerCase() !== kind)
          throw new Error(
            "This session belongs to a different tool. Open it from Creative tools.",
          );
        setWorkspace(s);
      })
      .catch((e) => setError(e.message));
  }, [id, kind]);
  return (
    <>
      <Link href="/tools">← Creative tools</Link>
      {error && <p role="alert">{error}</p>}
      {!workspace && !error && (
        <p role="status">Loading independent session…</p>
      )}
      {workspace && (
        <>
          <p className="eyebrow">Standalone session · {workspace.name}</p>
          <details>
            <summary>Edit session context</summary>
            <ToolContextEditor
              workspace={workspace}
              onSaved={(next) => {
                setWorkspace(next);
                setRefresh((v) => v + 1);
              }}
            />
          </details>
          <p>
            {human(workspace.shootType)} · {workspace.settings.sceneCategory} ·{" "}
            {workspace.settings.occasion || "No occasion specified"}
          </p>
          <details
            onToggle={(e) => {
              if (!e.currentTarget.open) setRefresh((v) => v + 1);
            }}
          >
            <summary>People, preferences, consent & equipment</summary>
            <InputWorkspace shootId={id} embedded />
          </details>
          <p className="hint">
            Add people above for exact-person guidance and wardrobe. Photos are
            optional. References uploaded inside this tool stay with this
            session.
          </p>
          {workspace.workflowKind === "POSES" ? (
            <PlanStudio key={refresh} shootId={id} poseStudio standalone />
          ) : (
            <StylingStudio
              key={refresh}
              shootId={id}
              mode={
                workspace.workflowKind === "LIGHTING" ? "lighting" : "wardrobe"
              }
              standalone
            />
          )}
        </>
      )}
    </>
  );
}

function ToolContextEditor({
  workspace,
  onSaved,
}: {
  workspace: Shoot;
  onSaved: (next: Shoot) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const values = new FormData(event.currentTarget);
        try {
          onSaved(
            await api<Shoot>(`workflows/${workspace.id}`, "PATCH", {
              baseRevision: workspace.revision,
              name: values.get("name"),
              environment: values.get("environment"),
              scene: values.get("scene"),
              occasion: values.get("occasion"),
              lightMode: values.get("lightMode"),
            }),
          );
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Session title
        <input
          name="name"
          defaultValue={workspace.name}
          minLength={3}
          maxLength={120}
          required
        />
      </label>
      <label>
        Indoor / outdoor
        <select name="environment" defaultValue={workspace.shootType}>
          <option>INDOOR</option>
          <option>OUTDOOR</option>
        </select>
      </label>
      <label>
        Scene
        <input
          name="scene"
          defaultValue={workspace.settings.sceneCategory}
          maxLength={120}
          required
        />
      </label>
      <label>
        Occasion
        <input
          name="occasion"
          defaultValue={workspace.settings.occasion}
          maxLength={200}
        />
      </label>
      <label>
        Lighting preference
        <select name="lightMode" defaultValue={workspace.settings.lightMode}>
          {["NATURAL", "ARTIFICIAL", "MIXED"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>Save session context</button>
    </form>
  );
}
