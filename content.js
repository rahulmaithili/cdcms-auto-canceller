// Inject alert/confirm interceptor immediately at document_start
(function injectInterceptor() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  (document.head || document.documentElement).appendChild(script);
})();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function logDebug(...args) {
  console.log('[Auto-Canceller Content]', ...args);
}

let isExecutingStep = false;
let pollInterval = null;

// Start the polling loop on page load
document.addEventListener('DOMContentLoaded', () => {
  logDebug('DOM Loaded, starting polling loop...');
  startPolling();
});

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(checkAndRunAutomation, 1000);
}

// Helper to check if ASP.NET UpdateProgress is active (page is loading)
function isPageLoading() {
  const loaders = [
    document.getElementById('UpdateProgress1'),
    document.getElementById('updateProgress'),
    document.querySelector('.loading'),
    document.querySelector('.overlay'),
    document.querySelector('[id*="UpdateProgress"]'),
    document.getElementById('imgLoading')
  ];
  return loaders.some(el => el && el.offsetWidth > 0 && el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none' && window.getComputedStyle(el).visibility !== 'hidden');
}

// Main polling loop function
async function checkAndRunAutomation() {
  if (isExecutingStep) return;
  
  chrome.storage.local.get(['cdcms_automation_state', 'cdcms_license'], async (result) => {
    const state = result.cdcms_automation_state;
    const license = result.cdcms_license;
    
    // Check if license is active
    const isLicensed = license && license.active && (new Date(license.expires_at) > new Date());
    
    // If not licensed but state is active, force stop automation immediately
    if (!isLicensed && state && state.active) {
      console.log('[Auto-Canceller] License expired or suspended. Stopping execution.');
      state.active = false;
      state.statusText = "License invalid/expired. Automation stopped.";
      chrome.storage.local.set({ cdcms_automation_state: state });
      return;
    }
    
    if (!isLicensed) {
      return; // Do not execute ticks if unlicensed
    }

    if (!state || !state.active || state.paused) {
      if (!state && pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      return;
    }
    
    // Check if the page is currently processing an AJAX request
    if (isPageLoading()) {
      logDebug('Server is processing (loading spinner active). Waiting...');
      return;
    }

    isExecutingStep = true;
    try {
      if (state.mode === 'confirm') {
        await processDeliveryAutomation(state);
      } else {
        await processAutomation(state);
      }
    } catch (err) {
      console.error('[Auto-Canceller] Loop error:', err);
    } finally {
      isExecutingStep = false;
    }
  });
}

// Route active states, alert dialogues, and popup dialogues
async function processAutomation(state) {
  const { list, currentIndex } = state;
  if (currentIndex >= list.length) {
    state.active = false;
    state.statusText = 'Completed successfully!';
    chrome.storage.local.set({ cdcms_automation_state: state });
    logDebug('Automation complete.');
    return;
  }
  
  const currentItem = list[currentIndex];
  
  // If we are in the CLEARING state, do nothing and let the clear timer complete
  if (state.step === 'CLEARING') {
    return;
  }
  
  // 1. Check for browser alerts (captured in the bridge)
  const bridge = document.getElementById('cdcms_alert_bridge');
  const browserAlert = bridge ? bridge.getAttribute('data-alert') : null;
  if (browserAlert && browserAlert.trim().length > 0) {
    bridge.removeAttribute('data-alert');
    bridge.innerText = '';
    logDebug('Captured Browser Alert:', browserAlert);
    await handleResultCaptured(state, currentItem, browserAlert);
    return;
  }
  
  // 2. Check for jQuery UI dialogs (custom page modals)
  // We use querySelectorAll because the sidebar menu itself may use the '.ui-dialog' wrapper class.
  const dialogs = Array.from(document.querySelectorAll('.ui-dialog'));
  let activeDialog = null;
  let dialogMsg = '';
  
  for (const dialog of dialogs) {
    const isVisible = dialog.offsetWidth > 0 && dialog.offsetHeight > 0 && window.getComputedStyle(dialog).display !== 'none';
    if (isVisible) {
      const dialogContent = dialog.querySelector('.ui-dialog-content');
      const msg = dialogContent ? dialogContent.innerText.trim() : '';
      
      // Exclude the sidebar menu wrapper
      const isSidebarMenu = msg.includes('DISTRIBUTOR DATA') || msg.includes('SUVIDHA CLUB') || msg.includes('CDCMS MENU');
      
      if (msg.length > 0 && !isSidebarMenu) {
        activeDialog = dialog;
        dialogMsg = msg;
        break; // Found the actual message popup dialog!
      }
    }
  }
  
  if (activeDialog) {
    logDebug('Captured Visible jQuery UI Dialog:', dialogMsg);
    
    // Find and click the dialog's "OK" button to close it
    const buttons = Array.from(activeDialog.querySelectorAll('button, input[type="button"]'));
    const okBtn = buttons.find(b => {
      const txt = b.innerText.trim().toUpperCase() || b.value.trim().toUpperCase();
      return txt === 'OK' || txt === 'CLOSE' || txt === '×';
    });
    if (okBtn) {
      logDebug('Clicking dialog OK/Close button');
      okBtn.click();
      await sleep(500);
    }
    
    await handleResultCaptured(state, currentItem, dialogMsg);
    return;
  }
  
  // 3. If no active visible alert/dialog, execute the step matching the current state
  await executeStep(state, currentItem);
}

// Log result, clear inputs, wait delay, and advance queue index
async function handleResultCaptured(state, item, msg) {
  const consumerNo = item.consumerNo || item;
  const lowerMsg = msg.toLowerCase();
  
  let status = 'Error';
  // If we are in CANCELLING step, a success message indicates cancellation went through
  if (state.step === 'CANCELLING') {
    if (lowerMsg.includes('success') || lowerMsg.includes('cancel') || lowerMsg.includes('done') || lowerMsg.includes('ok')) {
      status = 'Success';
    }
  }
  
  state.logs.push({
    consumerNo: consumerNo,
    status: status,
    message: msg,
    timestamp: new Date().toLocaleTimeString()
  });
  
  state.currentIndex++;
  state.step = 'CLEARING'; // Enter CLEARING state to block polling loop ticks
  
  if (state.currentIndex >= state.list.length) {
    state.active = false;
    state.statusText = 'Completed!';
  } else {
    state.statusText = `Completed ${state.currentIndex}/${state.list.length}. Clearing form...`;
  }
  
  // Save state immediately
  chrome.storage.local.set({ cdcms_automation_state: state }, async () => {
    // Wait the configured delay
    const delayMs = (state.delay || 2) * 1000;
    await sleep(delayMs);
    
    // Click the main page Clear button to empty the form
    const btnClear = document.getElementById('ctl00_placeholder_2_widget_0_btnClear');
    if (btnClear) {
      logDebug('Clicking main page Clear button...');
      
      // Reset step to INIT *right before* clicking Clear, so when the postback completes, it is ready
      state.step = 'INIT';
      chrome.storage.local.set({ cdcms_automation_state: state }, () => {
        btnClear.click();
      });
    } else {
      // Fallback reload if no Clear button found
      state.step = 'INIT';
      chrome.storage.local.set({ cdcms_automation_state: state }, () => {
        logDebug('Clear button not found. Reloading page...');
        window.location.reload();
      });
    }
  });
}

// Helper to remove disabled class and attributes
function forceEnable(element) {
  if (element) {
    element.disabled = false;
    element.removeAttribute('disabled');
    element.removeAttribute('readonly');
    element.classList.remove('aspNetDisabled');
  }
}

// Execute the DOM actions for the current step
async function executeStep(state, currentItem) {
  const consumerNo = currentItem.consumerNo || currentItem;
  
  const rdbSingle = document.getElementById('rdbSingle');
  const txtConsumerNo = document.getElementById('ctl00_placeholder_2_widget_0_txtConsumerNo');
  const btnFetch = document.getElementById('ctl00_placeholder_2_widget_0_btnFetch');
  const txtConsumerName = document.getElementById('txtConsumerName');
  const cmbReason = document.getElementById('cmbCancellationReason');
  const btnCancel = document.getElementById('ctl00_placeholder_2_widget_0_btnCancelCashMemo');
  
  // Safety check: if inputs are not on page, skip to avoid executing in blank frames
  if (!rdbSingle && !txtConsumerNo) {
    return;
  }
  
  if (state.step === 'INIT') {
    // 1. Select single cancellation mode
    if (rdbSingle && !rdbSingle.checked) {
      logDebug('Selecting Single Cancellation...');
      rdbSingle.checked = true;
      rdbSingle.click();
      rdbSingle.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(500); // let page event handler trigger
    }
    
    if (txtConsumerNo) {
      // Force enable in case click handler is slow
      forceEnable(txtConsumerNo);
      
      // Fill consumer number
      if (txtConsumerNo.value !== consumerNo) {
        logDebug(`Filling consumer number: ${consumerNo}`);
        txtConsumerNo.value = consumerNo;
        txtConsumerNo.dispatchEvent(new Event('input', { bubbles: true }));
        txtConsumerNo.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(200);
      }
      
      // Click Fetch
      if (btnFetch) {
        forceEnable(btnFetch);
        
        state.step = 'FETCHING';
        state.statusText = `Fetching consumer ${consumerNo}...`;
        state.stepStartTime = Date.now(); // Track start time for timeout
        chrome.storage.local.set({ cdcms_automation_state: state }, () => {
          logDebug(`Clicking Fetch for ${consumerNo}`);
          btnFetch.click();
        });
      }
    }
  } 
  
  else if (state.step === 'FETCHING') {
    // 2. Wait for consumer details to load
    const consumerName = txtConsumerName ? txtConsumerName.value.trim() : '';
    if (consumerName) {
      logDebug(`Fetch complete! Consumer: ${consumerName}`);
      
      // Select cancellation reason from dropdown
      if (cmbReason) {
        forceEnable(cmbReason);
        
        let selectedValue = '';
        if (state.reason) {
          // Find option matching key phrase (e.g. "Wrong Entry")
          for (let option of cmbReason.options) {
            if (option.text.toLowerCase().includes(state.reason.toLowerCase()) || option.value === state.reason) {
              selectedValue = option.value;
              break;
            }
          }
        }
        
        // Default to the first valid option if no match
        if (!selectedValue && cmbReason.options.length > 1) {
          selectedValue = cmbReason.options[1].value;
        }
        
        if (selectedValue) {
          cmbReason.value = selectedValue;
          cmbReason.dispatchEvent(new Event('change', { bubbles: true }));
          logDebug(`Selected reason value: ${selectedValue}`);
          await sleep(500); // let page scripts process the selection
        } else {
          throw new Error('No cancellation reasons found in dropdown.');
        }
      }
      
      // Click Cancel Cash Memo
      if (btnCancel) {
        forceEnable(btnCancel);
        
        state.step = 'CANCELLING';
        state.statusText = `Cancelling booking for ${consumerNo}...`;
        state.stepStartTime = Date.now();
        chrome.storage.local.set({ cdcms_automation_state: state }, () => {
          logDebug('Clicking Cancel Cash Memo...');
          btnCancel.click();
        });
      }
    } else {
      // Check for fetch timeout (e.g., after 15 seconds)
      const startTime = state.stepStartTime || Date.now();
      if (Date.now() - startTime > 15000) {
        logDebug('Fetch timed out.');
        await handleResultCaptured(state, currentItem, 'Fetch timed out - details not loaded.');
      }
    }
  } 
  
  else if (state.step === 'CANCELLING') {
    // 3. Wait for cancellation popup dialog or browser alert to appear.
    // If no dialog appears, it will safely time out after 15 seconds.
    const startTime = state.stepStartTime || Date.now();
    if (Date.now() - startTime > 15000) {
      logDebug('Cancellation timed out.');
      await handleResultCaptured(state, currentItem, 'Cancellation timed out - no popup response.');
    }
  }
}

// ==========================================
// Delivery Confirmation Punching Automation
// ==========================================

// Route active states, alert dialogues, and popup dialogues for delivery confirm
async function processDeliveryAutomation(state) {
  const { list, currentIndex } = state;
  if (currentIndex >= list.length && (state.batchCount || 0) === 0) {
    state.active = false;
    state.statusText = 'Completed successfully!';
    chrome.storage.local.set({ cdcms_automation_state: state });
    logDebug('Delivery automation complete.');
    return;
  }
  
  const currentItem = list[currentIndex];
  
  if (state.step === 'CLEARING' || state.step === 'WAITING_DELAY') {
    return;
  }
  
  // 1. Check for browser alerts (captured in the bridge)
  const bridge = document.getElementById('cdcms_alert_bridge');
  const browserAlert = bridge ? bridge.getAttribute('data-alert') : null;
  if (browserAlert && browserAlert.trim().length > 0) {
    bridge.removeAttribute('data-alert');
    bridge.innerText = '';
    logDebug('Captured Browser Alert in Delivery:', browserAlert);
    await handleDeliveryResultCaptured(state, currentItem, browserAlert);
    return;
  }
  
  // 2. Check for jQuery UI dialogs
  const dialogs = Array.from(document.querySelectorAll('.ui-dialog'));
  let activeDialog = null;
  let dialogMsg = '';
  
  for (const dialog of dialogs) {
    const isVisible = dialog.offsetWidth > 0 && dialog.offsetHeight > 0 && window.getComputedStyle(dialog).display !== 'none';
    if (isVisible) {
      const dialogContent = dialog.querySelector('.ui-dialog-content');
      const msg = dialogContent ? dialogContent.innerText.trim() : '';
      
      const isSidebarMenu = msg.includes('DISTRIBUTOR DATA') || msg.includes('SUVIDHA CLUB') || msg.includes('CDCMS MENU');
      
      if (msg.length > 0 && !isSidebarMenu) {
        activeDialog = dialog;
        dialogMsg = msg;
        break;
      }
    }
  }
  
  if (activeDialog) {
    logDebug('Captured jQuery UI Dialog in Delivery:', dialogMsg);
    
    // Find and click the dialog's "OK" button to close it
    const buttons = Array.from(activeDialog.querySelectorAll('button, input[type="button"]'));
    const okBtn = buttons.find(b => {
      const txt = b.innerText.trim().toUpperCase() || b.value.trim().toUpperCase();
      return txt === 'OK' || txt === 'CLOSE' || txt === '×';
    });
    if (okBtn) {
      logDebug('Clicking dialog OK/Close button');
      okBtn.click();
      await sleep(500);
    }
    
    await handleDeliveryResultCaptured(state, currentItem, dialogMsg);
    return;
  }
  
  // 3. Execute step
  await executeDeliveryStep(state, currentItem);
}

// Log delivery confirmation results, clear form / reload, and manage batch status
async function handleDeliveryResultCaptured(state, item, msg) {
  const consumerNo = item.consumerNo || item;
  const lowerMsg = msg.toLowerCase();
  
  if (state.step === 'FETCHING') {
    // Fetch failed (e.g. invalid consumer or already punch)
    state.logs.push({
      consumerNo: consumerNo,
      status: 'Error',
      message: msg,
      timestamp: new Date().toLocaleTimeString()
    });
    
    state.currentIndex++;
    state.step = 'CLEARING';
    state.statusText = `Error fetching ${consumerNo}. Clearing...`;
    
    chrome.storage.local.set({ cdcms_automation_state: state }, async () => {
      await sleep(1000);
      const btnClear = findClearButton();
      if (btnClear) {
        logDebug('Clicking clear button after fetch error...');
        state.step = 'INIT';
        chrome.storage.local.set({ cdcms_automation_state: state }, () => {
          btnClear.click();
        });
      } else {
        logDebug('Clear button not found. Reloading page...');
        state.step = 'INIT';
        chrome.storage.local.set({ cdcms_automation_state: state }, () => {
          window.location.reload();
        });
      }
    });
  } 
  
  else if (state.step === 'SUBMITTING') {
    // Batch submission result
    const status = (lowerMsg.includes('success') || lowerMsg.includes('confirm') || lowerMsg.includes('done') || lowerMsg.includes('ok') || lowerMsg.includes('save')) ? 'Success' : 'Error';
    
    state.logs.push({
      consumerNo: 'BATCH SUBMIT',
      status: status,
      message: msg,
      timestamp: new Date().toLocaleTimeString()
    });
    
    state.batchCount = 0;
    state.step = 'CLEARING';
    state.statusText = `Batch submitted. Reloading page...`;
    
    chrome.storage.local.set({ cdcms_automation_state: state }, async () => {
      await sleep(1500);
      state.step = 'INIT';
      chrome.storage.local.set({ cdcms_automation_state: state }, () => {
        window.location.reload();
      });
    });
  }
}

// Execute step for Delivery Confirmation
async function executeDeliveryStep(state, currentItem) {
  const consumerNo = currentItem.consumerNo || currentItem;
  
  const txtConsumerNo = findConsumerNoInput();
  const btnFetch = findFetchButton();
  const ddlDeliveryMan = findDeliveryManSelect();
  const btnAddRow = findAddRowButton();
  const btnSubmit = findSubmitButton();
  
  // Safety check: if inputs are not on page, skip to avoid executing in blank frames
  if (!txtConsumerNo && !btnFetch && !btnAddRow) {
    return;
  }
  
  if (state.step === 'INIT') {
    if (txtConsumerNo) {
      forceEnable(txtConsumerNo);
      
      if (txtConsumerNo.value !== consumerNo) {
        logDebug(`Filling consumer number: ${consumerNo}`);
        txtConsumerNo.value = consumerNo;
        txtConsumerNo.dispatchEvent(new Event('input', { bubbles: true }));
        txtConsumerNo.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(200);
      }
      
      if (btnFetch) {
        forceEnable(btnFetch);
        state.step = 'FETCHING';
        state.statusText = `Fetching consumer ${consumerNo}...`;
        state.stepStartTime = Date.now();
        chrome.storage.local.set({ cdcms_automation_state: state }, () => {
          logDebug(`Clicking Fetch for ${consumerNo}`);
          btnFetch.click();
        });
      }
    }
  } 
  
  else if (state.step === 'FETCHING') {
    // Wait for consumer name to load
    const txtConsumerName = document.getElementById('txtConsumerName') || 
                            document.querySelector('input[id*="txtConsName"]') ||
                            document.querySelector('input[id*="txtConsumerName"]') ||
                            document.querySelector('input[name*="ConsName"]') ||
                            document.querySelector('input[name*="ConsumerName"]');
                            
    const consumerName = txtConsumerName ? txtConsumerName.value.trim() : '';
    
    if (consumerName) {
      logDebug(`Fetch complete! Consumer: ${consumerName}`);
      
      // Select Delivery Man
      if (ddlDeliveryMan) {
        forceEnable(ddlDeliveryMan);
        
        let selectedValue = '';
        if (state.deliveryMan) {
          for (let option of ddlDeliveryMan.options) {
            if (option.text.toLowerCase().includes(state.deliveryMan.toLowerCase()) || option.value === state.deliveryMan) {
              selectedValue = option.value;
              break;
            }
          }
        }
        
        if (!selectedValue && ddlDeliveryMan.options.length > 1) {
          selectedValue = ddlDeliveryMan.options[1].value;
        }
        
        if (selectedValue) {
          ddlDeliveryMan.value = selectedValue;
          ddlDeliveryMan.dispatchEvent(new Event('change', { bubbles: true }));
          logDebug(`Selected delivery man value: ${selectedValue}`);
          await sleep(500);
        }
      }
      
      // Click Add Row
      if (btnAddRow) {
        forceEnable(btnAddRow);
        state.step = 'ADDING_ROW';
        state.statusText = `Adding row for ${consumerNo}...`;
        state.stepStartTime = Date.now();
        chrome.storage.local.set({ cdcms_automation_state: state }, () => {
          logDebug('Clicking Add Row...');
          btnAddRow.click();
        });
      }
    } else {
      // Check for fetch timeout (15 seconds)
      const startTime = state.stepStartTime || Date.now();
      if (Date.now() - startTime > 15000) {
        logDebug('Fetch timed out.');
        await handleDeliveryResultCaptured(state, currentItem, 'Fetch timed out - details not loaded.');
      }
    }
  } 
  
  else if (state.step === 'ADDING_ROW') {
    // Wait for row to be added (indicated by consumer textbox clearing, or timeout)
    const isCleared = !txtConsumerNo || txtConsumerNo.value.trim() === '';
    const elapsed = Date.now() - (state.stepStartTime || Date.now());
    
    // Remove the 2000ms hardcoded force-advance, wait for clear or 20s timeout
    if (isCleared) {
      logDebug(`Row added successfully for ${consumerNo}`);
      
      state.logs.push({
        consumerNo: consumerNo,
        status: 'Success',
        message: 'Added to punch queue',
        timestamp: new Date().toLocaleTimeString()
      });
      
      state.currentIndex++;
      state.batchCount = (state.batchCount || 0) + 1;
      
      const maxBatchSize = 20;
      const shouldSubmit = state.batchCount >= maxBatchSize || (state.currentIndex >= state.list.length && state.batchCount > 0);
      
      if (shouldSubmit) {
        if (btnSubmit) {
          forceEnable(btnSubmit);
          state.step = 'SUBMITTING';
          state.statusText = `Submitting batch of ${state.batchCount} confirmations...`;
          state.stepStartTime = Date.now();
          chrome.storage.local.set({ cdcms_automation_state: state }, () => {
            logDebug('Clicking Submit button for batch...');
            btnSubmit.click();
          });
        } else {
          logDebug('Submit button not found!');
          state.step = 'INIT';
          state.batchCount = 0;
          state.logs.push({
            consumerNo: 'BATCH SUBMIT',
            status: 'Error',
            message: 'Submit button not found',
            timestamp: new Date().toLocaleTimeString()
          });
          chrome.storage.local.set({ cdcms_automation_state: state });
        }
      } else {
        state.step = 'INIT';
        state.statusText = `Added ${state.batchCount}/20. Moving to next...`;
        chrome.storage.local.set({ cdcms_automation_state: state }, async () => {
          const delayMs = (state.delay || 2) * 1000;
          await sleep(delayMs);
        });
      }
    } else if (elapsed > 20000) {
      // 20 second timeout for server to process "Add Row"
      logDebug('Add Row timed out after 20s.');
      await handleDeliveryResultCaptured(state, currentItem, 'Add Row timed out - server too slow.');
    }
  } 
  
  else if (state.step === 'SUBMITTING') {
    // Wait for submission alert
    const startTime = state.stepStartTime || Date.now();
    if (Date.now() - startTime > 15000) {
      logDebug('Submission timed out.');
      await handleDeliveryResultCaptured(state, currentItem, 'Submission timed out - no response alert.');
    }
  }
}

// Dynamic selectors helper functions
function findConsumerNoInput() {
  return document.getElementById('ctl00_placeholder_2_widget_0_txtConsumerNo') ||
         document.getElementById('txtConsumerNo') ||
         document.querySelector('input[id*="txtConsumerNo"]') ||
         document.querySelector('input[name*="txtConsumerNo"]') ||
         document.querySelector('input[placeholder*="Consumer"]') ||
         document.querySelector('input[id*="ConsumerNo"]') ||
         document.querySelector('input[name*="ConsumerNo"]');
}

function findFetchButton() {
  return document.getElementById('ctl00_placeholder_2_widget_0_btnFetch') ||
         document.getElementById('btnFetch') ||
         document.querySelector('input[id*="btnFetch"], button[id*="btnFetch"]') ||
         document.querySelector('input[value="Fetch"], button[value="Fetch"]') ||
         Array.from(document.querySelectorAll('input, button')).find(el => (el.value || el.innerText || '').trim() === 'Fetch');
}

function findDeliveryManSelect() {
  return document.getElementById('ctl00_placeholder_2_widget_0_ddlDeliveryMan') ||
         document.getElementById('ctl00_placeholder_2_widget_0_cmbDeliveryMan') ||
         document.querySelector('select[id*="DeliveryMan"]') ||
         document.querySelector('select[name*="DeliveryMan"]') ||
         document.querySelector('select[id*="DelMan"]') ||
         document.querySelector('select[id*="ddlDel"]') ||
         document.querySelector('select');
}

function findAddRowButton() {
  return document.getElementById('ctl00_placeholder_2_widget_0_btnAddRow') ||
         document.getElementById('btnAddRow') ||
         document.querySelector('input[id*="btnAddRow"], button[id*="btnAddRow"]') ||
         document.querySelector('input[id*="btnAdd"], button[id*="btnAdd"]') ||
         document.querySelector('input[value="Add Row"], button[value="Add Row"]') ||
         Array.from(document.querySelectorAll('input, button, a')).find(el => (el.value || el.innerText || '').trim().toLowerCase().includes('add row'));
}

function findSubmitButton() {
  return document.getElementById('ctl00_placeholder_2_widget_0_btnSubmit') ||
         document.getElementById('btnSubmit') ||
         document.querySelector('input[id*="btnSubmit"], button[id*="btnSubmit"]') ||
         document.querySelector('input[value="Submit"], button[value="Submit"]') ||
         Array.from(document.querySelectorAll('input, button')).find(el => (el.value || el.innerText || '').trim().toLowerCase() === 'submit');
}

function findClearButton() {
  return document.getElementById('ctl00_placeholder_2_widget_0_btnClear') ||
         document.getElementById('btnClear') ||
         document.querySelector('input[id*="btnClear"], button[id*="btnClear"]') ||
         document.querySelector('input[value="Clear"], button[value="Clear"]') ||
         Array.from(document.querySelectorAll('input, button')).find(el => (el.value || el.innerText || '').trim().toLowerCase() === 'clear');
}

// ==========================================
// Floating Widget Injection
// ==========================================
function injectFloatingWidget() {
  if (document.getElementById('cdcms-floating-widget')) return;

  const widget = document.createElement('div');
  widget.id = 'cdcms-floating-widget';
  
  Object.assign(widget.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    width: '450px',
    height: '620px',
    backgroundColor: '#fff',
    border: '1px solid #1e293b',
    borderRadius: '12px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
    zIndex: '999999',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    transition: 'height 0.3s ease, width 0.3s ease, bottom 0.3s ease'
  });

  const header = document.createElement('div');
  Object.assign(header.style, {
    backgroundColor: '#0f172a',
    color: 'white',
    padding: '10px 15px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    userSelect: 'none',
    fontWeight: 'bold',
    fontSize: '14px',
    borderBottom: '1px solid #334155'
  });
  
  const title = document.createElement('span');
  title.innerText = '⚡ CDCMS Auto-Canceller Tool';
  
  const minBtn = document.createElement('button');
  minBtn.innerText = '▼ Minimize';
  Object.assign(minBtn.style, {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: '12px',
    outline: 'none',
    fontWeight: 'bold'
  });

  header.appendChild(title);
  header.appendChild(minBtn);
  widget.appendChild(header);

  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('popup.html');
  Object.assign(iframe.style, {
    width: '100%',
    flex: '1',
    border: 'none',
    backgroundColor: '#0f172a'
  });
  widget.appendChild(iframe);

  let isMinimized = sessionStorage.getItem('cdcms_widget_minimized') === 'true';
  
  const applyState = () => {
    if (isMinimized) {
      widget.style.height = '42px';
      widget.style.width = '280px';
      widget.style.bottom = '0px';
      widget.style.borderRadius = '12px 12px 0 0';
      minBtn.innerText = '▲ Open';
    } else {
      widget.style.height = '620px';
      widget.style.width = '450px';
      widget.style.bottom = '20px';
      widget.style.borderRadius = '12px';
      minBtn.innerText = '▼ Minimize';
    }
  };
  
  applyState();

  header.addEventListener('click', () => {
    isMinimized = !isMinimized;
    sessionStorage.setItem('cdcms_widget_minimized', isMinimized);
    applyState();
  });

  document.body.appendChild(widget);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFloatingWidget);
} else {
  injectFloatingWidget();
}

