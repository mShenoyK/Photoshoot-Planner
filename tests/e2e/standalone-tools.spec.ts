import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { blankSubject } from "../../packages/shared/src/inputs";
for (const width of [375, 1440])
  test(`independent tools, local reference intake and knowledge-only guidance at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 950 });
    const headers = { origin: "http://localhost:3000" };
    const post = async (route: string, data: unknown) => {
      const response = await page.request.post(`/api/v1/${route}`, {
        headers,
        data,
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json()).data;
    };
    await post("auth/register", {
      email: `standalone-${width}-${Date.now()}@example.com`,
      password: "browser-password-123",
    });
    await page.goto("/tools");
    await page
      .getByLabel("Creative tool", { exact: true })
      .selectOption("WARDROBE");
    await page
      .getByLabel("Session name", { exact: true })
      .fill("Independent wardrobe");
    await page.getByRole("button", { name: "Open tool", exact: true }).click();
    await expect(page).toHaveURL(/\/tools\/wardrobe\//);
    const id = page.url().split("/").at(-1)!;
    const person = await post(`shoots/${id}/subjects`, {
      ...blankSubject,
      label: "Pat",
      ageGroup: "ADULT",
      fitComfort: "Soft seams",
      preferredColors: "blue",
    });
    await post(`shoots/${id}/subjects/${person.id}/consents`, {
      status: "GRANTED",
      acknowledged: true,
      confirmedAuthority: true,
      allowAnalysis: true,
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Upload reference images", exact: true })
      .click();
    await expect(
      page.getByText(/Optional views: front in neutral light/),
    ).toBeVisible();
    await page
      .getByLabel("Reference view", { exact: true })
      .selectOption("FULL_LENGTH");
    await page.getByRole("checkbox", { name: /Pat · consent granted/ }).check();
    const image = await sharp({
      create: { width: 512, height: 768, channels: 3, background: "#758cac" },
    })
      .jpeg()
      .toBuffer();
    await page
      .getByLabel("Choose image (JPG, PNG or WebP; default limit 15 MB)")
      .setInputFiles({
        name: "synthetic-outfit.jpg",
        mimeType: "image/jpeg",
        buffer: image,
      });
    await page
      .getByRole("button", { name: "Upload privately", exact: true })
      .click();
    await expect(
      page.getByText("Photo saved privately.", { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(`/tools/wardrobe/${id}`);
    const media = (
      await (await page.request.get(`/api/v1/shoots/${id}/inputs`)).json()
    ).data.media;
    expect(media).toHaveLength(1);
    expect(media[0].workflowScope).toBe("WARDROBE");
    expect(media[0].referenceView).toBe("FULL_LENGTH");
    page.on("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Analyze reference", exact: true })
      .click();
    await page
      .getByLabel("Visible proportions / body-shape impression")
      .fill("Editable reference observation sentinel.");
    await page
      .getByRole("button", { name: "Confirm and use reference", exact: true })
      .click();
    await expect(page.getByText(/Reviewed and included/)).toBeVisible();
    await page
      .getByRole("button", { name: "Upload reference images", exact: true })
      .click();
    await page
      .getByRole("checkbox", {
        name: "Use knowledge only, without reference images",
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Generate wardrobe", exact: true })
      .click();
    await expect(
      page.getByText("Knowledge-only output: no photo observations used.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByText(/^Knowledge sources \(/).click();
    await expect(page.getByText(/PDF page/).first()).toBeVisible();
    await page.getByText(/^Knowledge sources \(/).click();
    const styling = (
      await (await page.request.get(`/api/v1/shoots/${id}/styling`)).json()
    ).data.latest;
    expect(styling.wardrobe.looks[0].sourceAssetId).toBeUndefined();
    expect(JSON.stringify(styling.wardrobe)).not.toContain(
      "Editable reference observation sentinel",
    );
    expect(
      (await (await page.request.get(`/api/v1/shoots/${id}/plans`)).json())
        .data,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `/tmp/framecraft-standalone-wardrobe-${width}.png`,
      fullPage: true,
    });
    const exported = await page.request.get(
      `/api/v1/shoots/${id}/styling/export.json`,
    );
    expect(exported.ok()).toBeTruthy();
    for (const kind of ["LIGHTING", "POSES"]) {
      const workflow = await post("workflows", {
        kind,
        name: `Independent ${kind}`,
        environment: "OUTDOOR",
        scene: "Garden",
        occasion: "Birthday",
        lightMode: "NATURAL",
      });
      await post(`shoots/${workflow.id}/subjects`, {
        ...blankSubject,
        label: "Guest",
        ageGroup: "ADULT",
      });
      await page.goto(`/tools/${kind.toLowerCase()}/${workflow.id}`);
      await expect(page.locator(".reference-card")).toHaveCount(0);
      if (kind === "LIGHTING") {
        await page
          .getByRole("button", { name: "Generate lighting", exact: true })
          .click();
        await expect(page.getByText(/Open shade/i).first()).toBeVisible();
        expect(
          (
            await (
              await page.request.get(`/api/v1/shoots/${workflow.id}/plans`)
            ).json()
          ).data,
        ).toEqual([]);
      } else {
        await page
          .getByRole("button", {
            name: "Recommend poses from knowledge",
            exact: true,
          })
          .click();
        await expect(
          page.locator(".pose-card .recommendation-visual"),
        ).toHaveCount(6);
        const plans = (
          await (
            await page.request.get(`/api/v1/shoots/${workflow.id}/plans`)
          ).json()
        ).data;
        expect(plans[0].poses[0].sourceReferences.length).toBeGreaterThan(0);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `/tmp/framecraft-standalone-${kind.toLowerCase()}-${width}.png`,
        fullPage: true,
      });
    }
  });
