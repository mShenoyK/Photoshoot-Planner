"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  visualKey,
  type PublicVisual,
  type VisualTarget,
} from "@framecraft/shared/visuals";
import type { TaskJob } from "@framecraft/shared/knowledge";
import { api, human, providerFailure } from "./client";
// Bound concurrent paid requests across all cards, including a mixed-family wardrobe.
let running = 0;
const waiting: (() => void)[] = [];
async function scheduled<T>(fn: () => Promise<T>) {
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else running++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}
type Listing = {
  matchingItem?: PublicVisual | null;
  items: PublicVisual[];
  jobs: { targetKey: string; job: TaskJob }[];
  provider: { configured: boolean; mode: string; model: string };
};
const pending = new Map<string, Promise<TaskJob>>();
const autoAttempted = new Set<string>();
export function GeneratedVisual({
  shootId,
  target,
  autoGenerate = false,
}: {
  shootId: string;
  target: VisualTarget;
  autoGenerate?: boolean;
}) {
  const key = visualKey(target);
  const [image, setImage] = useState<PublicVisual | null>(null);
  const [job, setJob] = useState<TaskJob | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempted = useRef("");
  const active = useRef(true);
  const currentKey = useRef(key);
  currentKey.current = key;
  const load = async () => {
    const data = await api<Listing>(
      `shoots/${shootId}/visuals?target=${encodeURIComponent(JSON.stringify(target))}`,
    );
    if (!active.current || currentKey.current !== key) return data;
    setConfigured(data.provider.configured);
    setImage(
      data.matchingItem ??
        data.items.filter((v) => visualKey(v.target) === key).at(-1) ??
        null,
    );
    setJob(data.jobs.filter((v) => v.targetKey === key).at(-1)?.job ?? null);
    return data;
  };
  const generate = async (force = false) => {
    setBusy(true);
    setError("");
    const requestKey = `${shootId}:${key}`;
    try {
      let request = pending.get(requestKey);
      if (!request) {
        request = scheduled(() =>
          api<TaskJob>(`shoots/${shootId}/visuals`, "POST", {
            target,
            force,
            idempotencyKey: `visual:${key}:${crypto.randomUUID()}`,
          }),
        );
        pending.set(requestKey, request);
      }
      const result = await request;
      if (active.current && currentKey.current === key) {
        setJob(result);
        if (result.status === "SUCCEEDED") await load();
      }
    } catch (e) {
      if (active.current && currentKey.current === key) {
        setError((e as Error).message);
        // An inline request may outlive the HTTP connection; recover its durable job instead of starting a second paid request.
        try {
          const data = await load();
          if (
            data.jobs.some(
              (v) =>
                v.targetKey === key &&
                ["QUEUED", "RUNNING"].includes(v.job.status),
            )
          )
            setError("");
        } catch {
          /* Keep the original actionable failure. */
        }
      }
    } finally {
      pending.delete(requestKey);
      if (active.current && currentKey.current === key) setBusy(false);
    }
  };
  useEffect(() => {
    active.current = true;
    setImage(null);
    setJob(null);
    setError("");
    load()
      .then((data) => {
        if (
          !active.current ||
          !autoGenerate ||
          !data.provider.configured ||
          !!data.matchingItem ||
          data.items.some((v) => visualKey(v.target) === key) ||
          data.jobs.some(
            (v) =>
              v.targetKey === key &&
              ["QUEUED", "RUNNING"].includes(v.job.status),
          ) ||
          autoAttempted.has(`${shootId}:${key}`) ||
          attempted.current === key
        )
          return;
        attempted.current = key;
        autoAttempted.add(`${shootId}:${key}`);
        void generate();
      })
      .catch((e) => {
        if (active.current) setError(e.message);
      });
    return () => {
      active.current = false;
    };
  }, [shootId, key, autoGenerate]);
  useEffect(() => {
    if (!job || !["QUEUED", "RUNNING"].includes(job.status)) return;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      api<TaskJob>(`jobs/${job.id}`)
        .then(async (next) => {
          if (active.current) {
            setJob(next);
            if (next.status === "SUCCEEDED") await load();
          }
        })
        .catch((e) => {
          if (active.current) setError(e.message);
        })
        .finally(() => {
          polling = false;
        });
    }, 1200);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);
  const abandoned =
    !!job &&
    ((job.status === "QUEUED" &&
      Date.now() - Date.parse(job.updatedAt) > 60000) ||
      (job.status === "RUNNING" &&
        Date.now() - Date.parse(job.updatedAt) > 300000));
  const pendingJob =
    !!job && ["QUEUED", "RUNNING"].includes(job.status) && !abandoned;
  const retry = async () => {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<TaskJob>(`jobs/${job.id}/retry`, "POST", {});
      setJob(next);
      if (next.status === "SUCCEEDED") await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <figure className="recommendation-visual">
      {image ? (
        <>
          <Image
            unoptimized
            width={1024}
            height={1024}
            src={`/api/v1/shoots/${shootId}/visuals/${image.id}/download`}
            alt={`Original AI-generated ${target.kind.toLowerCase()} proposal`}
            onError={() => {
              setImage(null);
              setError(
                "This image is unavailable or its inputs/permissions changed. Regenerate from current guidance.",
              );
            }}
            style={{ width: "100%", height: "auto", borderRadius: 16 }}
          />
          <figcaption>
            AI-generated proposal · {image.provider}. Fictional people; review
            details, safety and color in practice.{" "}
            <a
              href={`/api/v1/shoots/${shootId}/visuals/${image.id}/download`}
              download
            >
              Download PNG
            </a>
          </figcaption>
        </>
      ) : (
        <p role="status">
          {busy || pendingJob
            ? `Creating and reviewing your original image${job ? ` · ${human(job.status)}` : "…"}`
            : configured === false
              ? "Live image generation is not configured. No dummy image is shown."
              : "Your original image will appear here."}
        </p>
      )}
      {configured === false && (
        <p className="hint">
          Configure AI_IMAGE_PROVIDER=openai and OPENAI_API_KEY securely on the
          server.
        </p>
      )}
      {(error || job?.status === "FAILED") && (
        <p role="alert">{error || providerFailure(job?.errorCode)}</p>
      )}
      <button
        className="secondary"
        disabled={busy || pendingJob || configured !== true}
        onClick={() =>
          void ((abandoned || job?.status === "FAILED") &&
          job &&
          job.attempts < 3
            ? retry()
            : generate(!!image))
        }
      >
        {abandoned
          ? "Resume image generation"
          : image
            ? "Generate a new image"
            : error || job?.status === "FAILED"
              ? "Retry image generation"
              : "Generate original image"}
      </button>
    </figure>
  );
}
