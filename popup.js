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

function clearOldStorageData() {
  chrome.storage.local.get(null, (items) => {
    const keysToRemove = [];
    for (const key in items) {
      if (key.startsWith("httpData_") || key.startsWith("wsData_")) {
        const domain = key.replace(/^(httpData_|wsData_)/, "");
        const rootDomain = getDomainFromUrl(`https://${domain}`);

        if (domain !== rootDomain) {
          keysToRemove.push(key);
        }
      }

      if (key === "lastHttpRequest" || key === "lastWsRequest") {
        keysToRemove.push(key);
      }
    }

    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove, () => {
        console.log("Cleared old storage keys:", keysToRemove);
      });
    }
  });
}

function loadAndApplySettings() {
  chrome.storage.sync.get("settings", (data) => {
    const settings = data.settings || { preset: "default", presets: {} };
    updateUiWithOptions(settings);
  });
}

function saveSettings() {
  const presetToSave = document.querySelector('input[name="preset"]:checked').value;
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
      status.textContent = `Preset '${presetToSave}' saved!`;
      setTimeout(() => (status.textContent = ""), 2000);
    });
  });
}

function updateUiWithOptions(settings) {
  const activePreset = settings.preset || "default";
  const presetsConfig = settings.presets || {};

  document.getElementById("activePreset").value = activePreset;

  const radio = document.querySelector(`input[name="preset"][value="${activePreset}"]`);
  if (radio) radio.checked = true;

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

    const domainInfo = document.getElementById("currentDomain");
    if (domainInfo) {
      domainInfo.textContent = `Current domain: ${domain}`;
    }
  });
}

function autoDetectAndSetPreset() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.url) {
      loadAndApplySettings();
      return;
    }
    const url = new URL(tabs[0].url);
    let detectedPreset = "default";

    if (url.hostname.includes("tiktok.com")) detectedPreset = "tiktok";
    else if (url.hostname.includes("facebook.com") || url.hostname.includes("messenger.com")) detectedPreset = "facebook";

    chrome.storage.sync.get("settings", ({ settings = {} }) => {
      const newSettings = { ...settings, preset: detectedPreset };
      chrome.storage.sync.set({ settings: newSettings }, () => {
        updateUiWithOptions(newSettings);
      });
    });
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

  document.getElementById("activePreset").addEventListener("change", (event) => {
    const newActivePreset = event.target.value;
    chrome.storage.sync.get("settings", (data) => {
      const settings = data.settings || {};
      const newSettings = { ...settings, preset: newActivePreset };
      chrome.storage.sync.set({ settings: newSettings }, () => {
        updateUiWithOptions(newSettings);
      });
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

  document.getElementById("saveButton").addEventListener("click", saveSettings);

  document.getElementById("copyHttpButton").addEventListener("click", () => copyDataAsJson("http", "copyHttpButton"));
  document.getElementById("copyWsButton").addEventListener("click", () => copyDataAsJson("ws", "copyWsButton"));
  document.getElementById("copyAllButton").addEventListener("click", () => copyAllDataAsJson("copyAllButton"));

  document.getElementById("reloadButton").addEventListener("click", () => {
    getCurrentDomainAndLoadData();
    const reloadBtn = document.getElementById("reloadButton");
    const originalContent = reloadBtn.innerHTML;
    reloadBtn.innerHTML = `<svg class="button-icon" width="20" height="20" viewBox="0 0 0.5 0.5" aria-hidden="true" focusable="false" style="animation: spin 1s linear infinite;">
                <path fill="#fff" d="M0.482 0.3a0.018 0.018 0 0 1 0.018 0.018v0.08a0.018 0.018 0 0 1 -0.017 0.018 0.018 0.018 0 0 1 -0.017 -0.018v-0.028C0.419 0.446 0.335 0.5 0.244 0.5c-0.11 0 -0.203 -0.068 -0.243 -0.173a0.018 0.018 0 0 1 0.01 -0.023c0.009 -0.004 0.019 0.001 0.023 0.01 0.035 0.092 0.115 0.15 0.21 0.15 0.084 0 0.163 -0.055 0.2 -0.129l-0.037 0a0.018 0.018 0 0 1 -0.018 -0.018 0.018 0.018 0 0 1 0.017 -0.018zm-0.226 -0.3c0.11 0 0.203 0.068 0.243 0.173a0.018 0.018 0 0 1 -0.01 0.023 0.017 0.017 0 0 1 -0.023 -0.01c-0.035 -0.092 -0.115 -0.15 -0.21 -0.15 -0.084 0 -0.163 0.055 -0.2 0.129l0.037 0a0.018 0.018 0 0 1 0.018 0.018 0.018 0.018 0 0 1 -0.017 0.018L0.018 0.2A0.018 0.018 0 0 1 0 0.182V0.102c0 -0.01 0.008 -0.018 0.017 -0.018s0.017 0.008 0.017 0.018v0.028C0.081 0.054 0.165 0 0.256 0"/>
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
    renderRequestDetails(data[httpKey], "http-output", "copyHttpButton", "No HTTP request captured yet.", domain);
    renderRequestDetails(data[wsKey], "ws-output", "copyWsButton", "No WebSocket handshake captured yet.", domain);

    const copyAllContainer = document.getElementById("copyAllContainer");
    if (data[httpKey] || data[wsKey]) {
      copyAllContainer.style.display = "flex";
    } else {
      copyAllContainer.style.display = "default";
    }
  });
}

function renderRequestDetails(request, outputId, buttonId, emptyMessage, domain) {
  const output = document.getElementById(outputId);
  const copyBtn = document.getElementById(buttonId);

  if (!request) {
    output.innerHTML = `<p class="no-request">${emptyMessage}</p>`;
    copyBtn.style.display = "default";
    return;
  }

  copyBtn.style.display = "flex";

  const headers = request.headers;
  const params = extractParams(request.url);
  const cookies = extractCookies(headers);

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

document.addEventListener("DOMContentLoaded", () => {
  clearOldStorageData();

  autoDetectAndSetPreset();
  setupEventListeners();
  getCurrentDomainAndLoadData();

  chrome.tabs.onActivated.addListener(() => {
    setTimeout(() => {
      getCurrentDomainAndLoadData();
      autoDetectAndSetPreset();
    }, 0);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.active) {
      setTimeout(() => {
        getCurrentDomainAndLoadData();
        autoDetectAndSetPreset();
      }, 0);
    }
  });
});
