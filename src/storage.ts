import type { PixelDocument } from "./document";
export async function storage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("mogdoppixes", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("projects");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readRecovery(
  key = "current",
): Promise<PixelDocument | undefined> {
  const database = await storage();
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction("projects")
        .objectStore("projects")
        .get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}
export async function writeRecovery(
  document: PixelDocument,
  key = "current",
): Promise<void> {
  const database = await storage();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("projects", "readwrite");
      transaction.objectStore("projects").put(document, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
