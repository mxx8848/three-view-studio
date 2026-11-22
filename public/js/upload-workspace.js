import { renderUploadBoard, uploadStep, boardLayout } from './upload-board.js';
const NAMES={front:'主视图',top:'俯视图',side:'左视图'};

export function modelVerificationHTML(recon) {
 const check=recon.modelVerification;
 if(!check)return `<p class="recognition-warning">${recon.profileStructureFit?.unresolved?'结构尚未解出，已停止生成未经核对的实体。':'尚未执行实体核对，当前结果不能标记为解题完成。'}</p>`;
 if(check.status==='error')return '<p class="recognition-warning">三视图自动检测未完成，请重新建模。</p>';
 const path=(points,color,width)=>`<path d="${points.map((p,i)=>`${i?'L':'M'}${p[0]*220},${p[1]*180}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
 const inferred=Object.values(check.views).some(v=>v.status==='inferred'||v.partial);
 const pending=recon.assumedPartial?`候选实体：推测${NAMES[recon.assumedPartial]}缺线，请对照题目确认`:'候选实体：仍有孔槽待确认，尚未解题完成';
 return `<details class="model-verification" data-verification-status="${check.status}" ><summary>${check.status==='passed'?(inferred?'✓ 已知图线核对通过；补图待独立验证':'✓ 三视图自动检测通过'):check.status==='candidate'?pending:'候选实体：三视图核对未通过'}</summary>${check.material?.tested?`<p class="hint">实体材料检查：${check.material.status==='passed'?'通过':'失败'}，${check.material.tested} 次三方向射线检测；对比采样点的实际材料与推导出的结构。</p>`:''}<div class="model-verification-views">${['front','side','top'].map(role=>{
 const v=check.views[role];if(!v||v.status==='inferred')return `<div><b>${NAMES[role]} · 待独立核对</b><p>此图由另外两图推导，没有原图可作独立验证。</p></div>`;
 const missing=v.recall.unexplained,extra=v.precision.unexplained;
 return `<div data-verification-role="${role}" data-status="${v.status}"><b>${NAMES[role]} · ${v.status==='passed'?'通过':'不匹配'}</b><p>原图线匹配 ${(v.recall.ratio*100).toFixed(1)}%<br>模型图线有据 ${(v.precision.ratio*100).toFixed(1)}%</p>${v.status==='passed'?'':`<svg viewBox="-8 -8 236 196" aria-label="${NAMES[role]}差异定位">${recon.drawing[role].paths.filter(p=>['v','h'].includes(p.lt)).map(p=>path(p.points,'#b3bfbd',.7)).join('')}${missing.map(l=>path(l.p,'#c45b24',2)).join('')}${extra.map(l=>path(l.p,'#9a3787',2)).join('')}</svg>`}</div>`;
 }).join('')}</div><p class="hint">实际网格回投，分别检查轮廓、内部线和虚实线；橙线表示原图未匹配，紫线表示模型多出的线（显示主要差异）。按源图 2.25 像素容差核对，匹配率不代表唯一解或答案准确率。</p></details>`;
}


function jointReviewHTML(recon) {
 const fit=recon.jointStructureFit;if(!fit||['not-applicable','unsupported'].includes(fit.status))return '';
 const views=fit.audit?.views;
 return `<details class="upload-curve-methods"><summary>两幅已知图的结构核对</summary><p>${fit.selected?(fit.audit.supported?'当前孔槽组合同时通过两幅已知图的核对。':'当前修改后的结构尚未通过两幅已知图的核对。'):fit.status==='ambiguous'?'存在多个补画不同的结构方案，需要补充孔深或连接条件。':'当前结构尚未通过联合核对。'}</p>${views?Object.entries(views).map(([role,v])=>`<p>${NAMES[role]}：已知图线匹配 ${(v.recall.ratio*100).toFixed(1)}%，模型图线有据 ${(v.precision.ratio*100).toFixed(1)}%；分别检查可见实线和隐藏虚线。</p>`).join(''):''}<p>这些数值用于核对图线，不能当作标准答案准确率；当前自动搜索范围为长方体或单圆柱、凸多边形截切及最多三个圆孔组合。</p></details>`;
}

export function uploadPhaseTrack(step) {
  return ['找同名点','作投影线','45° 转向求交','连线辨虚实'].map((label,i)=>`<span class="draft-phase${step.phase===i?' is-current':step.phase>i?' is-done':''}"><i>${i+1}</i>${label}</span>`).join('<span class="draft-phase-arrow" aria-hidden="true">→</span>');
}

export function uploadWorkspaceHTML(recon,linework,index,zoom=1) {
  const layout=boardLayout(recon.modelSize);
  return `<div class="upload-board-toolbar"><div><b>三视图</b><span>点击图线可校正线型</span></div><label class="target-view-label">演示视图 <select id="uploadTargetView">${Object.entries(NAMES).map(([role,name])=>`<option value="${role}" ${recon.plan.target===role?'selected':''}>${name}</option>`).join('')}</select></label><div class="board-zoom"><button class="mini" id="boardZoomOut" aria-label="缩小">−</button><span>${Math.round(zoom*100)}%</span><button class="mini" id="boardZoomIn" aria-label="放大">＋</button></div></div><div class="draft-color-key" aria-label="作图颜色图例"><span><i class="key-known"></i>已知图线</span><span><i class="key-complete"></i>已完成轮廓</span><span><i class="key-current"></i>本次补线</span><span><i class="key-hidden"></i>隐藏边</span><span><i class="key-transfer"></i>深度转向</span><span><i class="key-axis"></i>中心轴线</span></div><div id="uploadPlayerDock"></div><div id="lineEditBar" class="line-edit-bar" hidden></div><div class="upload-board-scroll"><div class="upload-board-paper" style="width:${zoom*100}%;max-width:${65*layout.width/layout.height*zoom}vh">${renderUploadBoard(recon,linework,index)}</div></div><details class="upload-originals"><summary>对照拍摄原图与提取线稿（校正前）</summary><div id="uploadSourceImages"></div></details>`;
}

export function uploadSolutionHTML(recon,index) {
  const plan=recon.plan,current=uploadStep(plan,index);
  return `<section class="upload-step-player" aria-live="polite">
    <div class="upload-step-head"><span class="step-label" id="uploadStepCount">步骤 ${index+1} / ${plan.total}</span></div>
    <div class="draft-navigation"><button class="draft-nav" id="uploadStepPrev" aria-label="上一步" ${index===0?'disabled':''}>‹ 上一步</button><span>左右方向键也可切换</span><button class="draft-nav" id="uploadStepNext" aria-label="下一步" ${index===plan.total-1?'disabled':''}>下一步 ›</button></div><div id="uploadPhaseTrack" class="draft-phase-track">${plan.unresolved?'自动求解未完成':uploadPhaseTrack(current)}</div><b id="uploadStepTitle">${current.title}</b><p id="uploadStepExplain">${current.explain}</p><div class="draft-rule"><b id="uploadStepRule">${current.rule}</b><span id="uploadStepCheck">${current.check}</span></div>${recon.lessonError?'<p class="recognition-warning">尚未生成可信投影；已保留源图线稿，补画与实体等待结构求解。</p>':''}<input class="upload-step-range" id="uploadStepRange" type="range" min="0" max="${plan.total-1}" value="${index}" aria-label="作图进度"/>
    <details class="point-index" ${plan.unresolved?'hidden':''}><summary>跳转到特征点</summary><div class="point-jumps" id="uploadStepProgress"><button class="mini" data-upload-step="0">线稿</button><button class="mini" data-upload-step="1">45° 基准</button>${plan.points.map((p,i)=>`<button class="mini${index>=2+i*4&&index<6+i*4?' active-point':''}" data-upload-step="${2+i*4}">${p.name}</button>`).join('')}<button class="mini" data-upload-step="${plan.total-1}">完成图</button></div></details>
    ${jointReviewHTML(recon)}<details class="upload-curve-methods"><summary>截交线／相贯线怎么求、怎么判断虚实</summary><p>截交线是截平面与实体表面的公共线；先找极限点和转向点，再用素线或辅助截面求一般点。圆柱被斜平面截切时，真实截形通常为椭圆，其各视图投影应按方向求解，不能直接画成圆。</p><p>相贯线是两实体表面的公共线。用辅助平面分别截两表面，两截线的公共点就是相贯点；先求特殊点，再补一般点，按同名点投射到目标视图，依次连接。不要把不属于同一曲线分支的点跨接，也不要把任意相贯线拟合成圆。</p><p>本页补线来自当前候选实体的几何交集和遮挡计算，可见段用实线、不可见段用虚线。曲线种类需结合已知实体确认；两幅轮廓不足以确定的孔槽或相交曲面，请对照原图确认结构。</p><p>教学参考：<a href="https://archive.nptel.ac.in/content/storage2/courses/112103019/module2/lec16/1.html" target="_blank" rel="noopener">NPTEL 正投影与线型</a> · <a href="https://archive.nptel.ac.in/content/storage2/courses/112103019/module3/lec31/1.html" target="_blank" rel="noopener">剖切与截面</a> · <a href="https://archive.nptel.ac.in/content/storage2/courses/112103019/module3/lec33/1.html" target="_blank" rel="noopener">实体相贯：素线法与辅助平面法</a></p></details>
    <div id="uploadBuildControls"><button class="primary" id="btnBuildUploadModel" ${recon.invalidReason?'disabled':''}>${plan.unresolved?'重新核对当前线稿':recon.modelReady?'重新生成三维实体':'根据校正后的线稿生成实体'}</button><button class="ghost" id="uploadReviewModel">核对并更正三视图与模型</button>${recon.projectionReview?`<p class="hint" id="uploadProjectionReview">${recon.projectionReview.verified?'已用实测轮廓核对结构，并检查三视图的遮挡边。':'当前候选尚未通过完整核对，请查看实体上方的逐图差异。'}${Object.entries(recon.projectionReview.views).filter(([,v])=>v.addedHidden).map(([r])=>`${NAMES[r]}有缺失隐藏线，完成图已补画。`).join('')}${recon.projectionReview.unresolved?`仍有 ${recon.projectionReview.unresolved} 个孔槽候选待确认。`:''}</p>`:''}${recon.invalidReason?'<p class="recognition-warning">粗轮廓尚不足以重建，请继续校正线型。</p>':''}</div>
    </section>
    `;
}
