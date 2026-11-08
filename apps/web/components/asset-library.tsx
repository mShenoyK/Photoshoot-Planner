"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { PublicVisual } from "@framecraft/shared/visuals";
import type { ShootPlan } from "@framecraft/shared/planning";
import type { Styling } from "@framecraft/shared/styling";
import type { Artifact } from "@framecraft/shared/artifacts";
import type { TaskJob } from "@framecraft/shared/knowledge";
import { api, human } from "./client";
export function AssetLibrary({
  shootId,
  standalone = false,
}: {
  shootId: string;
  standalone?: boolean;
}) {
  const [visuals, setVisuals] = useState<PublicVisual[]>([]);
  const [imageMode, setImageMode] = useState("openai");
  const [plans, setPlans] = useState<ShootPlan[] | null>(null);
  const [styling, setStyling] = useState<Styling[]>([]);
  const [artifacts, setArtifacts] = useState<Omit<Artifact, "storageKey">[]>(
    [],
  );
  const [planId, setPlanId] = useState("");
  const [revision, setRevision] = useState("");
  const [poseId, setPoseId] = useState("");
  const [format, setFormat] = useState("ZIP");
  const [job, setJob] = useState<TaskJob | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const [p, s, a, v] = await Promise.all([
      api<ShootPlan[]>(`shoots/${shootId}/plans`),
      api<{ versions: Styling[] }>(`shoots/${shootId}/styling`),
      api<Omit<Artifact, "storageKey">[]>(`shoots/${shootId}/artifacts`),
      api<{ items: PublicVisual[]; provider: { mode: string } }>(
        `shoots/${shootId}/visuals`,
      ),
    ]);
    setPlans(p);
    setStyling(s.versions);
    setArtifacts(a);
    setVisuals(v.items);
    setImageMode(v.provider.mode);
    return p;
  };
  async function receiveJob(next: TaskJob) {
    if (next.status === "SUCCEEDED") await load();
    if (next.status === "FAILED")
      setError(`Task failed: ${next.errorCode}. Saved artifacts are retained.`);
    setJob(next);
  }
  useEffect(() => {
    load()
      .then((p) => {
        setPlanId(p.at(-1)?.id ?? "");
        setPoseId(p.at(-1)?.poses[0]?.id ?? "");
      })
      .catch((e) => setError(e.message));
  }, [shootId]);
  const active = !!job && ["QUEUED", "RUNNING"].includes(job.status);
  useEffect(() => {
    if (!active || !job) return;
    let mounted = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      api<TaskJob>(`jobs/${job.id}`)
        .then(async (next) => {
          if (!mounted) return;
          if (next.status === "SUCCEEDED") await load();
          if (next.status === "FAILED")
            setError(
              `Task failed: ${next.errorCode}. Saved artifacts are retained.`,
            );
          setJob(next);
          if (next.status === "FAILED")
            setError(
              `Task failed: ${next.errorCode}. Saved files are retained; retry is available.`,
            );
        })
        .catch((e) => {
          if (mounted) setError(e.message);
        })
        .finally(() => {
          polling = false;
        });
    }, 600);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [job?.id, active]);
  const create = async (illustration = false) => {
    setError("");
    setBusy(true);
    try {
      if (illustration && imageMode !== "mock") {
        await receiveJob(
          await api<TaskJob>(`shoots/${shootId}/visuals`, "POST", {
            target: { kind: "POSE", planId, poseId },
            idempotencyKey: crypto.randomUUID(),
          }),
        );
        return;
      }
      await receiveJob(
        await api<TaskJob>(`shoots/${shootId}/artifacts`, "POST", {
          planId,
          format: illustration ? "ILLUSTRATION" : format,
          ...(illustration
            ? { poseId }
            : revision
              ? { stylingRevision: Number(revision) }
              : {}),
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="container">
      {standalone ? (
        <Link href={`/tools/poses/${shootId}`}>← Posing session</Link>
      ) : (
        <nav className="actions">
          <Link href={`/shoots/${shootId}`}>Shoot brief</Link>
          <Link href={`/shoots/${shootId}/plan`}>Pose plan</Link>
          <Link href={`/shoots/${shootId}/lighting`}>Lighting Lab</Link>
          <Link href={`/shoots/${shootId}/wardrobe`}>Wardrobe Stylist</Link>
        </nav>
      )}

      <h1>Private files & exports</h1>
      <p>
        On-demand original schematic illustrations and immutable downloads. No
        photos or source books enter default exports. Planning text may identify
        participants; review before sharing.
      </p>
      {error && <p role="alert">{error}</p>}
      {!plans && !error && <p role="status">Loading private files…</p>}
      {plans &&
        (!plans.length ? (
          <p>
            {standalone ? "No saved posing guide yet." : "No saved plan yet."}{" "}
            <Link
              href={
                standalone
                  ? `/tools/poses/${shootId}`
                  : `/shoots/${shootId}/plan`
              }
            >
              {standalone
                ? "Generate a posing guide first"
                : "Generate a plan first"}
            </Link>
            .
          </p>
        ) : (
          <fieldset disabled={busy || active}>
            <label>
              {standalone ? "Guide version" : "Plan version"}
              <select
                value={planId}
                onChange={(e) => {
                  setPlanId(e.target.value);
                  setPoseId(
                    plans.find((p) => p.id === e.target.value)?.poses[0]?.id ??
                      "",
                  );
                }}
              >
                {plans.map((p) => (
                  <option value={p.id} key={p.id}>
                    Version {p.version} · {p.status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Styling revision for export
              <select
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
              >
                <option value="">Exclude styling</option>
                {styling.map((s) => (
                  <option key={s.revision} value={s.revision}>
                    Styling {s.revision}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Export format
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                {["ZIP", "PDF", "MARKDOWN", "CSV", "SVG"].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => create()}>Create export</button>
            <h2>
              {imageMode === "mock"
                ? "Original pose schematic (local test mode)"
                : "Original generated pose image"}
            </h2>
            <p>
              {imageMode === "mock"
                ? "Local test-only support-and-spacing schematic; not a live image."
                : "Request a new original OpenAI image from the saved pose. The image is reviewed for subject count, age and safety before publication."}{" "}
              Baby/toddler pose images require an adult caregiver profile.
            </p>
            <label>
              Pose to illustrate
              <select
                value={poseId}
                onChange={(e) => setPoseId(e.target.value)}
              >
                {plans
                  .find((p) => p.id === planId)
                  ?.poses.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </label>
            <button onClick={() => create(true)}>
              {imageMode === "mock"
                ? "Generate original schematic"
                : "Generate original image"}
            </button>
          </fieldset>
        ))}
      {job && (
        <p role="status">
          Artifact job: {human(job.status)} · attempt {job.attempts}
        </p>
      )}
      {job?.status === "FAILED" && job.attempts < 3 && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setError("");
              setJob(await api<TaskJob>(`jobs/${job.id}/retry`, "POST", {}));
            } catch (e) {
              setError(e instanceof Error ? e.message : "Retry failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Retry artifact job
        </button>
      )}
      {!!visuals.length && (
        <section className="panel">
          <h2>Generated recommendation images</h2>
          <div className="reference-grid">
            {visuals.map((v) => (
              <figure key={v.id}>
                <Image
                  unoptimized
                  width={1024}
                  height={1024}
                  src={`/api/v1/shoots/${shootId}/visuals/${v.id}/download`}
                  alt={`AI-generated ${v.target.kind.toLowerCase()} proposal`}
                  style={{ width: "100%", height: "auto" }}
                />
                <figcaption>
                  {v.provider} ·{" "}
                  <a
                    href={`/api/v1/shoots/${shootId}/visuals/${v.id}/download`}
                    download
                  >
                    Download PNG
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      <h2>Saved artifacts</h2>
      {!artifacts.length ? (
        <p>
          No generated files yet. Each action creates a private immutable file.
        </p>
      ) : (
        <div className="grid">
          {artifacts.map((a) => (
            <article className="panel" key={a.id}>
              <h3>{human(a.format)}</h3>
              {a.format === "ILLUSTRATION" && (
                <Image
                  unoptimized
                  width={1000}
                  height={500}
                  style={{ width: "100%", height: "auto" }}
                  src={`/api/v1/shoots/${shootId}/artifacts/${a.id}/download`}
                  alt="Original mock support-and-spacing schematic, not a photographic likeness"
                />
              )}
              <p>
                Plan {a.planVersion}
                {a.stylingRevision
                  ? ` · styling ${a.stylingRevision}`
                  : ""} · {a.bytes} bytes
              </p>
              <p>{a.provider}</p>
              <p className="artifact-hash">SHA-256: {a.sha256}</p>
              <a
                className="button secondary"
                href={`/api/v1/shoots/${shootId}/artifacts/${a.id}/download`}
                download
              >
                Download {human(a.format)}
              </a>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
