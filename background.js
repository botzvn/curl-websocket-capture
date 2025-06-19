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

chrome.webRequest.onBeforeSendHeaders.addListener(handleRequest, { urls: ["<all_urls>"] }, ["requestHeaders", "extraHeaders"]);

// Handle tab activation to update popup data when switching tabs
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  console.log("Tab activated:", activeInfo.tabId);

  // Send message to popup if it's open to refresh data
  chrome.runtime
    .sendMessage({
      type: "TAB_ACTIVATED",
      tabId: activeInfo.tabId,
    })
    .catch(() => {
      // Popup not open, ignore error
      console.log("Popup not open, can't send tab activation message");
    });
});

// Handle tab updates (URL changes, page loads)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    console.log("Tab updated and complete:", tabId);

    // Send message to popup if it's open to refresh data
    chrome.runtime
      .sendMessage({
        type: "TAB_UPDATED",
        tabId: tabId,
        url: tab.url,
      })
      .catch(() => {
        // Popup not open, ignore error
        console.log("Popup not open, can't send tab update message");
      });
  }
});
