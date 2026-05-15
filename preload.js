const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickPdfAndAnalyze:  (options = {}) => ipcRenderer.invoke('pick-pdf-and-analyze', options),
  pickStudentListPdf: ()             => ipcRenderer.invoke('pick-student-list-pdf')
});
