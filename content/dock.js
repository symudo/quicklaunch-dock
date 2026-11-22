(function (global) {
  'use strict';

  // 仅在顶层网页挂载，避免在广告/内嵌 iframe 内重复出现
  if (global.top !== global.self) return;
  if (document.getElementById('qldock-extension-host')) return;

  const store = global.QLDock && global.QLDock.store;
  const mountPanel = global.QLDock && global.QLDock.mountPanel;
  const PANEL_CSS = global.QLDock && global.QLDock.PANEL_CSS;
  if (!store || !mountPanel || !PANEL_CSS) return;

  const host = document.createElement('qldock-root');
  host.id = 'qldock-extension-host';
  host.setAttribute('data-theme', 'auto');
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';

  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = PANEL_CSS;
  shadow.appendChild(styleEl);

  const wrap = document.createElement('div');
  wrap.className = 'ql-dock-wrap';

  const handleHit = document.createElement('div');
  handleHit.className = 'ql-handle-hit';
  handleHit.title = 'QuickLaunch Dock（悬停展开，上下拖动可调节位置）';

  const handleBar = document.createElement('div');
  handleBar.className = 'ql-handle-bar';
  handleHit.appendChild(handleBar);

  const drawer = document.createElement('div');
  drawer.className = 'ql-dock-drawer';

  wrap.appendChild(handleHit);
  wrap.appendChild(drawer);
  shadow.appendChild(wrap);

  let isOpen = false;
  let isLocked = false;
  let hoverOpenEnabled = true;
  let currentTopPercent = 42;
  let isHostHidden = false;
  let isFullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  let openTimer = null;
  let closeTimer = null;
  let isDragging = false;
  let dragStartY = 0;
  let dragStartPercent = 42;
  let didDragMove = false;
  const currentHostname = (window.location && window.location.hostname) || '';

  function updateVisibility() {
    const shouldHide = isHostHidden || isFullscreen;
    if (shouldHide) {
      clearTimers();
      isOpen = false;
      wrap.classList.remove('is-open');
      host.style.display = 'none';
    } else {
      host.style.display = '';
    }
  }

  function clearTimers() {
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = null;
    }
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function positionDrawer() {
    const vh = window.innerHeight || 800;
    const anchorY = (currentTopPercent / 100) * vh;
    const estHeight = Math.min(520, Math.round(vh * 0.82), Math.max(drawer.offsetHeight || 0, 260));
    if (currentTopPercent <= 55) {
      const maxTop = Math.max(12, vh - estHeight - 12);
      const topPx = Math.max(12, Math.min(maxTop, Math.round(anchorY - 48)));
      drawer.style.top = topPx + 'px';
      drawer.style.bottom = 'auto';
    } else {
      const maxBottom = Math.max(12, vh - estHeight - 12);
      const bottomPx = Math.max(12, Math.min(maxBottom, Math.round(vh - anchorY - 48)));
      drawer.style.bottom = bottomPx + 'px';
      drawer.style.top = 'auto';
    }
  }

  function applySettings(settings) {
    if (!settings) return;
    hoverOpenEnabled = settings.hoverOpen !== false;
    currentTopPercent = Number.isFinite(settings.topPercent) ? settings.topPercent : 42;
    isHostHidden = store.isHostHidden(settings, currentHostname);
    host.setAttribute('data-theme', settings.theme || 'auto');
    wrap.classList.toggle('is-left', settings.side === 'left');
    handleHit.style.top = currentTopPercent + '%';
    updateVisibility();
    positionDrawer();
  }

  function setOpen(nextOpen) {
    isOpen = nextOpen;
    if (isOpen) {
      positionDrawer();
    }
    wrap.classList.toggle('is-open', isOpen);
  }

  function scheduleOpen() {
    if (isDragging) return;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (isOpen) return;
    openTimer = setTimeout(() => {
      setOpen(true);
    }, 100);
  }

  function scheduleClose() {
    if (isLocked || isDragging) return;
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = null;
    }
    closeTimer = setTimeout(() => {
      if (!isLocked && !isDragging) {
        setOpen(false);
      }
    }, 320);
  }

  handleHit.addEventListener('mouseenter', () => {
    if (hoverOpenEnabled) {
      scheduleOpen();
    }
  });

  handleHit.addEventListener('mouseleave', () => {
    scheduleClose();
  });

  drawer.addEventListener('mouseenter', () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  });

  drawer.addEventListener('mouseleave', () => {
    scheduleClose();
  });

  handleHit.addEventListener('click', () => {
    if (didDragMove) {
      didDragMove = false;
      return;
    }
    clearTimers();
    setOpen(!isOpen);
  });

  // 上下拖拽拉手调节停靠高度
  handleHit.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    didDragMove = false;
    dragStartY = e.clientY;
    dragStartPercent = currentTopPercent;
    clearTimers();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dy) > 4) {
      didDragMove = true;
    }
    if (!didDragMove) return;
    const vh = window.innerHeight || 800;
    const deltaPercent = (dy / vh) * 100;
    currentTopPercent = Math.max(8, Math.min(88, Math.round(dragStartPercent + deltaPercent)));
    handleHit.style.top = currentTopPercent + '%';
    positionDrawer();
  });

  function finishDrag() {
    if (!isDragging) return;
    isDragging = false;
    if (didDragMove) {
      store.saveSettings({ topPercent: currentTopPercent }).catch(() => {});
      setTimeout(() => {
        didDragMove = false;
      }, 60);
    }
  }

  window.addEventListener('mouseup', finishDrag);
  window.addEventListener('blur', finishDrag);

  function onFullscreenChange() {
    isFullscreen = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    updateVisibility();
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  let panelApi = null;

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen) return;
    if (panelApi && typeof panelApi.handleEscape === 'function' && panelApi.handleEscape()) {
      e.stopPropagation();
      return;
    }
    if (!isLocked) {
      clearTimers();
      setOpen(false);
    }
  });

  // 点击网页空白处时若非锁定状态则收起
  document.addEventListener('mousedown', (e) => {
    if (!isOpen || isLocked) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (!path.includes(host)) {
      clearTimers();
      setOpen(false);
    }
  });

  window.addEventListener('resize', positionDrawer);

  panelApi = mountPanel(drawer, {
    mode: 'dock',
    currentHostname,
    onLockChange(locked) {
      isLocked = locked;
      if (locked && closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    },
    onSettingsChange(settings) {
      applySettings(settings);
    },
    onLaunched() {
      if (!isLocked) {
        setTimeout(() => setOpen(false), 450);
      }
    }
  });

  updateVisibility();
  (document.documentElement || document.body).appendChild(host);
})(typeof globalThis !== 'undefined' ? globalThis : window);
