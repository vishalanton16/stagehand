import type { Page } from "../../../src/page.js";

// Benchmark setup is outside observation timing and identical across arms.
export async function waitForBenchmarkReady(page: Page, selector: string | null | undefined) {
  const start = performance.now();
  if (!selector) return { ready: true, ms: 0 };
  for (let attempt = 0; attempt < 12; attempt++) {
    const ready = await page.evaluate(
      (selector: string) =>
        [...document.querySelectorAll(selector)].some((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return (
            r.width > 0 &&
            r.height > 0 &&
            s.display !== "none" &&
            s.visibility !== "hidden" &&
            !el.closest('[hidden],[aria-hidden="true"]')
          );
        }),
      selector,
    );
    if (ready) return { ready: true, ms: performance.now() - start };
    await page.waitForTimeout(600);
  }
  return { ready: false, ms: performance.now() - start };
}
