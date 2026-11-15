import type { Action } from "@browserbasehq/stagehand-protocol/types";
import type { Protocol } from "devtools-protocol";
import { resolveLocatorWithHops } from "../../understudy/deepLocator.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";

export async function guardActionTarget(
  page: Page,
  action: Action,
  progress: Progress,
  expectedElementId?: string,
): Promise<string | undefined> {
  const method = action.method ?? "";
  if (
    ![
      "click",
      "doubleClick",
      "hover",
      "fill",
      "type",
      "selectOptionFromDropdown",
      "scrollTo",
      "nextChunk",
      "prevChunk",
      "press",
      "dragAndDrop",
    ].includes(method)
  )
    return;
  try {
    const locator = await resolveLocatorWithHops(page, page.mainFrame(), action.selector, progress);
    if (expectedElementId) {
      const actualId = `${page.getOrdinal(locator.getFrame().frameId)}-${await locator.backendNodeId(progress)}`;
      if (actualId !== expectedElementId) return "target_replaced";
    }
    const session = locator.getFrame().session;
    const { objectId } = await locator.resolveNode(progress);
    try {
      const response = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: actionEligibility.toString(),
          arguments: [{ value: method }],
          returnByValue: true,
        },
      );
      if (response.exceptionDetails) return "target_check_failed";
      const verdict = response.result.value;
      return verdict === "ok"
        ? undefined
        : typeof verdict === "string"
          ? verdict
          : "target_check_failed";
    } finally {
      await session.send("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  } catch {
    progress.throwIfStopped();
    return "target_unresolved";
  }
}

function actionEligibility(this: Element, method: string): string {
  if (!this.isConnected) return "target_detached";
  if (["scrollTo", "nextChunk", "prevChunk", "press"].includes(method)) return "ok";
  if (this.matches(":disabled") || this.closest('[inert],[aria-disabled="true"]'))
    return "target_disabled";
  const rect = this.getBoundingClientRect();
  const style = getComputedStyle(this);
  if (
    !rect.width ||
    !rect.height ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    this.closest('[hidden],[aria-hidden="true"]')
  )
    return "target_hidden";
  if (method === "fill" || method === "type") {
    if ((this as HTMLInputElement).readOnly) return "target_readonly";
    if (
      !(
        this instanceof HTMLInputElement ||
        this instanceof HTMLTextAreaElement ||
        (this as HTMLElement).isContentEditable
      )
    )
      return "target_not_editable";
    if (
      this instanceof HTMLInputElement &&
      ["checkbox", "radio", "file", "hidden", "button", "submit", "reset", "image"].includes(
        this.type,
      )
    )
      return "target_not_editable";
  }
  if (method === "selectOptionFromDropdown" && !(this instanceof HTMLSelectElement))
    return "target_not_native_select";
  return "ok";
}
