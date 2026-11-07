"use client";
import { useEffect, useState } from "react";
import type {
  KnowledgeDocument,
  KnowledgeChunk,
  TaskJob,
} from "@framecraft/shared/knowledge";
import { api, human } from "./client";
type Doc = Pick<
  KnowledgeDocument,
  | "mime"
  | "allowDerivedUse"
  | "id"
  | "title"
  | "status"
  | "pages"
  | "imageOnlyPages"
  | "sha256"
  | "licenseStatus"
  | "allowPrivateReview"
  | "allowPrivateVision"
  | "taxonomy"
> & { chunkCount: number; approvedChunks: number; chunks?: KnowledgeChunk[] };
export function KnowledgeLibrary() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [selected, setSelected] = useState<Doc | null>(null);
  const [job, setJob] = useState<TaskJob | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [showPage, setShowPage] = useState(false);
  const [vision, setVision] = useState("");
  const [visual, setVisual] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const load = () => api<Doc[]>("admin/knowledge/documents").then(setDocs);
  const detail = (id: string) =>
    api<Doc>("admin/knowledge/documents/" + id).then((d) => {
      setSelected(d);
      setPage(d.imageOnlyPages[0] ?? 1);
      setShowPage(false);
    });
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!job || !["QUEUED", "RUNNING"].includes(job.status)) return;
    let active = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      api<TaskJob>("jobs/" + job.id)
        .then(async (next) => {
          if (!active) return;
          if (next.status === "SUCCEEDED") {
            await load();
            const id = String(next.result?.documentId ?? selected?.id ?? "");
            if (id) await detail(id);
          }
          setJob(next);
          if (next.status === "FAILED")
            setError(
              `Task failed: ${next.errorCode}. Review the source and retry.`,
            );
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          polling = false;
        });
    }, 600);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="hero">
        <div>
          <p className="eyebrow">Private knowledge administration</p>
          <h1>Knowledge, with provenance.</h1>
          <p>
            Ingest only sources you have permission to process. Reviewed
            original paraphrases guide plans; source PDFs and page illustrations
            stay private.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {job && (
        <section className="banner">
          <div>
            <h3>Ingestion / indexing task · {human(job.status)}</h3>
            <p role="status">
              {job.progress}% · attempt {job.attempts} of 3
            </p>
            {job.status === "FAILED" && (
              <button
                disabled={busy || job.attempts >= 3}
                onClick={() =>
                  void action(async () => {
                    setJob(
                      await api<TaskJob>(`jobs/${job.id}/retry`, "POST", {}),
                    );
                  })
                }
              >
                Retry task
              </button>
            )}
          </div>
        </section>
      )}
      <section className="panel">
        <h2>Add a private source</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            if (!file) {
              setError("Choose a Markdown or PDF source.");
              return;
            }
            void action(async () => {
              const metadata = {
                title: String(form.get("title")),
                author: String(form.get("author")),
                edition: String(form.get("edition")),
                licenseStatus: String(form.get("license")),
                ingestionPermitted: form.get("rights") === "on",
                allowDerivedUse: form.get("derived") === "on",
                allowPrivateReview: form.get("review") === "on",
                allowPrivateVision: form.get("vision") === "on",
                taxonomy: {
                  environments: form.get("environment")
                    ? [String(form.get("environment"))]
                    : [],
                  ageGroups: [],
                  minSubjects: Number(form.get("min")),
                  maxSubjects: Number(form.get("max")),
                  topics: ["POSE", "COMPOSITION"],
                },
              };
              const upload = new FormData();
              upload.set("metadata", JSON.stringify(metadata));
              upload.set("file", file);
              const response = await fetch(
                "/api/v1/admin/knowledge/documents",
                { method: "POST", body: upload },
              );
              const body = await response.json();
              if (!response.ok)
                throw new Error(
                  body.error?.message ?? "Ingestion request failed.",
                );
              setNotice(
                body.data.duplicate
                  ? "Duplicate checksum: existing source reused."
                  : "Source received privately; extraction is queued.",
              );
              await load();
              await detail(body.data.document.id);
              if (body.data.jobId) {
                const current = await api<TaskJob>("jobs/" + body.data.jobId);
                setJob(current);
                if (current.status === "SUCCEEDED") {
                  await load();
                  await detail(body.data.document.id);
                }
              }
            });
          }}
        >
          <div className="row">
            <div className="field">
              <label htmlFor="source-title">Document title</label>
              <input
                id="source-title"
                name="title"
                required
                minLength={3}
                maxLength={160}
              />
            </div>
            <div className="field">
              <label htmlFor="source-author">Author (optional)</label>
              <input id="source-author" name="author" maxLength={160} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="edition">Edition (optional)</label>
              <input id="edition" name="edition" maxLength={100} />
            </div>
            <div className="field">
              <label htmlFor="license">Rights assessment</label>
              <select id="license" name="license">
                <option value="PRIVATE_REFERENCE">
                  Private reference; permissions assessed
                </option>
                <option value="OWNED">I own the source rights</option>
                <option value="LICENSED">Licensed for this use</option>
                <option value="PUBLIC_DOMAIN">Verified public domain</option>
                <option value="UNVERIFIED">
                  Unverified — ingestion blocked
                </option>
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="source-environment">Environment taxonomy</label>
              <select id="source-environment" name="environment">
                <option value="">Any environment</option>
                <option value="INDOOR">Indoor</option>
                <option value="OUTDOOR">Outdoor</option>
              </select>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="min-people">Minimum people</label>
                <input
                  id="min-people"
                  name="min"
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={1}
                />
              </div>
              <div className="field">
                <label htmlFor="max-people">Maximum people</label>
                <input
                  id="max-people"
                  name="max"
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={20}
                />
              </div>
            </div>
          </div>
          <label className="check">
            <input type="checkbox" name="rights" required /> I have permission
            to privately ingest and process this source.
          </label>
          <label className="check">
            <input type="checkbox" name="derived" /> Rights permit original
            derived guidance in my plans.
          </label>
          <label className="check">
            <input type="checkbox" name="review" /> Permit private
            extracted-text and PDF thumbnail review.
          </label>
          <label className="check">
            <input type="checkbox" name="vision" /> Separately permit private
            page vision review (mock aid unless a provider is configured).
          </label>
          <div className="field">
            <label htmlFor="source-file">
              Markdown or PDF source (10 MB maximum; up to 150 PDF pages)
            </label>
            <input
              id="source-file"
              type="file"
              accept=".md,.markdown,.pdf,text/markdown,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          <button disabled={busy}>
            {busy ? "Submitting…" : "Ingest privately"}
          </button>
        </form>
      </section>
      <div className="workspace-stack">
        <section className="panel">
          <h2>Your private sources</h2>
          {docs === null ? (
            <p role="status">Loading your library…</p>
          ) : !docs.length ? (
            <p className="hint">
              No ingested sources yet. Plans can still use clearly labeled,
              uncited mock guidance.
            </p>
          ) : (
            docs.map((d) => (
              <article className="media-row" key={d.id}>
                <span className="badge">{human(d.status)}</span>
                <h3>{d.title}</h3>
                <p className="hint">
                  {d.chunkCount} chunks · {d.approvedChunks} approved ·{" "}
                  {d.pages} pages · {human(d.licenseStatus)}
                </p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void action(() => detail(d.id))}
                >
                  Review {d.title}
                </button>
              </article>
            ))
          )}
        </section>
        {selected && (
          <section className="panel">
            <p className="eyebrow">Source review · never an export asset</p>
            <h2>{selected.title}</h2>
            <p className="hint">
              SHA-256: <span className="hash">{selected.sha256}</span>
            </p>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    setJob(
                      await api<TaskJob>(
                        `admin/knowledge/documents/${selected.id}/embeddings`,
                        "POST",
                        {},
                      ),
                    ),
                  )
                }
              >
                Queue optional embeddings
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Reindexing replaces reviewed chunks and can invalidate older plan citations. Continue?",
                    )
                  )
                    void action(async () =>
                      setJob(
                        await api<TaskJob>(
                          `admin/knowledge/documents/${selected.id}/reindex`,
                          "POST",
                          {},
                        ),
                      ),
                    );
                }}
              >
                Reindex source
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Delete this private source? Plans using it will require new valid sources before approval.",
                    )
                  )
                    void action(async () => {
                      await api(
                        `admin/knowledge/documents/${selected.id}`,
                        "DELETE",
                      );
                      setSelected(null);
                      await load();
                    });
                }}
              >
                Delete source
              </button>
            </div>
            {selected.mime === "application/pdf" &&
              selected.pages > 0 &&
              selected.allowPrivateReview && (
                <details>
                  <summary>Private page thumbnail / visual review</summary>
                  <p className="hint">
                    For authorized workbook review only. Original illustrations
                    are never used as pose images or included in generated
                    plans.
                  </p>
                  <div className="field">
                    <label htmlFor="review-page">Source page</label>
                    <input
                      id="review-page"
                      type="number"
                      min={1}
                      max={selected.pages}
                      value={page}
                      onChange={(e) => {
                        setPage(Number(e.target.value));
                        setShowPage(false);
                      }}
                    />
                  </div>
                  <button
                    className="secondary"
                    onClick={() => setShowPage(true)}
                  >
                    Show private thumbnail
                  </button>
                  {showPage && (
                    <img
                      className="private-page"
                      onError={() => {
                        setError(
                          "The private page could not be rendered. Check source rights and page number, then retry.",
                        );
                        setShowPage(false);
                      }}
                      alt={`Private review of ${selected.title}, page ${page}`}
                      src={`/api/v1/admin/knowledge/documents/${selected.id}/pages/${page}`}
                    />
                  )}
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={busy || !selected.allowPrivateVision}
                      onClick={() =>
                        void action(async () => {
                          const r = await api<{
                            summary: string;
                            notes: string[];
                          }>(
                            `admin/knowledge/documents/${selected.id}/vision/${page}`,
                            "POST",
                            {},
                          );
                          setVision([r.summary, ...r.notes].join(" "));
                        })
                      }
                    >
                      Request private vision review
                    </button>
                  </div>
                  {vision && <p className="quality-note">{vision}</p>}
                  <div className="field">
                    <label htmlFor="visual-summary">
                      Original page guidance for manual review
                    </label>
                    <textarea
                      id="visual-summary"
                      maxLength={800}
                      value={visual}
                      onChange={(e) => setVisual(e.target.value)}
                    />
                  </div>
                  <button
                    disabled={busy || visual.trim().length < 12}
                    onClick={() =>
                      void action(async () => {
                        await api(
                          `admin/knowledge/documents/${selected.id}/visual-cards`,
                          "POST",
                          { page, summary: visual },
                        );
                        await detail(selected.id);
                        await load();
                        setVisual("");
                      })
                    }
                  >
                    Add pending visual guidance card
                  </button>
                </details>
              )}
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api(
                    `admin/knowledge/documents/${selected.id}`,
                    "PATCH",
                    { allowDerivedUse: !selected.allowDerivedUse },
                  );
                  await detail(selected.id);
                  await load();
                })
              }
            >
              {selected.allowDerivedUse
                ? "Withdraw derived-use permission"
                : "Restore assessed derived-use permission"}
            </button>
            <h3>Review original paraphrases</h3>
            <p className="hint">
              Only approved guidance with derived-use permission enters
              retrieval. Long copied source phrases are rejected. Embeddings use
              approved summaries only.
            </p>
            {selected.chunks?.map((c) => (
              <ChunkReview
                key={c.id + ":" + c.revision}
                documentId={selected.id}
                chunk={c}
                onSaved={() =>
                  void action(async () => {
                    await detail(selected.id);
                    await load();
                  })
                }
              />
            ))}
          </section>
        )}
      </div>
    </>
  );
}
function ChunkReview({
  documentId,
  chunk,
  onSaved,
}: {
  documentId: string;
  chunk: KnowledgeChunk;
  onSaved: () => void;
}) {
  const [summary, setSummary] = useState(chunk.summary);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <article className="media-row">
      <span className="badge">{human(chunk.reviewStatus)}</span>
      <p className="hint">
        {chunk.pageStart
          ? `Page ${chunk.pageStart}`
          : `Lines ${chunk.lineStart}–${chunk.lineEnd}`}{" "}
        · {chunk.headingPath.join(" / ")}
      </p>
      {chunk.text && (
        <details>
          <summary>Private extracted text preview</summary>
          <p className="source-preview">{chunk.text}</p>
        </details>
      )}
      <label className="field">
        Original paraphrased guidance
        <textarea
          aria-label={`Guidance ${chunk.id}`}
          maxLength={800}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {(["APPROVED", "REJECTED"] as const).map((status) => (
          <button
            key={status}
            className={status === "REJECTED" ? "secondary" : ""}
            disabled={busy || summary.trim().length < 12}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(
                  `admin/knowledge/documents/${documentId}/chunks/${chunk.id}`,
                  "PATCH",
                  {
                    summary,
                    reviewStatus: status,
                    baseRevision: chunk.revision,
                    taxonomy: chunk.taxonomy,
                  },
                );
                onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {status === "APPROVED"
              ? "Approve original guidance"
              : "Reject guidance"}
          </button>
        ))}
      </div>
    </article>
  );
}
