// CDCMS Auto-Canceller Popup Logic

// LicenseWala license verification (single source of truth).
// Keys are verified ONLY against the LicenseWala server below. There is
// no offline, sandbox, or developer fallback of any kind.
const LICENSE_VERIFY_URL = "https://licensescript.netlify.app/api/verify-license";
const LICENSE_RENEW_URL = "https://licensescript.netlify.app/";
const LICENSE_VERIFY_TIMEOUT_MS = 12000;

// State Variables
let loadedNumbersList = [];
let isStateActive = false;
let activeToolMode = 'cancel'; // 'cancel' or 'confirm'

// DOM Elements
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const fileInfoPanel = document.getElementById('fileInfoPanel');
const fileNameEl = document.getElementById('fileName');
const fileCountEl = document.getElementById('fileCount');
const removeFileBtn = document.getElementById('removeFileBtn');
const manualNumbersTextarea = document.getElementById('manualNumbers');
const cancelReasonInput = document.getElementById('cancelReason');
const delaySecondsInput = document.getElementById('delaySeconds');
const delayValSpan = document.getElementById('delayVal');

// Mode & Delivery Confirmation Elements
const modeCancelBtn = document.getElementById('modeCancelBtn');
const modeConfirmBtn = document.getElementById('modeConfirmBtn');
const settingsTitle = document.getElementById('settingsTitle');
const cancelSettings = document.getElementById('cancelSettings');
const deliverySettings = document.getElementById('deliverySettings');
const deliveryManSelect = document.getElementById('deliveryMan');
const delaySecondsConfirmInput = document.getElementById('delaySecondsConfirm');
const delayValConfirmSpan = document.getElementById('delayValConfirm');
const customDeliveryManGroup = document.getElementById('customDeliveryManGroup');
const customDeliveryManInput = document.getElementById('customDeliveryMan');
const customCancelReasonGroup = document.getElementById('customCancelReasonGroup');
const customCancelReasonInput = document.getElementById('customCancelReason');
const startBtnText = document.getElementById('startBtnText');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');

const monitorPanel = document.getElementById('monitorPanel');
const progressStatusText = document.getElementById('progressStatusText');
const progressPercentText = document.getElementById('progressPercentText');
const progressBarFill = document.getElementById('progressBarFill');

const statTotal = document.getElementById('statTotal');
const statSuccess = document.getElementById('statSuccess');
const statError = document.getElementById('statError');
const statPending = document.getElementById('statPending');

const logsPanel = document.getElementById('logsPanel');
const logsTableBody = document.getElementById('logsTableBody');
const exportLogsBtn = document.getElementById('exportLogsBtn');
const statusBadge = document.getElementById('statusBadge');
const configPanel = document.getElementById('configPanel');

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Licensing verification
  initializeLicensing();

  // Load SaaS settings configurations dynamically (logo, company name, contact info)
  fetchDynamicConfig();

  // 1. Load configuration and restore state
  restoreState();
  
  // 2. Tab selection logic
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (isStateActive) return; // Disable switching tabs while running
      
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
      
      validateInputs();
    });
  });

  // 3. Dropzone & File upload handlers
  browseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);
  
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (isStateActive) return;
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      fileInput.files = files;
      handleFileSelect();
    }
  });

  removeFileBtn.addEventListener('click', () => {
    if (isStateActive) return;
    fileInput.value = '';
    loadedNumbersList = [];
    fileInfoPanel.style.display = 'none';
    dropzone.style.display = 'block';
    validateInputs();
  });

  // 4. Manual Text Area listener
  manualNumbersTextarea.addEventListener('input', () => {
    if (isStateActive) return;
    validateInputs();
  });

  // 5. Delay slider sync
  delaySecondsInput.addEventListener('input', (e) => {
    delayValSpan.innerText = e.target.value;
  });

  delaySecondsConfirmInput.addEventListener('input', (e) => {
    delayValConfirmSpan.innerText = e.target.value;
  });

  // 5b. Tool Mode & Delivery Man listeners
  modeCancelBtn.addEventListener('click', () => {
    if (isStateActive) return;
    setMode('cancel');
  });

  modeConfirmBtn.addEventListener('click', () => {
    if (isStateActive) return;
    setMode('confirm');
  });

  deliveryManSelect.addEventListener('change', () => {
    if (deliveryManSelect.value === 'CUSTOM') {
      customDeliveryManGroup.style.display = 'flex';
    } else {
      customDeliveryManGroup.style.display = 'none';
    }
  });

  cancelReasonInput.addEventListener('change', () => {
    if (cancelReasonInput.value === 'CUSTOM') {
      customCancelReasonGroup.style.display = 'flex';
    } else {
      customCancelReasonGroup.style.display = 'none';
    }
  });

  // 6. Action buttons
  startBtn.addEventListener('click', startAutomation);
  pauseBtn.addEventListener('click', togglePauseAutomation);
  stopBtn.addEventListener('click', stopAutomation);
  exportLogsBtn.addEventListener('click', exportLogs);

  // 7. Watch for state changes in storage (synchronized with content.js)
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.cdcms_automation_state) {
      updateUI(changes.cdcms_automation_state.newValue);
    }
  });
});

// Load numbers from file (Excel/CSV)
function handleFileSelect() {
  const file = fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = e.target.result;
      const workbook = XLSX.read(data, { type: 'binary' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Parse to 2D array of rows
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (rows.length === 0) {
        alert("The uploaded file is empty!");
        return;
      }
      
      // Apply Heuristic to find the Consumer Numbers column
      const colIndex = findConsumerColumnIndex(rows.slice(0, 15));
      console.log(`Found consumer column index: ${colIndex}`);
      
      const numbers = [];
      for (let i = 0; i < rows.length; i++) {
        const val = rows[i][colIndex];
        if (val === undefined || val === null) continue;
        
        // Clean value and check if it resembles a consumer number (e.g. 5 to 9 digits)
        const strVal = String(val).trim();
        if (/^\d{5,9}$/.test(strVal)) {
          numbers.push({
            consumerNo: strVal,
            rowNum: i + 1
          });
        }
      }
      
      if (numbers.length === 0) {
        alert("No valid consumer numbers found in the file! (Expected columns with 5-9 digit numbers)");
        return;
      }
      
      loadedNumbersList = numbers;
      fileNameEl.innerText = file.name;
      fileCountEl.innerText = `${numbers.length} bookings loaded`;
      
      // Toggle views
      dropzone.style.display = 'none';
      fileInfoPanel.style.display = 'flex';
      
      validateInputs();
    } catch (err) {
      console.error(err);
      alert("Error reading file! Please make sure it is a valid Excel or CSV file.");
    }
  };
  
  reader.readAsBinaryString(file);
}

// Heuristic to locate consumer number column (looks for 5-9 digit integers)
function findConsumerColumnIndex(sampleRows) {
  if (sampleRows.length === 0) return 0;
  
  // Find max columns in samples
  let maxCols = 0;
  sampleRows.forEach(row => {
    if (row.length > maxCols) maxCols = row.length;
  });
  
  const colScores = new Array(maxCols).fill(0);
  
  // Score columns based on digit matches
  for (let r = 0; r < sampleRows.length; r++) {
    const row = sampleRows[r];
    for (let c = 0; c < row.length; c++) {
      const val = row[c];
      if (val !== undefined && val !== null) {
        const str = String(val).trim();
        if (/^\d{5,9}$/.test(str)) {
          colScores[c]++;
        }
      }
    }
  }
  
  // Find column with highest score
  let bestCol = 0;
  let maxScore = -1;
  for (let c = 0; c < colScores.length; c++) {
    if (colScores[c] > maxScore) {
      maxScore = colScores[c];
      bestCol = c;
    }
  }
  
  return maxScore > 0 ? bestCol : 0;
}

// Enable/Disable Start button based on inputs
function validateInputs() {
  if (isStateActive) return;

  const activeTabId = document.querySelector('.tab-btn.active').dataset.tab;
  let hasItems = false;
  
  if (activeTabId === 'excelTab') {
    hasItems = loadedNumbersList.length > 0;
  } else {
    const manualVal = manualNumbersTextarea.value.trim();
    hasItems = manualVal.length > 0;
  }
  
  startBtn.disabled = !hasItems;
}

// Set popup mode helper
function setMode(mode) {
  activeToolMode = mode;
  if (mode === 'cancel') {
    modeCancelBtn.classList.add('active');
    modeConfirmBtn.classList.remove('active');
    settingsTitle.innerText = "2. Cancellation Options";
    cancelSettings.style.display = 'grid';
    deliverySettings.style.display = 'none';
    startBtnText.innerText = "Start Cancelling";
    
    if (cancelReasonInput.value === 'CUSTOM') {
      customCancelReasonGroup.style.display = 'flex';
    } else {
      customCancelReasonGroup.style.display = 'none';
    }
  } else {
    modeCancelBtn.classList.remove('active');
    modeConfirmBtn.classList.add('active');
    settingsTitle.innerText = "2. Delivery Confirmation Options";
    cancelSettings.style.display = 'none';
    deliverySettings.style.display = 'grid';
    startBtnText.innerText = "Start Punching";
    
    if (deliveryManSelect.value === 'CUSTOM') {
      customDeliveryManGroup.style.display = 'flex';
    } else {
      customDeliveryManGroup.style.display = 'none';
    }
  }
}

// Gather numbers from active inputs
function getNumbersQueue() {
  const activeTabId = document.querySelector('.tab-btn.active').dataset.tab;
  if (activeTabId === 'excelTab') {
    return loadedNumbersList;
  } else {
    // Parse manual inputs
    const text = manualNumbersTextarea.value.trim();
    return text.split('\n')
      .map(line => line.trim())
      .filter(line => /^\d{5,9}$/.test(line))
      .map(num => ({ consumerNo: num }));
  }
}

// Start the automation loop
function startAutomation() {
  const list = getNumbersQueue();
  if (list.length === 0) {
    alert("Please load or enter valid consumer numbers first!");
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    let targetUrlKeyword = "";
    let pageFriendlyName = "";

    if (activeToolMode === 'cancel') {
      targetUrlKeyword = "CancelCashMemo/CashMemoCancellation.aspx";
      pageFriendlyName = "CDCMS 'Cash Memo Cancellation'";
    } else {
      targetUrlKeyword = "OrderFulfillment/Punching/DeliveryConfirmation.aspx";
      pageFriendlyName = "CDCMS 'Delivery Confirmation'";
    }
    
    if (!activeTab || !activeTab.url || !activeTab.url.includes(targetUrlKeyword)) {
      alert(`❌ Operation Blocked!\n\nPlease make sure your active Chrome tab is opened to the ${pageFriendlyName} page.`);
      return;
    }

    let delay, reason, deliveryMan;
    if (activeToolMode === 'cancel') {
      delay = parseInt(delaySecondsInput.value, 10);
      reason = cancelReasonInput.value === 'CUSTOM' ? customCancelReasonInput.value.trim() : cancelReasonInput.value;
      if (!reason) {
        alert("Please select or enter a Cancellation Reason!");
        return;
      }
    } else {
      delay = parseInt(delaySecondsConfirmInput.value, 10);
      deliveryMan = deliveryManSelect.value === 'CUSTOM' ? customDeliveryManInput.value.trim() : deliveryManSelect.value;
      if (!deliveryMan) {
        alert("Please select or enter a Delivery Man name!");
        return;
      }
    }
    
    // Construct State
    const state = {
      active: true,
      paused: false,
      mode: activeToolMode,
      list: list,
      currentIndex: 0,
      logs: [],
      step: 'INIT',
      delay: delay,
      reason: reason,
      deliveryMan: deliveryMan,
      statusText: 'Initializing automation...'
    };
    
    // Save state and reload active tab to trigger the content script injection
    chrome.storage.local.set({ cdcms_automation_state: state }, () => {
      console.log('Automation state initialized in storage.');
      chrome.tabs.reload(activeTab.id);
    });
  });
}

// Toggle Pause/Resume
function togglePauseAutomation() {
  chrome.storage.local.get(['cdcms_automation_state'], (result) => {
    const state = result.cdcms_automation_state;
    if (!state) return;
    
    state.paused = !state.paused;
    state.statusText = state.paused ? 'Paused' : 'Resuming...';
    
    chrome.storage.local.set({ cdcms_automation_state: state }, () => {
      if (!state.paused) {
        // If resuming, reload the page to kickstart the content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) chrome.tabs.reload(tabs[0].id);
        });
      }
    });
  });
}

// Stop the automation
function stopAutomation() {
  chrome.storage.local.get(['cdcms_automation_state'], (result) => {
    const state = result.cdcms_automation_state || {};
    state.active = false;
    state.paused = false;
    state.statusText = 'Stopped';
    
    chrome.storage.local.set({ cdcms_automation_state: state });
  });
}

// Load and restore state on popup open
function restoreState() {
  chrome.storage.local.get(['cdcms_automation_state'], (result) => {
    const state = result.cdcms_automation_state;
    if (state) {
      if (state.mode) {
        activeToolMode = state.mode;
        setMode(state.mode);
      }
      
      // Restore settings values
      if (state.delay) {
        if (activeToolMode === 'cancel') {
          delaySecondsInput.value = state.delay;
          delayValSpan.innerText = state.delay;
        } else {
          delaySecondsConfirmInput.value = state.delay;
          delayValConfirmSpan.innerText = state.delay;
        }
      }
      if (state.reason) {
        const hasOption = Array.from(cancelReasonInput.options).some(opt => opt.value === state.reason);
        if (hasOption) {
          cancelReasonInput.value = state.reason;
          customCancelReasonGroup.style.display = 'none';
        } else {
          cancelReasonInput.value = 'CUSTOM';
          customCancelReasonInput.value = state.reason;
          customCancelReasonGroup.style.display = 'flex';
        }
      }
      if (state.deliveryMan) {
        const hasOption = Array.from(deliveryManSelect.options).some(opt => opt.value === state.deliveryMan);
        if (hasOption) {
          deliveryManSelect.value = state.deliveryMan;
          customDeliveryManGroup.style.display = 'none';
        } else {
          deliveryManSelect.value = 'CUSTOM';
          customDeliveryManInput.value = state.deliveryMan;
          customDeliveryManGroup.style.display = 'flex';
        }
      }
      
      updateUI(state);
    }
  });
}

// Update UI based on storage state changes
function updateUI(state) {
  if (!state) return;
  
  isStateActive = state.active;
  const isPaused = state.paused;
  
  // Badge and Controls
  if (isStateActive) {
    statusBadge.innerText = isPaused ? 'Paused' : 'Running';
    statusBadge.className = 'badge';
    statusBadge.classList.add(isPaused ? 'pending-card' : 'active-badge');
    
    // Disable inputs
    configPanel.style.opacity = '0.5';
    cancelReasonInput.disabled = true;
    customCancelReasonInput.disabled = true;
    delaySecondsInput.disabled = true;
    deliveryManSelect.disabled = true;
    delaySecondsConfirmInput.disabled = true;
    customDeliveryManInput.disabled = true;
    modeCancelBtn.disabled = true;
    modeConfirmBtn.disabled = true;
    
    // Buttons
    startBtn.style.display = 'none';
    pauseBtn.style.display = 'inline-flex';
    pauseBtn.innerHTML = isPaused ? '<span class="btn-icon">▶</span> Resume' : '<span class="btn-icon">⏸</span> Pause';
    stopBtn.disabled = false;
  } else {
    const hasLogs = state.logs && state.logs.length > 0;
    statusBadge.innerText = hasLogs ? 'Done' : 'Idle';
    statusBadge.className = 'badge';
    statusBadge.classList.add(hasLogs ? 'success-card' : 'active-badge');
    
    // Enable inputs
    configPanel.style.opacity = '1';
    cancelReasonInput.disabled = false;
    customCancelReasonInput.disabled = false;
    delaySecondsInput.disabled = false;
    deliveryManSelect.disabled = false;
    delaySecondsConfirmInput.disabled = false;
    customDeliveryManInput.disabled = false;
    modeCancelBtn.disabled = false;
    modeConfirmBtn.disabled = false;
    
    // Buttons
    startBtn.style.display = 'inline-flex';
    pauseBtn.style.display = 'none';
    stopBtn.disabled = !hasLogs;
    
    validateInputs();
  }

  // Progress Panel
  if (state.list && state.list.length > 0 && (isStateActive || (state.logs && state.logs.length > 0))) {
    monitorPanel.style.display = 'block';
    logsPanel.style.display = 'block';
    
    const total = state.list.length;
    const current = state.currentIndex;
    
    // Stats calculation
    let successCount = 0;
    let errorCount = 0;
    state.logs.forEach(log => {
      if (log.status === 'Success') successCount++;
      else errorCount++;
    });
    
    const pendingCount = total - current;
    
    statTotal.innerText = total;
    statSuccess.innerText = successCount;
    statError.innerText = errorCount;
    statPending.innerText = pendingCount;
    
    // Progress bar
    const percent = Math.round((current / total) * 100);
    progressPercentText.innerText = `${percent}%`;
    progressBarFill.style.width = `${percent}%`;
    
    progressStatusText.innerText = state.statusText || 'Processing...';
    
    // Render Logs Table
    renderLogs(state.logs);
  } else {
    monitorPanel.style.display = 'none';
    logsPanel.style.display = 'none';
  }
}

// Render dynamic log rows
function renderLogs(logs) {
  logsTableBody.innerHTML = '';
  
  if (!logs || logs.length === 0) {
    logsTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No logs recorded yet.</td></tr>';
    return;
  }

  // Show latest logs first, capped for popup responsiveness. The full
  // log list stays in storage, so Export Report still exports everything.
  const displayLogs = [...logs].reverse().slice(0, 200);
  if (logs.length > 200) {
    const note = document.createElement('tr');
    const noteTd = document.createElement('td');
    noteTd.colSpan = 4;
    noteTd.style.textAlign = 'center';
    noteTd.innerText = `Showing latest 200 of ${logs.length} logs. Export Report contains all logs.`;
    note.appendChild(noteTd);
    logsTableBody.appendChild(note);
  }
  
  displayLogs.forEach(log => {
    const tr = document.createElement('tr');
    
    const tdNo = document.createElement('td');
    tdNo.innerText = log.consumerNo;
    
    const tdStatus = document.createElement('td');
    tdStatus.innerText = log.status;
    tdStatus.className = log.status === 'Success' ? 'status-success' : 'status-error';
    
    const tdMsg = document.createElement('td');
    tdMsg.innerText = log.message;
    tdMsg.title = log.message;
    
    const tdTime = document.createElement('td');
    tdTime.innerText = log.timestamp;
    
    tr.appendChild(tdNo);
    tr.appendChild(tdStatus);
    tr.appendChild(tdMsg);
    tr.appendChild(tdTime);
    
    logsTableBody.appendChild(tr);
  });
}

// Export logs to CSV
function exportLogs() {
  chrome.storage.local.get(['cdcms_automation_state'], (result) => {
    const state = result.cdcms_automation_state;
    if (!state || !state.logs || state.logs.length === 0) {
      alert("No logs to export!");
      return;
    }
    
    // Create CSV content
    const headers = ["Consumer No", "Status", "Details", "Timestamp"];
    const rows = state.logs.map(log => [
      log.consumerNo,
      log.status,
      log.message,
      log.timestamp
    ]);
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += headers.join(",") + "\n";
    rows.forEach(row => {
      const escapedRow = row.map(val => {
        const strVal = String(val);
        // Escape quotes
        return `"${strVal.replace(/"/g, '""')}"`;
      });
      csvContent += escapedRow.join(",") + "\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute("download", `CDCMS_Cancellation_Report_${dateStr}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}

// ==========================================
// Licensing & Device Activation System
// ==========================================

async function initializeLicensing() {
  const deviceId = await getOrCreateDeviceId();
  const displayDeviceId = document.getElementById('displayDeviceId');
  if (displayDeviceId) displayDeviceId.innerText = deviceId;
  
  const btnActivate = document.getElementById('btnActivateLicense');
  const inputKey = document.getElementById('inputLicenseKey');
  const errorMsg = document.getElementById('licenseErrorMsg');
  
  if (btnActivate) {
    btnActivate.addEventListener('click', async () => {
      const key = inputKey.value.trim().toUpperCase();
      if (!key) {
        showLicenseError("Please enter a license key!");
        return;
      }
      
      const originalBtnHtml = btnActivate.innerHTML;
      btnActivate.disabled = true;
      btnActivate.innerText = "Verifying Key...";

      const res = await remoteVerifyLicense(key, deviceId);

      btnActivate.disabled = false;
      btnActivate.innerHTML = originalBtnHtml;
      
      if (res && res.valid) {
        const licenseData = {
          key: key,
          expires_at: res.expires_at,
          active: true,
          lastChecked: Date.now()
        };
        chrome.storage.local.set({ cdcms_license: licenseData }, () => {
          showLicensedUI(res.expires_at);
        });
      } else {
        showLicenseError(res ? res.message : "Activation failed.");
      }
    });
  }
  
  // Check cached license validity on load
  chrome.storage.local.get(['cdcms_license'], async (result) => {
    const license = result.cdcms_license;
    if (!license || !license.active) {
      showLockedUI();
    } else {
      const cacheDuration = 12 * 60 * 60 * 1000; // 12 hours local cache
      const isCacheValid = (Date.now() - license.lastChecked) < cacheDuration;
      
      if (isCacheValid) {
        if (new Date(license.expires_at) < new Date()) {
          lockLicenseLocal();
        } else {
          showLicensedUI(license.expires_at);
        }
      } else {
        // Re-verify online to check if admin suspended/expired key.
        // A network error must NOT lock a legitimate user out: keep the
        // cached license visible (without refreshing lastChecked, so the
        // next popup open retries verification). Only a server verdict
        // of invalid/expired locks the tool.
        const res = await remoteVerifyLicense(license.key, deviceId);
        if (res && res.valid) {
          license.lastChecked = Date.now();
          license.expires_at = res.expires_at;
          chrome.storage.local.set({ cdcms_license: license }, () => {
            showLicensedUI(res.expires_at);
          });
        } else if (res && res.networkError) {
          if (new Date(license.expires_at) > new Date()) {
            showLicensedUI(license.expires_at);
          } else {
            lockLicenseLocal();
          }
        } else {
          lockLicenseLocal();
          showLicenseError(res ? res.message : "License session expired.");
        }
      }
    }
  });
}

function getOrCreateDeviceId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['cdcms_device_id'], (result) => {
      let deviceId = result.cdcms_device_id;
      if (!deviceId) {
        deviceId = 'DEV-' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()
          .slice(0, 16);
        chrome.storage.local.set({ cdcms_device_id: deviceId }, () => resolve(deviceId));
      } else {
        resolve(deviceId);
      }
    });
  });
}

async function remoteVerifyLicense(key, deviceId) {
  const cleanKey = (key || '').trim().toUpperCase();
  if (!cleanKey) {
    return { valid: false, message: 'Please enter a license key.' };
  }

  // Same request shape as the sibling LicenseWala-integrated tools:
  // key + device id, verified server-side. No activation happens unless
  // the server itself returns an active/grace verdict below.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LICENSE_VERIFY_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(LICENSE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: cleanKey,
        hwid: deviceId,
        deviceName: 'CDCMS Auto-Canceller'
      }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('LicenseWala verification network error:', err);
    return { valid: false, networkError: true, message: 'Could not connect to LicenseWala server. Please check your internet connection and try again.' };
  }
  clearTimeout(timeoutId);

  let result = {};
  try {
    result = await response.json();
  } catch (e) {
    result = {};
  }

  const isActive = result.valid === true || result.status === 'active' || result.status === 'grace';
  if (isActive) {
    const expiresAt = result.expires_at || result.expiry_date || result.trial_ends_at || null;
    const daysLeft = typeof result.days_left === 'number' ? result.days_left : null;
    const computedExpiry = expiresAt || (daysLeft !== null ? new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000).toISOString() : null);
    if (!computedExpiry) {
      return { valid: false, message: 'License server response is missing an expiry date. Please contact LicenseWala support.' };
    }
    return {
      valid: true,
      expires_at: computedExpiry,
      status: result.status || 'active',
      trial: result.trial === true || cleanKey.startsWith('LW-TRIAL-'),
      message: result.message || 'License active!'
    };
  }

  const reason = result.status || 'invalid';
  let message = result.message || '';
  if (!message) {
    if (reason === 'expired') message = 'License key has expired. Please renew on LicenseWala.';
    else if (reason === 'device_mismatch') message = 'This key is already bound to another device. Please reset the device binding on your LicenseWala account.';
    else if (reason === 'rate_limited') message = 'Too many verification attempts. Please wait a minute and try again.';
    else message = 'Invalid license key. Please check the key and try again.';
  }
  return { valid: false, status: reason, message: message };
}

function showLockedUI() {
  const licensedEl = document.getElementById('licensedContent');
  const lockEl = document.getElementById('licenseLockScreen');
  if (licensedEl) licensedEl.style.display = 'none';
  if (lockEl) lockEl.style.display = 'block';
}

function showLicensedUI(expiryDateStr) {
  const licensedEl = document.getElementById('licensedContent');
  const lockEl = document.getElementById('licenseLockScreen');
  if (licensedEl) licensedEl.style.display = 'block';
  if (lockEl) lockEl.style.display = 'none';
  
  const expInfo = document.getElementById('licenseExpiryInfo');
  if (expInfo && expiryDateStr) {
    const expDate = new Date(expiryDateStr);
    expInfo.innerHTML = `License Active - Expiry: ${expDate.toLocaleDateString()} (<a href="${LICENSE_RENEW_URL}" target="_blank" style="color: inherit; text-decoration: underline;">Renew</a>)`;
    expInfo.style.display = 'block';
  }
}

function lockLicenseLocal() {
  chrome.storage.local.remove('cdcms_license', () => {
    showLockedUI();
  });
}

function showLicenseError(msg) {
  const errorMsg = document.getElementById('licenseErrorMsg');
  if (errorMsg) {
    errorMsg.innerText = msg;
    errorMsg.style.display = 'block';
  }
}

// Portal details shown in the popup header/footer.
// Static on purpose: no remote config fetch, so a failed or slow network
// can never change branding or interfere with activation.
async function fetchDynamicConfig() {
  const config = {
    company_name: 'Mr. Rahul Scripts',
    support_email: 'its.rahul@zohomail.com',
    support_phone: '+91 7564948617',
    company_logo: ''
  };

  const logoImg = document.getElementById('popupLogoImg');
  const brandName = document.getElementById('popupBrandName');
  const footer = document.getElementById('popupFooter');

  if (logoImg && config.company_logo) {
    logoImg.src = config.company_logo;
  }
  if (brandName) {
    brandName.innerText = config.company_name.toUpperCase();
  }
  if (footer) {
    footer.innerText = `© 2026 ${config.company_name} | ${config.support_email} | ${config.support_phone}`;
  }
}
