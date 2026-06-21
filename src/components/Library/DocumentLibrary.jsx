import React from 'react';

export default function DocumentLibrary({ projects, onSelect, onDelete, onRefresh }) {
  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Document Library</h2>
        <button onClick={onRefresh} className="text-sm text-indigo-600 hover:underline">Refresh</button>
      </div>
      {projects.length === 0 ? (
        <div className="text-center text-gray-500 mt-20">
          <p className="text-lg">No documents yet.</p>
          <p className="text-sm mt-2">Import a folder with scanned images to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => onSelect(p)}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 cursor-pointer hover:shadow-md transition-shadow"
            >
              <h3 className="font-medium truncate">{p.name}</h3>
              <p className="text-xs text-gray-500 mt-1">{new Date(p.created_at).toLocaleDateString()}</p>
              <p className="text-xs text-gray-400 mt-1 truncate">{p.folder_path}</p>
              <div className="mt-2 flex gap-1 flex-wrap items-center">
                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">Original</span>
                <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded">{p.total_paragraphs ?? (Array.isArray(p.paragraphs) ? p.paragraphs.length : p.paragraphs ?? 0)} paragraphs</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(p); }}
                  className="ml-auto text-red-400 hover:text-red-600 text-xs px-2 py-0.5 rounded hover:bg-red-50"
                  title="Delete document"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
