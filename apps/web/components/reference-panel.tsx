"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type {
  ReferenceReview,
  ReferenceAnalysis,
} from "@framecraft/shared/references";
import type { PublicMedia } from "./photo-intake";
import { api, human } from "./client";
type VisibleReview = Omit<ReferenceReview, "consentIds">;
export function ReferencePanel({
  shootId,
  onApproved,
  refreshKey,
}: {
  shootId: string;
  onApproved?: () => void;
  refreshKey?: string;
}) {
  const [media, setMedia] = useState<PublicMedia[]>([]);
  const [reviews, setReviews] = useState<VisibleReview[]>([]);
  const [mode, setMode] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    const [input, result] = await Promise.all([
      api<{ media: PublicMedia[] }>(`shoots/${shootId}/inputs`),
      api<{ provider: string; configured: boolean; reviews: VisibleReview[] }>(
        `shoots/${shootId}/references`,
      ),
    ]);
    setMedia(input.media);
    setReviews(result.reviews);
    setMode(result.provider);
    setConfigured(result.configured);
  };
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [shootId, refreshKey]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reference review failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="reference-panel panel">
      <div className="section-intro">
        <div>
          <p className="eyebrow">Start with what inspires you</p>
          <h2>Your reference images.</h2>
          <p>
            Bring a person, a place or a pose. Review visible proportions,
            colors and light, then confirm what should shape your shoot.
          </p>
        </div>
        <Link
          className="button secondary"
          href={`/shoots/${shootId}/subjects#photo-intake`}
        >
          Upload reference images
        </Link>
      </div>
      <p className="hint">
        {mode === "mock"
          ? "Local mock: example observations only. No body-shape or color detection is performed."
          : configured
            ? "OpenAI vision: only the private, metadata-stripped copy is sent after you request analysis and grant permission."
            : "Photo analysis needs an OpenAI API key in the server settings. Manual profiles and styling preferences still work."}{" "}
        Observations can be affected by clothing, cropping, perspective and
        color casts. No personality, identity or precise measurements are
        inferred.
      </p>
      {loading && <p>Loading references…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!loading && !media.length && (
        <div className="reference-empty">
          <span aria-hidden>＋</span>
          <p>
            Add an individual photo for styling, a scene for lighting, or a pose
            reference for direction. Manual planning remains available.
          </p>
        </div>
      )}
      <div className="reference-grid">
        {media.map((m) => {
          const review = reviews.find((r) => r.assetId === m.id);
          return (
            <article key={m.id} className="reference-card">
              <Image
                unoptimized
                width={480}
                height={320}
                src={`/api/v1/shoots/${shootId}/media/${m.id}/download`}
                alt={`Private ${human(m.kind)} reference`}
                style={{ width: "100%", height: 200, objectFit: "contain" }}
              />
              <p>
                {human(m.kind)} · {m.fileName}
              </p>
              <button
                className="secondary"
                disabled={busy || (!configured && mode !== "mock")}
                onClick={() =>
                  run(async () => {
                    if (
                      !confirm(
                        mode === "mock"
                          ? "Create a clearly labeled example review? Mock mode does not analyze the photo."
                          : "Analyze this private image with OpenAI? Every identifiable person must have current analysis consent.",
                      )
                    )
                      return;
                    await api(
                      `shoots/${shootId}/references/${m.id}/analyze`,
                      "POST",
                      { acknowledged: true },
                    );
                    await load();
                  })
                }
              >
                {review ? "Re-analyze reference" : "Analyze reference"}
              </button>
              {review && (
                <ReviewEditor
                  key={review.id + String(review.approved)}
                  review={review}
                  busy={busy}
                  onSave={(analysis, approved) =>
                    run(async () => {
                      await api(
                        `shoots/${shootId}/references/${review.id}`,
                        "PATCH",
                        { analysis, approved },
                      );
                      await load();
                      onApproved?.();
                    })
                  }
                />
              )}
            </article>
          );
        })}
      </div>
      {busy && (
        <p role="status">
          Reviewing your reference… Your existing plan is kept.
        </p>
      )}
    </section>
  );
}
function ReviewEditor({
  review,
  busy,
  onSave,
}: {
  review: VisibleReview;
  busy: boolean;
  onSave: (analysis: ReferenceAnalysis, approved: boolean) => Promise<boolean>;
}) {
  const [a, setA] = useState(review.analysis);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    const nav = (e: MouseEvent) => {
      if (
        dirty &&
        (e.target as Element).closest("a") &&
        !confirm("Discard unconfirmed reference edits?")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", nav, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", nav, true);
    };
  }, [dirty]);
  return (
    <details className="review-editor" open={!review.approved}>
      <summary className="badge">
        {review.approved ? "Reviewed and included" : "Confirm observations"} ·{" "}
        {review.provider.startsWith("mock") ? "Mock example" : "Photo review"}
      </summary>
      <p className="hint">
        Edit before confirming. Regenerate the relevant plan, lighting or
        unlocked looks to apply changes.
      </p>
      <fieldset disabled={busy} onChange={() => setDirty(true)}>
        {(
          [
            ["sceneSummary", "Scene observations"],
            ["lightingNotes", "Light observations"],
            [
              "visibleProportions",
              "Visible proportions / body-shape impression",
            ],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              maxLength={1500}
              value={a[key]}
              onChange={(e) => setA({ ...a, [key]: e.target.value })}
            />
          </label>
        ))}
        <label>
          Key light side
          <select
            value={a.keySide}
            onChange={(e) =>
              setA({
                ...a,
                keySide: e.target.value as ReferenceAnalysis["keySide"],
              })
            }
          >
            {["LEFT", "RIGHT", "FRONT", "UNCERTAIN"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Fit and comfort suggestions
          <textarea
            value={a.fitSuggestions.join("\n")}
            onChange={(e) =>
              setA({
                ...a,
                fitSuggestions: e.target.value
                  .split("\n")
                  .filter(Boolean)
                  .slice(0, 6),
              })
            }
          />
        </label>
        <label>
          Posing observations
          <textarea
            maxLength={6000}
            value={a.posingNotes.join("\n")}
            onChange={(e) =>
              setA({
                ...a,
                posingNotes: e.target.value
                  .split("\n")
                  .filter(Boolean)
                  .slice(0, 6),
              })
            }
          />
        </label>
        <label>
          Observed garment/background colors (hex, comma separated)
          <input
            value={a.visibleColors.join(", ")}
            maxLength={80}
            onChange={(e) =>
              setA({
                ...a,
                visibleColors: e.target.value
                  .split(",")
                  .map((c) => c.trim())
                  .filter(Boolean)
                  .slice(0, 8),
              })
            }
          />
        </label>
        <div className="palette-strip" aria-label="Suggested photo palette">
          {a.suggestedColors.map((color, i) => (
            <label key={i}>
              <input
                type="color"
                aria-label={`Suggested color ${i + 1}`}
                value={color}
                onChange={(e) =>
                  setA({
                    ...a,
                    suggestedColors: a.suggestedColors.map((c, j) =>
                      j === i ? e.target.value : c,
                    ),
                  })
                }
              />
              <span>{color}</span>
            </label>
          ))}
        </div>
        {a.outfits.map((outfit, i) => (
          <details key={i}>
            <summary>
              Outfit {i + 1}: {outfit.name}
            </summary>
            <label>
              Outfit concept
              <input
                maxLength={120}
                value={outfit.name}
                onChange={(e) =>
                  setA({
                    ...a,
                    outfits: a.outfits.map((o, j) =>
                      j === i ? { ...o, name: e.target.value } : o,
                    ),
                  })
                }
              />
            </label>
            <label>
              Garments
              <textarea
                maxLength={6000}
                value={outfit.garments.join("\n")}
                onChange={(e) =>
                  setA({
                    ...a,
                    outfits: a.outfits.map((o, j) =>
                      j === i
                        ? {
                            ...o,
                            garments: e.target.value
                              .split("\n")
                              .filter(Boolean)
                              .slice(0, 6),
                          }
                        : o,
                    ),
                  })
                }
              />
            </label>
            <label>
              Outfit rationale
              <textarea
                maxLength={1500}
                value={outfit.rationale}
                onChange={(e) =>
                  setA({
                    ...a,
                    outfits: a.outfits.map((o, j) =>
                      j === i ? { ...o, rationale: e.target.value } : o,
                    ),
                  })
                }
              />
            </label>
          </details>
        ))}
        <p>{a.caveats.join(" ")}</p>
        <button
          onClick={async () => {
            if (await onSave(a, true)) setDirty(false);
          }}
        >
          Confirm and use reference
        </button>
        {review.approved && (
          <button
            className="secondary"
            onClick={async () => {
              if (await onSave(a, false)) setDirty(false);
            }}
          >
            Exclude reference from planning
          </button>
        )}
      </fieldset>
    </details>
  );
}
