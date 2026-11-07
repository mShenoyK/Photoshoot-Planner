import { test, expect } from "@playwright/test";
import sharp from "sharp";
for (const width of [375, 1440])
  test(`mixed family, guardian consent, private intake and Canon kit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "New here? Create account" })
      .click();
    await page
      .getByLabel("Email address")
      .fill(`family-${width}-${Date.now()}@example.com`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("browser-password-123");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page).toHaveURL(/dashboard/);
    await page.getByRole("link", { name: "Plan a new shoot" }).click();
    await page.getByLabel("Shoot name").fill("Family with mixed ages");
    await page.getByLabel("Shoot format").selectOption("PORTRAIT_GROUP");
    await expect(page.getByRole("status")).toHaveText("All changes saved");
    await page
      .getByRole("link", { name: "People, photos & equipment" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Every person has a place." }),
    ).toBeVisible();
    async function person(label: string, band: string) {
      await page
        .getByRole("button", { name: "Add a person", exact: true })
        .click();
      await page.getByLabel("Name or label").fill(label);
      await page.getByLabel("Stated age band").selectOption(band);
      await page
        .getByRole("button", { name: "Save subject", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: label, exact: true }),
      ).toBeVisible();
    }
    await person("Parent", "ADULT");
    await person("Child", "CHILD");
    const parent = page.locator(".subject-card").filter({
      has: page.getByRole("heading", { name: "Parent", exact: true }),
    });
    const child = page.locator(".subject-card").filter({
      has: page.getByRole("heading", { name: "Child", exact: true }),
    });
    await child
      .getByText("Photo consent · not recorded", { exact: true })
      .click();
    await expect(
      child.getByRole("button", { name: "Record consent", exact: true }),
    ).toBeDisabled();
    await child.getByLabel("Guardian name").fill("Authorized parent");
    await child.getByLabel("Guardian relationship").fill("Parent");
    await child.getByLabel("I confirm that the subject").check();
    await child.getByLabel("The subject or guardian agreed").check();
    await child
      .getByRole("button", { name: "Record consent", exact: true })
      .click();
    await expect(
      child.getByText("Photo consent · granted", { exact: true }),
    ).toBeVisible();
    await parent
      .getByText("Photo consent · not recorded", { exact: true })
      .click();
    await parent.getByLabel("I confirm that the subject").check();
    await parent.getByLabel("The subject or guardian agreed").check();
    await parent
      .getByRole("button", { name: "Record consent", exact: true })
      .click();
    await expect(
      parent.getByText("Photo consent · granted", { exact: true }),
    ).toBeVisible();
    const upload = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", {
          name: "Private photo intake",
          exact: true,
        }),
      })
      .last();
    await upload
      .getByLabel("Parent · consent granted", { exact: true })
      .check();
    await upload.getByLabel("Child · consent granted", { exact: true }).check();
    const buffer = await sharp({
      create: { width: 512, height: 768, channels: 3, background: "#b2c1a0" },
    })
      .jpeg()
      .toBuffer();
    await page.getByLabel("Choose image").setInputFiles({
      name: "synthetic-family.jpg",
      mimeType: "image/jpeg",
      buffer,
    });
    await page.getByRole("button", { name: "Upload privately" }).click();
    await expect(
      page.getByText("Photo saved privately.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download private copy" }),
    ).toBeVisible();
    await expect(page.getByText(/Low resolution:/)).toBeVisible();
    await page
      .getByRole("button", { name: "Add Canon portrait preset" })
      .click();
    await expect(
      page.getByText("Canon portrait kit added.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Use for this shoot", exact: true })
      .click();
    await expect(
      page.getByText("Canon portrait kit selected for this shoot.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.route("**/api/v1/shoots/*/inputs", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.data.deletionPending = 1;
      await route.fulfill({ response, json });
    });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Retry pending photo deletion" }),
    ).toBeVisible();
    await page.unrouteAll({ behavior: "wait" });
    await page
      .getByRole("button", { name: "Retry pending photo deletion" })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry pending photo deletion" }),
    ).toHaveCount(0);

    await expect(
      page.getByRole("heading", { name: "Child", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download private copy" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Canon EOS R6 Mark II · RF 24–105mm f\/4 · 2 flashes/),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/framecraft-inputs-${width}.png`,
      fullPage: true,
    });
    const consent = page.locator(".subject-card").filter({
      has: page.getByRole("heading", { name: "Child", exact: true }),
    });
    await consent.getByText("Photo consent · granted", { exact: true }).click();
    await consent
      .getByRole("button", { name: "Revoke consent & remove photos" })
      .click();
    await expect(
      consent.getByText("Photo consent · revoked", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download private copy" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Upload privately" }),
    ).toBeDisabled();
  });
