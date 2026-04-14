import { get, set, del } from 'idb-keyval';

const MEDIA_PREFIX = 'sync-split-media-';
const LIBRARY_KEY = 'sync-split-library';

export interface MediaMetadata {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  duration?: number; // for images
}

export async function saveMediaToDB(file: File, id: string) {
  try {
    await set(`${MEDIA_PREFIX}${id}`, file);
    return true;
  } catch (err) {
    console.error('Failed to save media to IndexedDB:', err);
    return false;
  }
}

export async function getMediaFromDB(id: string): Promise<File | null> {
  try {
    const file = await get(`${MEDIA_PREFIX}${id}`);
    return file || null;
  } catch (err) {
    console.error('Failed to get media from IndexedDB:', err);
    return null;
  }
}

export async function saveLibrary(library: MediaMetadata[]) {
  await set(LIBRARY_KEY, library);
}

export async function getLibrary(): Promise<MediaMetadata[]> {
  const lib = await get(LIBRARY_KEY);
  return lib || [];
}

export async function deleteMedia(id: string) {
  await del(`${MEDIA_PREFIX}${id}`);
}
