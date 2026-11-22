(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const rawUrl = params.get('url') || '';
  const rawName = params.get('name') || '';

  const titleEl = document.getElementById('title');
  const urlBoxEl = document.getElementById('urlBox');
  const statusEl = document.getElementById('status');
  const retryBtn = document.getElementById('retryBtn');
  const closeBtn = document.getElementById('closeBtn');

  closeBtn.addEventListener('click', () => window.close());

  const protocol = window.QLDock && window.QLDock.protocol;
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

  let hasBlurred = false;
  let autoCloseTimer = null;

  function triggerLaunch() {
    window.location.href = targetUrl;
  }

  retryBtn.addEventListener('click', triggerLaunch);

  // 如果外部应用被拉起或页面失焦，切回前台/短暂停留后自动关闭中转页，避免残留空白标签
  window.addEventListener('blur', () => {
    hasBlurred = true;
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(() => {
      // 若此时页面已被隐藏（用户切去目标软件），安全关闭该中转页
      if (document.hidden) {
        window.close();
      }
    }, 1500);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && hasBlurred) {
      setTimeout(() => window.close(), 800);
    }
  });

  window.addEventListener('focus', () => {
    if (hasBlurred) {
      setTimeout(() => window.close(), 400);
    }
  });

  // 延迟极短时间触发，确保页面已完成首帧渲染且浏览器可正常挂接确认框
  setTimeout(triggerLaunch, 60);
})();
