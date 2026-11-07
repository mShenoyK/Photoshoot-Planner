import { sceneSchema, type Scene } from "./styling";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** Original vector primitives only. No external resources, photos, scripts or book artwork. */
export function renderLightingSvg(input: Scene, view: "top" | "side"): string {
  const s = sceneSchema.parse(input);
  const x = (n: number) => 45 + (n / s.bounds.width) * 510;
  const y = (n: number) =>
    50 + (n / (view === "top" ? s.bounds.height : 4)) * 300;
  const sy = (p: { y: number; heightM: number }) =>
    view === "top" ? y(p.y) : y(4 - p.heightM);
  const arrow = (p: Scene["camera"], color: string) => {
    if (view !== "top") return "";
    const a = (p.directionDeg * Math.PI) / 180;
    const ex = x(p.x) + 36 * Math.cos(a),
      ey = sy(p) + 36 * Math.sin(a);
    return `<path d="M${x(p.x)},${sy(p)} L${ex},${ey}" stroke="${color}" stroke-width="3" marker-end="url(#arrow)"/>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420" role="img" aria-labelledby="title desc"><title id="title">Lighting ${view} view</title><desc id="desc">Original schematic, ${s.subjects.length} subjects. ${view === "side" ? "Side elevation projects lateral positions; depth is omitted." : "Arrows show camera and light directions."} Illustrative positions in meters; verify on location.</desc><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#536b60"/></marker></defs><rect width="600" height="420" fill="#faf8f2"/><rect x="30" y="40" width="540" height="330" fill="none" stroke="#536b60"/><text x="30" y="25" fill="#172d24">${view === "top" ? "Top view · meters" : "Side elevation · height 0–4 m"}</text><path d="M45 ${view === "top" ? y(s.backdrop.y) : 75} H555" stroke="#666" stroke-dasharray="7 5"/><text x="46" y="65" font-size="12">${s.backdrop.kind === "BLACK" ? "Dark backdrop" : "Scene / background"}</text>${s.subjects.map((p, i) => `<g data-subject="${escape(p.id)}"><circle cx="${x(p.x)}" cy="${sy(p)}" r="12" fill="#365d4d"/><text x="${x(p.x) + 15}" y="${sy(p) + (i % 2 ? 23 : -15)}" font-size="12" fill="#172d24">${i + 1}. ${escape(p.label.slice(0, 30))}</text></g>`).join("")}${s.lights.map((p) => `<g>${arrow(p, "#956525")}<rect x="${x(p.x) - 10}" y="${sy(p) - 10}" width="20" height="20" fill="#b07c34"/><text x="${x(p.x) + 14}" y="${sy(p) - 10}" font-size="12">${p.purpose} · ${p.kind}</text></g>`).join("")}${arrow(s.camera, "#365d4d")}<rect x="${x(s.camera.x) - 12}" y="${sy(s.camera) - 8}" width="24" height="16" fill="#172d24"/><text x="${x(s.camera.x) + 16}" y="${sy(s.camera) + 5}" font-size="12">Camera</text><text x="30" y="400" font-size="12" fill="#172d24">Illustrative starting geometry · verify coverage, distances and exposure.</text></svg>`;
}
