// AgentPong — мост виджет <-> сцена (contextIsolation)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apWidget', {
    isWidget: true,
    onHide: (cb) => ipcRenderer.on('ap:hidden', () => cb()),
    onShow: (cb) => ipcRenderer.on('ap:shown', () => cb()),
    onMove: (cb) => ipcRenderer.on('ap:moved', () => cb()),
    minimize: () => ipcRenderer.send('ap:minimize'),
    quit: () => ipcRenderer.send('ap:quit'),
    dragStart: () => ipcRenderer.send('ap:drag-start'),
    tts: (text, voiceName) => ipcRenderer.invoke('tts:ps', { text: text, voiceName: voiceName || null }),
    voices: () => ipcRenderer.invoke('tts:voices'),
});
