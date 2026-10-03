const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('exportBridge',{getPayload:()=>ipcRenderer.invoke('export-payload')});
