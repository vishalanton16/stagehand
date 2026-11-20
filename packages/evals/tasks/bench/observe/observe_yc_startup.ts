import { defineBenchTask } from "../../../framework/defineTask.js";

const companyLinks = String.raw`Array.from(document.querySelectorAll("main a[href]")).filter(
  (link) => link.origin === location.origin &&
    /^\/companies\/[^/]+\/?$/.test(link.pathname) &&
    link.getClientRects().length > 0 &&
    link.textContent.trim().length > 0
)`;

export default defineBenchTask(
  { name: "observe_yc_startup" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://www.ycombinator.com/companies", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(`${companyLinks}.length >= 2`, undefined, {
        timeout: 15_000,
        polling: 100,
      });

      const { data: observations } = await stagehand.observe(
        "Click the container element that holds links to each of the startup companies. The companies each have a name, a description, and a link to their website.",
      );

      if (observations.length === 0) {
        return {
          _success: false,
          observations,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      // The directory's generated class names change between releases.
      const matchedLocator = await page.evaluate<string | null>(`(() => {
        const links = ${companyLinks};
        if (links.length < 2) return null;
        let container = links[0].parentElement;
        while (container && !links.every((link) => container.contains(link))) {
          container = container.parentElement;
        }
        if (!container) return null;
        const selectors = ${JSON.stringify(observations.map(({ selector }) => selector))};
        return selectors.find((selector) => {
          const raw = selector.startsWith("xpath=") ? selector.slice(6) : selector;
          try {
            const element = raw.startsWith("/") || raw.startsWith("(")
              ? document.evaluate(raw, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
              : document.querySelector(raw);
            return element === container;
          } catch {
            return false;
          }
        }) ?? null;
      })()`);

      return {
        _success: matchedLocator !== null,
        matchedLocator,
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
