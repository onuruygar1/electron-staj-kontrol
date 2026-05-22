const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickPdfAndAnalyze:   (options = {}) => ipcRenderer.invoke('pick-pdf-and-analyze', options),
  pickTranscriptPdf:   ()             => ipcRenderer.invoke('pick-transcript-pdf'),
  pickStudentListPdf:  ()             => ipcRenderer.invoke('pick-student-list-pdf'),
  getProgress:         ()             => ipcRenderer.invoke('get-analyze-progress'),
  saveExportFile:      (opts)         => ipcRenderer.invoke('save-export-file', opts)
});
