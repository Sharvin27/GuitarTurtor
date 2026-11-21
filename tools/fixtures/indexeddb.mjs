// Async request and transaction phases stay separate: request success is not a committed write.
export function fakeIndexedDB(mode = 'ok') {
  const data = new Map(); let closes = 0;
  const db = {
    createObjectStore() { if (mode === 'upgrade') throw new Error('upgrade'); },
    close() { closes++; },
    transaction() {
      if (mode === 'transaction') throw new Error('transaction');
      const tx = { objectStore() {
        const run = (op, id, blob) => {
          if (mode === 'request') throw new Error('request');
          const req = {};
          queueMicrotask(() => {
            if (mode === 'quota') { req.error = new Error('quota'); req.onerror?.(); return; }
            req.result = data.get(id); req.onsuccess?.();
            queueMicrotask(() => {
              if (mode === 'abort') { tx.error = new Error('aborted after request success'); tx.onabort?.(); return; }
              if (op === 'put') data.set(id, blob);
              if (op === 'delete') data.delete(id);
              tx.oncomplete?.();
            });
          });
          return req;
        };
        return { get: id => run('get', id), put: (blob, id) => run('put', id, blob), delete: id => run('delete', id) };
      } };
      return tx;
    },
  };
  return { data, get closes() { return closes; }, open() {
    if (mode === 'open') throw new Error('open');
    const req = { result: db };
    queueMicrotask(() => {
      if (mode === 'error') { req.error = new Error('open failure'); req.onerror?.(); return; }
      if (mode === 'blocked') req.onblocked?.();
      req.onupgradeneeded?.(); req.onsuccess?.();
    });
    return req;
  } };
}
