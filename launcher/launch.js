(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const rawUrl = params.get('url') || '';
  const rawName = params.get('name') || '';
  const isKnown = params.get('known') === '1';
  const openerParam = params.get('openerTabId');
  const openerTabId = openerParam !== null && /^\d+$/.test(openerParam) ? Number(openerParam) : undefined;

  const titleEl = document.getElementById('title');
  const urlBoxEl = document.getElementById('urlBox');
  const statusEl = document.getElementById('status');
  const retryBtn = document.getElementById('retryBtn');
  const markKnownBtn = document.getElementById('markKnownBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const closeBtn = document.getElementById('closeBtn');

  function closeAndReturn() {
    let closed = false;
    const fallbackClose = () => {
      if (closed) return;
      closed = true;
      window.close();
    };
    if (window.chrome && window.chrome.runtime && window.chrome.runtime.sendMessage) {
      const timer = setTimeout(fallbackClose, 300);
      try {
        window.chrome.runtime.sendMessage(
          { type: 'QLDOCK_CLOSE_LAUNCHER', openerTabId },
          () => {
            clearTimeout(timer);
            void window.chrome.runtime.lastError;
            fallbackClose();
          }
        );
        return;
      } catch (_) {
        clearTimeout(timer);
      }
    }
    fallbackClose();
  }

  closeBtn.addEventListener('click', closeAndReturn);

  const protocol = window.QLDock && window.QLDock.protocol;
  const store = window.QLDock && window.QLDock.store;
  const check = protocol ? protocol.validateUrl(rawUrl) : { valid: false, reason: '校验模块未加载' };

  if (!check.valid || check.kind !== 'custom') {
    titleEl.textContent = '无法打开该链接';
    urlBoxEl.textContent = rawUrl || '（空链接）';
    statusEl.textContent = check.valid ? '仅支持自定义协议中转' : check.reason;
    statusEl.classList.add('is-error');
    retryBtn.style.display = 'none';
    return;
  }

  const targetUrl = check.url;
  titleEl.textContent = rawName ? `正在打开 ${rawName}` : `正在调用 ${check.scheme}://`;
  urlBoxEl.textContent = targetUrl;

  let autoCloseTimer = null;
  let paused = false;

  function clearAutoClose() {
    if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
  }

  function triggerLaunch() {
    window.location.href = targetUrl;
  }

  function markSchemeAuthorized() {
    if (store && typeof store.markSchemeKnown === 'function') {
      return store.markSchemeKnown(check.scheme).catch(() => {});
    }
    return Promise.resolve();
  }

  retryBtn.addEventListener('click', () => {
    clearAutoClose();
    triggerLaunch();
  });

  if (isKnown) {
    // 已授权过的协议：拉起后自动关闭并切回原网页，回来不再残留中转页
    statusEl.textContent = '已拉起目标应用，即将自动关闭并返回原网页...';
    pauseBtn.style.display = '';
    pauseBtn.addEventListener('click', () => {
      paused = true;
      clearAutoClose();
      pauseBtn.style.display = 'none';
      statusEl.textContent = '已暂停自动关闭。如果浏览器弹出了确认框，请勾选“始终允许”。';
    });

    autoCloseTimer = setTimeout(() => {
      if (!paused) {
        closeAndReturn();
      }
    }, 950);
  } else {
    // 首次使用此协议：留足时间勾选“始终允许”，并在用户切去外部软件后自动记住并关闭
    statusEl.textContent =
      '首次打开此协议：请在浏览器提示框中勾选“始终允许”并点击打开；以后将自动关闭并返回原网页。';
    markKnownBtn.style.display = '';
    markKnownBtn.addEventListener('click', async () => {
      clearAutoClose();
      await markSchemeAuthorized();
      closeAndReturn();
    });

    const scheduleFirstTimeClose = (delayMs) => {
      if (paused) return;
      clearAutoClose();
      autoCloseTimer = setTimeout(async () => {
        if (!paused) {
          await markSchemeAuthorized();
          closeAndReturn();
        }
      }, delayMs);
    };

    // 仅当页面确实进入后台不可见状态（如切走标签页或最小化浏览器）才自动记住并关闭，
    // 绝不在单纯 window.blur 后强制倒计时关闭，防止用户阅读系统确认框超过几秒时误关确认框或误标已授权。
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        scheduleFirstTimeClose(1000);
      } else {
        clearAutoClose();
      }
    });
  }

  // 延迟极短时间触发，确保页面已完成首帧渲染且浏览器可正常挂接确认框
  setTimeout(triggerLaunch, 60);
})();
