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
      setupAutoSyncInterval();
    }
  } catch (error) {
    console.error('Error checking permissions:', error);
  }
}

let webRequestListenerSetup = false;

let pendingRequests = new Map();
const inMemoryCapturedData = {};

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
      if (!inMemoryCapturedData[domain]) {
        inMemoryCapturedData[domain] = {};
      }
      inMemoryCapturedData[domain].http = requestData;

      chrome.runtime
        .sendMessage({
          type: 'NEW_DATA_CAPTURED',
          dataType: 'http',
          domain: domain,
          url: details.url,
        })
        .catch(() => {});
    } else if (isWs) {
      if (!inMemoryCapturedData[domain]) {
        inMemoryCapturedData[domain] = {};
      }
      inMemoryCapturedData[domain].ws = requestData;

      chrome.runtime
        .sendMessage({
          type: 'NEW_DATA_CAPTURED',
          dataType: 'ws',
          domain: domain,
          url: details.url,
        })
        .catch(() => {});
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
  } else if (message.type === 'SYNC_CONFIG_UPDATED') {
    console.log('🔄 Config updated, restarting sync interval...');
    setupAutoSyncInterval();
  } else if (message.type === 'GET_CAPTURED_DATA') {
    const domain = message.domain;
    // Return data for the requested domain, or empty object if none
    const data = inMemoryCapturedData[domain] || {};
    sendResponse(data);
  } else if (message.type === 'CLEAR_DATA') {
    const domain = message.domain;
    if (domain) {
      delete inMemoryCapturedData[domain];
    } else {
      // Clear all if no domain specified
      for (const key in inMemoryCapturedData) {
        delete inMemoryCapturedData[key];
      }
    }
    sendResponse({ success: true });
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

// ==================== HELPERS FOR DATA FORMATTING ====================

function extractParams(urlString) {
  try {
    const url = new URL(urlString);
    const params = new URLSearchParams(url.search);
    return Object.fromEntries(params.entries());
  } catch {
    return {};
  }
}

function extractCookies(headers) {
  if (!headers) return {};
  const cookieHeader = headers.find((h) => h.name.toLowerCase() === 'cookie');
  if (!cookieHeader) return {};

  const cookies = {};
  cookieHeader.value.split(';').forEach((cookie) => {
    const [name, value] = cookie.split('=');
    if (name && value) {
      cookies[name.trim()] = value.trim();
    }
  });
  return cookies;
}

function formatHeadersForJson(headers) {
  if (!headers) return {};
  return headers.reduce((obj, h) => {
    if (!h.name.startsWith(':')) obj[h.name] = h.value;
    return obj;
  }, {});
}

let autoSyncIntervalId = null;

/**
 * Setup or restart the auto-sync interval
 */
async function setupAutoSyncInterval() {
  if (autoSyncIntervalId) {
    clearInterval(autoSyncIntervalId);
    autoSyncIntervalId = null;
  }

  const data = await chrome.storage.sync.get('syncConfig');
  const config = data.syncConfig;

  if (config && config.autoSync) {
    const intervalSeconds = config.syncInterval || 30; // Default 30s
    console.log(`⏱️ Starting auto-sync interval: every ${intervalSeconds}s`);

    // Run immediately once
    performAutoSync();

    autoSyncIntervalId = setInterval(() => {
      performAutoSync();
    }, intervalSeconds * 1000);
  } else {
    console.log('⏹️ Auto-sync disabled or not configured');
  }
}

/**
 * Perform auto-sync for the current active tab
 * Called by interval timer
 */
async function performAutoSync() {
  console.log(`🔄 performAutoSync (interval tick) called`);

  // Get current domain
  const domain = await getCurrentDomain();
  if (!domain) {
    console.log('Skipping auto-sync: No active domain found');
    return;
  }

  try {
    // Get sync config
    const data = await chrome.storage.sync.get('syncConfig');
    const config = data.syncConfig;

    // Check if auto-sync is enabled and API URL is configured
    if (!config || !config.autoSync || !config.apiUrl) {
      console.log('Skipping auto-sync: Not enabled or no API URL');
      // Should stop interval here? Maybe not, settings might change.
      // But verify if we should be running at all.
      return;
    }

    // Get captured data
    const domainData = inMemoryCapturedData[domain] || {};
    console.log(`📦 Captured data found for ${domain}:`, { http: !!domainData.http, ws: !!domainData.ws });

    if (!domainData.http && !domainData.ws) {
      console.log('Skipping auto-sync: No data found');
      return;
    }

    // Build payload to match popup.js buildExportData logic
    const payload = {
      autoSync: true, // Metadata for the server to know it's auto-sync
    };

    if (domainData.http) {
      const httpReq = domainData.http;
      payload.http = {
        type: httpReq.type,
        url: httpReq.url,
        method: httpReq.method,
        timestamp: new Date().toISOString(), // Consistent timestamp generation
        headers: formatHeadersForJson(httpReq.headers),
        params: extractParams(httpReq.url),
        cookies: extractCookies(httpReq.headers),
        body: httpReq.body || null,
      };
    }

    if (domainData.ws) {
      const wsReq = domainData.ws;
      payload.ws = {
        type: wsReq.type,
        url: wsReq.url,
        method: wsReq.method,
        timestamp: new Date().toISOString(),
        headers: formatHeadersForJson(wsReq.headers),
        params: extractParams(wsReq.url),
        cookies: extractCookies(wsReq.headers),
        body: wsReq.body || null,
      };
    }

    // Build authorization header
    let authHeader = {};
    if (config.authValue && config.authType !== 'none') {
      switch (config.authType) {
        case 'bearer':
          authHeader = { Authorization: `Bearer ${config.authValue}` };
          break;
        case 'apikey':
          authHeader = { 'X-API-Key': config.authValue };
          break;
        case 'basic':
          authHeader = { Authorization: `Basic ${btoa(config.authValue)}` };
          break;
      }
    }

    // Define sync function
    const doSync = async () => {
      console.log(`🚀 Executing sync for ${domain} to ${config.apiUrl}`);
      try {
        const response = await fetch(config.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeader,
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          console.log(`✅ Auto-sync successful for ${domain}`);
        } else {
          console.error(`❌ Auto-sync failed: ${response.status} ${response.statusText}`);
        }
      } catch (error) {
        console.error('❌ Auto-sync error:', error);
      }
    };

    // Execute sync immediately (interval handles spacing)
    doSync();
  } catch (error) {
    console.error('❌ Auto-sync error:', error);
  }
}
