const PRESET_KEYWORDS = {
  tiktok: {
    http: ["msToken", "device_id", "odinId"],
    ws: ["im-ws-sg.tiktok.com/ws/v2", "ttwid", "Web-Sdk-Ms-Token"],
  },
  facebook: {
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

async function handleRequest(details) {
  const data = await chrome.storage.sync.get("settings");
  const settings = data.settings || { preset: "default", presets: {} };

  const currentPreset = settings.preset || "default";
  const presetOverrides = settings.presets?.[currentPreset] || {};

  // 1. Keywords HTTP
  let keywordsHttp = [];
  if (presetOverrides.overrideKeywords?.trim()) {
    keywordsHttp = presetOverrides.overrideKeywords
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);
  } else if (currentPreset !== "default") {
    keywordsHttp = PRESET_KEYWORDS[currentPreset]?.http || [];
  }

  // 2. Keywords WebSocket
  let keywordsWs = [];
  if (presetOverrides.overrideKeywordsWS?.trim()) {
    keywordsWs = presetOverrides.overrideKeywordsWS
      .split("\n")
      .map((k) => k.trim())
      .filter(Boolean);
  } else if (currentPreset !== "default") {
    keywordsWs = PRESET_KEYWORDS[currentPreset]?.ws || [];
  }

  const isHttp = details.type === "xmlhttprequest" || details.type === "fetch";
  const isWs = details.type === "websocket";

  let shouldCapture = false;

  if (isHttp) {
    shouldCapture = keywordsHttp.length === 0 || keywordsHttp.every((keyword) => details.url.includes(keyword));
  } else if (isWs) {
    shouldCapture = keywordsWs.length === 0 || keywordsWs.every((keyword) => details.url.includes(keyword));
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
      chrome.storage.local.set({ [storageKey]: requestData });
      console.log(`Stored HTTP data with key: ${storageKey}`);
    } else if (isWs) {
      const storageKey = `wsData_${domain}`;
      chrome.storage.local.set({ [storageKey]: requestData });
      console.log(`Stored WS data with key: ${storageKey}`);
    }
  }
}

chrome.webRequest.onBeforeSendHeaders.addListener(handleRequest, { urls: ["<all_urls>"] }, ["requestHeaders", "extraHeaders"]);
