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
  return headers.reduce((obj, h) => {
    if (!h.name.startsWith(':')) obj[h.name] = h.value;
    return obj;
  }, {});
}

function formatObjectForDisplay(obj) {
  const entries = Object.entries(obj);
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join('\n') : 'default';
}

function formatBodyForDisplay(body) {
  if (!body) return 'No body data';

  switch (body.type) {
    case 'json':
      // For JSON, flatten to key-value pairs like params/cookies
      if (typeof body.data === 'object' && body.data !== null) {
        return formatObjectForDisplay(flattenObject(body.data));
      }
      return body.raw || JSON.stringify(body.data);
    case 'formData':
      // FormData is already in key-value format
      const formDataObj = {};
      Object.entries(body.data).forEach(([key, values]) => {
        formDataObj[key] = Array.isArray(values) ? values.join(', ') : values;
      });
      return formatObjectForDisplay(formDataObj);
    case 'text':
      return body.data;
    case 'error':
      return `Error parsing body: ${body.error}`;
    default:
      return 'Unknown body format';
  }
}

function flattenObject(obj, prefix = '') {
  const flattened = {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        Object.assign(flattened, flattenObject(obj[key], newKey));
      } else {
        flattened[newKey] = Array.isArray(obj[key]) ? obj[key].join(', ') : obj[key];
      }
    }
  }

  return flattened;
}

function getBodyFieldCount(body) {
  if (!body) return 0;

  switch (body.type) {
    case 'json':
      if (typeof body.data === 'object' && body.data !== null) {
        return Object.keys(flattenObject(body.data)).length;
      }
      return 1;
    case 'formData':
      return Object.keys(body.data).length;
    case 'text':
      return 1;
    case 'error':
      return 0;
    default:
      return 0;
  }
}

function getDomainFromUrl(url) {
  console.log('🚀 ~ getDomainFromUrl ~ url:', url);
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

function loadAndApplySettings() {
  chrome.storage.sync.get('settings', (data) => {
    const settings = data.settings || { preset: 'default', presets: {} };
    updateUiWithOptions(settings);
  });
}

async function saveSettings() {
  const presetToSave = await getCurrentDomain();
  const overrideKeywords = document.getElementById('overrideKeywords').value;
  const overrideKeywordsWS = document.getElementById('overrideKeywordsWS').value;

  chrome.storage.sync.get('settings', (data) => {
    const oldSettings = data.settings || { preset: 'default', presets: {} };
    const allPresets = oldSettings.presets || {};

    allPresets[presetToSave] = {
      overrideKeywords,
      overrideKeywordsWS,
    };

    const newSettings = {
      ...oldSettings,
      presets: allPresets,
    };

    chrome.storage.sync.set({ settings: newSettings }, () => {
      const status = document.getElementById('status');
      status.textContent = `saved!`;
      status.style.marginRight = '10px';
      setTimeout(() => (status.textContent = ''), 2000);
    });
  });
}

function updateUiWithOptions(settings) {
  const activePreset = settings.preset || 'default';
  const presetsConfig = settings.presets || {};

  const activePresetConfig = presetsConfig[activePreset] || {};
  document.getElementById('overrideKeywords').value = activePresetConfig.overrideKeywords || '';
  document.getElementById('overrideKeywordsWS').value = activePresetConfig.overrideKeywordsWS || '';
}

function getCurrentDomainAndLoadData() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.url) {
      displayAllCapturedRequests('unknown');
      return;
    }

    const originalHostname = new URL(tabs[0].url).hostname;
    const domain = getDomainFromUrl(tabs[0].url);
    console.log(`Domain extraction: ${originalHostname} → ${domain}`);

    displayAllCapturedRequests(domain);
  });
}

function autoDetectAndSetPreset() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.url) {
      loadAndApplySettings();
      return;
    }

    let detectedPreset = getDomainFromUrl(tabs[0].url);

    chrome.storage.sync.get('settings', ({ settings = {} }) => {
      const newSettings = { ...settings, preset: detectedPreset };
      chrome.storage.sync.set({ settings: newSettings }, () => {
        updateUiWithOptions(newSettings);
      });
    });
  });
}

function saveAndReloadBtn() {
  saveSettings();
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.tabs.reload(tabs[0].id);
  });
}

function setupEventListeners() {
  document.querySelectorAll('.tab-button').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-button').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.dataset.tab;
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.toggle('active', c.id === target));
    });
  });

  document.querySelectorAll('input[name="preset"]').forEach((radio) => {
    radio.addEventListener('change', (event) => {
      const selectedPresetForView = event.target.value;

      chrome.storage.sync.get('settings', (data) => {
        const presetsConfig = data.settings?.presets || {};
        const configToShow = presetsConfig[selectedPresetForView] || {};
        document.getElementById('overrideKeywords').value = configToShow.overrideKeywords || '';
        document.getElementById('overrideKeywordsWS').value = configToShow.overrideKeywordsWS || '';
      });
    });
  });

  document.getElementById('saveAndReloadBtn').addEventListener('click', saveAndReloadBtn);
  document.getElementById('copyAllButton').addEventListener('click', () => copyAllDataAsJson('copyAllButton'));
  document.getElementById('clearStorageButton').addEventListener('click', clearStorageAndReload);

  document.getElementById('reloadButton').addEventListener('click', () => {
    getCurrentDomainAndLoadData();
    const reloadBtn = document.getElementById('reloadButton');
    const originalContent = reloadBtn.innerHTML;
    reloadBtn.innerHTML = `<svg class="button-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="animation: spin 1s linear infinite; vertical-align: middle;">
                <path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
              </svg>`;
    setTimeout(() => {
      reloadBtn.innerHTML = originalContent;
    }, 1000);
  });
}

function displayAllCapturedRequests(domain) {
  console.log(`Requesting data for domain: ${domain}`);

  chrome.runtime.sendMessage({ type: 'GET_CAPTURED_DATA', domain: domain }, (data) => {
    console.log(`Received data:`, data);
    renderRequestDetails({ request: data.http, outputId: 'http-output', emptyMessage: 'No HTTP request captured yet.', domain });
    renderRequestDetails({ request: data.ws, outputId: 'ws-output', emptyMessage: 'No WebSocket handshake captured yet.', domain });

    const copyAllContainer = document.getElementById('copyAllContainer');
    if (data.http || data.ws) {
      copyAllContainer.style.display = 'flex';
    } else {
      copyAllContainer.style.display = 'default';
    }
  });
}

function renderRequestDetails({ request, outputId, emptyMessage }) {
  const output = document.getElementById(outputId);

  if (!request) {
    output.innerHTML = `<p class="no-request">${emptyMessage}</p>`;
    return;
  }

  const headers = request.headers;
  const params = extractParams(request.url);
  const cookies = extractCookies(request.headers);

  // Add timestamp for when data was captured
  const timestamp = new Date().toLocaleString();

  // Check if request has body data
  const hasBody = request.body && request.body.type !== 'error';
  const bodyFieldCount = hasBody ? getBodyFieldCount(request.body) : 0;

  output.innerHTML = `
      <details class="result-details" open>
        <summary>URL</summary>
        <div class="result-details-content"><pre>${request.url}</pre></div>
      </details>
      <details class="result-details">
        <summary>Headers (${headers.length})</summary>
        <div class="result-details-content"><pre>${formatObjectForDisplay(formatHeadersForJson(headers))}</pre></div>
      </details>
      <details class="result-details">
        <summary>Params (${Object.keys(params).length})</summary>
        <div class="result-details-content"><pre>${formatObjectForDisplay(params)}</pre></div>
      </details>
       ${
         hasBody
           ? `
      <details class="result-details">
        <summary>Body (${bodyFieldCount})</summary>
        <div class="result-details-content"><pre>${formatBodyForDisplay(request.body)}</pre></div>
      </details>
      `
           : ''
       }
      <details class="result-details">
        <summary>Cookies (${Object.keys(cookies).length})</summary>
        <div class="result-details-content"><pre>${formatObjectForDisplay(cookies)}</pre></div>
      </details>
    `;
}

function copyDataAsJson(type, buttonId) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.url) return;

    const domain = getDomainFromUrl(tabs[0].url);

    chrome.runtime.sendMessage({ type: 'GET_CAPTURED_DATA', domain: domain }, (data) => {
      const req = type === 'http' ? data.http : data.ws;
      if (!req) return;

      const exportData = {
        type: req.type,
        url: req.url,
        method: req.method,
        timestamp: new Date().toISOString(),
        headers: formatHeadersForJson(req.headers),
        params: extractParams(req.url),
        cookies: extractCookies(req.headers),
        body: req.body || null,
      };

      const json = JSON.stringify(exportData, null, 2);
      copyToClipboard(json, document.getElementById(buttonId));
    });
  });
}

function buildExportData(httpRequest, wsRequest) {
  const exportData = {};

  if (httpRequest) {
    exportData.http = {
      type: httpRequest.type,
      url: httpRequest.url,
      method: httpRequest.method,
      timestamp: new Date().toISOString(),
      headers: formatHeadersForJson(httpRequest.headers),
      params: extractParams(httpRequest.url),
      cookies: extractCookies(httpRequest.headers),
      body: httpRequest.body || null,
    };
  }

  if (wsRequest) {
    exportData.ws = {
      type: wsRequest.type,
      url: wsRequest.url,
      method: wsRequest.method,
      timestamp: new Date().toISOString(),
      headers: formatHeadersForJson(wsRequest.headers),
      params: extractParams(wsRequest.url),
      cookies: extractCookies(wsRequest.headers),
      body: wsRequest.body || null,
    };
  }

  return exportData;
}

function copyAllDataAsJson(buttonId) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.url) return;

    const domain = getDomainFromUrl(tabs[0].url);

    chrome.runtime.sendMessage({ type: 'GET_CAPTURED_DATA', domain: domain }, (data) => {
      const httpRequest = data.http;
      const wsRequest = data.ws;
      if (!httpRequest && !wsRequest) return;

      const exportData = buildExportData(httpRequest, wsRequest);
      const json = JSON.stringify(exportData, null, 2);
      copyToClipboard(json, document.getElementById(buttonId));
    });
  });
}

function copyToClipboard(text, btn) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const old = btn.innerHTML;
      btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
      btn.disabled = true;
      setTimeout(() => {
        btn.innerHTML = old;
        btn.disabled = false;
      }, 2000);
    })
    .catch((err) => console.error('Copy error: ', err));
}

function flashElementGreen(dataType) {
  if (!document.getElementById('flashAnimationStyle')) {
    const style = document.createElement('style');
    style.id = 'flashAnimationStyle';
    style.textContent = `
      @keyframes flashGreen {
        0% { color: #666; }
        50% { color: #4CAF50; font-weight: bold; }
        100% { color: #666; }
      }
      .data-timestamp.flash-green {
        animation: flashGreen 0.8s ease-in-out 3;
      }
      .data-timestamp {
        margin-top: 6px;
      }
    `;
    document.head.appendChild(style);
  }

  const timestampElement = document.querySelector('.data-timestamp');

  if (timestampElement) {
    timestampElement.classList.add('flash-green');
    timestampElement.textContent = `📡 Captured: ${new Date().toLocaleString()}`;
    setTimeout(() => {
      timestampElement.classList.remove('flash-green');
    }, 800);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // clearOldStorageData(); // No longer needed with in-memory storage

  autoDetectAndSetPreset();
  setupEventListeners();
  getCurrentDomainAndLoadData();

  // Notify background that popup is open
  chrome.runtime
    .sendMessage({
      type: 'POPUP_OPENED',
    })
    .catch(() => {
      console.log('Background script not ready');
    });

  // Check permissions status and show request button if needed
  checkPermissionsStatus();

  // Setup sync functionality
  setupSyncEventListeners();

  // Listen for messages from background script about data changes
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Received message from background:', message);

    if (message.type === 'TAB_UPDATED') {
      // Only refresh if URL actually changed significantly
      setTimeout(() => {
        getCurrentDomainAndLoadData();
        autoDetectAndSetPreset();
      }, 100); // Small delay to ensure tab info is updated
    } else if (message.type === 'NEW_DATA_CAPTURED') {
      // Real-time update when new data is captured
      console.log(`New ${message.dataType} data captured for ${message.domain}`);

      // Check if this data is for current domain
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.url) {
          const currentDomain = getDomainFromUrl(tabs[0].url);
          if (currentDomain === message.domain) {
            // Flash elements green for new data
            flashElementGreen(message.dataType);

            // Refresh data display
            setTimeout(() => {
              getCurrentDomainAndLoadData();
            }, 50);
          }
        }
      });
    } else if (message.type === 'PERMISSIONS_RESULT') {
      // Handle permission request result from background
      console.log('📨 Received permission result:', message.granted);

      if (message.granted) {
        // Hide the permission button if still visible
        const permissionButton = document.getElementById('permissionButton');
        if (permissionButton) {
          permissionButton.remove();
          console.log('🗑️ Permission button removed after grant');
        }

        // Refresh permission status
        checkPermissionsStatus();
      }
    }
  });
});

async function checkPermissionsStatus() {
  console.log('🔍 Checking permissions status...');

  const permissions = {
    origins: ['<all_urls>'],
  };

  try {
    const hasPermissions = await chrome.permissions.contains(permissions);
    console.log('🚀 ~ checkPermissionsStatus ~ hasPermissions:', hasPermissions);

    if (!hasPermissions) {
      console.log('❌ No permissions found, showing request button');
      showPermissionRequestButton();
    } else {
      console.log('✅ Permissions already granted');

      // Notify background to setup webRequest listener if not already done
      console.log('🔄 Notifying background to setup webRequest listener...');
      chrome.runtime
        .sendMessage({
          type: 'PERMISSIONS_GRANTED',
        })
        .then(() => {
          console.log('✅ Background notified about existing permissions');
        })
        .catch((error) => {
          console.log('❌ Failed to notify background:', error.message);
        });
    }
  } catch (error) {
    console.error('❌ Error checking permissions:', error);
  }
}

function showPermissionRequestButton() {
  console.log('🔘 Creating permission request button...');

  // Create permission request button if it doesn't exist
  if (!document.getElementById('permissionButton')) {
    const permissionButton = document.createElement('button');
    permissionButton.id = 'permissionButton';
    permissionButton.className = 'button';
    permissionButton.style.cssText = `
      background: #ff9800;
      margin-bottom: 10px;
      width: 100%;
    `;
    permissionButton.innerHTML = '🔒 Grant Host Permissions to Capture Requests';
    permissionButton.addEventListener('click', requestHostPermissions);

    // Insert at the top of the filter section
    const filterSection = document.querySelector('.filter-section');
    if (filterSection) {
      filterSection.insertBefore(permissionButton, filterSection.firstChild);
      console.log('✅ Permission button added to DOM');
    } else {
      console.error('❌ Could not find .filter-section to add button');
    }
  } else {
    console.log('⚠️ Permission button already exists');
  }
}

async function requestHostPermissions() {
  console.log('🔒 User clicked permission request button');

  try {
    console.log('📤 Sending REQUEST_PERMISSIONS message to background...');
    await chrome.runtime.sendMessage({
      type: 'REQUEST_PERMISSIONS',
    });
    console.log('✅ Permission request message sent to background');
  } catch (error) {
    console.error('❌ Error sending permission request message:', error);
    alert('❌ Error requesting permissions. Please try again.');
  }
}

function clearStorageAndReload() {
  const btn = document.getElementById('clearStorageButton');
  const originalContent = btn.innerHTML;

  btn.innerHTML = 'Clearing...';
  btn.disabled = true;

  // Send message to background to clear only current domain data, or all?
  // User interface says "Clear Storage", usually implies all or current context.
  // Let's clear ALL for safety as per original "clearStorage" intent, but maybe we should scope it?
  // The original clearStorage.local.clear() cleared everything.
  // Let's stick to clearing everything for now to match behavior.

  chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }, (response) => {
    if (response && response.success) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.reload(tabs[0].id, () => {
            btn.innerHTML = '✅ Cleared!';
            setTimeout(() => {
              btn.innerHTML = originalContent;
              btn.disabled = false;
              getCurrentDomainAndLoadData();
            }, 1500);
          });
        } else {
          btn.innerHTML = originalContent;
          btn.disabled = false;
        }
      });
    }
  });
}

// ==================== SYNC FUNCTIONALITY ====================

/**
 * Load sync settings from storage and populate the form
 */
function loadSyncSettings() {
  chrome.storage.sync.get('syncConfig', (data) => {
    const config = data.syncConfig || {
      apiUrl: '',
      authType: 'none',
      authValue: '',
      autoSync: false,
    };

    document.getElementById('syncApiUrl').value = config.apiUrl || '';
    document.getElementById('syncAuthType').value = config.authType || 'none';
    document.getElementById('syncAuthValue').value = config.authValue || '';
    document.getElementById('autoSyncToggle').checked = config.autoSync || false;
    document.getElementById('syncDelay').value = config.syncInterval || 30; // Default 30s for interval

    updateAuthValueVisibility(config.authType);
    updateSyncDelayVisibility(config.autoSync || false);
  });
}

/**
 * Save sync settings to storage
 */
function saveSyncSettings() {
  const config = {
    apiUrl: document.getElementById('syncApiUrl').value.trim(),
    authType: document.getElementById('syncAuthType').value,
    authValue: document.getElementById('syncAuthValue').value.trim(),
    autoSync: document.getElementById('autoSyncToggle').checked,
    syncInterval: parseInt(document.getElementById('syncDelay').value, 10) || 30,
  };

  chrome.storage.sync.set({ syncConfig: config }, () => {
    showSyncSettingsStatus('success', '✅ Settings saved successfully!');
    setTimeout(() => hideSyncSettingsStatus(), 3000);

    // Notify background to restart interval
    chrome.runtime.sendMessage({ type: 'SYNC_CONFIG_UPDATED' });
  });
}

/**
 * Update auth value field visibility based on auth type
 */
function updateAuthValueVisibility(authType) {
  const authValueGroup = document.getElementById('authValueGroup');
  const authValueLabel = document.getElementById('authValueLabel');
  const authValueInput = document.getElementById('syncAuthValue');

  if (authType === 'none') {
    authValueGroup.classList.add('hidden');
  } else {
    authValueGroup.classList.remove('hidden');

    switch (authType) {
      case 'bearer':
        authValueLabel.textContent = 'Bearer Token';
        authValueInput.placeholder = 'Enter your bearer token';
        break;
      case 'apikey':
        authValueLabel.textContent = 'API Key';
        authValueInput.placeholder = 'Enter your API key';
        break;
      case 'basic':
        authValueLabel.textContent = 'Basic Auth (username:password)';
        authValueInput.placeholder = 'username:password';
        break;
    }
  }
}

/**
 * Update sync delay visibility based on auto-sync toggle
 */
function updateSyncDelayVisibility(isAutoSyncEnabled) {
  const syncDelayGroup = document.getElementById('syncDelayGroup');
  if (isAutoSyncEnabled) {
    syncDelayGroup.style.display = 'block';
  } else {
    syncDelayGroup.style.display = 'none';
  }
}

/**
 * Show status message in settings
 */
function showSyncSettingsStatus(type, message) {
  const statusEl = document.getElementById('syncSettingsStatus');
  statusEl.className = 'settings-status ' + type;
  statusEl.textContent = message;
}

/**
 * Hide status message
 */
function hideSyncSettingsStatus() {
  const statusEl = document.getElementById('syncSettingsStatus');
  statusEl.className = 'settings-status';
  statusEl.textContent = '';
}

/**
 * Build authorization header based on config
 */
function buildAuthHeader(authType, authValue) {
  if (!authValue || authType === 'none') return {};

  switch (authType) {
    case 'bearer':
      return { Authorization: `Bearer ${authValue}` };
    case 'apikey':
      return { 'X-API-Key': authValue };
    case 'basic':
      return { Authorization: `Basic ${btoa(authValue)}` };
    default:
      return {};
  }
}

/**
 * Sync data to configured server
 */
async function syncDataToServer() {
  const syncBtn = document.getElementById('syncButton');
  const originalContent = syncBtn.innerHTML;

  // Get sync config
  const data = await new Promise((resolve) => {
    chrome.storage.sync.get('syncConfig', resolve);
  });
  const config = data.syncConfig;

  if (!config || !config.apiUrl) {
    showSyncButtonState(syncBtn, 'error', originalContent);
    alert('⚠️ Please configure the API endpoint in Settings tab first.');
    return;
  }

  // Get captured data
  const domain = await getCurrentDomain();
  if (!domain) {
    showSyncButtonState(syncBtn, 'error', originalContent);
    alert('⚠️ No active tab found.');
    return;
  }

  const capturedData = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_CAPTURED_DATA', domain: domain }, (data) => {
      resolve(data);
    });
  });

  if (!capturedData.http && !capturedData.ws) {
    showSyncButtonState(syncBtn, 'error', originalContent);
    alert('⚠️ No captured data to sync. Capture some requests first.');
    return;
  }

  // Show loading state
  showSyncButtonState(syncBtn, 'loading', originalContent);

  // Build payload using shared logic
  const payload = buildExportData(capturedData.http, capturedData.ws);

  // Note: previously we added a top-level domain and timestamp, but now we match copyAllDataAsJson structure exactly.
  // If the server needs domain/timestamp, they are now inside http/ws objects or need to be re-added if requirements change.
  // For now, based on "data sync phải giống copyAllDataAsJson", we send exactly what buildExportData returns.

  // Build headers
  const headers = {
    'Content-Type': 'application/json',
    ...buildAuthHeader(config.authType, config.authValue),
  };

  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      showSyncButtonState(syncBtn, 'success', originalContent);
      console.log('✅ Data synced successfully!');
    } else {
      throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error('❌ Sync failed:', error);
    showSyncButtonState(syncBtn, 'error', originalContent);
    alert(`❌ Sync failed: ${error.message}`);
  }
}

/**
 * Show sync button state with animation
 */
function showSyncButtonState(btn, state, originalContent) {
  btn.classList.remove('loading', 'success', 'error');

  switch (state) {
    case 'loading':
      btn.classList.add('loading');
      btn.innerHTML = `
        <svg class="button-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        Syncing...
      `;
      btn.disabled = true;
      break;
    case 'success':
      btn.classList.add('success');
      btn.innerHTML = `
        <svg class="button-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Synced!
      `;
      btn.disabled = false;
      setTimeout(() => {
        btn.classList.remove('success');
        btn.innerHTML = originalContent;
      }, 2000);
      break;
    case 'error':
      btn.classList.add('error');
      btn.innerHTML = `
        <svg class="button-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        Failed
      `;
      btn.disabled = false;
      setTimeout(() => {
        btn.classList.remove('error');
        btn.innerHTML = originalContent;
      }, 2000);
      break;
  }
}

/**
 * Test connection to the configured API
 */
async function testConnection() {
  const testBtn = document.getElementById('testConnectionBtn');
  const originalContent = testBtn.innerHTML;

  const apiUrl = document.getElementById('syncApiUrl').value.trim();
  const authType = document.getElementById('syncAuthType').value;
  const authValue = document.getElementById('syncAuthValue').value.trim();

  if (!apiUrl) {
    showSyncSettingsStatus('error', '⚠️ Please enter an API endpoint first.');
    return;
  }

  testBtn.innerHTML = 'Testing...';
  testBtn.disabled = true;
  showSyncSettingsStatus('loading', '🔄 Testing connection...');

  const headers = {
    'Content-Type': 'application/json',
    ...buildAuthHeader(authType, authValue),
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ test: true, timestamp: new Date().toISOString() }),
    });

    if (response.ok) {
      showSyncSettingsStatus('success', `✅ Connection successful! (Status: ${response.status})`);
    } else {
      showSyncSettingsStatus('error', `⚠️ Server responded with status: ${response.status}`);
    }
  } catch (error) {
    showSyncSettingsStatus('error', `❌ Connection failed: ${error.message}`);
  } finally {
    testBtn.innerHTML = originalContent;
    testBtn.disabled = false;
    setTimeout(() => hideSyncSettingsStatus(), 5000);
  }
}

/**
 * Setup sync-related event listeners
 */
function setupSyncEventListeners() {
  // Sync button in capture tab
  document.getElementById('syncButton').addEventListener('click', syncDataToServer);

  // Settings tab elements
  document.getElementById('saveSyncSettingsBtn').addEventListener('click', saveSyncSettings);
  document.getElementById('testConnectionBtn').addEventListener('click', testConnection);

  // Auth type change handler
  document.getElementById('syncAuthType').addEventListener('change', (e) => {
    updateAuthValueVisibility(e.target.value);
  });

  // Auto-sync toggle handler to show/hide delay option
  document.getElementById('autoSyncToggle').addEventListener('change', (e) => {
    updateSyncDelayVisibility(e.target.checked);
  });

  // Load settings when Settings tab is shown
  loadSyncSettings();
}
