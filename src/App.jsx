import React, { useState, useEffect, useCallback, Component } from 'react';
import DocumentLibrary from './components/Library/DocumentLibrary';
import SplitPaneEditor from './components/Editor/SplitPaneEditor';
import OcrValidator from './components/Editor/OcrValidator';
import FolderImporter from './components/Importer/FolderImporter';
import DocxImporter from './components/Importer/DocxImporter';
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
  console.error('[App] render loading=', loading, 'view=', view, 'error=', error);

  // Auto-reset loading if stuck for more than 15 seconds
  useEffect(() => {
    if (!loading) return;
    const id = setTimeout(() => {
      console.error('[App] loading stuck for 15s, auto-resetting');
      setLoading(false);
      setError('Loading timed out — the operation did not complete.');
    }, 15000);
    return () => clearTimeout(id);
  }, [loading]);

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
          .map((p) => {
            if (p.type === 'table' && p.rows && p.rows.length > 0) {
              const rowsHtml = p.rows.map(r =>
                '<tr>' + r.map(c => '<td>' + (c || '') + '</td>').join('') + '</tr>'
              ).join('');
              return `<table data-page="${p.page}" data-filename="${p.filename || ''}" data-type="table">${rowsHtml}</table>`;
            }
            return `<p data-page="${p.page}" data-filename="${p.filename || ''}"${p.source ? ` data-source="${p.source}"` : ''}>${p.text}</p>`;
          })
          .join('\n');

        project = await saveProject({
          name: result.name || 'Untitled',
          folder_path: result.folder || '',
          content: htmlContent,
          paragraphsArray: result.paragraphs,
          total_paragraphs: result.paragraphs.length,
          images: result.images || [],
          fileHandle: result.fileHandle || null,
          isDocx: !!result.isDocx,
        });
      } else if (typeof result === 'object' && result.id) {
        project = result;
      } else {
        throw new Error('Invalid project data');
      }

      await loadProjects();
      setActiveProject(project);
      setEditorTab(result.isDocx ? 'translate' : 'ocr');
      setView('editor');
    } catch (err) {
      setError(err.message || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectProject = (project) => {
    setActiveProject(project);
    setEditorTab(project.isDocx ? 'translate' : project.images?.length ? 'ocr' : 'translate');
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
    if (!activeProject) { return false; }
    console.log('[handleSaveOcr] START', {
      projectId: activeProject.id,
      beforeParagraphsCount: activeProject.paragraphsArray?.length,
      beforeContentLength: activeProject.content?.length,
      incomingCount: updatedParagraphs?.length,
      incomingSample: updatedParagraphs?.slice(0, 2).map(p => ({ i: p.index, t: p.text })),
    });
    setLoading(true);
    try {
      const htmlContent = updatedParagraphs
        .map((p) => {
          if (p.type === 'table' && p.rows && p.rows.length > 0) {
            const rowsHtml = p.rows.map(r =>
              '<tr>' + r.map(c => '<td>' + (c || '') + '</td>').join('') + '</tr>'
            ).join('');
            return `<table data-page="${p.page}" data-filename="${p.filename || ''}" data-type="table">${rowsHtml}</table>`;
          }
          return `<p data-page="${p.page}" data-filename="${p.filename || ''}">${p.text}</p>`;
        })
        .join('\n');
      console.log('[handleSaveOcr] generated HTML length:', htmlContent.length, 'first 100:', htmlContent.substring(0, 100));
      const updated = await saveProject({
        ...activeProject,
        content: htmlContent,
        paragraphsArray: updatedParagraphs,
      });
      console.log('[handleSaveOcr] saveProject returned', {
        id: updated.id,
        paragraphsCount: updated.paragraphsArray?.length,
        paragraphsSample: updated.paragraphsArray?.slice(0, 2).map(p => ({ i: p.index, t: p.text })),
      });
      setActiveProject(updated);
      console.log('[handleSaveOcr] DONE - activeProject updated');
      return true;
    } catch (err) {
      console.error('[handleSaveOcr] ERROR:', err);
      setError('Save failed: ' + err.message);
      return false;
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
      <div className="bg-yellow-200 text-yellow-900 px-4 py-1 text-xs font-mono flex gap-4">
        <span>loading={String(loading)}</span>
        <span>view={view}</span>
        <span>error={error || 'none'}</span>
        <span>projects={projects.length}</span>
      </div>
      <header className="bg-slate-800 text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">T³ - Tanmay's Translation Tool</h1>
          <nav className="flex gap-2">
            <button
              onClick={() => setView('library')}
              className="bg-emerald-600 hover:bg-emerald-700 px-3 py-1 rounded text-sm"
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
          <DocxImporter onImport={handleProjectResult} disabled={loading} />
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
                images={activeProject.images || []}
                paragraphs={activeProject.paragraphsArray || []}
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
