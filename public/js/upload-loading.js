// Attach to existing live status regions so every completion/cancel/error path
// shares the same timer lifecycle, including regions replaced by rendering.
export function observeUploadLoading() {
  const timers=new Map();
  const update=()=>{
    for(const [node,timer] of timers)if(!node.isConnected||node.hidden){clearInterval(timer);timers.delete(node);}
    for(const node of document.querySelectorAll('.upload-import-status,.upload-analysis-status')) {
      if(node.hidden||timers.has(node))continue;
      node.classList.add('is-loading');
      let detail=node.querySelector('.loading-detail');
      if(!detail){detail=document.createElement('small');detail.className='loading-detail';node.append(detail);}
      const started=performance.now(),tick=()=>{const seconds=Math.floor((performance.now()-started)/1000);detail.textContent=`已等待 ${seconds} 秒 · 正在处理，请稍候；可取消操作`;};
      tick();timers.set(node,setInterval(tick,1000));
    }
  };
  const observer=new MutationObserver(update);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});update();
  addEventListener('pagehide',()=>{observer.disconnect();for(const timer of timers.values())clearInterval(timer);});
}
