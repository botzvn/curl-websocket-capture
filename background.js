const PRESET_KEYWORDS = {
  'tiktok.com': {
    http: ['msToken', 'device_id', 'odinId'],
    ws: {
      required: ['ttwid', 'Web-Sdk-Ms-Token'],
      flexible: ['im-ws*.tiktok.com/ws'],
    },
  },
  'facebook.com': {
    http: ['facebook', 'api', 'graphql'],
    ws: ['messenger', 'edge-chat'],
  },
};

chrome.runtime.onStartup.addListener(checkAndRequestPermissions);
chrome.runtime.onInstalled.addListener(checkAndRequestPermissions);

async function checkAndRequestPermissions() {
  const permissions = {
    origins: ['<all_urls>'],
  };

  try {
    const hasPermissions = await chrome.permissions.contains(permissions);

    if (!hasPermissions) {
      return;
    } else {
      setupWebRequestListener();
    }
  } catch (error) {
    console.error('Error checking permissions:', error);
  }
}

let webRequestListenerSetup = false;
let pendingRequests = new Map();

function setupWebRequestListener() {
  if (webRequestListenerSetup) {
    return;
  }

  try {
    chrome.webRequest.onBeforeRequest.addListener(handleRequestBody, { urls: ['<all_urls>'] }, ['requestBody']);
    chrome.webRequest.onBeforeSendHeaders.addListener(handleRequestHeaders, { urls: ['<all_urls>'] }, ['requestHeaders', 'extraHeaders']);

    webRequestListenerSetup = true;
  } catch (error) {
    console.error('❌ Failed to setup WebRequest listener:', error);
    throw error;
  }
}

function handleRequestBody(details) {
  let body = null;

  if (details.requestBody) {
    try {
      if (details.requestBody.formData) {
        body = {
          type: 'formData',
          data: details.requestBody.formData,
        };
      } else if (details.requestBody.raw) {
        const rawData = details.requestBody.raw[0];
        if (rawData && rawData.bytes) {
          const decoder = new TextDecoder('utf-8');
          const bodyText = decoder.decode(rawData.bytes);

          try {
            const jsonData = JSON.parse(bodyText);
            body = {
              type: 'json',
              data: jsonData,
              raw: bodyText,
            };
          } catch {
            body = {
              type: 'text',
              data: bodyText,
            };
          }
        }
      }
    } catch (error) {
      console.error('Error parsing request body:', error);
      body = {
        type: 'error',
        error: error.message,
      };
    }
  }

  pendingRequests.set(details.requestId, {
    body: body,
    timestamp: Date.now(),
  });

  const cutoff = Date.now() - 30000;
  for (const [requestId, data] of pendingRequests.entries()) {
    if (data.timestamp < cutoff) {
      pendingRequests.delete(requestId);
    }
  }
}

function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    const parts = hostname.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return hostname;
  } catch {
    return 'unknown';
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

/**
 * Match URL against pattern with wildcard support
 * * = matches any characters except /
 * ** = matches any characters including /
 */
function matchesPattern(text, pattern) {
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLE_WILDCARD___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLE_WILDCARD___/g, '.*');

  const regex = new RegExp(regexPattern);
  return regex.test(text);
}

async function handleRequestHeaders(details) {
  const requestDomain = getDomainFromUrl(details.url);
  const currentDomain = await getCurrentDomain();

  const data = await chrome.storage.sync.get('settings');
  const settings = data.settings || { preset: currentDomain || requestDomain, presets: {} };

  let currentPreset = settings.preset || currentDomain;

  if (!PRESET_KEYWORDS[currentPreset]) {
    for (const presetKey of Object.keys(PRESET_KEYWORDS)) {
      if (details.url.includes(presetKey.replace('.com', ''))) {
        currentPreset = presetKey;
        break;
      }
    }
  }

  if (!currentPreset) {
    currentPreset = requestDomain;
  }

  const presetOverrides = settings.presets?.[currentPreset] || {};

  let keywordsHttp = [];
  if (presetOverrides.overrideKeywords?.trim()) {
    keywordsHttp = presetOverrides.overrideKeywords
      .split('\n')
      .map((k) => k.trim())
      .filter(Boolean);
  } else {
    keywordsHttp = PRESET_KEYWORDS[currentPreset]?.http || [];
  }

  let keywordsWs = [];
  let wsRequired = [];
  let wsFlexible = [];

  if (presetOverrides.overrideKeywordsWS?.trim()) {
    keywordsWs = presetOverrides.overrideKeywordsWS
      .split('\n')
      .map((k) => k.trim())
      .filter(Boolean);
  } else {
    const wsConfig = PRESET_KEYWORDS[currentPreset]?.ws;

    if (wsConfig && typeof wsConfig === 'object' && !Array.isArray(wsConfig)) {
      wsRequired = wsConfig.required || [];
      wsFlexible = wsConfig.flexible || [];
    } else {
      keywordsWs = wsConfig || [];
    }
  }

  const isHttp = details.type === 'xmlhttprequest' || details.type === 'fetch';
  const isWs = details.type === 'websocket';

  let shouldCapture = false;

  if (isHttp) {
    shouldCapture = keywordsHttp.every((keyword) => details.url.includes(keyword));
  } else if (isWs) {
    if (keywordsWs.length > 0) {
      shouldCapture = keywordsWs.every((keyword) => details.url.includes(keyword));
    } else if (wsRequired.length > 0 || wsFlexible.length > 0) {
      const allRequiredMatch = wsRequired.every((keyword) => {
        if (details.url.includes(keyword)) {
          return true;
        }
        if (details.requestHeaders) {
          const cookieHeader = details.requestHeaders.find((h) => h.name.toLowerCase() === 'cookie');
          if (cookieHeader && cookieHeader.value.includes(keyword)) {
            return true;
          }
        }
        return false;
      });

      const anyFlexibleMatch = wsFlexible.length === 0 || wsFlexible.some((pattern) => matchesPattern(details.url, pattern));

      shouldCapture = allRequiredMatch && anyFlexibleMatch;
    }
  }

  if (shouldCapture) {
    const pendingData = pendingRequests.get(details.requestId);
    const requestBody = pendingData ? pendingData.body : null;

    if (pendingData) {
      pendingRequests.delete(details.requestId);
    }

    const requestData = {
      url: details.url,
      method: details.method,
      headers: details.requestHeaders,
      initiator: details.initiator,
      type: details.type,
      body: requestBody,
    };

    const domain = getDomainFromUrl(details.url);

    if (isHttp) {
      const storageKey = `httpData_${domain}`;
      chrome.storage.local.set({ [storageKey]: requestData }, () => {
        chrome.runtime
          .sendMessage({
            type: 'NEW_DATA_CAPTURED',
            dataType: 'http',
            domain: domain,
            url: details.url,
          })
          .catch(() => {});
      });
    } else if (isWs) {
      const storageKey = `wsData_${domain}`;
      chrome.storage.local.set({ [storageKey]: requestData }, () => {
        chrome.runtime
          .sendMessage({
            type: 'NEW_DATA_CAPTURED',
            dataType: 'ws',
            domain: domain,
            url: details.url,
          })
          .catch(() => {});
      });
    }
  }
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PERMISSIONS_GRANTED') {
    try {
      setupWebRequestListener();
    } catch (error) {
      console.error('❌ Error setting up WebRequest listener:', error);
    }
  } else if (message.type === 'REQUEST_PERMISSIONS') {
    handlePermissionRequest(sender);
  } else if (message.type === 'POPUP_OPENED') {
    sendResponse({ status: 'ready' });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {});

function tryNotifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

async function handlePermissionRequest(sender) {
  const permissions = {
    origins: ['<all_urls>'],
  };

  try {
    const granted = await chrome.permissions.request(permissions);

    if (granted) {
      setupWebRequestListener();

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.reload(tabs[0].id);
        }
      });

      tryNotifyPopup({
        type: 'PERMISSIONS_RESULT',
        granted: true,
      });
    } else {
      tryNotifyPopup({
        type: 'PERMISSIONS_RESULT',
        granted: false,
      });
    }
  } catch (error) {
    console.error('❌ Error requesting permissions in background:', error);
  }
}
