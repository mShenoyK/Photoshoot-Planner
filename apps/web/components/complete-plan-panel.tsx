"use client";
import { GeneratedVisual } from "./generated-visual";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Styling } from "@framecraft/shared/styling";
import { renderLightingSvg } from "@framecraft/shared/lighting-svg";
import { api, human } from "./client";

type Snapshot = {
  record: {
    planId: string;
    stylingRevision: number;
    referenceIds: string[];
  } | null;
  styling: Styling | null;
  stale: boolean;
  context: {
    environment: string;
    scene: string;
    surroundings: string;
    occasion: string;
    lightMode: string;
  };
  subjects: { id: string; label: string }[];
  referenceCount: number;
  approvedReferenceCount: number;
};
export function CompletePlanPanel({
  shootId,
  planId,
  refresh,
  autoGenerate = false,
}: {
  shootId: string;
  planId?: string;
  refresh: number;
  autoGenerate?: boolean;
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<Snapshot>(`shoots/${shootId}/complete-plan`)
      .then((next) => {
        if (active) {
          setData(next);
          setError("");
        }
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [shootId, refresh]);
  if (error) return <p role="alert">Could not load complete plan: {error}</p>;
  if (!data) return <p role="status">Loading shoot context…</p>;
  const linked = data.record?.planId === planId;
  const lighting = linked ? data.styling?.lighting : null;
  const wardrobe = linked ? data.styling?.wardrobe : null;
  return (
    <section className="panel" aria-label="Complete shoot direction">
      <h2>Your shoot, connected.</h2>
      <p>
        {human(data.context.environment)} · {human(data.context.scene)} ·{" "}
        {human(data.context.lightMode)} ·{" "}
        {data.context.occasion || "Everyday portrait"}
      </p>
      {data.context.surroundings && <p>{data.context.surroundings}</p>}
      <p className="hint">
        {data.approvedReferenceCount} reviewed references available of{" "}
        {data.referenceCount} attached. Only confirmed observations with current
        consent influence generation. Without photos, guidance uses your brief
        and manual profiles.
      </p>
      {data.record && (
        <p className="hint">
          This bundle used {data.record.referenceIds.length} reviewed references
          · styling revision {data.record.stylingRevision}.
        </p>
      )}
      {data.stale && (
        <p className="quality-note" role="status">
          Inputs or saved versions changed. This bundle is historical; generate
          a complete plan to bring every section together again.
        </p>
      )}
      {!data.record && (
        <p>
          Choose Generate complete shoot plan to save posing, lighting and
          wardrobe together. Add manual people profiles first; reference images
          are optional.
        </p>
      )}
      {data.record && !linked && (
        <p>
          Select the bundled plan version to see its lighting and wardrobe, or
          generate a new complete plan.
        </p>
      )}
      {lighting && (
        <>
          <h2>Lighting setup</h2>
          <p>{lighting.title}</p>
          <GeneratedVisual
            shootId={shootId}
            target={{
              kind: "LIGHTING",
              stylingRevision: data.record!.stylingRevision,
            }}
            autoGenerate={autoGenerate}
          />
          <div className="complete-visual-grid">
            {(["top", "side"] as const).map((view) => (
              <figure key={view}>
                <div
                  className="complete-diagram"
                  dangerouslySetInnerHTML={{
                    __html: renderLightingSvg(lighting.scene, view),
                  }}
                />
                <figcaption>
                  {human(view)} view · original equipment layout, distances in
                  meters
                </figcaption>
              </figure>
            ))}
          </div>
          <dl>
            {Object.entries(lighting.settings).map(([key, value]) => (
              <div key={key}>
                <dt>{human(key)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {lighting.notes.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
          <Link href={`/shoots/${shootId}/lighting`}>
            Edit this setup in Lighting Lab
          </Link>
        </>
      )}
      {wardrobe && (
        <>
          <h2>Wardrobe looks</h2>
          <p>{wardrobe.rationale}</p>
          <div className="complete-visual-grid">
            {wardrobe.looks.map((look) => (
              <article className="media-row" key={look.subjectId}>
                <h3>{look.label}</h3>
                {look.candidates.map((outfit) => (
                  <div className="outfit-reference" key={outfit.id}>
                    <GeneratedVisual
                      key={`${data.record!.stylingRevision}:${look.subjectId}:${outfit.id}`}
                      shootId={shootId}
                      target={{
                        kind: "WARDROBE",
                        stylingRevision: data.record!.stylingRevision,
                        subjectId: look.subjectId,
                        candidateId: outfit.id,
                      }}
                      autoGenerate={autoGenerate}
                    />
                    <div>
                      <h4>
                        {outfit.name}
                        {look.selectedId === outfit.id ? " · Selected" : ""}
                      </h4>
                      <p>{outfit.garments.join(" · ")}</p>
                      <p>{outfit.color}</p>
                      <p>{outfit.suitability}</p>
                      <p>{outfit.rationale}</p>
                      <p>{outfit.comfort}</p>
                      <p>{outfit.alternatives}</p>
                    </div>
                  </div>
                ))}
              </article>
            ))}
          </div>
          <p className="hint">
            Original generated proposals use fictional people and are not
            predictions of fit or depictions of the subject.
          </p>
          <Link href={`/shoots/${shootId}/wardrobe`}>
            Coordinate, lock or swap outfits in Wardrobe Stylist
          </Link>
        </>
      )}
      {linked && (
        <p>
          <Link href={`/shoots/${shootId}/files`}>
            Export this plan — select styling revision{" "}
            {data.record?.stylingRevision}
          </Link>
        </p>
      )}
    </section>
  );
}
