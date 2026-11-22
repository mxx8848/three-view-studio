let sourceCanvas=null,sourceId=null;
self.onmessage=async({data})=>{
  const post=(message,transfers=[])=>self.postMessage({...message,id:data.id},transfers);
  let geometry;
  try {
    if(data.task==='import') {
      post({progress:'正在读取图片…'});
      const decoded=await createImageBitmap(data.file);
      try {
        const scale=Math.min(1,1800/Math.max(decoded.width,decoded.height));
        const width=Math.max(1,Math.round(decoded.width*scale)),height=Math.max(1,Math.round(decoded.height*scale));
        const canvas=new OffscreenCanvas(width,height);
        canvas.getContext('2d').drawImage(decoded,0,0,width,height);
        const thumb=new OffscreenCanvas(Math.min(320,width),Math.max(1,Math.round(height*Math.min(320,width)/width)));
        thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);
        const thumbnail=await thumb.convertToBlob({type:'image/jpeg',quality:.62});
        sourceCanvas=canvas;sourceId=data.imageId;
        const bitmap=await createImageBitmap(canvas);
        post({bitmap,thumbnail,imageId:sourceId,width,height},[bitmap]);
      }finally{decoded.close();}
      return;
    }
    if(data.bitmap) {
      sourceCanvas=new OffscreenCanvas(data.bitmap.width,data.bitmap.height);
      sourceCanvas.getContext('2d').drawImage(data.bitmap,0,0);data.bitmap.close();sourceId=data.imageId;
    }
    if(!sourceCanvas||sourceId!==data.imageId)throw new Error('图片缓存已失效，请重新上传');
    const canvas=sourceCanvas;
    if(data.task==='preview') {
      const [{thresholdSelectedViews},{extractPhotoViews},{smoothProfile},{recoverMeasuredPrimitives,cleanPhotoPaths}]=await Promise.all([import('./recognize.js'),import('./upload-photo-lines.js'),import('./upload-curves.js'),import('./upload-primitives.js')]);
      const previews=[];
      const boxes=Object.fromEntries(data.boxes.map(item=>[item.id,item.box]));
      const extraction=thresholdSelectedViews(canvas,boxes),works=extractPhotoViews(extraction.lineMasks,boxes);
      for(const item of data.boxes) {
        const work=works[item.id];
        const measured=recoverMeasuredPrimitives(work);
        work.paths=measured?measured.paths:cleanPhotoPaths(work.paths.map(p=>p.lt==='v'?{...p,points:smoothProfile(p.points,1.5).points}:p),work);
        const points=work.paths.flatMap(p=>p.points);
        work.blank=!points.length;
        work.reference=work.blank||[0,1].some(axis=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis]))<(axis?work.h:work.w)*.12);
        previews.push({id:item.id,box:item.box,work});
      }
      post({previews});return;
    }
    post({progress:'正在识别线稿、校正轮廓与求解投影…'});
    const {analyzeUpload,analyzeUploadLinework,prepareUploadLesson,outlineInk}=await import('./upload-analysis.js');
    let analysis;
    if(data.task==='refresh'||data.task==='review') {
      const recon=data.recon;recon.modelReady=false;delete recon.modelAttempted;delete recon.answerProjections;
      geometry=prepareUploadLesson(recon,data.linework,undefined,{retainGeometry:true,fitFeatures:(data.task==='review'||recon.profileStructureFit?.unresolved)&&!recon.bodyComponents});
      analysis={ok:true,recon,linework:data.linework};
    } else if(data.task==='recalculate'&&Object.values(data.linework).some(w=>w.paths.some(p=>p.manualType))) {
      // A learner has changed the evidence. Redetect features and measure
      // the frames from that linework instead of reusing yesterday's solid.
      analysis=analyzeUploadLinework(canvas,data.roles,data.linework,{retainGeometry:true,onProgress:progress=>post({progress})});
      geometry=analysis.geometry;delete analysis.geometry;
    } else if(data.task==='recalculate') {
      const {reconstructFromViews}=await import('./reconstruct.js');
      const {alignCircularSilhouetteSize}=await import('./upload-model.js');
      const result=reconstructFromViews({ink:outlineInk(data.linework,data.roles,canvas.width,canvas.height),linework:data.linework,w:canvas.width,h:canvas.height,roles:data.roles,views:Object.values(data.roles)},{res:72});
      if(result.ok)for(const [role,state] of Object.entries(result.viewStates))if(state.kind==='partial'&&!state.closedFrame)result.silhouetteBounds[role]=state.bounds;
      analysis={...result,linework:data.linework};
      if(result.ok) {
        const recon={...result,features:data.recon.features,source:'upload',modelReady:false};alignCircularSilhouetteSize(recon);
        recon.sectionFrames=data.recon.sectionFrames;recon.structureExplanation=data.recon.structureExplanation;
        // Editing a line type must not discard an already solved positive
        // component decomposition and silently revert to silhouette prisms.
        if(data.recon.bodyComponents&&!data.recon.orthogonalGrid) {
          recon.bodyComponents=data.recon.bodyComponents;recon.bodySourceRoles=data.recon.bodySourceRoles;recon.structureFit=data.recon.structureFit;
          recon.bodyBoxes=data.recon.bodyBoxes;recon.completionRole=data.recon.completionRole;recon.profileStructureFit=data.recon.profileStructureFit;
          recon.jointStructureFit=data.recon.jointStructureFit;
          recon.bodyStadia=data.recon.bodyStadia;
          recon.bodyRevolution=data.recon.bodyRevolution;
          recon.bodyProfiles=data.recon.bodyProfiles;
          recon.parallelSections=data.recon.parallelSections;recon.parallelSectionFrames=data.recon.parallelSectionFrames;
          recon.drillInk=data.recon.drillInk;
          if(recon.completionRole)recon.viewStates[recon.completionRole].kind='partial';
        }
        geometry=prepareUploadLesson(recon,data.linework,data.recon.plan.target,{retainGeometry:true,fitFeatures:!!(data.recon.profileStructureFit?.unresolved||data.recon.orthogonalGrid)});analysis.recon=recon;
      }
    } else {
      analysis=analyzeUpload(canvas,data.roles,{retainGeometry:true,onProgress:progress=>post({progress})});
      geometry=analysis.geometry;delete analysis.geometry;
    }
    // Offscreen canvases with contexts cannot be cloned. Return pixel data.
    analysis.thresholded=Object.fromEntries(Object.entries(analysis.thresholded||{}).map(([role,c])=>[role,c.getContext('2d').getImageData(0,0,c.width,c.height)]));
    if(analysis.ok) {
      post({progress:'投影求解完成，正在生成三维实体…'});
      if(!geometry&&analysis.recon.profileStructureFit?.unresolved){post({analysis,geometry:null});return;}
      if(!geometry)throw new Error(analysis.recon.lessonError||'模型生成失败，请校正选框与粗轮廓');
      const attributes=Object.fromEntries(Object.entries(geometry.attributes).map(([name,a])=>[name,{array:a.array,itemSize:a.itemSize,normalized:a.normalized}]));
      post({analysis,geometry:{attributes,index:geometry.index?.array,contourEdges:geometry.userData.uploadSurfaceEdges}},Object.values(attributes).map(a=>a.array.buffer).filter((v,i,all)=>all.indexOf(v)===i).concat(geometry.index?[geometry.index.array.buffer]:[]));
    } else post({analysis});
  } catch(error) {post({error:error.message||String(error)});}
  finally {geometry?.dispose();}
};
