import { expect, test, type Page, type TestInfo } from "@playwright/test";

type ProfileSurface = "standalone" | "production" | "production-no-html-callback";

const routeFor = (surface: ProfileSurface) => surface === "standalone"
  ? "/?canonical=1&blocks=10000"
  : "/?canonicalAuthority=1&blocks=10000";

const profileSurface = async (page: Page, testInfo: TestInfo, surface: ProfileSurface) => {
  await page.goto(routeFor(surface));
  const root = page.locator('[contenteditable="true"]');
  await expect(root).toBeVisible();
  if (surface === "production-no-html-callback") {
    await page.evaluate(() => window.__smartProductCanonical?.setCallbacks(undefined, undefined));
  }
  await root.focus();
  await page.keyboard.type("warm");

  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 100 });
  const before = await session.send("Performance.getMetrics");
  await session.send("Profiler.start");
  const elapsed = await page.evaluate(async () => {
    const values: number[] = [];
    const root = document.querySelector<HTMLElement>('[contenteditable="true"]')!;
    for (let index = 0; index < 10; index += 1) {
      const started = performance.now();
      root.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "x",
      }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      values.push(performance.now() - started);
    }
    return values;
  });
  const profile = await session.send("Profiler.stop");
  const after = await session.send("Performance.getMetrics");
  const metric = (values: typeof before.metrics, name: string) => values.find((entry) => entry.name === name)?.value || 0;
  const deltas = Object.fromEntries(["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration"].map((name) => [
    name,
    metric(after.metrics, name) - metric(before.metrics, name),
  ]));
  const nodeById = new Map(profile.profile.nodes.map((node) => [node.id, node]));
  const selfMicros = new Map<string, number>();
  profile.profile.samples?.forEach((id, index) => {
    const frame = nodeById.get(id)?.callFrame;
    const label = `${frame?.functionName || "(anonymous)"} (${frame?.url?.split("/").at(-1) || "browser"})`;
    selfMicros.set(label, (selfMicros.get(label) || 0) + (profile.profile.timeDeltas?.[index] || 0));
  });
  const hottest = [...selfMicros].sort((left, right) => right[1] - left[1]).slice(0, 15);
  const summary = { surface, elapsed, deltas, hottest };
  await testInfo.attach(`${surface}.cpuprofile`, { body: JSON.stringify(profile.profile), contentType: "application/json" });
  await testInfo.attach(`${surface}-summary.json`, { body: JSON.stringify(summary, null, 2), contentType: "application/json" });
  return summary;
};

test("profiles identical 10k canonical surfaces", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Chromium DevTools CPU profiles are the comparison artifact.");
  test.skip(process.env.SRTE_PROFILE !== "1", "Run explicitly with SRTE_PROFILE=1; this is not a regression test.");
  const context = await browser.newContext();
  const summaries = [];
  for (const surface of ["standalone", "production", "production-no-html-callback"] as const) {
    const page = await context.newPage();
    summaries.push(await profileSurface(page, testInfo, surface));
    await page.close();
  }
  console.log("Phase 8b same-browser surface profiles", JSON.stringify(summaries, null, 2));
  await context.close();
});
