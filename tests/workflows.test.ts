import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaults } from "../packages/shared/src/shoot";
import { blankSubject } from "../packages/shared/src/inputs";
import { store } from "../apps/web/lib/store";
import { withShoot } from "../apps/web/lib/input-repository";
import { withCorpus } from "../apps/web/lib/knowledge-repository";
import {
  ensureBuiltinKnowledge,
  builtinSources,
} from "../apps/web/lib/builtin-knowledge";
import { generatePlan, listPlans } from "../apps/web/lib/planning-service";
import { changeStyling } from "../apps/web/lib/styling-service";
import { validateSources } from "../apps/web/lib/knowledge-service";
import { handle } from "../apps/web/lib/api";
import { token } from "../apps/web/lib/auth";
import { inputs } from "../apps/web/lib/inputs-service";
let dir: string, owner: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fc-workflows-"));
  process.env.DATA_MODE = "mock";
  process.env.MOCK_DATA_FILE = path.join(dir, "data.json");
  process.env.WEB_BASE_URL = "http://localhost:3000";
  process.env.AI_TEXT_PROVIDER = "mock";
  owner = (
    await store.createUser(`workflow-${randomUUID()}@example.com`, "unused")
  ).id;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function fixture(kind: "POSES" | "LIGHTING" | "WARDROBE") {
  const shoot = (await store.save(owner, {
    ...defaults,
    workflowKind: kind,
    name: "Independent session",
  }))!;
  await withShoot(owner, shoot.id, (s) => {
    s.subjects = [
      {
        ...blankSubject,
        id: randomUUID(),
        label: "Guest",
        ageGroup: "ADULT",
        preferredColors: "blue",
        fitComfort: "Soft seams",
        consentHistory: [],
      },
    ];
  });
  return shoot.id;
}
it("installs three deduplicated, owner-private reviewed-note sources with real PDF-page citations", async () => {
  await ensureBuiltinKnowledge(owner);
  await ensureBuiltinKnowledge(owner);
  const documents = await withCorpus(owner, (c) => c.documents);
  expect(documents).toHaveLength(3);
  expect(new Set(documents.map((d) => d.sha256)).size).toBe(3);
  for (const doc of documents) {
    expect(doc.representation).toBe("REVIEWED_NOTES");
    expect(doc.allowPrivateReview).toBe(false);
    expect(doc.chunks.every((c) => c.pageStart! <= doc.pages)).toBe(true);
    expect(builtinSources.some((s) => s.sha256 === doc.sha256)).toBe(true);
  }
  const other = (
    await store.createUser(`other-${randomUUID()}@example.com`, "unused")
  ).id;
  expect((await withCorpus(other, (c) => c.documents)).length).toBe(0);
});
it("generates standalone poses and wardrobe with valid knowledge citations and no photographs or shoot plan prerequisite", async () => {
  const poseId = await fixture("POSES");
  await generatePlan(owner, poseId, randomUUID(), {
    poseCount: 3,
    useKnowledgeBase: true,
    knowledgeOnly: true,
  });
  const plan = (await listPlans(owner, poseId))[0];
  expect(plan.poses.every((p) => p.sourceReferences.length > 0)).toBe(true);
  expect(
    await validateSources(
      owner,
      plan.poses.flatMap((p) => p.sourceReferences),
    ),
  ).toBe(true);
  const wardrobeId = await fixture("WARDROBE");
  const result = await changeStyling(owner, wardrobeId, {
    action: "WARDROBE",
    baseRevision: 0,
    knowledgeOnly: true,
  });
  expect(result.latest?.wardrobe?.knowledgeOnly).toBe(true);
  expect(result.latest?.wardrobe?.looks[0].candidates).toHaveLength(3);
  const refs = result.latest!.wardrobe!.sourceNotes!.map((n) => n.reference);
  expect(refs.length).toBeGreaterThan(0);
  expect(await validateSources(owner, refs)).toBe(true);
  await withShoot(owner, wardrobeId, (s) => {
    expect(s.plans).toBeUndefined();
    expect(s.media).toHaveLength(0);
  });
});
it("does not resurrect deleted sources or override rights on repeated installation", async () => {
  await withCorpus(
    owner,
    (c) => {
      c.documents[0].allowDerivedUse = false;
      c.documents[1].status = "DELETED";
    },
    true,
  );
  await ensureBuiltinKnowledge(owner);
  const docs = await withCorpus(owner, (c) => c.documents);
  expect(docs).toHaveLength(3);
  expect(docs[0].allowDerivedUse).toBe(false);
  expect(docs[1].status).toBe("DELETED");
});
it("exposes independent sessions outside the shoot list, enforces owner and kind scope", async () => {
  const headers = {
    origin: "http://localhost:3000",
    cookie: `fc_session=${await token(owner)}`,
    "Content-Type": "application/json",
  };
  const response = await handle(
    new Request("http://localhost:3000/api/v1/workflows", {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "LIGHTING",
        name: "Window test",
        environment: "INDOOR",
        scene: "Living room",
        occasion: "",
        lightMode: "NATURAL",
      }),
    }),
  );
  expect(response.status).toBe(201);
  const workspace = (await response.json()).data;
  const shootList = await handle(
    new Request("http://localhost:3000/api/v1/shoots", { headers }),
  );
  expect(
    (await shootList.json()).data.some(
      (s: { id: string }) => s.id === workspace.id,
    ),
  ).toBe(false);
  const stranger = (
    await store.createUser(`stranger-${randomUUID()}@example.com`, "unused")
  ).id;
  const denied = await handle(
    new Request(`http://localhost:3000/api/v1/workflows/${workspace.id}`, {
      headers: { ...headers, cookie: `fc_session=${await token(stranger)}` },
    }),
  );
  expect(denied.status).toBe(404);
  await expect(
    inputs.intent(owner, workspace.id, {
      fileName: "ref.jpg",
      mime: "image/jpeg",
      bytes: 100,
      kind: "SCENE_REFERENCE",
      subjectIds: [],
      noIdentifiablePeople: true,
      workflowScope: "WARDROBE",
    }),
  ).rejects.toMatchObject({ code: "WORKFLOW_SCOPE" });
});

it("updates standalone context with revision checks and blocks exports after source revocation", async () => {
  const id = await fixture("WARDROBE");
  const headers = {
    origin: "http://localhost:3000",
    cookie: `fc_session=${await token(owner)}`,
    "Content-Type": "application/json",
  };
  const body = {
    baseRevision: 1,
    name: "Updated session",
    environment: "INDOOR",
    scene: "Window",
    occasion: "Birthday",
    lightMode: "NATURAL",
  };
  const patch = () =>
    handle(
      new Request(`http://localhost:3000/api/v1/workflows/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      }),
    );
  expect((await patch()).status).toBe(200);
  expect((await patch()).status).toBe(409);
  const view = await changeStyling(owner, id, {
    action: "WARDROBE",
    baseRevision: 0,
    knowledgeOnly: true,
  });
  const source = view.latest!.wardrobe!.sourceNotes![0].reference;
  await withCorpus(
    owner,
    (c) => {
      c.documents.find((d) => d.id === source.documentId)!.allowDerivedUse =
        false;
    },
    true,
  );
  const download = await handle(
    new Request(
      `http://localhost:3000/api/v1/shoots/${id}/styling/export.json`,
      { headers },
    ),
  );
  expect(download.status).toBe(409);
});
