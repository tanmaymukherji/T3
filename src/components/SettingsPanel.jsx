import React, { useState, useEffect, useRef } from 'react';
import CONFIG from '../config';
import { listProjects, saveProject, getWorkingInfo, changeWorkingDirectory } from '../storage';

export default function SettingsPanel({ onClose }) {
  const [hfKey, setHfKey] = useState(
    localStorage.getItem('hf_api_key') || ''
  );
  const [bhashiniKey, setBhashiniKey] = useState(
    localStorage.getItem('bhashini_api_key') || ''
  );
  const [libreKey, setLibreKey] = useState(
    localStorage.getItem('libretranslate_api_key') || ''
  );
  const [saved, setSaved] = useState(false);
  const [storageInfo, setStorageInfo] = useState(null);
  const [importStatus, setImportStatus] = useState('');
  const fileInputRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [changingDir, setChangingDir] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const info = await getWorkingInfo();
        setStorageInfo(info);
      } catch { setStorageInfo({ name: 'Unknown', count: 0 }) }
    })();
  }, []);

  const handleChangeDirectory = async () => {
    setChangingDir(true);
    try {
      const info = await changeWorkingDirectory();
      setStorageInfo(info);
    } catch (err) {
      if (err.name !== 'AbortError') alert('Failed to change directory: ' + err.message);
    } finally {
      setChangingDir(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const projects = await listProjects();
      const blob = new Blob([JSON.stringify(projects, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translation-tool-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus('Importing...');
    try {
      const text = await file.text();
      const projects = JSON.parse(text);
      if (!Array.isArray(projects)) throw new Error('Invalid backup file');
      let imported = 0;
      for (const p of projects) {
        if (p.id && (p.paragraphsArray || p.content)) {
          await saveProject(p);
          imported++;
        }
      }
      setImportStatus(`Imported ${imported} document(s). Refresh the library.`);
    } catch (err) {
      setImportStatus('Import failed: ' + err.message);
    }
    e.target.value = '';
  };

  const handleSave = () => {
    localStorage.setItem('hf_api_key', hfKey);
    localStorage.setItem('bhashini_api_key', bhashiniKey);
    localStorage.setItem('libretranslate_api_key', libreKey);
    CONFIG.HUGGINGFACE_API_KEY = hfKey;
    CONFIG.BHASHINI_API_KEY = bhashiniKey;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">&times;</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Hugging Face API Key
            </label>
            <input
              type="password"
              value={hfKey}
              onChange={(e) => setHfKey(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Enter your Hugging Face token (hf_...)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Used for IndicTrans2 translation models. Saved in browser local storage.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bhashini API Key
            </label>
            <input
              type="password"
              value={bhashiniKey}
              onChange={(e) => setBhashiniKey(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Enter Bhashini API key"
            />
            <p className="text-xs text-gray-500 mt-1">
              Optional. If set, will be used for translations (with HF fallback).
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              LibreTranslate API Key
            </label>
            <input
              type="password"
              value={libreKey}
              onChange={(e) => setLibreKey(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Get a free key at portal.libretranslate.com"
            />
            <p className="text-xs text-gray-500 mt-1">
              Optional. Free tier available at portal.libretranslate.com.
            </p>
          </div>
        </div>

        <hr className="my-4" />
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Storage</h3>
          <div className="bg-gray-50 rounded p-3 text-xs text-gray-600 space-y-2">
            <p>
              All project data is stored in your selected working directory on your file system.
              Images are saved to disk and loaded on demand, keeping browser memory usage low.
            </p>
            {storageInfo && (
              <div className="space-y-1">
                <p><strong>Working directory:</strong> {storageInfo.name}</p>
                <p><strong>Local projects:</strong> {storageInfo.count}</p>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleChangeDirectory}
                disabled={changingDir}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded text-xs disabled:opacity-50"
              >
                {changingDir ? 'Selecting...' : 'Change Working Directory'}
              </button>
            </div>
          </div>
        </div>

        <hr className="my-4" />
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Backup & Restore</h3>
          <div className="bg-gray-50 rounded p-3 text-xs text-gray-600 space-y-2">
            <p>
              Export or import project metadata as a JSON file.
              Images and project files on disk are not included.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleExport}
                disabled={exporting}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded text-xs disabled:opacity-50"
              >
                {exporting ? 'Exporting...' : 'Export All (JSON)'}
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded text-xs"
              >
                Import Backup
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
            </div>
            {importStatus && (
              <p className="text-blue-700">{importStatus}</p>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={handleSave}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded text-sm"
          >
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
