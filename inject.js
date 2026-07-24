// Alert and Confirm Interceptor (Injected in Page Context)
(function() {
  function getBridge() {
    let el = document.getElementById('cdcms_alert_bridge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cdcms_alert_bridge';
      el.style.display = 'none';
      document.documentElement.appendChild(el);
    }
    return el;
  }
  
  window.alert = function(msg) {
    console.log('[Auto-Canceller] Intercepted alert:', msg);
    const bridge = getBridge();
    bridge.setAttribute('data-alert', msg);
    bridge.innerText = msg;
    bridge.dispatchEvent(new CustomEvent('cdcms_alert', { bubbles: true, detail: msg }));
    return true; // Auto-accept alerts
  };

  window.confirm = function(msg) {
    console.log('[Auto-Canceller] Intercepted confirm:', msg);
    const bridge = getBridge();
    bridge.setAttribute('data-confirm', msg);
    return true; // Auto-confirm (OK)
  };
})();
