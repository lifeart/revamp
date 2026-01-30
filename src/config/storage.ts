/**
 * Configuration Storage Manager
 *
 * Handles file-based persistence with:
 * - Atomic writes (write to temp, rename)
 * - File watching for hot reload
 * - In-memory caching
 */

import { watch, type FSWatcher } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getConfig } from './index.js';

let watcher: FSWatcher | null = null;
const changeCallbacks: Array<(filename: string) => void> = [];

/**
 * Get the path to the data directory
 */
export function getDataDir(): string {
  const config = getConfig();
  // Place data dir next to cache dir
  return join(dirname(config.cacheDir), '.revamp-data');
}

/**
 * Ensure the data directory exists
 */
export async function ensureDataDir(): Promise<void> {
  const dataDir = getDataDir();
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
}

/**
 * Get full path to a file in the data directory
 */
export function getDataFilePath(filename: string): string {
  return join(getDataDir(), filename);
}

/**
 * Write JSON data atomically (write to temp file, then rename)
 * This prevents corruption if the process crashes during write
 */
export async function writeJsonAtomic<T extends object>(
  filename: string,
  data: T
): Promise<void> {
  await ensureDataDir();
  const filePath = getDataFilePath(filename);
  const tempPath = `${filePath}.tmp.${Date.now()}`;

  try {
    // Write to temp file first
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    // Atomic rename
    await rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on error
    try {
      if (existsSync(tempPath)) {
        const { unlink } = await import('node:fs/promises');
        await unlink(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Read JSON data from a file
 * Returns null if file doesn't exist or is invalid
 */
export async function readJson<T>(filename: string): Promise<T | null> {
  const filePath = getDataFilePath(filename);

  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    console.warn(`[Storage] Failed to read ${filename}:`, error);
    return null;
  }
}

/**
 * Check if a file exists in the data directory
 */
export function dataFileExists(filename: string): boolean {
  return existsSync(getDataFilePath(filename));
}

/**
 * Delete a file from the data directory
 */
export async function deleteDataFile(filename: string): Promise<boolean> {
  const filePath = getDataFilePath(filename);

  try {
    if (!existsSync(filePath)) {
      return false;
    }
    const { unlink } = await import('node:fs/promises');
    await unlink(filePath);
    return true;
  } catch (error) {
    console.warn(`[Storage] Failed to delete ${filename}:`, error);
    return false;
  }
}

/**
 * Register a callback for file changes
 * Returns a function to unregister the callback
 */
export function onFileChange(
  callback: (filename: string) => void
): () => void {
  changeCallbacks.push(callback);

  // Start watching if not already
  startWatching();

  return () => {
    const index = changeCallbacks.indexOf(callback);
    if (index !== -1) {
      changeCallbacks.splice(index, 1);
    }
  };
}

/**
 * Start watching the data directory for changes
 */
function startWatching(): void {
  if (watcher) return;

  const dataDir = getDataDir();

  // Ensure directory exists before watching
  if (!existsSync(dataDir)) {
    try {
      import('node:fs').then(({ mkdirSync }) => {
        mkdirSync(dataDir, { recursive: true });
      });
    } catch {
      // Will try again on next access
      return;
    }
  }

  try {
    watcher = watch(dataDir, (eventType, filename) => {
      if (filename && filename.endsWith('.json')) {
        for (const callback of changeCallbacks) {
          try {
            callback(filename);
          } catch (error) {
            console.warn('[Storage] Callback error:', error);
          }
        }
      }
    });

    watcher.on('error', (error) => {
      console.warn('[Storage] Watch error:', error);
      stopWatching();
    });
  } catch (error) {
    console.warn('[Storage] Failed to start watching:', error);
  }
}

/**
 * Stop watching the data directory
 */
export function stopWatching(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

/**
 * List all JSON files in the data directory
 */
export async function listJsonFiles(): Promise<string[]> {
  const dataDir = getDataDir();

  if (!existsSync(dataDir)) {
    return [];
  }

  try {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(dataDir);
    return files.filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}
