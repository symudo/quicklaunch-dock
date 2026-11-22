(function () {
  'use strict';

  const app = document.getElementById('app');
  if (!app || !window.QLDock) return;

  const styleEl = document.createElement('style');
  styleEl.textContent = window.QLDock.PANEL_CSS;
  document.head.appendChild(styleEl);

  window.QLDock.mountPanel(app, {
    mode: 'popup',
    onSettingsChange(settings) {
      app.setAttribute('data-theme', (settings && settings.theme) || 'auto');
    }
  });
})();
