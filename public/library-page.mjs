import { createLibraryView } from './library-view.mjs';
import { enableOffline } from './offline-register.mjs';
const view=createLibraryView({root:document.getElementById('libraryRoot')});
await view.open();
document.getElementById('offlineStatus').textContent=await enableOffline();
document.getElementById('plannerLink').addEventListener('click',event=>{if(!navigator.onLine){event.preventDefault();document.getElementById('offlineStatus').textContent='当前离线，请继续使用本机路书；规划页与在线导航需要网络。';}});
