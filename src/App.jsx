import React, { useState, useEffect, useCallback } from 'react';
import DocumentLibrary from './components/Library/DocumentLibrary';
import SplitPaneEditor from './components/Editor/SplitPaneEditor';
import FolderImporter from './components/Importer/FolderImporter';
import SettingsPanel from './components/SettingsPanel';
import ErrorBanner from './components/ErrorBanner';
import { listProjects, saveProject } from './storage';

export default function App() {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState('library');
  const [showSettings, setShowSettings] = useState(false);
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const all = await listProjects();
      setProjects(all);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  };

  const handleProjectResult = useCallback(async (result) => {
    setLoading(true);
    setError(null);
    setProgress(null);
    try {
      let project;

      if (typeof result === 'object' && result.paragraphs) {
        // OCR result from FolderImporter
        const htmlContent = result.paragraphs
          .map((p) => `<p>${p}</p>`)
          .join('\n');

        project = await saveProject({
          name: result.name || 'Untitled',
          folder_path: result.folder || '',
          content: htmlContent,
          paragraphs: result.paragraphs.length,
        });
      } else if (typeof result === 'object' && result.id) {
        project = result;
      } else {
        throw new Error('Invalid project data');
      }

      await loadProjects();
      setActiveProject(project);
      setView('editor');
    } catch (err) {
      setError(err.message || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectProject = (project) => {
    setActiveProject(project);
    setView('editor');
  };

  const handleSaveContent = async (content) => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const updated = await saveProject({ ...activeProject, content });
      setActiveProject(updated);
      await loadProjects();
    } catch (err) {
      setError('Save failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-slate-800 text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Translation Tool</h1>
          <nav className="flex gap-2">
            <button
              onClick={() => setView('library')}
              className={`px-3 py-1 rounded text-sm ${view === 'library' ? 'bg-slate-600' : 'hover:bg-slate-700'}`}
            >
              Library
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {activeProject && view === 'editor' && (
            <span className="text-gray-300 text-sm truncate max-w-[200px]">
              {activeProject.name}
            </span>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="text-gray-400 hover:text-white text-sm"
            title="Settings"
          >
            ⚙
          </button>
          <FolderImporter onImport={handleProjectResult} disabled={loading} />
        </div>
      </header>

      {/* Progress bar */}
      {progress && (
        <div className="bg-blue-100 text-blue-800 px-4 py-1 text-xs flex items-center gap-2">
          <div className="flex-1 bg-blue-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
            />
          </div>
          <span>
            {progress.phase === 'ocr'
              ? `OCR: ${progress.current}/${progress.total} (${progress.file})`
              : progress.phase === 'translate'
              ? `Translating...`
              : ''}
          </span>
        </div>
      )}

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <main className="flex-1 overflow-hidden">
        {view === 'library' && (
          <DocumentLibrary
            projects={projects}
            onSelect={handleSelectProject}
            onRefresh={loadProjects}
          />
        )}
        {view === 'editor' && activeProject && (
          <SplitPaneEditor
            project={activeProject}
            onSave={handleSaveContent}
            loading={loading}
          />
        )}
      </main>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}
