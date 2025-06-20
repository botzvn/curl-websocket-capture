const PRESET_KEYWORDS = {
  "tiktok.com": {
    http: ["msToken", "device_id", "odinId"],
    ws: ["im-ws-sg.tiktok.com/ws/v2", "ttwid", "Web-Sdk-Ms-Token"],
  },
  "facebook.com": {
    http: ["facebook", "api", "graphql"],
    ws: ["messenger", "edge-chat"],
  },
};

// Check and request host permissions on extension startup
chrome.runtime.onStartup.addListener(checkAndRequestPermissions);
chrome.runtime.onInstalled.addListener(checkAndRequestPermissions);

async function checkAndRequestPermissions() {
  const permissions = {
    origins: ["<all_urls>"],
  };

  try {
    // Check if we already have the permissions
    const hasPermissions = await chrome.permissions.contains(permissions);
    console.log("🚀 ~ checkAndRequestPermissions ~ hasPermissions:", hasPermissions);

    if (!hasPermissions) {
      console.log("Host permissions not granted, extension will have limited functionality");
      console.log("User can grant permissions manually from popup or extension settings");
    } else {
      console.log("Host permissions already granted");
      setupWebRequestListener();
    }
  } catch (error) {
    console.error("Error checking permissions:", error);
  }
}

let webRequestListenerSetup = false;

function setupWebRequestListener() {
  if (webRequestListenerSetup) {
    console.log("⚠️ WebRequest listener already setup, skipping");
    return;
  }

  try {
    // Only setup webRequest listener if we have permissions
    chrome.webRequest.onBeforeSendHeaders.addListener(handleRequest, { urls: ["<all_urls>"] }, ["requestHeaders", "extraHeaders"]);
    webRequestListenerSetup = true;
    console.log("✅ WebRequest listener setup successfully");
  } catch (error) {
    console.error("❌ Failed to setup WebRequest listener:", error);
    throw error;
  }
}

// Utility function to extract root domain from URL
function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Extract root domain (remove subdomains)
    const parts = hostname.split(".");
    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return hostname;
  } catch {
    return "unknown";
  }
}

function getCurrentDomain() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      if (!url) return resolve(undefined);
      resolve(getDomainFromUrl(url));
    });
  });
}

async function handleRequest(details) {
  const currentDomain = await getCurrentDomain();
  const data = await chrome.storage.sync.get("settings");
  const settings = data.settings || { preset: currentDomain, presets: {} };

  const currentPreset = settings.preset || currentDomain;
  const presetOverrides = settings.presets?.[currentPreset] || {};

  // 1. Keywords HTTP
  let keywordsHttp = [];
  if (presetOverrides.overrideKeywords?.trim()) {
    keywordsHttp = presetOverrides.overrideKeywords
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);
  } else {
    keywordsHttp = PRESET_KEYWORDS[currentPreset]?.http || [];
  }

  // 2. Keywords WebSocket
  let keywordsWs = [];
  if (presetOverrides.overrideKeywordsWS?.trim()) {
    keywordsWs = presetOverrides.overrideKeywordsWS
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);
  } else {
    keywordsWs = PRESET_KEYWORDS[currentPreset]?.ws || [];
  }

  const isHttp = details.type === "xmlhttprequest" || details.type === "fetch";
  const isWs = details.type === "websocket";

  let shouldCapture = false;

  if (isHttp) {
    shouldCapture = keywordsHttp.every((keyword) => details.url.includes(keyword));
  } else if (isWs) {
    shouldCapture = keywordsWs.every((keyword) => details.url.includes(keyword));
  }

  if (shouldCapture) {
    const requestData = {
      url: details.url,
      method: details.method,
      headers: details.requestHeaders,
      initiator: details.initiator,
      type: details.type,
    };

    // Get domain from request URL to store data per site
    const originalHostname = new URL(details.url).hostname;
    const domain = getDomainFromUrl(details.url);
    console.log(`Capturing ${details.type.toUpperCase()}: ${originalHostname} → ${domain}`);

    if (isHttp) {
      const storageKey = `httpData_${domain}`;
      chrome.storage.local.set({ [storageKey]: requestData }, () => {
        console.log(`Stored HTTP data with key: ${storageKey}`);

        // Notify popup about new data
        chrome.runtime
          .sendMessage({
            type: "NEW_DATA_CAPTURED",
            dataType: "http",
            domain: domain,
            url: details.url,
          })
          .catch(() => {
            // Popup not open, ignore error
            console.log("Popup not open for HTTP data notification");
          });
      });
    } else if (isWs) {
      const storageKey = `wsData_${domain}`;
      chrome.storage.local.set({ [storageKey]: requestData }, () => {
        console.log(`Stored WS data with key: ${storageKey}`);

        // Notify popup about new data
        chrome.runtime
          .sendMessage({
            type: "NEW_DATA_CAPTURED",
            dataType: "ws",
            domain: domain,
            url: details.url,
          })
          .catch(() => {
            // Popup not open, ignore error
            console.log("Popup not open for WS data notification");
          });
      });
    }
  }
}

// Handle tab activation to update popup data when switching tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  console.log("Tab activated:", activeInfo.tabId);

  // Don't send message immediately, let popup query when it opens
  // This avoids unnecessary "popup not open" errors
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("🔔 Background received message:", message.type, message);

  if (message.type === "PERMISSIONS_GRANTED") {
    console.log("✅ Received permissions granted notification");

    // Check if listener is already setup
    try {
      setupWebRequestListener();
      console.log("🎉 WebRequest listener setup completed");
    } catch (error) {
      console.error("❌ Error setting up WebRequest listener:", error);
    }
  } else if (message.type === "REQUEST_PERMISSIONS") {
    console.log("📋 Received permission request from popup");
    handlePermissionRequest(sender);
  } else if (message.type === "POPUP_OPENED") {
    // Popup is requesting current tab info
    console.log("👋 Popup opened, sending current tab info");
    sendResponse({ status: "ready" });
  } else {
    console.log("ℹ️ Unhandled message type:", message.type);
  }
});

// Handle tab updates (URL changes, page loads)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    console.log("Tab updated and complete:", tabId);

    // Don't send message - popup will refresh data when user opens it
    // This prevents unnecessary "popup not open" errors
  }
});

function tryNotifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Silently ignore - popup not open
  });
}

async function handlePermissionRequest(sender) {
  const permissions = {
    origins: ["<all_urls>"],
  };

  try {
    console.log("🔐 Requesting permissions from background:", permissions);
    const granted = await chrome.permissions.request(permissions);
    console.log("🚀 ~ handlePermissionRequest ~ granted:", granted);

    if (granted) {
      console.log("✅ Host permissions granted!");

      // Setup webRequest listener
      setupWebRequestListener();

      // Get current tab and reload it
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          console.log("🔄 Reloading current tab to start capturing...");
          chrome.tabs.reload(tabs[0].id, () => {
            console.log("✅ Tab reloaded successfully");
          });
        }
      });

      // Notify popup if it's still open
      tryNotifyPopup({
        type: "PERMISSIONS_RESULT",
        granted: true,
      });
    } else {
      console.log("❌ Permissions denied by user");

      // Notify popup if it's still open
      tryNotifyPopup({
        type: "PERMISSIONS_RESULT",
        granted: false,
      });
    }
  } catch (error) {
    console.error("❌ Error requesting permissions in background:", error);
  }
}
