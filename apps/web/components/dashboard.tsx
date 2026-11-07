"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Shoot } from "@framecraft/shared";
import { api, human } from "./client";
export function Dashboard() {
  const [shoots, setShoots] = useState<Shoot[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const load = () => {
    setError("");
    api<Shoot[]>("shoots")
      .then(setShoots)
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);
  const filtered = shoots?.filter(
    (s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "ALL" || s.shootType === filter),
  );
  return (
    <>
      <div className="eyebrow">The photographer’s workspace</div>
      <div className="hero">
        <div>
          <h1>Good shoots start here.</h1>
          <p>
            Bring a little intention to your next session. Shape the brief, find
            your light, and make room for the unexpected.
          </p>
        </div>
        <Link className="button" href="/shoots/new">
          <span aria-hidden>＋</span> Plan a new shoot
        </Link>
      </div>
      <div className="banner">
        <div className="symbol" aria-hidden>
          ◌
        </div>
        <div>
          <h3>From first idea to shoot day.</h3>
          <p>
            Start with a brief. No reference photographs required. Planning,
            lighting, and wardrobe tools arrive in upcoming milestones.
          </p>
        </div>
      </div>
      <div className="toolbar">
        <h2>
          Your shoots{" "}
          <span className="muted">{shoots ? `(${shoots.length})` : ""}</span>
        </h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            aria-label="Search shoots"
            placeholder="Search your shoots…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Filter environment"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="ALL">All environments</option>
            <option>INDOOR</option>
            <option>OUTDOOR</option>
          </select>
        </div>
      </div>
      {error ? (
        <div role="alert" className="error">
          {error}{" "}
          <button className="secondary" onClick={load}>
            Retry
          </button>
        </div>
      ) : shoots === null ? (
        <div aria-label="Loading shoots" className="grid">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : filtered?.length ? (
        <div className="grid">
          {filtered.map((s) => (
            <article className="shoot-card" key={s.id}>
              <div
                aria-hidden
                className={"card-art " + s.shootType.toLowerCase()}
              />
              <div className="card-body">
                <span className="badge">Draft brief</span>
                <h3>
                  <Link href={"/shoots/" + s.id}>{s.name}</Link>
                </h3>
                <p className="meta">
                  {human(s.shootType)} · {human(s.portraitCategory)}
                  <br />
                  {s.subjectCount ?? "Unspecified"}{" "}
                  {s.subjectCount === 1 ? "person" : "people"} ·{" "}
                  {human(s.settings.lightMode)} light
                </p>
                <Link className="button secondary" href={"/shoots/" + s.id}>
                  Open brief <span aria-hidden>↗</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel empty">
          <div className="symbol" aria-hidden>
            ＋
          </div>
          <h3>
            {shoots.length
              ? "No matching shoots"
              : "Your next story starts with a brief."}
          </h3>
          <p>
            {shoots.length
              ? "Try another search or environment."
              : "Give your shoot a name, choose a setting, and save your first idea."}
          </p>
          <Link className="button" href="/shoots/new">
            Create your first shoot
          </Link>
        </div>
      )}
      <div className="actions">
        <p className="hint">
          Your briefs are private to your account.{" "}
          <Link href="/settings/equipment">Manage camera kits</Link>
          {" · "}
          <Link href="/admin/knowledge">Private knowledge library</Link>
        </p>
        <button
          className="secondary"
          onClick={async () => {
            await api("auth/logout", "POST", {});
            window.location.assign("/");
          }}
        >
          Sign out
        </button>
      </div>
    </>
  );
}
