// Bridge for the local wallet window (secure.html): import a key, reveal it, answer a confirmation, close. Nothing else.
const { contextBridge, ipcRenderer } = require('electron');
const call = (fn, arg) => ipcRenderer.invoke('secure', { fn, arg });
contextBridge.exposeInMainWorld('burnerSecure', {
  context: () => call('context'),
  importKey: (secret) => call('import', String(secret || '')),
  reveal: () => call('reveal'),
  answer: (yes) => call('answer', yes === true),
  close: () => call('close'),
});
