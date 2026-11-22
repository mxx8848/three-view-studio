// One processor owns the image. Coalesce edits and retain its module cache.
let worker=null,active=null,pending=null,scheduled=null,sequence=0,residentImage=null;
const images=new WeakMap(),abort=()=>new DOMException('已取消计算','AbortError');
function resetWorker() {
  worker?.terminate();worker=null;residentImage=null;
  if(active){clearTimeout(active.timer);active=null;}
}
function finish(job,error,data) {
  if(job.settled){data?.bitmap?.close();return;}
  job.settled=true;error?job.reject(error):job.resolve(data);
}
function schedule() {
  clearTimeout(scheduled);
  if(!active&&pending)scheduled=setTimeout(dispatch,pending.request.task==='preview'?160:0);
}
function ensureWorker() {
  if(worker)return;
  worker=new Worker('/worker-modules/js/upload-worker.js',{type:'module'});
  worker.onmessage=({data})=>{
    const job=active;
    if(!job||data.id!==job.id){data.bitmap?.close();return;}
    if(data.progress){if(!job.settled)job.progress(data.progress);return;}
    clearTimeout(job.timer);active=null;
    if(!data.error)residentImage=job.imageId;
    finish(job,data.error?new Error(data.error):null,data);schedule();
  };
  worker.onerror=event=>{
    event.preventDefault();const job=active;resetWorker();
    if(job)finish(job,new Error(event.message||'后台处理器加载失败，请刷新后重试'));
    schedule();
  };
}
async function dispatch() {
  if(active||!pending)return;
  const job=pending;pending=null;active=job;
  job.timer=setTimeout(()=>{
    if(active!==job)return;
    resetWorker();finish(job,new Error('处理超时，已停止。请缩小选框或换用更清晰的图纸'));schedule();
  },job.request.task==='import'?8000:60000);
  try {
    ensureWorker();
    const data={...job.request,id:job.id,imageId:job.imageId},transfers=[];
    if(job.canvas&&residentImage!==job.imageId) {
      const bitmap=await createImageBitmap(job.canvas);
      if(active!==job){bitmap.close();return;}
      data.bitmap=bitmap;transfers.push(bitmap);
    }
    worker.postMessage(data,transfers);
  }catch(error){if(active===job){resetWorker();finish(job,error);schedule();}}
}
function enqueue(canvas,request,progress) {
  const job={id:++sequence,canvas,request,progress,settled:false};
  job.imageId=request.task==='import'?job.id:images.get(canvas);
  if(!job.imageId){job.imageId=job.id;images.set(canvas,job.imageId);}
  const promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});
  if(pending)finish(pending,abort());
  // Model/import work preempts old previews. Routine edits let the active
  // preview finish, avoiding a fresh worker and dependency fetch on every drag.
  if(active&&request.task!=='preview') {
    const previous=active;resetWorker();finish(previous,abort());
  }
  pending=job;schedule();
  return {promise,cancel(){
    if(job.settled)return;
    finish(job,abort());
    if(pending===job){pending=null;clearTimeout(scheduled);}
    if(active===job&&request.task!=='preview'){resetWorker();schedule();}
  }};
}
export function startUploadTask(canvas,request,onProgress=()=>{}) {return enqueue(canvas,request,onProgress);}
export function startUploadFile(file,onProgress=()=>{}) {return enqueue(null,{task:'import',file},onProgress);}
export function registerUploadCanvas(canvas,imageId) {images.set(canvas,imageId);}
export function disposeUploadProcessor() {
  clearTimeout(scheduled);
  if(pending)finish(pending,abort());if(active)finish(active,abort());
  pending=null;resetWorker();
}
