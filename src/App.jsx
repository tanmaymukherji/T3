import React, { useState, useEffect, useCallback, Component } from 'react';
import DocumentLibrary from './components/Library/DocumentLibrary';
import SplitPaneEditor from './components/Editor/SplitPaneEditor';
import OcrValidator from './components/Editor/OcrValidator';
import FolderImporter from './components/Importer/FolderImporter';
import SettingsPanel from './components/SettingsPanel';
import ErrorBanner from './components/ErrorBanner';
import { listProjects, saveProject, deleteProject } from './storage';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: '' };
  }
  static getDerivedStateFromError(error) {
    return { error: error?.message || String(error), info: error?.stack || '' };
  }
  componentDidCatch(error, info) {
    console.error('App error:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex items-center justify-center bg-gray-100">
          <div className="bg-white p-8 rounded-lg shadow-xl max-w-md">
            <h2 className="text-lg font-bold text-red-700 mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-600 mb-4 whitespace-pre-wrap">{this.state.error}</p>
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer hover:text-gray-700">Stack trace</summary>
              <pre className="mt-2 p-2 bg-gray-100 rounded overflow-auto max-h-60">{this.state.info}</pre>
            </details>
            <button
              onClick={() => { this.setState({ error: null, info: '' }); window.location.reload(); }}
              className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState('library');
  const [editorTab, setEditorTab] = useState('ocr');
  const [showSettings, setShowSettings] = useState(false);

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
    try {
      let project;

      if (typeof result === 'object' && result.paragraphs && Array.isArray(result.paragraphs)) {
        const htmlContent = result.paragraphs
          .map((p) => `<p data-page="${p.page}" data-filename="${p.filename || ''}">${p.text}</p>`)
          .join('\n');

        project = await saveProject({
          name: result.name || 'Untitled',
          folder_path: result.folder || '',
          content: htmlContent,
          paragraphsArray: result.paragraphs,
          total_paragraphs: result.paragraphs.length,
          images: result.images || [],
        });
      } else if (typeof result === 'object' && result.id) {
        project = result;
      } else {
        throw new Error('Invalid project data');
      }

      await loadProjects();
      setActiveProject(project);
      setEditorTab('ocr');
      setView('editor');
    } catch (err) {
      setError(err.message || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectProject = (project) => {
    setActiveProject(project);
    setEditorTab(project.images?.length ? 'ocr' : 'translate');
    setView('editor');
  };

  const handleDeleteProject = async (project) => {
    if (!project?.id) return;
    if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
    try {
      await deleteProject(project.id);
      if (activeProject?.id === project.id) {
        setActiveProject(null);
        setEditorTab('ocr');
        setView('library');
      }
      await loadProjects();
    } catch (err) {
      setError('Delete failed: ' + err.message);
    }
  };

  const handleSaveOcr = async (updatedParagraphs) => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const htmlContent = updatedParagraphs
        .map((p) => `<p data-page="${p.page}" data-filename="${p.filename || ''}">${p.text}</p>`)
        .join('\n');
      const updated = await saveProject({
        ...activeProject,
        content: htmlContent,
        paragraphsArray: updatedParagraphs,
      });
      setActiveProject(updated);
    } catch (err) {
      setError('Save failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveContent = async (content, extraData) => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const updated = await saveProject({ ...activeProject, content, ...extraData });
      setActiveProject(updated);
      await loadProjects();
    } catch (err) {
      setError('Save failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ErrorBoundary>
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

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <main className="flex-1 overflow-hidden">
        {view === 'library' && (
          <DocumentLibrary
            projects={projects}
            onSelect={handleSelectProject}
            onDelete={handleDeleteProject}
            onRefresh={loadProjects}
          />
        )}
        {view === 'editor' && activeProject && (
          <div className="h-full flex flex-col">
            {/* Editor Tab Bar */}
            <div className="bg-gray-200 border-b border-gray-300 px-4 py-0 flex items-center gap-0">
              <button
                onClick={() => setEditorTab('ocr')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  editorTab === 'ocr'
                    ? 'border-indigo-600 text-indigo-700 bg-white'
                    : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                }`}
              >
                OCR Validation
              </button>
              <button
                onClick={() => setEditorTab('translate')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  editorTab === 'translate'
                    ? 'border-indigo-600 text-indigo-700 bg-white'
                    : 'border-transparent text-gray-600 hover:text-gray-800 hover:bg-gray-100'
                }`}
              >
                Translation
              </button>
            </div>

            {editorTab === 'ocr' ? (
              <OcrValidator
                images={activeProject.images || []}
                paragraphs={activeProject.paragraphsArray || []}
                onSaveParagraphs={handleSaveOcr}
              />
            ) : (
              <SplitPaneEditor
                project={activeProject}
                onSave={handleSaveContent}
                loading={loading}
              />
            )}
          </div>
        )}
      </main>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
    </ErrorBoundary>
  );
}
