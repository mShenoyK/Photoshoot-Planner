import { test, expect } from "@playwright/test";
for (const width of [375, 768, 1280, 1440])
  test(`create, autosave and reopen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "New here? Create account" })
      .click();
    await page
      .getByLabel("Email address")
      .fill(`browser-${width}-${Date.now()}@example.com`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("browser-password-123");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page).toHaveURL(/dashboard/);
    await expect(
      page.getByText("Your next story starts with a brief."),
    ).toBeVisible();
    await page.getByRole("link", { name: "Plan a new shoot" }).click();
    await page.getByLabel("Shoot name").fill("Golden Hour Family");
    await page.getByLabel("Shoot format").selectOption("PORTRAIT_GROUP");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Subject category").selectOption("FAMILY_MIXED");
    await page.getByLabel("Number of people").fill("4");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Scene", { exact: true }).fill("Garden");
    await page.getByLabel("Occasion").fill("Family memories");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("status")).toHaveText("All changes saved");
    await expect(page).toHaveURL(/shoots\/[a-f0-9-]+/);
    const url = page.url();
    await page.screenshot({
      path: `/tmp/framecraft-review-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.reload();
    await page.getByLabel("Shoot name").fill("Golden Hour Revised");
    const savedId = new URL(url).pathname.split("/").pop();
    await expect
      .poll(async () => {
        const response = await page.request.get("/api/v1/shoots/" + savedId);
        return (await response.json()).data?.name;
      })
      .toBe("Golden Hour Revised");
    await expect(page.getByRole("status")).toHaveText("All changes saved");
    await page.goto("/dashboard");
    await expect(
      page.getByRole("link", { name: "Golden Hour Revised" }),
    ).toBeVisible();
    await page.screenshot({
      path: `/tmp/framecraft-dashboard-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "Golden Hour Revised" }).click();
    await expect(page.getByLabel("Shoot name")).toHaveValue(
      "Golden Hour Revised",
    );
    expect(page.url()).toBe(url);
    await page.screenshot({
      path: `/tmp/framecraft-wizard-${width}.png`,
      fullPage: true,
    });
  });
test("protects workspace", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL("/");
});

test("save errors retain edits and support retry", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New here? Create account" }).click();
  await page
    .getByLabel("Email address")
    .fill(`retry-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByRole("link", { name: "Plan a new shoot" }).click();
  await page.route(
    "**/api/v1/shoots",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          data: null,
          error: {
            code: "UNAVAILABLE",
            message: "Temporary service interruption.",
          },
          meta: {},
        }),
      }),
    { times: 1 },
  );
  await page.getByLabel("Shoot name").fill("Retryable family brief");
  await expect(page.locator("main [role=alert]")).toContainText(
    "Temporary service interruption.",
  );
  await expect(page.getByLabel("Shoot name")).toHaveValue(
    "Retryable family brief",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(page).toHaveURL(/shoots\/new/);
  await expect(page.getByLabel("Shoot name")).toHaveValue(
    "Retryable family brief",
  );
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  await page.getByLabel("Shoot name").fill("x");
  await expect(page.locator("main [role=alert]")).toContainText("name");
  await expect(page.getByRole("status")).not.toHaveText("All changes saved");
});

test("PWA serves a static offline notice without private cached pages", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "You’re offline." }),
  ).toBeVisible();
  await context.setOffline(false);
});

test("persists indoor portfolio details with optional subject count", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New here? Create account" }).click();
  await page
    .getByLabel("Email address")
    .fill(`portfolio-${Date.now()}@example.com`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByRole("link", { name: "Plan a new shoot" }).click();
  await page.getByLabel("Shoot name").fill("Studio portfolio");
  await page.getByLabel("Description").fill("Quiet editorial portraits");
  await page.getByLabel("Environment", { exact: true }).selectOption("INDOOR");
  await page.getByLabel("Shoot format").selectOption("PORTFOLIO");
  await page.getByLabel("Shoot date").fill("2027-02-12");
  await page.getByLabel("Start time").fill("10:30");
  await page.getByLabel("Time zone").fill("Asia/Kolkata");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Subject category").selectOption("GROUP_MIXED");
  await page.getByLabel("Number of people").fill("");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Lighting preference").selectOption("ARTIFICIAL");
  await page.getByLabel("Scene", { exact: true }).fill("Studio backdrop");
  await page.getByLabel("Surroundings").fill("Grey backdrop; step-free access");
  await page.getByLabel("Occasion").fill("Portfolio refresh");
  await expect(page.getByRole("status")).toHaveText("All changes saved");
  const id = page.url().split("/").pop();
  const response = await page.request.get("/api/v1/shoots/" + id);
  expect(response.ok()).toBe(true);
  const { data } = await response.json();
  expect(data).toMatchObject({
    name: "Studio portfolio",
    description: "Quiet editorial portraits",
    shootType: "INDOOR",
    portraitCategory: "PORTFOLIO",
    subjectCategory: "GROUP_MIXED",
    date: "2027-02-12",
    time: "10:30",
    timezone: "Asia/Kolkata",
    settings: {
      lightMode: "ARTIFICIAL",
      sceneCategory: "Studio backdrop",
      sceneDetails: "Grey backdrop; step-free access",
      occasion: "Portfolio refresh",
    },
  });
  expect(data.subjectCount).toBeUndefined();
  await page.reload();
  await expect(page.getByLabel("Description")).toHaveValue(
    "Quiet editorial portraits",
  );
  await expect(page.getByLabel("Shoot date")).toHaveValue("2027-02-12");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Number of people")).toHaveValue("");
});
