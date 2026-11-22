(function (global) {
  'use strict';

  const QUICK_EMOJIS = ['💻', '📝', '🎮', '💬', '🎵', '📂', '⚡', '🔧', '🌐', '📧'];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function resizeImageToDataUrl(file, maxSize) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        reject(new Error('请选择有效的图片文件'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('无法解析该图片'));
        img.onload = () => {
          const size = maxSize || 64;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function createAvatarNode(item, protocol) {
    const avatar = el('div', 'ql-avatar');
    if (item.iconType === 'emoji' && item.iconValue) {
      avatar.classList.add('is-emoji');
      avatar.textContent = item.iconValue;
      return avatar;
    }
    if (item.iconType === 'image' && item.iconValue && protocol.validateImageUrl(item.iconValue)) {
      avatar.classList.add('is-image');
      const img = document.createElement('img');
      img.src = item.iconValue;
      img.alt = item.name;
      img.onerror = () => {
        avatar.classList.remove('is-image');
        avatar.textContent = '';
        const badge = protocol.getBadgeInfo(item.name, item.url);
        avatar.style.background = badge.gradient;
        avatar.textContent = badge.char;
      };
      avatar.appendChild(img);
      return avatar;
    }
    const badge = protocol.getBadgeInfo(item.name, item.url);
    avatar.style.background = badge.gradient;
    avatar.textContent = badge.char;
    return avatar;
  }

  function mountPanel(container, options) {
    const opts = options || {};
    const mode = opts.mode || 'dock'; // 'dock' | 'popup'
    const store = global.QLDock.store;
    const protocol = global.QLDock.protocol;

    let state = {
      items: [],
      settings: Object.assign({}, store.DEFAULT_SETTINGS),
      view: 'list', // 'list' | 'form' | 'settings'
      editingId: null,
      confirmDelete: false,
      search: '',
      pinned: false,
      filePicking: false,
      searchFocused: false,
      toast: ''
    };

    let toastTimer = null;

    const panel = el('div', 'ql-panel' + (mode === 'popup' ? ' is-popup' : ''));
    container.appendChild(panel);

    function notifyLock() {
      if (typeof opts.onLockChange === 'function') {
        const locked =
          state.pinned ||
          state.view !== 'list' ||
          state.filePicking ||
          state.searchFocused ||
          state.search.trim().length > 0;
        opts.onLockChange(locked);
      }
    }

    function notifySettings() {
      if (typeof opts.onSettingsChange === 'function') {
        opts.onSettingsChange(state.settings);
      }
    }

    function showToast(msg) {
      state.toast = msg;
      renderToastOnly();
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        state.toast = '';
        renderToastOnly();
      }, 2200);
    }

    let toastEl = null;
    function renderToastOnly() {
      if (!toastEl) return;
      if (state.toast) {
        toastEl.textContent = state.toast;
        toastEl.classList.remove('ql-hidden');
      } else {
        toastEl.textContent = '';
        toastEl.classList.add('ql-hidden');
      }
    }

    async function handleLaunch(item) {
      try {
        await store.openLink(item);
        showToast('正在打开 ' + item.name + '...');
        if (typeof opts.onLaunched === 'function') {
          opts.onLaunched(item);
        }
      } catch (err) {
        showToast('打开失败：' + (err && err.message ? err.message : '未知错误'));
      }
    }

    function renderHeader() {
      const header = el('div', 'ql-header');

      const brand = el('div', 'ql-brand');
      const dot = el('span', 'ql-brand-dot', '⚡');
      const titleText =
        state.view === 'form'
          ? state.editingId
            ? '编辑快捷方式'
            : '新增快捷方式'
          : state.view === 'settings'
          ? '面板设置'
          : 'QuickLaunch';
      brand.appendChild(dot);
      brand.appendChild(el('span', '', titleText));
      header.appendChild(brand);

      const actions = el('div', 'ql-header-actions');

      if (state.view !== 'list') {
        const backBtn = el('button', 'ql-icon-btn', '✕');
        backBtn.type = 'button';
        backBtn.title = '返回';
        backBtn.addEventListener('click', () => {
          state.view = 'list';
          state.editingId = null;
          state.confirmDelete = false;
          render();
        });
        actions.appendChild(backBtn);
      } else {
        const layoutBtn = el(
          'button',
          'ql-icon-btn',
          state.settings.layout === 'grid' ? '☰' : '⊞'
        );
        layoutBtn.type = 'button';
        layoutBtn.title = state.settings.layout === 'grid' ? '切换为列表视图' : '切换为网格视图';
        layoutBtn.addEventListener('click', async () => {
          const nextLayout = state.settings.layout === 'grid' ? 'list' : 'grid';
          state.settings = await store.saveSettings({ layout: nextLayout });
          render();
        });
        actions.appendChild(layoutBtn);

        if (mode === 'dock') {
          const pinBtn = el('button', 'ql-icon-btn' + (state.pinned ? ' is-active' : ''), '📌');
          pinBtn.type = 'button';
          pinBtn.title = state.pinned ? '取消固定面板' : '固定展开面板';
          pinBtn.addEventListener('click', () => {
            state.pinned = !state.pinned;
            render();
          });
          actions.appendChild(pinBtn);
        }

        const settingsBtn = el('button', 'ql-icon-btn', '⚙');
        settingsBtn.type = 'button';
        settingsBtn.title = '设置与备份';
        settingsBtn.addEventListener('click', () => {
          state.view = 'settings';
          render();
        });
        actions.appendChild(settingsBtn);

        const addBtn = el('button', 'ql-icon-btn is-primary', '+');
        addBtn.type = 'button';
        addBtn.title = '新增快捷方式';
        addBtn.addEventListener('click', () => {
          state.view = 'form';
          state.editingId = null;
          state.confirmDelete = false;
          render();
        });
        actions.appendChild(addBtn);
      }

      header.appendChild(actions);
      return header;
    }

    function renderListView() {
      const frag = document.createDocumentFragment();

      if (state.items.length > 0) {
        const searchBar = el('div', 'ql-search-bar');
        const input = el('input', 'ql-input');
        input.type = 'search';
        input.placeholder = '搜索名称或协议（如 vscode://）...';
        input.value = state.search;
        input.addEventListener('focus', () => {
          state.searchFocused = true;
          notifyLock();
        });
        input.addEventListener('blur', () => {
          state.searchFocused = false;
          notifyLock();
        });
        input.addEventListener('input', (e) => {
          state.search = e.target.value;
          notifyLock();
          renderItemsContainer(itemsHost);
        });
        searchBar.appendChild(input);
        frag.appendChild(searchBar);
      }

      const body = el('div', 'ql-body');
      const itemsHost = el('div');
      renderItemsContainer(itemsHost);
      body.appendChild(itemsHost);

      toastEl = el('div', 'ql-toast ql-hidden');
      body.appendChild(toastEl);
      renderToastOnly();

      frag.appendChild(body);
      return frag;
    }

    function renderItemsContainer(host) {
      host.textContent = '';

      if (state.items.length === 0) {
        const empty = el('div', 'ql-empty');
        empty.appendChild(el('div', 'ql-empty-title', '还没有快捷启动项'));
        empty.appendChild(
          el(
            'div',
            'ql-empty-desc',
            '添加本地软件的自定义协议（如 vscode://、obsidian://、steam://），随时一键直达。'
          )
        );
        const btns = el('div', 'ql-empty-actions');
        const addBtn = el('button', 'ql-btn is-primary', '+ 立即添加');
        addBtn.type = 'button';
        addBtn.addEventListener('click', () => {
          state.view = 'form';
          state.editingId = null;
          render();
        });
        const sampleBtn = el('button', 'ql-btn', '填入示例');
        sampleBtn.type = 'button';
        sampleBtn.addEventListener('click', async () => {
          state.items = await store.addSampleItems();
          showToast('已填入 3 个常用软件示例');
          render();
        });
        btns.appendChild(addBtn);
        btns.appendChild(sampleBtn);
        empty.appendChild(btns);
        host.appendChild(empty);
        return;
      }

      const kw = state.search.trim().toLowerCase();
      const filtered = kw
        ? state.items.filter(
            (x) => x.name.toLowerCase().includes(kw) || x.url.toLowerCase().includes(kw)
          )
        : state.items;

      if (filtered.length === 0) {
        const empty = el('div', 'ql-empty');
        empty.appendChild(el('div', 'ql-empty-desc', '没有匹配的快捷方式'));
        host.appendChild(empty);
        return;
      }

      if (state.settings.layout === 'list') {
        const list = el('div', 'ql-list');
        filtered.forEach((item) => {
          const row = el('div', 'ql-row');
          row.title = item.name + '\n' + item.url;
          row.addEventListener('click', () => handleLaunch(item));

          row.appendChild(createAvatarNode(item, protocol));

          const info = el('div', 'ql-row-info');
          info.appendChild(el('div', 'ql-row-name', item.name));
          info.appendChild(el('div', 'ql-row-url', item.url));
          row.appendChild(info);

          const editBtn = el('button', 'ql-row-edit', '✎');
          editBtn.type = 'button';
          editBtn.title = '编辑';
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.view = 'form';
            state.editingId = item.id;
            state.confirmDelete = false;
            render();
          });
          row.appendChild(editBtn);

          list.appendChild(row);
        });
        host.appendChild(list);
      } else {
        const grid = el('div', 'ql-grid');
        filtered.forEach((item) => {
          const card = el('div', 'ql-card');
          card.title = item.name + '\n' + item.url;
          card.addEventListener('click', () => handleLaunch(item));

          card.appendChild(createAvatarNode(item, protocol));
          card.appendChild(el('div', 'ql-card-name', item.name));

          const editBtn = el('button', 'ql-card-edit', '✎');
          editBtn.type = 'button';
          editBtn.title = '编辑';
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            state.view = 'form';
            state.editingId = item.id;
            state.confirmDelete = false;
            render();
          });
          card.appendChild(editBtn);

          grid.appendChild(card);
        });
        host.appendChild(grid);
      }
    }

    function renderFormView() {
      const existing = state.editingId
        ? state.items.find((x) => x.id === state.editingId)
        : null;

      let formState = {
        name: existing ? existing.name : '',
        url: existing ? existing.url : '',
        iconType: existing ? existing.iconType : 'auto',
        iconValue: existing ? existing.iconValue : ''
      };

      const body = el('div', 'ql-body');
      const form = el('form', 'ql-form');

      // 名称
      const nameField = el('div', 'ql-field');
      nameField.appendChild(el('label', 'ql-label', '名称'));
      const nameInput = el('input', 'ql-input');
      nameInput.type = 'text';
      nameInput.maxLength = 40;
      nameInput.placeholder = '例如：Obsidian 笔记 / VS Code';
      nameInput.value = formState.name;
      nameInput.required = true;
      nameInput.addEventListener('input', (e) => {
        formState.name = e.target.value;
      });
      nameField.appendChild(nameInput);
      form.appendChild(nameField);

      // URL / 自定义协议
      const urlField = el('div', 'ql-field');
      const urlLabel = el('label', 'ql-label');
      urlLabel.appendChild(el('span', '', '自定义协议或链接'));
      const schemeTag = el('span', 'ql-badge-tag ql-hidden');
      urlLabel.appendChild(schemeTag);
      urlField.appendChild(urlLabel);

      const urlInput = el('input', 'ql-input');
      urlInput.type = 'text';
      urlInput.placeholder = '例如：obsidian://open?vault=Notes 或 vscode://';
      urlInput.value = formState.url;
      urlInput.required = true;
      urlField.appendChild(urlInput);

      const errorText = el('div', 'ql-error-text ql-hidden');
      urlField.appendChild(errorText);

      function updateUrlBadge() {
        const v = urlInput.value.trim();
        if (!v) {
          schemeTag.classList.add('ql-hidden');
          errorText.classList.add('ql-hidden');
          return;
        }
        const check = protocol.validateUrl(v);
        if (check.valid) {
          schemeTag.classList.remove('ql-hidden', 'is-error');
          schemeTag.textContent = check.kind === 'custom' ? `自定义协议 ${check.scheme}://` : '网页链接';
          errorText.classList.add('ql-hidden');
        } else {
          schemeTag.classList.remove('ql-hidden');
          schemeTag.classList.add('is-error');
          schemeTag.textContent = '格式有误';
          errorText.textContent = check.reason;
          errorText.classList.remove('ql-hidden');
        }
      }

      urlInput.addEventListener('input', (e) => {
        formState.url = e.target.value;
        updateUrlBadge();
      });
      updateUrlBadge();
      form.appendChild(urlField);

      // 图标类型
      const iconField = el('div', 'ql-field');
      iconField.appendChild(el('label', 'ql-label', '图标样式'));
      const seg = el('div', 'ql-seg');
      const iconDetailBox = el('div');

      const types = [
        { key: 'auto', label: '首字徽章' },
        { key: 'emoji', label: 'Emoji' },
        { key: 'image', label: '图片图标' }
      ];

      function renderIconDetail() {
        iconDetailBox.textContent = '';
        if (formState.iconType === 'emoji') {
          const emojiInput = el('input', 'ql-input');
          emojiInput.type = 'text';
          emojiInput.placeholder = '输入任意 Emoji，如 📝';
          emojiInput.value = formState.iconValue;
          emojiInput.addEventListener('input', (e) => {
            formState.iconValue = e.target.value;
          });
          iconDetailBox.appendChild(emojiInput);

          const chips = el('div', 'ql-emoji-chips');
          QUICK_EMOJIS.forEach((em) => {
            const chip = el('button', 'ql-chip', em);
            chip.type = 'button';
            chip.addEventListener('click', () => {
              formState.iconValue = em;
              emojiInput.value = em;
            });
            chips.appendChild(chip);
          });
          iconDetailBox.appendChild(chips);
        } else if (formState.iconType === 'image') {
          const row = el('div', 'ql-upload-row');
          const imgInput = el('input', 'ql-input');
          imgInput.type = 'text';
          imgInput.placeholder = '粘贴图片 URL 或右侧上传本地图';
          imgInput.value = formState.iconValue;
          imgInput.addEventListener('input', (e) => {
            formState.iconValue = e.target.value;
          });

          const fileInput = document.createElement('input');
          fileInput.type = 'file';
          fileInput.accept = 'image/*';
          fileInput.className = 'ql-hidden';
          fileInput.addEventListener('change', async (e) => {
            state.filePicking = false;
            notifyLock();
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            try {
              const dataUrl = await resizeImageToDataUrl(file, 64);
              formState.iconValue = dataUrl;
              imgInput.value = dataUrl;
              showToast('图标已压缩并载入');
            } catch (err) {
              showToast(err.message || '图片处理失败');
            }
          });

          const uploadBtn = el('button', 'ql-btn is-sm', '上传图');
          uploadBtn.type = 'button';
          uploadBtn.addEventListener('click', () => {
            state.filePicking = true;
            notifyLock();
            fileInput.click();
          });

          row.appendChild(imgInput);
          row.appendChild(uploadBtn);
          row.appendChild(fileInput);
          iconDetailBox.appendChild(row);
        }
      }

      types.forEach((t) => {
        const btn = el('button', 'ql-seg-btn' + (formState.iconType === t.key ? ' is-active' : ''), t.label);
        btn.type = 'button';
        btn.addEventListener('click', () => {
          formState.iconType = t.key;
          if (t.key === 'auto') formState.iconValue = '';
          Array.from(seg.children).forEach((c, idx) => {
            c.classList.toggle('is-active', types[idx].key === t.key);
          });
          renderIconDetail();
        });
        seg.appendChild(btn);
      });

      iconField.appendChild(seg);
      iconField.appendChild(iconDetailBox);
      renderIconDetail();
      form.appendChild(iconField);

      // 底部操作按钮
      const footer = el('div', 'ql-form-footer');
      const leftGroup = el('div', 'ql-form-footer-group');
      const rightGroup = el('div', 'ql-form-footer-group');

      if (existing) {
        const upBtn = el('button', 'ql-btn is-sm', '↑');
        upBtn.type = 'button';
        upBtn.title = '前移一位';
        upBtn.addEventListener('click', async () => {
          state.items = await store.moveItem(existing.id, -1);
          showToast('已前移');
        });

        const downBtn = el('button', 'ql-btn is-sm', '↓');
        downBtn.type = 'button';
        downBtn.title = '后移一位';
        downBtn.addEventListener('click', async () => {
          state.items = await store.moveItem(existing.id, 1);
          showToast('已后移');
        });

        const delBtn = el('button', 'ql-btn is-sm is-danger', state.confirmDelete ? '确认删除' : '删除');
        delBtn.type = 'button';
        delBtn.addEventListener('click', async () => {
          if (!state.confirmDelete) {
            state.confirmDelete = true;
            delBtn.textContent = '确认删除';
            return;
          }
          state.items = await store.removeItem(existing.id);
          state.view = 'list';
          state.editingId = null;
          state.confirmDelete = false;
          showToast('已删除');
          render();
        });

        leftGroup.appendChild(upBtn);
        leftGroup.appendChild(downBtn);
        leftGroup.appendChild(delBtn);
      }

      const cancelBtn = el('button', 'ql-btn', '取消');
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', () => {
        state.view = 'list';
        state.editingId = null;
        state.confirmDelete = false;
        render();
      });

      const saveBtn = el('button', 'ql-btn is-primary', '保存');
      saveBtn.type = 'submit';

      rightGroup.appendChild(cancelBtn);
      rightGroup.appendChild(saveBtn);

      footer.appendChild(leftGroup);
      footer.appendChild(rightGroup);
      form.appendChild(footer);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = formState.name.trim();
        const urlCheck = protocol.validateUrl(formState.url);
        if (!name) {
          errorText.textContent = '请填写名称';
          errorText.classList.remove('ql-hidden');
          return;
        }
        if (!urlCheck.valid) {
          errorText.textContent = urlCheck.reason;
          errorText.classList.remove('ql-hidden');
          return;
        }
        if (formState.iconType === 'image' && formState.iconValue.trim() && !protocol.validateImageUrl(formState.iconValue)) {
          errorText.textContent = '图片地址无效，请填 http(s) 图片链接或上传本地图片';
          errorText.classList.remove('ql-hidden');
          return;
        }

        try {
          const payload = {
            name,
            url: urlCheck.url,
            iconType: formState.iconType,
            iconValue: formState.iconValue.trim()
          };
          if (existing) {
            const res = await store.updateItem(existing.id, payload);
            state.items = res.items;
            showToast('已更新 ' + name);
          } else {
            const res = await store.addItem(payload);
            state.items = res.items;
            showToast('已添加 ' + name);
          }
          state.view = 'list';
          state.editingId = null;
          state.confirmDelete = false;
          render();
        } catch (err) {
          errorText.textContent = err.message || '保存失败';
          errorText.classList.remove('ql-hidden');
        }
      });

      body.appendChild(form);
      toastEl = el('div', 'ql-toast ql-hidden');
      body.appendChild(toastEl);
      renderToastOnly();

      setTimeout(() => nameInput.focus(), 20);
      return body;
    }

    function renderSettingsView() {
      const body = el('div', 'ql-body');
      const wrap = el('div', 'ql-form');

      function addSegField(labelText, optionsList, currentValue, onSelect, isTwo) {
        const field = el('div', 'ql-field');
        field.appendChild(el('label', 'ql-label', labelText));
        const seg = el('div', 'ql-seg' + (isTwo ? ' is-two' : ''));
        optionsList.forEach((opt) => {
          const btn = el('button', 'ql-seg-btn' + (currentValue === opt.value ? ' is-active' : ''), opt.label);
          btn.type = 'button';
          btn.addEventListener('click', async () => {
            await onSelect(opt.value);
          });
          seg.appendChild(btn);
        });
        field.appendChild(seg);
        wrap.appendChild(field);
      }

      addSegField(
        '边缘停靠位置（也可直接上下拖动拉手）',
        [
          { value: 'right', label: '靠右边缘' },
          { value: 'left', label: '靠左边缘' }
        ],
        state.settings.side,
        async (val) => {
          state.settings = await store.saveSettings({ side: val });
          notifySettings();
          render();
        },
        true
      );

      addSegField(
        '边缘栏呼出方式',
        [
          { value: true, label: '悬停自动滑出' },
          { value: false, label: '仅点击展开' }
        ],
        state.settings.hoverOpen,
        async (val) => {
          state.settings = await store.saveSettings({ hoverOpen: val });
          notifySettings();
          render();
        },
        true
      );

      addSegField(
        '主题外观',
        [
          { value: 'auto', label: '跟随系统' },
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' }
        ],
        state.settings.theme,
        async (val) => {
          state.settings = await store.saveSettings({ theme: val });
          notifySettings();
          render();
        },
        false
      );

      wrap.appendChild(el('div', 'ql-divider'));

      // 备份与恢复
      const backupField = el('div', 'ql-field');
      backupField.appendChild(el('label', 'ql-label', '数据迁移与备份（Chrome / Edge / Firefox 互通）'));
      const btnRow = el('div', 'ql-form-footer-group');

      const exportBtn = el('button', 'ql-btn is-sm', '导出 JSON');
      exportBtn.type = 'button';
      exportBtn.addEventListener('click', () => {
        const payload = store.buildExportPayload(state.items, state.settings);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'quicklaunch-dock-backup.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('已导出备份文件');
      });

      const importInput = document.createElement('input');
      importInput.type = 'file';
      importInput.accept = '.json,application/json';
      importInput.className = 'ql-hidden';
      importInput.addEventListener('change', async (e) => {
        state.filePicking = false;
        notifyLock();
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const loaded = await store.importFromJson(text);
          state.items = loaded.items;
          state.settings = loaded.settings;
          notifySettings();
          showToast(`已成功导入 ${loaded.items.length} 项配置`);
          render();
        } catch (err) {
          showToast('导入失败：' + (err.message || '格式错误'));
        }
      });

      const importBtn = el('button', 'ql-btn is-sm', '导入 JSON');
      importBtn.type = 'button';
      importBtn.addEventListener('click', () => {
        state.filePicking = true;
        notifyLock();
        importInput.click();
      });

      const sampleBtn = el('button', 'ql-btn is-sm', '添加示例');
      sampleBtn.type = 'button';
      sampleBtn.addEventListener('click', async () => {
        state.items = await store.addSampleItems();
        showToast('已添加常用软件示例');
      });

      btnRow.appendChild(exportBtn);
      btnRow.appendChild(importBtn);
      btnRow.appendChild(sampleBtn);
      btnRow.appendChild(importInput);
      backupField.appendChild(btnRow);
      wrap.appendChild(backupField);

      const tip = el(
        'div',
        'ql-tip-box',
        '提示：首次打开某个自定义协议（如 vscode://）时，勾选浏览器提示框中的“始终允许”，以后全网点击均免确认。空白页或系统页可点右上角图标或按 Alt+Q 呼出。'
      );
      wrap.appendChild(tip);

      body.appendChild(wrap);
      toastEl = el('div', 'ql-toast ql-hidden');
      body.appendChild(toastEl);
      renderToastOnly();
      return body;
    }

    function render() {
      panel.textContent = '';
      panel.appendChild(renderHeader());
      if (state.view === 'form') {
        panel.appendChild(renderFormView());
      } else if (state.view === 'settings') {
        panel.appendChild(renderSettingsView());
      } else {
        panel.appendChild(renderListView());
      }
      notifyLock();
    }

    async function init() {
      const data = await store.loadAll();
      state.items = data.items;
      state.settings = data.settings;
      notifySettings();
      render();
    }

    const unsubscribe = store.onChange((data) => {
      state.items = data.items;
      state.settings = data.settings;
      notifySettings();
      if (state.view === 'list') {
        render();
      }
    });

    init();

    return {
      destroy() {
        unsubscribe();
        panel.remove();
      },
      getSettings() {
        return state.settings;
      }
    };
  }

  global.QLDock = global.QLDock || {};
  global.QLDock.mountPanel = mountPanel;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mountPanel };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
