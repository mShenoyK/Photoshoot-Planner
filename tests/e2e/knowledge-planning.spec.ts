import { PDFDocument, rgb } from "pdf-lib";
import { test, expect } from "@playwright/test";
for (const width of [375, 1440])
  test(`private ingestion, retrieval-grounded plans and versioned edits at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "New here? Create account" })
      .click();
    await page
      .getByLabel("Email address")
      .fill(`knowledge-browser-${width}-${Date.now()}@example.com`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("browser-password-123");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page).toHaveURL(/dashboard/);
    await page.getByRole("link", { name: "Private knowledge library" }).click();
    await page
      .getByLabel("Document title")
      .fill("Original outdoor portrait notes");
    await page.getByLabel("I have permission").check();
    await page.getByLabel("Rights permit original").check();
    await page.getByLabel("Permit private extracted-text").check();
    await page.getByLabel("Environment taxonomy").selectOption("OUTDOOR");
    await page.getByLabel("Markdown or PDF source").setInputFiles({
      name: "original-notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Garden portraits\nUse a comfortable arrangement for family portraits in the garden. Stable seating can help children rest while the photographer checks framing and background.",
      ),
    });
    await page.getByRole("button", { name: "Ingest privately" }).click();
    await expect(
      page.getByText("Ingestion / indexing task · Succeeded", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Review original paraphrases" }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: /Guidance [a-f0-9]+/ })
      .fill(
        "In a garden family portrait, arrange the people comfortably and keep their faces clear of distracting background edges.",
      );
    await page
      .getByRole("button", { name: "Approve original guidance" })
      .click();
    await expect(
      page.getByText("1 chunks · 1 approved", { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: `/tmp/framecraft-knowledge-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "Workspace", exact: true }).click();
    await page.getByRole("link", { name: "Plan a new shoot" }).click();
    await page.getByLabel("Shoot name").fill("Grounded portrait session");
    await expect(page.getByRole("status")).toHaveText("All changes saved");
    await page.getByRole("link", { name: "Plan & Pose Studio" }).click();
    await page
      .getByRole("button", { name: "Generate plan", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Planning job:" }),
    ).toContainText("Succeeded");
    await expect(
      page.getByRole("heading", { name: "Pose cards", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Reviewed source guidance", { exact: true }),
    ).toHaveCount(6);
    await page
      .getByText("Reviewed source principles (private provenance)", {
        exact: true,
      })
      .first()
      .click();
    await expect(
      page.getByText(/Original outdoor portrait notes · lines/).first(),
    ).toBeVisible();
    await page
      .getByLabel("Concept", { exact: true })
      .fill("My original creative direction");
    await page
      .getByRole("button", { name: "Save new version", exact: true })
      .click();
    await expect(page.getByLabel("Version history")).toHaveValue(/.+/);
    await expect(
      page.getByText("DRAFT · version 2", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve as new version" }).click();
    await expect(
      page.getByText("APPROVED · version 3", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Lock brief", exact: true }).click();
    await expect(page.getByLabel("Concept", { exact: true })).toBeDisabled();
    await page
      .getByRole("button", { name: "Regenerate shot list", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Planning job:" }),
    ).toContainText("Succeeded");
    await expect(page.getByLabel("Concept", { exact: true })).toHaveValue(
      "My original creative direction",
    );
    await expect(
      page.getByText("READY · version 5", { exact: false }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/framecraft-plan-${width}.png`,
      fullPage: true,
    });
    await page.reload();
    await expect(page.getByLabel("Concept", { exact: true })).toHaveValue(
      "My original creative direction",
    );
    await page.getByRole("link", { name: "Open Pose Studio" }).click();
    await expect(
      page.getByRole("heading", { name: "Pose Studio." }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Filter pose cards" })
      .fill("Gentle diagonal arrangement");
    await expect(
      page.getByRole("textbox", { name: "Pose title", exact: true }),
    ).toHaveCount(1);
  });

test("private image-only PDF page thumbnail and mock vision review require manual guidance approval", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New here? Create account" }).click();
  await page
    .getByLabel("Email address")
    .fill(`pdf-browser-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByRole("link", { name: "Private knowledge library" }).click();
  await page.getByLabel("Document title").fill("Synthetic private workbook");
  await page.getByLabel("I have permission").check();
  await page.getByLabel("Rights permit original").check();
  await page.getByLabel("Permit private extracted-text").check();
  await page.getByLabel("Separately permit private page vision").check();
  const pdf = await PDFDocument.create();
  pdf.addPage([400, 500]).drawRectangle({
    x: 80,
    y: 100,
    width: 200,
    height: 200,
    color: rgb(0.3, 0.5, 0.4),
  });
  await page.getByLabel("Markdown or PDF source").setInputFiles({
    name: "synthetic-workbook.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByRole("button", { name: "Ingest privately" }).click();
  await expect(
    page.getByText("Ingestion / indexing task · Succeeded", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Private page thumbnail / visual review", { exact: true })
    .click();
  const renderedPage = page.waitForResponse((r) => /\/pages\/1$/.test(r.url()));
  await page.getByRole("button", { name: "Show private thumbnail" }).click();
  expect((await renderedPage).status()).toBe(200);
  const image = page.getByRole("img", {
    name: "Private review of Synthetic private workbook, page 1",
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
      timeout: 15000,
    })
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Request private vision review" })
    .click();
  await expect(
    page.getByText(/no visual understanding or OCR was performed/),
  ).toBeVisible();
  await page
    .getByLabel("Original page guidance for manual review")
    .fill(
      "Use a supported arrangement and keep the composition comfortable for every person.",
    );
  await page
    .getByRole("button", { name: "Add pending visual guidance card" })
    .click();
  await expect(
    page.getByText("Page 1 · Original private page review", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("1 chunks · 0 approved", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/framecraft-private-pdf-review.png",
    fullPage: true,
  });
});
