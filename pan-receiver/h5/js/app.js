const API_BASE = 'https://pan-receiver-api.onrender.com';

// ========== API ==========
function api(url, opts = {}) {
  const token = localStorage.getItem('token') || '';
  return fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
      ...opts.headers,
    },
    ...opts,
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  });
}

function apiUpload(url, formData) {
  const token = localStorage.getItem('token') || '';
  return fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Authorization': token ? `Bearer ${token}` : '' },
    body: formData,
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  });
}

// ========== Toast / Modal ==========
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

function modal({ title, body, bodyHtml, confirmText = '确定', onConfirm, showCancel = true }) {
  const overlay = document.getElementById('modal');
  document.getElementById('modal-title').textContent = title;
  const bodyEl = document.getElementById('modal-body');
  if (bodyHtml) {
    bodyEl.innerHTML = bodyHtml;
  } else {
    bodyEl.textContent = body || '';
  }
  const btnConfirm = document.getElementById('modal-confirm');
  const btnCancel = document.getElementById('modal-cancel');
  btnConfirm.textContent = confirmText;
  btnCancel.style.display = showCancel ? 'block' : 'none';

  overlay.classList.add('show');

  const close = () => {
    overlay.classList.remove('show');
    btnConfirm.onclick = null;
    btnCancel.onclick = null;
  };

  btnConfirm.onclick = () => { close(); if (onConfirm) onConfirm(); };
  btnCancel.onclick = close;
}

// ========== Auth ==========
function isLoggedIn() {
  return !!localStorage.getItem('token');
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('userId');
  localStorage.removeItem('baiduBound');
  location.hash = '#/login';
}

// ========== Router ==========
const routes = {
  '': 'page-login',
  '#/login': 'page-login',
  '#/home': 'page-home',
  '#/create': 'page-create',
  '#/task': 'page-task',
  '#/submit': 'page-submit',
};

function route() {
  const hash = location.hash;
  const pageId = routes[hash] || 'page-login';

  // 需要登录的页面
  const authPages = ['#/home', '#/create', '#/task'];
  if (authPages.includes(hash) && !isLoggedIn()) {
    location.hash = '#/login';
    return;
  }

  // 提交页不需要登录（公开任务）
  if (hash === '#/submit') {
    showPage('page-submit');
    renderSubmit();
    return;
  }

  showPage(pageId);

  if (pageId === 'page-home') renderHome();
  if (pageId === 'page-create') renderCreate();
  if (pageId === 'page-task') renderTask();
}

function showPage(id) {
  document.querySelectorAll('.page').forEach((p) => p.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ========== Page: Login ==========
function renderLogin() {
  const btn = document.getElementById('btn-login');
  const btnReg = document.getElementById('btn-register');

  btn.onclick = async () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) { toast('请输入用户名和密码'); return; }

    try {
      btn.disabled = true;
      btn.textContent = '登录中...';
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      localStorage.setItem('token', data.token);
      localStorage.setItem('userId', data.userId);
      localStorage.setItem('baiduBound', data.baiduBound);
      toast('登录成功');
      setTimeout(() => (location.hash = '#/home'), 500);
    } catch (e) {
      toast(e.message || '登录失败');
    } finally {
      btn.disabled = false;
      btn.textContent = '登录';
    }
  };

  btnReg.onclick = async () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) { toast('请输入用户名和密码'); return; }
    if (password.length < 6) { toast('密码至少6位'); return; }

    try {
      btnReg.disabled = true;
      btnReg.textContent = '注册中...';
      await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      toast('注册成功，请登录');
    } catch (e) {
      toast(e.message || '注册失败');
    } finally {
      btnReg.disabled = false;
      btnReg.textContent = '注册';
    }
  };
}

// ========== Page: Home ==========
async function renderHome() {
  const listEl = document.getElementById('task-list');
  const userEl = document.getElementById('user-info');
  listEl.innerHTML = '<div class="empty-state"><p>加载中...</p></div>';

  // 加载用户信息
  let user = null;
  try {
    user = await api('/api/auth/me');
    localStorage.setItem('baiduBound', user.baiduBound);
    if (user.baiduBound) {
      userEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:600;">${escapeHtml(user.baiduNickname || user.userId.slice(0, 8))}</div>
            <div style="font-size:12px;color:#07c160;">已绑定百度网盘</div>
          </div>
          <button class="btn btn-default btn-small" onclick="unbindBaidu()">解绑</button>
        </div>
      `;
    } else {
      userEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="color:#999;font-size:14px;">未绑定百度网盘，文件无法自动转存</div>
          <button class="btn btn-primary btn-small" onclick="bindBaidu()">绑定百度网盘</button>
        </div>
      `;
    }
  } catch (e) {
    userEl.innerHTML = '';
  }

  try {
    const tasks = await api('/api/tasks');
    if (!tasks || tasks.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><p>暂无任务，点击下方按钮创建</p></div>';
      return;
    }
    listEl.innerHTML = tasks.map((t) => `
      <div class="task-item" onclick="location.hash='#/task?taskId=${t.taskId}'">
        <div class="task-item-title">${escapeHtml(t.title)}</div>
        <div class="task-item-meta">
          <span class="task-status ${t.status}">${t.status === 'active' ? '进行中' : '已关闭'}</span>
          <span>提交 ${t.submissionCount}</span>
          <span>文件 ${t.fileCount}</span>
        </div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = '<div class="empty-state"><p>加载失败，请刷新重试</p></div>';
  }
}

async function bindBaidu() {
  try {
    const res = await api('/api/auth/baidu/auth-url?role=owner&redirect=/');
    location.href = res.authUrl;
  } catch (e) {
    toast('获取授权链接失败');
  }
}

async function unbindBaidu() {
  if (!confirm('确定解绑百度网盘？')) return;
  try {
    await api('/api/auth/baidu/unbind', { method: 'POST' });
    toast('已解绑');
    renderHome();
  } catch (e) {
    toast('解绑失败');
  }
}

// ========== Page: Create ==========
function renderCreate() {
  const btn = document.getElementById('btn-create');
  const pathInput = document.getElementById('create-path');

  // 点击路径输入框打开网盘文件夹选择器
  pathInput.onclick = () => openFolderPicker((selectedPath) => {
    pathInput.value = selectedPath;
  });

  btn.onclick = async () => {
    const title = document.getElementById('create-title').value.trim();
    const description = document.getElementById('create-desc').value.trim();
    const targetPath = document.getElementById('create-path').value.trim();
    const deadline = document.getElementById('create-deadline').value;

    if (!title || !targetPath) { toast('请填写标题和接收目录'); return; }

    try {
      btn.disabled = true;
      btn.textContent = '创建中...';
      const res = await api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          targetPath,
          deadline: deadline ? `${deadline}T23:59:59+08:00` : undefined,
        }),
      });
      const shareUrl = `${location.origin}${res.sharePath}`;
      // 自动复制到剪贴板
      navigator.clipboard.writeText(shareUrl).catch(() => {});

      modal({
        title: '任务创建成功',
        bodyHtml: `
          <div style="text-align:center;">
            <p style="color:#666;margin-bottom:16px;">分享链接已生成，点击复制发送给提交人</p>
            <div style="background:#f5f5f5;padding:12px;border-radius:8px;font-size:13px;word-break:break-all;margin-bottom:16px;">${escapeHtml(shareUrl)}</div>
            <button class="btn btn-primary" id="modal-copy-btn" style="margin-bottom:8px;">一键复制链接</button>
            <p style="font-size:12px;color:#999;">链接已自动复制到剪贴板</p>
          </div>
        `,
        confirmText: '去查看任务',
        onConfirm: () => { location.hash = `#/task?taskId=${res.taskId}`; },
        showCancel: false,
      });
      // 绑定模态框内的一键复制按钮
      setTimeout(() => {
        const copyBtn = document.getElementById('modal-copy-btn');
        if (copyBtn) {
          copyBtn.onclick = () => {
            navigator.clipboard.writeText(shareUrl).then(() => {
              toast('链接已复制');
            }).catch(() => {
              toast('复制失败，请手动复制');
            });
          };
        }
      }, 0);
    } catch (e) {
      toast(e.message || '创建失败');
    } finally {
      btn.disabled = false;
      btn.textContent = '创建任务';
    }
  };
}

// ========== Page: Task Detail ==========
async function renderTask() {
  const params = parseHashParams();
  const taskId = params.taskId;
  if (!taskId) { location.hash = '#/home'; return; }

  const infoEl = document.getElementById('task-detail-info');
  const subsEl = document.getElementById('task-detail-subs');
  infoEl.innerHTML = '<p>加载中...</p>';
  subsEl.innerHTML = '';

  try {
    const task = await api(`/api/tasks/${taskId}`);
    infoEl.innerHTML = `
      <div class="card-title">${escapeHtml(task.title)}</div>
      <p style="color:#666;margin-bottom:12px;">${escapeHtml(task.description || '无描述')}</p>
      <div style="font-size:13px;color:#999;margin-bottom:8px;">
        状态：<span class="task-status ${task.status}">${task.status === 'active' ? '进行中' : '已关闭'}</span>
      </div>
      <div style="font-size:13px;color:#999;margin-bottom:8px;">提交数：${task.submissionCount} | 文件数：${task.fileCount}</div>
      ${task.deadline ? `<div style="font-size:13px;color:#999;">截止：${task.deadline}</div>` : ''}
    `;

    // 分享链接
    try {
      const shareRes = await api(`/api/tasks/${taskId}/regenerate-share`, { method: 'POST' });
      const shareUrl = `${location.origin}${shareRes.sharePath}`;
      infoEl.innerHTML += `
        <div style="margin-top:12px;">
          <div class="share-link">${shareUrl}</div>
          <button class="btn btn-default btn-small" onclick="navigator.clipboard.writeText('${shareUrl}');toast('链接已复制')">复制分享链接</button>
        </div>
      `;
    } catch (e) {
      // 忽略分享链接获取失败
    }

    // 关闭任务按钮
    if (task.status === 'active') {
      infoEl.innerHTML += `<button class="btn btn-danger" style="margin-top:12px;" id="btn-close-task">关闭任务</button>`;
      document.getElementById('btn-close-task').onclick = async () => {
        if (!confirm('确定关闭此任务？关闭后无法再提交。')) return;
        await api(`/api/tasks/${taskId}/close`, { method: 'POST' });
        toast('任务已关闭');
        renderTask();
      };
    }

    // 提交记录
    const submissions = await api(`/api/tasks/${taskId}/submissions`);
    if (!submissions || submissions.length === 0) {
      subsEl.innerHTML = '<div class="empty-state"><p>暂无提交记录</p></div>';
      return;
    }
    subsEl.innerHTML = submissions.map((s) => `
      <div class="file-item">
        <div>
          <div class="file-item-name">${escapeHtml(s.submitterName)}</div>
          <div style="font-size:12px;color:#999;margin-top:2px;">${new Date(s.createdAt).toLocaleString()}</div>
        </div>
        <span class="status-badge status-${s.status === 'success' ? 'success' : s.status === 'failed' ? 'failed' : 'processing'}">
          ${s.status === 'success' ? '成功' : s.status === 'partial_success' ? '部分成功' : s.status === 'failed' ? '失败' : '处理中'}
        </span>
      </div>
    `).join('');
  } catch (e) {
    infoEl.innerHTML = '<p>加载失败</p>';
  }
}

// ========== Page: Submit (Public) ==========
let selectedFiles = [];

async function renderSubmit() {
  const params = parseHashParams();
  const taskId = params.taskId;
  const code = params.code;

  if (!taskId || !code) {
    document.getElementById('submit-content').innerHTML = '<div class="empty-state"><p>链接无效，缺少任务信息</p></div>';
    return;
  }

  // 加载任务信息
  try {
    const task = await api(`/api/public/tasks/${taskId}?code=${code}`);
    document.getElementById('submit-task-info').innerHTML = `
      <div class="card-title">${escapeHtml(task.title)}</div>
      <p style="color:#666;margin-bottom:12px;">${escapeHtml(task.description || '')}</p>
      <div style="font-size:13px;color:#999;">发起人：${escapeHtml(task.ownerName)}</div>
      ${task.deadline ? `<div style="font-size:13px;color:#999;">截止：${task.deadline}</div>` : ''}
    `;
  } catch (e) {
    document.getElementById('submit-content').innerHTML = '<div class="empty-state"><p>任务加载失败或已过期</p></div>';
    return;
  }

  // 文件选择
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const fileList = document.getElementById('file-list');

  uploadZone.onclick = () => fileInput.click();
  fileInput.onchange = (e) => addFiles(e.target.files);

  // 拖拽上传
  uploadZone.ondragover = (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); };
  uploadZone.ondragleave = () => uploadZone.classList.remove('dragover');
  uploadZone.ondrop = (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  };

  function addFiles(files) {
    for (const f of files) {
      if (f.size > 524288000) { toast(`文件 ${f.name} 超过 500MB，已跳过`); continue; }
      selectedFiles.push(f);
    }
    renderFileList();
  }

  function renderFileList() {
    if (selectedFiles.length === 0) { fileList.innerHTML = ''; return; }
    fileList.innerHTML = selectedFiles.map((f, i) => `
      <div class="file-item">
        <span class="file-item-name">${escapeHtml(f.name)}</span>
        <span class="file-item-size">${(f.size / 1024 / 1024).toFixed(2)} MB</span>
        <span class="file-item-remove" data-index="${i}">删除</span>
      </div>
    `).join('');
    fileList.querySelectorAll('.file-item-remove').forEach((el) => {
      el.onclick = () => { selectedFiles.splice(Number(el.dataset.index), 1); renderFileList(); };
    });
  }

  // 提交
  document.getElementById('btn-submit-files').onclick = async () => {
    if (selectedFiles.length === 0) { toast('请先选择文件'); return; }

    const token = localStorage.getItem('token');
    if (!token) {
      toast('请先登录');
      setTimeout(() => (location.hash = '#/login'), 1000);
      return;
    }

    const btn = document.getElementById('btn-submit-files');
    try {
      btn.disabled = true;
      btn.textContent = '创建提交单...';

      // 1. 创建提交单
      const res = await api('/api/submissions', {
        method: 'POST',
        body: JSON.stringify({
          taskId,
          sourceType: 'browser_upload',
          files: selectedFiles.map((f) => ({ name: f.name, size: f.size, type: f.type })),
        }),
      });

      const submissionId = res.submissionId;
      const fileMap = {};
      for (const f of res.files || []) {
        const localFile = selectedFiles.find((lf) => lf.name === f.name);
        if (localFile) fileMap[localFile.name] = f.fileId;
      }

      // 2. 上传文件
      btn.textContent = '上传中...';
      for (const f of selectedFiles) {
        const fileId = fileMap[f.name];
        if (!fileId) continue;
        const formData = new FormData();
        formData.append('file', f);
        formData.append('fileId', fileId);
        formData.append('taskId', taskId);
        await apiUpload(`/api/submissions/${submissionId}/upload`, formData);
      }

      toast('提交成功，正在处理...');
      selectedFiles = [];
      renderFileList();

      // 3. 轮询状态
      pollSubmissionStatus(submissionId);
    } catch (e) {
      toast(e.message || '提交失败');
    } finally {
      btn.disabled = false;
      btn.textContent = '确认提交';
    }
  };
}

async function pollSubmissionStatus(submissionId) {
  const statusEl = document.getElementById('submit-status');
  statusEl.classList.remove('hidden');

  const timer = setInterval(async () => {
    try {
      const status = await api(`/api/submissions/${submissionId}/status`);
      statusEl.innerHTML = `
        <div class="card-title">提交状态</div>
        <p>状态：<span class="status-badge status-${status.status === 'success' ? 'success' : status.status === 'partial_success' ? 'partial' : status.status === 'failed' ? 'failed' : 'processing'}">
          ${status.status === 'success' ? '成功' : status.status === 'partial_success' ? '部分成功' : status.status === 'failed' ? '失败' : '处理中'}
        </span></p>
        <p>文件：${status.successCount}/${status.fileCount} 成功</p>
      `;
      if (['success', 'partial_success', 'failed'].includes(status.status)) {
        clearInterval(timer);
      }
    } catch (e) {
      clearInterval(timer);
    }
  }, 3000);
}

// ========== Utils ==========
function parseHashParams() {
  const hash = location.hash;
  const query = hash.includes('?') ? hash.split('?')[1] : '';
  const params = {};
  new URLSearchParams(query).forEach((v, k) => (params[k] = v));
  return params;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ========== Folder Picker ==========
let folderPickerCallback = null;
let folderPickerCurrentPath = '/';

async function openFolderPicker(onSelect) {
  folderPickerCallback = onSelect;
  folderPickerCurrentPath = '/';
  document.getElementById('folder-picker').classList.add('show');
  await loadFolderList('/');
}

function closeFolderPicker() {
  document.getElementById('folder-picker').classList.remove('show');
  folderPickerCallback = null;
}

async function loadFolderList(path) {
  const listEl = document.getElementById('folder-picker-list');
  const breadcrumbEl = document.getElementById('folder-picker-breadcrumb');
  listEl.innerHTML = '<div class="empty-state"><p>加载中...</p></div>';
  breadcrumbEl.textContent = path || '/';

  try {
    const data = await api(`/api/baidu/files?path=${encodeURIComponent(path)}`);
    const folders = data.items.filter((item) => item.isDir);

    if (folders.length === 0) {
      listEl.innerHTML = '<div class="empty-state"><p style="font-size:14px;">该目录下没有文件夹</p></div>';
    } else {
      listEl.innerHTML = folders.map((f) => `
        <div class="folder-item" data-path="${escapeHtml(f.path)}">
          <span style="font-size:18px;margin-right:8px;">📁</span>
          <span style="flex:1;">${escapeHtml(f.name)}</span>
          <span style="color:#999;font-size:13px;">进入 ></span>
        </div>
      `).join('');
      listEl.querySelectorAll('.folder-item').forEach((el) => {
        el.onclick = () => {
          folderPickerCurrentPath = el.dataset.path;
          loadFolderList(el.dataset.path);
        };
      });
    }

    // 绑定"选择当前目录"按钮
    document.getElementById('folder-picker-confirm').onclick = () => {
      if (folderPickerCallback) {
        folderPickerCallback(folderPickerCurrentPath);
      }
      closeFolderPicker();
    };

    // 如果不是根目录，添加返回上一级
    if (path !== '/' && path !== '') {
      const parentPath = path.split('/').slice(0, -1).join('/') || '/';
      const backEl = document.createElement('div');
      backEl.className = 'folder-item';
      backEl.style.cssText = 'border-bottom:1px solid #e8e8e8;margin-bottom:8px;padding-bottom:8px;';
      backEl.innerHTML = '<span style="font-size:18px;margin-right:8px;">⬅️</span><span>返回上一级</span>';
      backEl.onclick = () => {
        folderPickerCurrentPath = parentPath;
        loadFolderList(parentPath);
      };
      listEl.insertBefore(backEl, listEl.firstChild);
    }
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state"><p>加载失败：${escapeHtml(e.message)}</p></div>`;
  }
}

// ========== Init ==========
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => {
  route();
  renderLogin();
  renderCreate();
});
