(function () {
  'use strict';

  const app = document.getElementById('app');
  if (!app || !window.QLDock) return;

  const params = new URLSearchParams(window.location.search);
  const isTabMode = params.get('tab') === '1';
  const initialView = params.get('view') || 'list';

  if (isTabMode) {
    document.body.classList.add('is-tab-page');
    document.body.setAttribute('data-theme', 'auto');
  }

  const styleEl = document.createElement('style');
  styleEl.textContent = window.QLDock.PANEL_CSS;
  document.head.appendChild(styleEl);

  window.QLDock.mountPanel(app, {
    mode: isTabMode ? 'tab' : 'popup',
    initialView,
    onSettingsChange(settings) {
      const theme = (settings && settings.theme) || 'auto';
      app.setAttribute('data-theme', theme);
      if (isTabMode) {
        document.body.setAttribute('data-theme', theme);
      }
    }
  });
})();
