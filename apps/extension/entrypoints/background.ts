import { defineBackground } from "wxt/utils/define-background";

export default defineBackground(() => {
  function restrictStorage() {
    void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  }
  chrome.runtime.onInstalled.addListener(restrictStorage);
  chrome.runtime.onStartup.addListener(restrictStorage);

  chrome.action.onClicked.addListener((tab) => {
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  });
});
