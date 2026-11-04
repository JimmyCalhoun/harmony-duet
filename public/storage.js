let database;
export async function openStore() {
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('harmony-duet', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('takes', { keyPath: 'part' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open browser storage.'));
    request.onblocked = () => reject(new Error('Browser storage is blocked. Close other Harmony Duet tabs and reload.'));
  });
  database.onversionchange = () => database.close();
  return new Promise((resolve, reject) => {
    const request = database.transaction('takes').objectStore('takes').getAll();
    request.onsuccess = () => resolve(request.result.map(take => {
      if (!take.audio) return take;
      const { audio, ...metadata } = take;
      return { ...metadata, blob: new Blob([audio], { type: 'audio/wav' }) };
    }));
    request.onerror = () => reject(request.error || new Error('Could not load saved takes.'));
  });
}
export async function saveTake(take) {
  const { blob, ...metadata } = take;
  const audio = await blob.arrayBuffer();
  return transact(store => store.put({ ...metadata, audio }));
}
export async function deleteTake(part) {
  return transact(store => store.delete(part));
}
function transact(action) {
  if (!database) return Promise.reject(new Error('Local recording storage is unavailable.'));
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('takes', 'readwrite');
    action(transaction.objectStore('takes'));
    transaction.oncomplete = resolve;
    transaction.onerror = event => reject(event.target.error || transaction.error || new Error('Storage write failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Storage write was aborted.'));
  });
}
