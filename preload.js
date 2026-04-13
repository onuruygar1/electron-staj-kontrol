const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickPdfAndAnalyze: () => ipcRenderer.invoke('pick-pdf-and-analyze')
});
