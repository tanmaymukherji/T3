const CONFIG_DB_NAME = 'T3Config';
const CONFIG_DB_VERSION = 1;
const CONFIG_STORE = 'config';
const LEGACY_DB_NAME = 'TranslationTool';

let _baseDirHandle = null;
let _projectsDirHandle = null;

function _openConfigDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFIG_DB_NAME, CONFIG_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONFIG_STORE)) {
        db.createObjectStore(CONFIG_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function _storeHandle(handle) {
  const db = await _openConfigDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONFIG_STORE, 'readwrite');
    tx.objectStore(CONFIG_STORE).put(handle, 'workDirHandle');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function _retrieveHandle() {
  try {
    const db = await _openConfigDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONFIG_STORE, 'readonly');
      const request = tx.objectStore(CONFIG_STORE).get('workDirHandle');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function _getBaseDir() {
  if (_baseDirHandle) return _baseDirHandle;

  _baseDirHandle = await _retrieveHandle();

  if (_baseDirHandle) {
    try {
      const perm = await _baseDirHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        const result = await _baseDirHandle.requestPermission({ mode: 'readwrite' });
        if (result !== 'granted') _baseDirHandle = null;
      }
    } catch {
      _baseDirHandle = null;
    }
  }

  if (!_baseDirHandle) {
    _baseDirHandle = await window.showDirectoryPicker({
      id: 't3-work-dir',
      startIn: 'documents',
      mode: 'readwrite',
    });
    await _storeHandle(_baseDirHandle);
  }

  return _baseDirHandle;
}

async function _getProjectsDir() {
  if (_projectsDirHandle) return _projectsDirHandle;
  const base = await _getBaseDir();
  _projectsDirHandle = await base.getDirectoryHandle('projects', { create: true });
  return _projectsDirHandle;
}

async function _getProjectDir(projectId) {
  const projectsDir = await _getProjectsDir();
  return projectsDir.getDirectoryHandle(projectId, { create: true });
}

export function buildHtmlContent(paragraphs) {
  return paragraphs.map((p) => {
    const sourceAttrs = `${p.source ? ` data-source="${p.source}"` : ''}` +
      `${p.sourceId ? ` data-source-id="${p.sourceId}"` : ''}` +
      `${p.sourcePage ? ` data-source-page="${p.sourcePage}"` : ''}`;
    if (p.type === 'table' && p.rows && p.rows.length > 0) {
      const rowsHtml = p.rows.map(r =>
        '<tr>' + r.map(c => '<td>' + (c || '') + '</td>').join('') + '</tr>'
      ).join('');
      return `<table data-page="${p.page}" data-filename="${p.filename || ''}" data-type="table"${sourceAttrs}>${rowsHtml}</table>`;
    }
    return `<p data-page="${p.page}" data-filename="${p.filename || ''}"${sourceAttrs}>${p.text}</p>`;
  }).join('\n');
}

export async function initializeStorage() {
  try {
    // Check browser support
    if (!('showDirectoryPicker' in window)) {
      throw new Error('Your browser does not support the File System Access API. Please use a recent version of Chrome or Edge on desktop.');
    }
    // Check secure context
    if (!window.isSecureContext) {
      throw new Error('A secure context (HTTPS or localhost) is required. The app is currently running over an insecure connection.');
    }

    _baseDirHandle = await _getBaseDir();
    _projectsDirHandle = await _getProjectsDir();
    await clearOldData();
    return { name: _baseDirHandle.name };
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    console.error('Storage initialization failed:', err);
    throw new Error(err.message || 'Storage permission denied. Please allow access to use this application.');
  }
}

export async function retryInitialization() {
  // Reset cached handles so a fresh attempt is made
  _baseDirHandle = null;
  _projectsDirHandle = null;
  return initializeStorage();
}

export async function listProjects() {
  const projectsDir = await _getProjectsDir();
  const projects = [];
  for await (const [name, handle] of projectsDir.entries()) {
    if (handle.kind === 'directory') {
      try {
        const fileHandle = await handle.getFileHandle('project.json');
        const file = await fileHandle.getFile();
        const content = await file.text();
        projects.push(JSON.parse(content));
      } catch {
        // Skip invalid project dirs silently
      }
    }
  }
  projects.sort((a, b) => (b.last_opened || 0) - (a.last_opened || 0));
  return projects;
}

export async function getProject(projectId) {
  const projectDir = await _getProjectDir(projectId);
  const fileHandle = await projectDir.getFileHandle('project.json');
  const file = await fileHandle.getFile();
  const content = await file.text();
  return JSON.parse(content);
}

export async function saveProject(projectData) {
  const now = Date.now();
  const finalId = projectData.id || 'p_' + now + '_' + Math.random().toString(36).slice(2, 8);

  const toStore = { ...projectData, id: finalId, last_opened: now };
  if (!('created_at' in toStore)) {
    toStore.created_at = now;
  }

  const projectDir = await _getProjectDir(finalId);
  const fileHandle = await projectDir.getFileHandle('project.json', { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(toStore, null, 2));
  await writable.close();

  return toStore;
}

export async function deleteProject(projectId) {
  const projectsDir = await _getProjectsDir();
  await projectsDir.removeEntry(projectId, { recursive: true });
}

export async function writeImage(projectId, pageNumber, blob) {
  const projectDir = await _getProjectDir(projectId);
  const imagesDir = await projectDir.getDirectoryHandle('images', { create: true });
  const fileHandle = await imagesDir.getFileHandle(`page_${pageNumber}.png`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function _safeSourceFilename(sourceIdOrFilename) {
  const base = String(sourceIdOrFilename || 'source')
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'source';
  return `${base}.pdf`;
}

export async function writeSourceDocument(projectId, sourceId, blob) {
  const projectDir = await _getProjectDir(projectId);
  const sourcesDir = await projectDir.getDirectoryHandle('sources', { create: true });
  const storageName = _safeSourceFilename(sourceId);
  const fileHandle = await sourcesDir.getFileHandle(storageName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  return storageName;
}

export async function readSourceDocument(projectId, storageNameOrSourceId) {
  try {
    const projectDir = await _getProjectDir(projectId);
    const sourcesDir = await projectDir.getDirectoryHandle('sources');
    const storageName = _safeSourceFilename(storageNameOrSourceId);
    const fileHandle = await sourcesDir.getFileHandle(storageName);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

export async function readImage(projectId, pageNumber, ext) {
  try {
    const projectDir = await _getProjectDir(projectId);
    const imagesDir = await projectDir.getDirectoryHandle('images');
    // Try the specific extension first, then fall back to .png, then .jpg
    const extensions = ext ? [ext] : ['png', 'jpg', 'jpeg'];
    for (const e of extensions) {
      try {
        const fileHandle = await imagesDir.getFileHandle(`page_${pageNumber}.${e}`);
        return await fileHandle.getFile();
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearOldData() {
  try {
    const request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Non-critical cleanup
  }
}

export async function changeWorkingDirectory() {
  const newHandle = await window.showDirectoryPicker({
    id: 't3-work-dir',
    startIn: 'documents',
    mode: 'readwrite',
  });
  await _storeHandle(newHandle);
  _baseDirHandle = newHandle;
  _projectsDirHandle = null;
  return { name: newHandle.name };
}

export async function getWorkingInfo() {
  try {
    const baseDir = await _getBaseDir();
    const projectsDir = await _getProjectsDir();
    let count = 0;
    for await (const entry of projectsDir.entries()) {
      if (entry[1].kind === 'directory') count++;
    }
    return { name: baseDir.name, count };
  } catch {
    return { name: 'Unknown', count: 0 };
  }
}
