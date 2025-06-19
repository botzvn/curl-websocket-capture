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
  const cookieHeader = headers.find((h) => h.name.toLowerCase() === "cookie");
  if (!cookieHeader) return {};

  const cookies = {};
  cookieHeader.value.split(";").forEach((cookie) => {
    const [name, value] = cookie.split("=");
    if (name && value) {
      cookies[name.trim()] = value.trim();
    }
  });
  return cookies;
}

function formatHeadersForJson(headers) {
  return headers.reduce((obj, h) => {
    if (!h.name.startsWith(":")) obj[h.name] = h.value;
    return obj;
  }, {});
}

function formatObjectForDisplay(obj) {
  const entries = Object.entries(obj);
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join("\n") : "default";
}

function getDomainFromUrl(url) {
  console.log("🚀 ~ getDomainFromUrl ~ url:", url);
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

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

function clearOldStorageData() {
  chrome.storage.local.get(null, (items) => {
    for (const key in items) {
      if (key.startsWith("httpData_") || key.startsWith("wsData_")) {
        const domain = key.replace(/^(httpData_|wsData_)/, "");
        chrome.storage.local.remove(domain, () => {
          console.log("Cleared old storage keys:", domain);
        });
      }
    }
  });
}

function loadAndApplySettings() {
  chrome.storage.sync.get("settings", (data) => {
    const settings = data.settings || { preset: "default", presets: {} };
    updateUiWithOptions(settings);
  });
}

async function saveSettings() {
  const presetToSave = await getCurrentDomain();
  const overrideKeywords = document.getElementById("overrideKeywords").value;
  const overrideKeywordsWS = document.getElementById("overrideKeywordsWS").value;

  chrome.storage.sync.get("settings", (data) => {
    const oldSettings = data.settings || { preset: "default", presets: {} };
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
      const status = document.getElementById("status");
      status.textContent = `saved!`;
      status.style.marginRight = "10px";
      setTimeout(() => (status.textContent = ""), 2000);
    });
  });
}

function updateUiWithOptions(settings) {
  const activePreset = settings.preset || "default";
  const presetsConfig = settings.presets || {};

  const activePresetConfig = presetsConfig[activePreset] || {};
  document.getElementById("overrideKeywords").value = activePresetConfig.overrideKeywords || "";
  document.getElementById("overrideKeywordsWS").value = activePresetConfig.overrideKeywordsWS || "";
}

function getCurrentDomainAndLoadData() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.url) {
      displayAllCapturedRequests("unknown");
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

    chrome.storage.sync.get("settings", ({ settings = {} }) => {
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
  document.querySelectorAll(".tab-button").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const target = tab.dataset.tab;
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.toggle("active", c.id === target));
    });
  });

  document.querySelectorAll('input[name="preset"]').forEach((radio) => {
    radio.addEventListener("change", (event) => {
      const selectedPresetForView = event.target.value;

      chrome.storage.sync.get("settings", (data) => {
        const presetsConfig = data.settings?.presets || {};
        const configToShow = presetsConfig[selectedPresetForView] || {};
        document.getElementById("overrideKeywords").value = configToShow.overrideKeywords || "";
        document.getElementById("overrideKeywordsWS").value = configToShow.overrideKeywordsWS || "";
      });
    });
  });

  // document.getElementById("saveButton").addEventListener("click", saveSettings);
  document.getElementById("saveAndReloadBtn").addEventListener("click", saveAndReloadBtn);

  // document.getElementById("copyHttpButton").addEventListener("click", () => copyDataAsJson("http", "copyHttpButton"));
  // document.getElementById("copyWsButton").addEventListener("click", () => copyDataAsJson("ws", "copyWsButton"));
  document.getElementById("copyAllButton").addEventListener("click", () => copyAllDataAsJson("copyAllButton"));

  document.getElementById("reloadButton").addEventListener("click", () => {
    getCurrentDomainAndLoadData();
    const reloadBtn = document.getElementById("reloadButton");
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
  const httpKey = `httpData_${domain}`;
  const wsKey = `wsData_${domain}`;

  console.log(`Looking for data with keys: ${httpKey}, ${wsKey}`);

  chrome.storage.local.get([httpKey, wsKey], (data) => {
    console.log(`Found data:`, data);
    renderRequestDetails({ request: data[httpKey], outputId: "http-output", emptyMessage: "No HTTP request captured yet.", domain });
    renderRequestDetails({ request: data[wsKey], outputId: "ws-output", emptyMessage: "No WebSocket handshake captured yet.", domain });

    const copyAllContainer = document.getElementById("copyAllContainer");
    if (data[httpKey] || data[wsKey]) {
      copyAllContainer.style.display = "flex";
    } else {
      copyAllContainer.style.display = "default";
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
    const key = type === "http" ? `httpData_${domain}` : `wsData_${domain}`;

    chrome.storage.local.get(key, (data) => {
      const req = data[key];
      if (!req) return;

      const exportData = {
        type: req.type,
        url: req.url,
        method: req.method,
        timestamp: new Date().toISOString(),
        headers: formatHeadersForJson(req.headers),
        params: extractParams(req.url),
        cookies: extractCookies(req.headers),
      };

      const json = JSON.stringify(exportData, null, 2);
      copyToClipboard(json, document.getElementById(buttonId));
    });
  });
}

function copyAllDataAsJson(buttonId) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.url) return;

    const domain = getDomainFromUrl(tabs[0].url);
    const httpKey = `httpData_${domain}`;
    const wsKey = `wsData_${domain}`;

    chrome.storage.local.get([httpKey, wsKey], (data) => {
      const httpRequest = data[httpKey];
      const wsRequest = data[wsKey];
      if (!httpRequest && !wsRequest) return;

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
        };
      }

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
    .catch((err) => console.error("Copy error: ", err));
}

function flashElementGreen(dataType) {
  if (!document.getElementById("flashAnimationStyle")) {
    const style = document.createElement("style");
    style.id = "flashAnimationStyle";
    style.textContent = `
      @keyframes flashGreen {
        0% { color: #666; }
        50% { color: #4CAF50; font-weight: bold; }
        100% { color: #666; }
      }
      .data-timestamp.flash-green {
        animation: flashGreen 0.8s ease-in-out 3;
      }
    `;
    document.head.appendChild(style);
  }

  const timestampElement = document.querySelector(".data-timestamp");

  if (timestampElement) {
    timestampElement.classList.add("flash-green");
    timestampElement.textContent = `📡 Captured: ${new Date().toLocaleString()}`;
    setTimeout(() => {
      timestampElement.classList.remove("flash-green");
    }, 800);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  clearOldStorageData();

  autoDetectAndSetPreset();
  setupEventListeners();
  getCurrentDomainAndLoadData();

  // Listen for messages from background script about tab changes
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Received message from background:", message);

    if (message.type === "TAB_ACTIVATED" || message.type === "TAB_UPDATED") {
      setTimeout(() => {
        getCurrentDomainAndLoadData();
        autoDetectAndSetPreset();
      }, 100); // Small delay to ensure tab info is updated
    } else if (message.type === "NEW_DATA_CAPTURED") {
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
    }
  });
});
