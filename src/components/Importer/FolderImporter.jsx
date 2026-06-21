import React, { useState, useRef } from 'react';
import axios from 'axios';

const API_BASE = 'http://localhost:8000';

export default function FolderImporter({ onImport, disabled }) {
  const [mode, setMode] = useState(null);
  const fileInputRef = useRef(null);

  const handleFolderClick = async () => {
    if (window.electronAPI && window.electronAPI.selectFolder) {
      const folder = await window.electronAPI.selectFolder();
      if (folder) onImport(folder);
    } else {
      const folder = prompt('Enter full folder path containing scanned images:');
      if (folder) onImport(folder);
    }
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const formData = new FormData();
    files.forEach((file) => formData.append('images', file));

    try {
      const res = await axios.post(`${API_BASE}/api/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onImport(res.data.folder_path);
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.detail || err.message));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleFolderClick}
        disabled={disabled}
        className="bg-indigo-600 hover:bg-indigo-700 px-4 py-1.5 rounded text-sm disabled:opacity-50"
      >
        {disabled ? 'Importing...' : '+ Import Folder'}
      </button>
      <span className="text-xs text-gray-400">or</span>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/tiff"
        onChange={handleFileSelect}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled}
        className="bg-emerald-600 hover:bg-emerald-700 px-4 py-1.5 rounded text-sm disabled:opacity-50"
      >
        Upload Images
      </button>
    </div>
  );
}
