// Client-side document storage using IndexedDB

import { openDB } from 'idb';

const DB_NAME = 'TranslationTool';
const DB_VERSION = 1;

let db = null;

async function getDB() {
  if (db) return db;

  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Projects store
      if (!db.objectStoreNames.contains('projects')) {
        const store = db.createObjectStore('projects', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('folder_path', 'folder_path', { unique: true });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('created_at', 'created_at', { unique: false });
      }
    },
  });

  return db;
}

export async function listProjects() {
  const database = await getDB();
  const projects = await database.getAll('projects');
  // Sort by last_opened descending
  projects.sort((a, b) => {
    const da = a.last_opened || a.created_at || 0;
    const db2 = b.last_opened || b.created_at || 0;
    return db2 - da;
  });
  return projects;
}

export async function getProject(id) {
  const database = await getDB();
  return database.get('projects', id);
}

export async function saveProject(project) {
  const database = await getDB();
  const now = Date.now();
  const toSave = {
    ...project,
    last_opened: now,
  };

  if (!toSave.id) {
    toSave.created_at = now;
    toSave.id = undefined; // Let autoIncrement assign
  }

  const id = await database.put('projects', toSave);
  return { ...toSave, id };
}

export async function deleteProject(id) {
  const database = await getDB();
  await database.delete('projects', id);
}

export async function createProject(name, folderPath, content, paragraphs) {
  const project = {
    name,
    folder_path: folderPath,
    content: content || '',
    paragraphs: paragraphs || 0,
    created_at: Date.now(),
    last_opened: Date.now(),
  };
  return saveProject(project);
}

export async function updateProjectContent(id, content) {
  const database = await getDB();
  const project = await database.get('projects', id);
  if (!project) throw new Error(`Project ${id} not found`);
  project.content = content;
  project.last_opened = Date.now();
  await database.put('projects', project);
  return project;
}
