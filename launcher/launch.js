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

  let hasHidden = false;
  let autoCloseTimer = null;

  function triggerLaunch() {
    window.location.href = targetUrl;
  }

  retryBtn.addEventListener('click', triggerLaunch);

  // 仅当页面确实进入后台不可见状态（用户已切到目标软件窗口）才自动关闭，
  // 避免首次弹出确认框点击“取消”时页面瞬间自毁而无法点击“重新拉起”。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hasHidden = true;
      if (autoCloseTimer) clearTimeout(autoCloseTimer);
      autoCloseTimer = setTimeout(() => {
        if (document.hidden && hasHidden) {
          window.close();
        }
      }, 900);
    } else if (autoCloseTimer) {
      clearTimeout(autoCloseTimer);
      autoCloseTimer = null;
    }
  });

  // 延迟极短时间触发，确保页面已完成首帧渲染且浏览器可正常挂接确认框
  setTimeout(triggerLaunch, 60);
})();
