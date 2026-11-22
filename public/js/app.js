// 应用主逻辑：模式切换、题目渲染、上传识别与反推、错题本、原理方法、备注自动保存
import { PROBLEMS, VIEW_NAME, VIEW_NOTE, familyIndex, firstIndexOfFamily, isVerified } from './problems.js';
import { METHOD_GROUPS } from './methods.js';
import { renderViewSVG, renderLegend } from './views2d.js';
import { Viewer } from './viewer3d.js';
import { inferViewRoles, selectedViewRoles } from './view-layout.js';
import { DRAWING_STEPS, lessonView, lessonExplanation, projectionCoordinates } from './drawing-lesson.js';
import { constructionPlan, renderUploadBoard, uploadStep } from './upload-board.js';
import { uploadWorkspaceHTML, uploadSolutionHTML, uploadPhaseTrack, modelVerificationHTML } from './upload-workspace.js';
import { loadData, saveData, getAnonId, SHARE_ONLY } from './api.js';
import { BufferGeometry, BufferAttribute, Vector3 } from 'three';
import { startUploadTask, startUploadFile, registerUploadCanvas, disposeUploadProcessor } from './upload-task.js';
import { observeUploadLoading } from './upload-loading.js';

let importTask=null,importVersion=0,analysisTask=null,previewTask=null,modelTask=null,preparedUploadGeometry=null;
function acceptUploadGeometry(geometry) {
  preparedUploadGeometry?.dispose();preparedUploadGeometry=null;
  if(!geometry)return;
  preparedUploadGeometry=new BufferGeometry();
  for(const [name,a] of Object.entries(geometry.attributes))preparedUploadGeometry.setAttribute(name,new BufferAttribute(a.array,a.itemSize,a.normalized));
  if(geometry.index)preparedUploadGeometry.setIndex(new BufferAttribute(geometry.index,1));
  preparedUploadGeometry.userData.uploadSurfaceEdges=geometry.contourEdges?.map(edge=>({...edge,n:edge.n.map(n=>new Vector3(n.x,n.y,n.z))}));
}
function cancelUploadTasks() {
  analysisTask?.cancel();analysisTask=null;
  previewTask?.cancel();previewTask=null;
  modelTask?.cancel();modelTask=null;
  document.querySelector('#uploadAnalysisStatus')?.setAttribute('hidden','');
  const button=document.querySelector('#btnRecon');if(button)button.disabled=!['front','top','side'].every(role=>state.upload?.roles[role]);
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const state = {
  mode: 'home',
  index: 0,
  revealed: false,
  bank: [],
  notes: {},
  last: null,
  upload: null,
  recon: null,
};

let viewer = null;
let saveTimer = null;
let lessonTimer = null;
let displayedProblem = null;
const VIEWER_UNAVAILABLE = '当前浏览器无法启用 WebGL，三维预览暂不可用。可继续上传图片、框选视图和查看二维作图步骤；如需三维预览，请启用浏览器硬件加速后刷新。';
function stopLesson() { clearInterval(lessonTimer); lessonTimer = null; }

// ------------------------------------------------------------ 持久化
async function pull() {
  if (SHARE_ONLY) return;
  try {
    const r = await loadData();
    state.bank = Array.isArray(r.data?.bank) ? r.data.bank : [];
    state.notes = r.data?.notes || {};
    state.last = r.data?.last || null;
    setAnon(r.uid, r.source, r.expired);
    if (r.expired) toast('距上次访问已超过 30 天，旧数据已按规则清空');
  } catch (e) {
    setAnon(null, 'offline', false);
    toast('离线：数据只保存在本页面，刷新会丢失');
    console.error(e);
  }
  renderBank();
}

function setAnon(uid, source, expired) {
  const dot = $('#anonDot');
  const label = $('#anonLabel');
  if (!uid) {
    dot.className = 'dot warn';
    label.textContent = '本地模式（服务端不可达）';
    return;
  }
  dot.className = expired ? 'dot warn' : 'dot ok';
  const src = { cookie: 'cookie', header: '本地备份', new: '新建', offline: '离线' }[source] || source;
  label.textContent = `匿名 ID ${uid.slice(0, 8)}…（来自${src}）`;
}

function scheduleSave() {
  if (SHARE_ONLY) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(push, 400);
}

async function push() {
  if (SHARE_ONLY) return;
  try {
    await saveData({ bank: state.bank, notes: state.notes, last: state.last });
  } catch (e) {
    console.warn('保存失败', e);
  }
}

// ------------------------------------------------------------ 小工具
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 2800);
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function showStageNotice(message) {
  const host = $('#stage');
  let notice = host.querySelector('.stage-empty');
  if (!notice) {
    notice = el('div', 'stage-empty');
    notice.className = 'stage-empty';
    host.appendChild(notice);
  }
  notice.textContent = message;
}

function hideStageNotice() {
  $('#stage')?.querySelector('.stage-empty')?.remove();
}

// ------------------------------------------------------------ 导航
function switchView(name) {
  stopLesson();
  $('#view-learn').hidden = name !== 'learn';
  $('#view-methods').hidden = name !== 'methods';
  $('#view-bank').hidden = name !== 'bank';
  document.querySelectorAll('[data-nav]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.nav === name);
  });
  if (name === 'bank') renderBank();
  if (name === 'methods') renderMethods();
}

function enterMode(opts = {}) {
  stopLesson();
  state.stepIndex = 0;
  if (!opts.preserveRecon) state.recon = null;
  state.mode = 'to3d';
  if (!opts.keepIndex) {
    state.index = 0;
    state.revealed = false;
  }
  $('#home').hidden = true;
  $('#work').hidden = false;
  const isUploadRecon = state.recon?.source === 'upload';
  $('#workTitle').textContent = isUploadRecon ? '上传图三视图重建' : '三视图综合练习';
  $('.picker').hidden = isUploadRecon;
  $('#qTag').hidden = isUploadRecon;
  state.last = { mode: 'to3d', problemId: PROBLEMS[state.index].id };
  scheduleSave();
  renderPicker();
  renderWork();
  requestAnimationFrame(() => viewer?.resize());
}

function backHome() {
  stopLesson();
  cancelUploadTasks();
  state.mode = 'home';
  state.recon = null;
  $('#home').hidden = false;
  $('#work').hidden = true;
}

// ------------------------------------------------------------ 题目选择（按家族分组）
function renderPicker() {
  const sel = $('#qSelect');
  const groups = familyIndex();
  sel.innerHTML = groups
    .map((g) => {
      const opts = PROBLEMS.slice(g.first, g.first + g.count)
        .map((p, k) => `<option value="${g.first + k}">${p.variant}. ${p.title}</option>`)
        .join('');
      return `<optgroup label="${esc(g.name)}（${g.count}）">${opts}</optgroup>`;
    })
    .join('');
  sel.value = String(state.index);
  const p = PROBLEMS[state.index];
  $('#qIdx').textContent = `${state.index + 1} / ${PROBLEMS.length}`;
  const tag = $('#qTag');
  if (tag) {
    tag.textContent = p ? `${p.tag} · 难度 ${p.level}` : '';
    if (p && !isVerified(p)) {
      tag.textContent += ' · ⚠ 视图待人工复核';
      tag.style.color = '#a8762a';
    } else {
      tag.style.color = '';
    }
  }
}

function selectProblem(i, opts = {}) {
  stopLesson();
  state.index = Math.max(0, Math.min(PROBLEMS.length - 1, i));
  state.revealed = false;
  state.stepIndex = 0;
  const p = PROBLEMS[state.index];
  state.last = { mode: state.mode, problemId: p.id };
  scheduleSave();
  renderPicker();
  renderWork();
  if (opts.scroll !== false) $('#work').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ------------------------------------------------------------ 工作区渲染
function renderWork() {
  const p = PROBLEMS[state.index];
  $('#uploadPlayerDock')?.remove();
  $('#work').classList.toggle('upload-work',state.recon?.source==='upload');
  if(state.recon?.source==='upload'&&!state.recon.modelReady&&!state.recon.modelAttempted&&!state.recon.invalidReason)buildUploadModel(false);
  if (state.recon?.source === 'upload') {
    state.reconStep=Math.max(0,Math.min(state.recon.plan.total-1,state.reconStep||0));
    if(state.reconStep===state.recon.plan.total-1)stopLesson();
  }
  if (!viewer) {
    showStageNotice(VIEWER_UNAVAILABLE);
  } else if (state.recon?.source === 'upload' && !state.recon.modelReady) {
    viewer?.clear();
    displayedProblem = null;
    showStageNotice(state.recon.invalidReason || state.recon.lessonError || '当前结构需校正后才能显示实体');
  } else if (state.recon?.source !== 'upload') {
    hideStageNotice();
    try {
      if (displayedProblem !== p.id) {
        viewer?.setPrims(p.prims);
        displayedProblem = p.id;
      }
    } catch (e) {
      console.error(e);
      toast('三维生成失败：' + e.message);
    }
  }

  $('#dimsLabel').textContent = state.recon?.source === 'upload'
    ? (state.recon.modelReady ? `模型长宽高比例 ${state.recon.modelSize.x.toFixed(3)} : ${state.recon.modelSize.y.toFixed(3)} : ${state.recon.modelSize.z.toFixed(3)}` : '完成作图核对后生成模型')
    : p.dims.label;
  const verification=$('#uploadModelVerification');
  verification.hidden=state.recon?.source!=='upload';
  verification.innerHTML=verification.hidden?'':modelVerificationHTML(state.recon);
  $('#uploadModelHeading').textContent=verification.hidden?'三维实体':state.recon.modelVerification?.status==='passed'?'三维实体 · 已知视图核对通过':'候选实体 · 尚未通过完整核对';
  $('#legend').innerHTML = renderLegend();
  const mhost = $('#qMethods');
  if (mhost) {
    mhost.innerHTML = (p.methods || []).map((m) => `<span class="chip">${esc(m)}</span>`).join('');
  }

  const area = $('#viewsArea');
  area.innerHTML = '';
  area.onclick=null;
  area.classList.toggle('upload-views', state.recon?.source === 'upload');
  area.classList.add('orthographic-layout');
  if (state.recon?.source === 'upload') {
    area.classList.remove('orthographic-layout');
    area.innerHTML = uploadWorkspaceHTML(state.recon,state.upload.linework,state.reconStep||0,state.boardZoom||1);
    for(const role of ['front','top','side']) {
      const box=state.recon.roles[role],row=el('div','upload-source-row',`<b>${VIEW_NAME[role]}</b>`);
      const original=document.createElement('canvas');original.width=Math.ceil(box.w);original.height=Math.ceil(box.h);
      original.getContext('2d').drawImage(state.upload.rec.canvas,box.x,box.y,box.w,box.h,0,0,original.width,original.height);
      row.append(original,state.upload.thresholded[role]);$('#uploadSourceImages').appendChild(row);
    }
    const zoom=(change)=>{state.boardZoom=Math.max(.75,Math.min(3,(state.boardZoom||1)+change));renderWork();};
    $('#boardZoomOut').onclick=()=>zoom(-.25);$('#boardZoomIn').onclick=()=>zoom(.25);
    area.onclick=e=>{const path=e.target.closest('[data-upload-line]');if(!path)return;
      const [role,id]=path.dataset.uploadLine.split(':'),line=state.upload.linework[role].paths.find(p=>String(p.id)===id);
      const bar=$('#lineEditBar');bar.hidden=false;
      if(!line){bar.textContent='这是由多段墨迹拟合出的轮廓。请选中相邻的原图笔画来校正线型。';return;}
      bar.innerHTML=`<b>${VIEW_NAME[role]} · 选中线段</b><label>线型 <select id="uploadLineType"><option value="v">粗实线 · 可见轮廓</option><option value="t">细实线 · 辅助/尺寸线</option><option value="h">虚线 · 遮挡轮廓</option><option value="c">点画线 · 中心轴线</option><option value="ignore">忽略 · 照片杂线</option></select></label><span>粗实线参与外轮廓重建，其余线保留在讲解图中</span>`;
      $('#uploadLineType').value=line.lt;path.classList.add('selected-upload-line');
      $('#uploadLineType').onchange=e=>{line.lt=e.target.value;line.manualType=true;recalculateUpload();};
    };
  } else for (const key of ['front', 'top', 'side']) {
    const block = el('div', 'view-block');
    block.setAttribute('data-view-role', key);
    block.appendChild(el('h4', null, `<b>${VIEW_NAME[key]}</b> <span class="hint">${VIEW_NOTE[key]}</span>`));
    block.insertAdjacentHTML(
      'beforeend',
      renderViewSVG(state.revealed ? lessonView(p.views[key], key, state.stepIndex || 0) : p.views[key], {
        flipX: key === 'side', label: VIEW_NAME[key], showCenters: !state.revealed || state.stepIndex >= 4,
        guides: state.revealed && state.stepIndex < 4 ? {
          x: key === 'side' ? projectionCoordinates(p.views.top, 1) : projectionCoordinates(p.views.front, 0),
          y: key === 'top' ? [0, p.views.top.h] : projectionCoordinates(p.views.front, 1),
        } : null,
      })
    );
    area.appendChild(block);
  }

  const sol = $('#solutionArea');
  // 学习模式与找第三视图模式都可以查看解析
  const uploadRecon = state.recon?.source === 'upload';
  const show = state.revealed || uploadRecon;
  sol.hidden = !show;
  if (show) sol.innerHTML = uploadRecon ? uploadReconstructionHTML(state.recon) : solutionHTML(p);
  if (uploadRecon) {
    const dock=$('#uploadPlayerDock');
    sol.classList.add('teaching-pane');
    $('.work-grid').insertBefore(sol,$('.model-pane'));
    dock.innerHTML='<div class="pane-head"><h3>分步教学</h3><span class="hint">对照左侧图线逐步学习</span></div>';
    dock.appendChild(sol.querySelector('.upload-step-player'));
    sol.prepend(dock);
  } else {
    $('#uploadPlayerDock')?.remove();
    sol.classList.remove('teaching-pane');
    $('.work-grid').after(sol);
  }
  if (show && !uploadRecon) wireSolutionSteps(p);
  if (uploadRecon) wireUploadSteps();

  const oldBar = $('#revealBar');
  if (oldBar) oldBar.remove();
  if (!state.revealed && !uploadRecon) {
    const bar = el('div', 'notes-foot');
    bar.id = 'revealBar';
    bar.style.padding = '0 18px 16px';
    bar.innerHTML = '<span class="hint">先观察三视图与立体关系，再展开作图方法和步骤。</span>';
    const btn = el('button', 'primary', '查看分步解析');
    btn.onclick = () => {
      state.revealed = true;
      renderWork();
    };
    bar.appendChild(btn);
    $('#viewsArea').after(bar);
  }

}

function uploadReconstructionHTML(recon) {
  return uploadSolutionHTML(recon,state.reconStep||0);
}

function wireUploadSteps() {
  const recon=state.recon,index=state.reconStep||0;
  if(index===recon.plan.total-1)stopLesson();
  const go=(i)=>{
    stopLesson();
    state.reconStep=Math.max(0,Math.min(recon.plan.total-1,i));
    if(state.reconStep===recon.plan.total-1)stopLesson();
    $('#uploadStepRange').value=state.reconStep;
    updateStep();
  };
  $('#uploadStepPrev').onclick=()=>go(state.reconStep-1);$('#uploadStepNext').onclick=()=>go(state.reconStep+1);
  const range=$('#uploadStepRange');
  range.draggable=false;
  range.oninput=e=>go(Number(e.target.value));
  // Keep scrubbing on the slider even when the pointer crosses the drawing.
  // Preserve the range's native mouse, touch and keyboard value handling.
  range.onpointerdown=e=>{
    if(e.button!==0||!e.isPrimary)return;
    range.setPointerCapture(e.pointerId);
  };
  range.ondragstart=e=>e.preventDefault();
  const updateStep=()=>{
    const i=state.reconStep,step=uploadStep(recon.plan,i);
    $('.upload-board-paper').innerHTML=renderUploadBoard(recon,state.upload.linework,i);
    $('#uploadStepCount').textContent=`步骤 ${i+1} / ${recon.plan.total}`;
    $('#uploadStepTitle').textContent=step.title;$('#uploadStepExplain').textContent=step.explain;
    $('#uploadStepRule').textContent=step.rule;$('#uploadStepCheck').textContent=step.check;$('#uploadPhaseTrack').innerHTML=uploadPhaseTrack(step);
    $$('#uploadStepProgress [data-upload-step]').forEach(b=>{const start=Number(b.dataset.uploadStep);b.classList.toggle('active-point',start>=2&&i>=start&&i<start+4);});
    $('#uploadStepPrev').disabled=i===0;$('#uploadStepNext').disabled=i===recon.plan.total-1;
    $('#lineEditBar').hidden=true;
  };
  $$('#uploadStepProgress [data-upload-step]').forEach(b=>{b.onclick=()=>go(Number(b.dataset.uploadStep));});
  $('#btnBuildUploadModel').onclick=()=>refreshUploadLesson();
  $('#uploadReviewModel').onclick=()=>updateUploadModel('review');
  $('#uploadTargetView').onchange=e=>{stopLesson();recon.plan=constructionPlan(recon,state.upload.linework,e.target.value);state.reconStep=0;renderWork();};

}

function invalidateUploadModel() {
  stopLesson();
  state.recon.modelReady=false;
  delete state.recon.modelAttempted;
  delete state.recon.answerProjections;
}

function refreshUploadLesson() {return updateUploadModel('refresh');}
function recalculateUpload() {return updateUploadModel('recalculate');}
async function updateUploadModel(taskName) {
  modelTask?.cancel();previewTask?.cancel();previewTask=null;
  const upload=state.upload,recon=state.recon,atEnd=state.reconStep>=recon.plan.total-1;
  invalidateUploadModel();recon.modelAttempted=true;
  const status=$('#uploadModelStatus');status.hidden=false;status.querySelector('span').textContent='正在后台更新模型…';
  viewer?.clear();showStageNotice('正在后台更新模型…');
  let task;
  try {
    task=startUploadTask(upload.rec.canvas,{task:taskName,recon,linework:upload.linework,roles:recon.roles},message=>{status.querySelector('span').textContent=message;});
    modelTask=task;
    $('#uploadCancelModel').onclick=()=>{modelTask?.cancel();modelTask=null;status.hidden=true;showStageNotice('已取消更新，可继续校正或重新计算');};
    const {analysis,geometry}=await task.promise;
    if(modelTask!==task||state.upload!==upload)return;
    if(!analysis.ok)throw new Error(analysis.reason||'粗轮廓不足以重建');
    acceptUploadGeometry(geometry);state.recon=analysis.recon;
    state.reconStep=taskName==='recalculate'?0:taskName==='review'||atEnd?analysis.recon.plan.total-1:Math.min(state.reconStep,analysis.recon.plan.total-1);
    renderWork();
  }catch(error){if(error.name!=='AbortError'){toast('模型未更新：'+error.message);showStageNotice('模型未更新，请校正轮廓或重试');}}
  finally {if(modelTask===task){modelTask=null;status.hidden=true;}}
}

function noteKey() {
  return `${PROBLEMS[state.index].id}:${state.mode}`;
}

function solutionHTML(p) {
  const s = p.solution;
  const methods = (s.methods || [s.method]).map((m) => `<span class="chip">${esc(m)}</span>`).join(' ');

  return `
    <h4>解题过程解析</h4>
    <div class="chips">用的方法：${methods}</div>
    <p class="idea">${esc(s.idea)}</p>
    <section class="step-player" aria-live="polite">
      <div class="step-player-head"><span class="step-label" id="stepCounter"></span><div class="step-controls"><button class="mini" id="stepPlay">自动演示</button><button class="mini" id="stepRestart">重播</button><button class="mini" id="stepPrev" title="上一步" aria-label="上一步">‹</button><button class="mini" id="stepNext" title="下一步" aria-label="下一步">›</button></div></div>
      <h5 id="stepTitle"></h5><p id="stepExplain"></p><div class="step-progress" id="stepProgress"></div>
    </section>
    <details class="problem-analysis"><summary>本题形体分析与作图要点</summary>
      <ol>${s.steps.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
    </details>
    <h4>三面尺寸对应</h4>
    <table class="pt-table"><thead><tr><th>尺寸</th><th>对应视图</th><th>数值</th></tr></thead>
    <tbody><tr><td>长对正</td><td>主视图 ↔ 俯视图</td><td>${p.views.front.w}</td></tr>
    <tr><td>高平齐</td><td>主视图 ↔ 左视图</td><td>${p.views.front.h}</td></tr>
    <tr><td>宽相等</td><td>俯视图 ↔ 左视图</td><td>${p.views.top.h}</td></tr></tbody></table>

    <h4>投影关系核对</h4>
    <ul class="checks">${s.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>

    <h4>易错点</h4>
    <ul class="pits">${s.pitfalls.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>

    <p class="hint">想看完整方法体系？切到顶部「原理方法」。</p>
  `;
}

function wireSolutionSteps(problem) {
  const steps = DRAWING_STEPS;
  const index = state.stepIndex = Math.max(0, Math.min(state.stepIndex || 0, steps.length - 1));
  if (index === steps.length - 1) stopLesson();
  $('#stepCounter').textContent = `作图步骤 ${index + 1} / ${steps.length}`;
  $('#stepTitle').textContent = steps[index].title;
  $('#stepExplain').textContent = lessonExplanation(problem, index);
  $('#stepProgress').innerHTML = steps.map((step, i) => `<button type="button" class="step-dot ${i === index ? 'active' : i < index ? 'done' : ''}" data-go-step="${i}" aria-label="第 ${i + 1} 步：${step.title}" aria-current="${i === index ? 'step' : 'false'}"></button>`).join('');
  $$('#viewsArea [data-view-role]').forEach(block => block.classList.toggle('step-focus', steps[index].roles.includes(block.dataset.viewRole)));
  $('#stepPrev').disabled = index === 0;
  $('#stepNext').disabled = index === steps.length - 1;
  const go = (i) => { stopLesson(); state.stepIndex = i; renderWork(); };
  $('#stepPrev').onclick = () => go(index - 1);
  $('#stepNext').onclick = () => go(index + 1);
  $('#stepRestart').onclick = () => go(0);
  $('#stepPlay').textContent = lessonTimer ? '暂停演示' : '自动演示';
  $('#stepPlay').onclick = () => {
    if (lessonTimer) { stopLesson(); renderWork(); return; }
    if (index === steps.length - 1) state.stepIndex = 0;
    lessonTimer = setInterval(() => { state.stepIndex += 1; renderWork(); }, 3200);
    renderWork();
  };
  $$('#stepProgress [data-go-step]').forEach(button => { button.onclick = () => go(Number(button.dataset.goStep)); });
}

// ------------------------------------------------------------ 原理方法集锦
function renderMethods() {
  const host = $('#methodsList');
  host.innerHTML = METHOD_GROUPS.map(
    (g) => `
    <div class="mgroup">
      <h2>${esc(g.group)}</h2>
      ${g.methods
        .map(
          (m) => `
        <article class="method" id="m-${m.id}">
          <h3>${esc(m.name)}</h3>
          <p class="basis">${esc(m.basis)}</p>
          <div class="mcols">
            <div>
              <h4>怎么做</h4>
              <ol>${m.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>
            </div>
            <div>
              <h4>易错点</h4>
              <ul class="pits">${m.traps.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
            </div>
          </div>
          <h4>三个例子</h4>
          <div class="examples">
            ${(() => {
              // 例子的三级解析：① 按方法名匹配 ② 按相关特征匹配 ③ 兜底取题库前几题
              // 这样任何方法下的按钮都不会是灰的、点了都能跳到真题
              const FEATURE_FOR = {
                辅助球面法: 'crossCyl',
                '相贯线的特殊情况': 'crossCyl',
                '素线法（表面取点法）': 'chamfer',
              };
              const pickBy = (fn) => {
                const out = [];
                const seen = new Set();
                for (let i = 0; i < PROBLEMS.length && out.length < 3; i += 1) {
                  const p = PROBLEMS[i];
                  if (!fn(p)) continue;
                  if (seen.has(p.title)) continue;
                  seen.add(p.title);
                  out.push(i);
                }
                return out;
              };
              let picks = pickBy((p) => (p.solution?.methods || []).includes(m.name));
              if (!picks.length) {
                const feat = FEATURE_FOR[m.name];
                if (feat) picks = pickBy((p) => (p.features || []).includes(feat));
              }
              if (!picks.length) picks = [0, 1, 2].filter((i) => i < PROBLEMS.length);
              return picks
                .map(
                  (i) => `<button class="example" data-jump="${i}">
                    <b>${esc(PROBLEMS[i].title)}</b><span>${esc(PROBLEMS[i].tag)}</span>
                  </button>`
                )
                .join('');
            })()}
          </div>
        </article>`
        )
        .join('')}
    </div>`
  ).join('');

  host.querySelectorAll('[data-jump]').forEach((b) => {
    b.onclick = () => {
      switchView('learn');
      state.index = Number(b.dataset.jump);
      state.revealed = true;
      enterMode({ keepIndex: true });
      $('#work').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('已跳转到该题型并展开解析');
    };
  });
}

// ------------------------------------------------------------ 上传 / 识别 / 反推
const selectionCursor = 'url("/selection-cursor.svg") 16 16, crosshair';
function syncSelectionRoles() {
  const upload = state.upload;
  upload.roles = selectedViewRoles(upload.selectionBoxes, upload.blankRole).roles || {};
}

function wireUpload() {
  const dz = $('#uploadCard');
  const input = $('#fileInput');
  $('#uploadReplaceImage').onclick=()=>input.click();
  $('#uploadCamera').onclick=()=>$('#cameraInput').click();
  $('#dropZone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}});
  let dragDepth = 0;
  for(const source of [input,$('#cameraInput')]) {
  source.dataset.uploadReady='true';
  source.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    source.value = '';
  });
  }
  dz.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragDepth += 1;
      dz.classList.add('hot');
  });
  dz.addEventListener('dragover', (e) => e.preventDefault());
  dz.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dz.classList.remove('hot');
  });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dz.classList.remove('hot');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  const canvas = $('#previewCanvas');
  let start = null,editing=null;
  let panMode=false,panStart=null,activePointer=null;
  const panButton=$('#uploadImagePan');
  panButton.onclick=()=>{
    panMode=!panMode;
    panButton.setAttribute('aria-pressed',String(panMode));
    panButton.textContent=panMode?'返回框选':'移动图片';
    canvas.style.cursor=panMode?'grab':selectionCursor;
  };
  let imageZoom=1;
  const zoomImage=(value,anchor)=>{
    const host=canvas.closest('.upload-preview-scroll'),before=canvas.getBoundingClientRect(),hr=host.getBoundingClientRect();
    const focus=anchor||{x:hr.left+host.clientWidth/2,y:hr.top+host.clientHeight/2};
    const u=(focus.x-before.left)/(before.width||1),v=(focus.y-before.top)/(before.height||1);
    imageZoom=Math.max(.5,Math.min(4,value));
    const width=Math.max(1,host.clientWidth-2),height=Math.max(1,host.clientHeight-2);
    canvas.style.width=`${Math.min(width,height*canvas.width/canvas.height)*imageZoom}px`;
    const after=canvas.getBoundingClientRect();host.scrollLeft+=after.left+u*after.width-focus.x;host.scrollTop+=after.top+v*after.height-focus.y;
    $('#uploadImageZoomValue').textContent=`${Math.round(imageZoom*100)}%`;
    drawSelection();
  };
  new ResizeObserver(()=>{if(!canvas.hidden)zoomImage(imageZoom);}).observe(canvas.closest('.upload-preview-scroll'));
  $('#uploadImageZoomIn').onclick=()=>zoomImage(imageZoom+.25);
  $('#uploadImageZoomOut').onclick=()=>zoomImage(imageZoom-.25);
  $('#uploadImageFit').onclick=()=>{zoomImage(1);canvas.closest('.upload-preview-scroll').scrollTo(0,0);};
  canvas.closest('.upload-preview-scroll').addEventListener('wheel',e=>{
    if(!state.upload||start)return;
    e.preventDefault();zoomImage(imageZoom*Math.exp(-e.deltaY*.0015),{x:e.clientX,y:e.clientY});
  },{passive:false});
  const hitSelection=p=>{
    const tolerance=10*canvas.width/canvas.getBoundingClientRect().width;
    for(const item of [...(state.upload?.selectionBoxes||[])].reverse()) {
      const b=item.box,nearX=Math.abs(p.x-b.x)<tolerance?'w':Math.abs(p.x-b.x-b.w)<tolerance?'e':'',nearY=Math.abs(p.y-b.y)<tolerance?'n':Math.abs(p.y-b.y-b.h)<tolerance?'s':'';
      const margin=tolerance*.25;
      if(p.x>=b.x-margin&&p.x<=b.x+b.w+margin&&p.y>=b.y-margin&&p.y<=b.y+b.h+margin)return {item,original:{...b},handle:nearY+nearX||'move'};
    }
    return null;
  };
  const updateCursor=p=>{
    if(panMode){canvas.style.cursor=panStart?'grabbing':'grab';return;}
    const handle=editing?.handle||hitSelection(p)?.handle;
    canvas.style.cursor=handle==='move'?(start?'grabbing':'grab'):handle?`${handle}-resize`:selectionCursor;
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (importTask||!state.upload?.rec?.canvas||activePointer!==null||e.button>0) return;
    e.preventDefault();
    activePointer=e.pointerId;
    if(e.isTrusted)canvas.setPointerCapture(e.pointerId);
    if(panMode){const host=canvas.closest('.upload-preview-scroll');panStart={x:e.clientX,y:e.clientY,left:host.scrollLeft,top:host.scrollTop};updateCursor();return;}
    start = canvasPoint(e, canvas);
    editing=hitSelection(start);
    if(!editing&&state.upload.selectionBoxes.length>=(state.upload.blankRole?2:3)){start=null;return;}
    cancelUploadTasks();
    updateCursor(start);
    state.upload.dragBox = { x: start.x, y: start.y, w: 0, h: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    if(!state.upload)return;
    if(activePointer!==null&&e.pointerId!==activePointer)return;
    if(panStart){const host=canvas.closest('.upload-preview-scroll');host.scrollLeft=panStart.left+panStart.x-e.clientX;host.scrollTop=panStart.top+panStart.y-e.clientY;return;}
    const p = canvasPoint(e, canvas);
    updateCursor(p);
    if(!start)return;
    if(editing) {
      const b=editing.original,dx=p.x-start.x,dy=p.y-start.y,h=editing.handle;
      let x=b.x,y=b.y,right=b.x+b.w,bottom=b.y+b.h;
      if(h==='move'){x=Math.max(0,Math.min(canvas.width-b.w,x+dx));y=Math.max(0,Math.min(canvas.height-b.h,y+dy));right=x+b.w;bottom=y+b.h;}
      else {if(h.includes('w'))x=Math.min(right-12,Math.max(0,x+dx));if(h.includes('e'))right=Math.max(x+12,Math.min(canvas.width,right+dx));if(h.includes('n'))y=Math.min(bottom-12,Math.max(0,y+dy));if(h.includes('s'))bottom=Math.max(y+12,Math.min(canvas.height,bottom+dy));}
      editing.item.box={x,y,w:right-x,h:bottom-y};
      state.upload.dragBox=null;
    } else state.upload.dragBox = normalizeBox(start, p);
    drawSelection();
  });
  const finish = (e) => {
    if(e.pointerId!==activePointer)return;
    activePointer=null;
    if(panStart){panStart=null;updateCursor();return;}
    if (!start || !state.upload) return;
    const p = canvasPoint(e, canvas);
    const rect = editing?editing.item.box:normalizeBox(start, p);
    // Commit selections to source-pixel boundaries. Pointer/CSS conversions
    // can turn e.g. y=40 into 39.999999999; floor/ceil cropping would then
    // add an unintended row and change thinning, datums and the fitted solid.
    const right=Math.round(rect.x+rect.w),bottom=Math.round(rect.y+rect.h);
    rect.x=Math.round(rect.x);rect.y=Math.round(rect.y);
    rect.w=right-rect.x;rect.h=bottom-rect.y;
    start = null;
    state.upload.dragBox = null;
    if (rect.w < 12 || rect.h < 12) {
      toast('框选区域太小，请重新拖动框选');
      drawSelection();
      return;
    }
    const overlaps = state.upload.selectionBoxes.some(item => item!==editing?.item&&boxesOverlap(rect, item.box));
    if (overlaps) {
      toast('视图区域不能重叠，请调整框选范围');
      if(editing)editing.item.box=editing.original;
      editing=null;
      syncSelectionRoles();
      drawSelection();
      return;
    }
    if(!editing)state.upload.selectionBoxes.push({ id: state.upload.nextBoxId++, box: rect });
    else {delete editing.item.preview;delete editing.item.previewError;}
    editing=null;
    updateCursor(p);
    syncSelectionRoles();
    renderRecog(state.upload.rec);
    drawSelection();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointerleave',()=>{if(!start)canvas.style.cursor=selectionCursor;});
  canvas.addEventListener('pointercancel',e=>{if(e.pointerId!==activePointer)return;activePointer=null;panStart=null;if(editing)editing.item.box=editing.original;editing=null;start=null;canvas.style.cursor=panMode?'grab':selectionCursor;if(state.upload){state.upload.dragBox=null;syncSelectionRoles();}drawSelection();});
}

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height)),
  };
}

function normalizeBox(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function boxesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function drawSelection() {
  const upload = state.upload;
  if (!upload?.rec?.canvas) return;
  const canvas = $('#previewCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(upload.rec.canvas, 0, 0);
  const overlay=$('#uploadSelectionOverlay'),scale=canvas.width/Math.max(1,canvas.getBoundingClientRect().width),shapes=[];
  overlay.setAttribute('viewBox',`0 0 ${canvas.width} ${canvas.height}`);
  const colors = { front: '#167d8d', top: '#bc5b42', side: '#668543' };
  const roleNames = { front: '主视图', top: '俯视图', side: '左视图' };
  const boxes = upload.selectionBoxes || [];
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i].box;
    const role = Object.entries(upload.roles).find(([, value]) => value === box)?.[0];
    const color = colors[role] || ['#167d8d', '#bc5b42', '#668543'][i];
    shapes.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="${color}0c" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    const handle=9*scale;
    for(const x of [box.x,box.x+box.w])for(const y of [box.y,box.y+box.h])shapes.push(`<rect x="${x-handle/2}" y="${y-handle/2}" width="${handle}" height="${handle}" fill="white" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    const label = role ? roleNames[role] : `区域 ${i + 1}`;
    shapes.push(`<rect x="${box.x}" y="${box.y}" width="${(label.length*14+14)*scale}" height="${25*scale}" fill="${color}"/><text x="${box.x+7*scale}" y="${box.y+18*scale}" fill="white" font-size="${14*scale}" font-family="sans-serif" font-weight="600">${label}</text>`);
  }
  if (upload.dragBox) {
    const b=upload.dragBox;shapes.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#167d8d" stroke-width="2" stroke-dasharray="8 5" vector-effect="non-scaling-stroke"/>`);
  }
  overlay.innerHTML=shapes.join('');
}

async function handleFile(file) {
  if (!file.type.startsWith('image/')&&!/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) return toast('请选择图片文件');
  clearTimeout(toastTimer);$('#toast').hidden=true;
  const version=++importVersion;
  importTask?.cancel();importTask=null;
  cancelUploadTasks();preparedUploadGeometry?.dispose();preparedUploadGeometry=null;
  const status=$('#uploadImportStatus');status.hidden=false;
  status.classList.remove('has-error');$('#uploadCancelImport').textContent='取消读取';
  status.querySelector('span').textContent='正在后台读取图片，可取消或选择另一张…';
  $('#uploadCancelImport').onclick=()=>{
    ++importVersion;importTask?.cancel();importTask=null;status.hidden=true;
  };
  let bitmap;
  try {
    importTask=startUploadFile(file,message=>{if(version===importVersion)status.querySelector('span').textContent=message;});
    let result;
    try {result=await importTask.promise;}
    catch(error) {
      if(error.name==='AbortError')throw error;
      status.querySelector('span').textContent='正在使用兼容方式读取图片…';
      result=await readUploadImage(file);
    }
    bitmap=result.bitmap;
    if(version!==importVersion)return;
    const original=document.createElement('canvas');original.width=result.width;original.height=result.height;
    original.getContext('2d').drawImage(bitmap,0,0);bitmap.close?.();bitmap=null;
    if(result.imageId)registerUploadCanvas(original,result.imageId);
    // Import only prepares pixels. Recognition is useful after users select
    // views; full-image statistics and bank matching delayed the first frame.
    const rec={ok:true,width:result.width,height:result.height,canvas:original};
    if(state.upload?.originalURL)URL.revokeObjectURL(state.upload.originalURL);
    state.upload = { file, rec, thumb:null,roles:{},selectionBoxes:[],nextBoxId:0,originalURL:URL.createObjectURL(file) };
    const originalPreview=$('#uploadOriginalPreview');originalPreview.hidden=true;
    originalPreview.onload=()=>{originalPreview.hidden=false;};originalPreview.onerror=()=>{originalPreview.hidden=true;};
    originalPreview.src=state.upload.originalURL;
    const uploaded=state.upload;
    const reader=new FileReader();
    reader.onload=()=>{if(state.upload===uploaded)uploaded.thumb=reader.result;};
    if(result.thumbnail)reader.readAsDataURL(result.thumbnail);
    $('#uploadCard').classList.add('has-image');
    $('#dropZone').hidden=true;
    state.recon = null;
    const cv = $('#previewCanvas');
    $('#uploadImageEditor').hidden=false;
    cv.style.cursor=selectionCursor;
    cv.width = rec.width;
    cv.height = rec.height;
    cv.hidden = false;
    $('#uploadImageFit').click();
    cv.getContext('2d').drawImage(rec.canvas, 0, 0);
    renderRecog(rec);
    drawSelection();
  } catch (error) {
    if(error.name==='AbortError'||version!==importVersion)return;
    console.error(error);
    status.classList.add('has-error');status.querySelector('span').textContent='图片读取失败：'+error.message+'。请重新选择图片。';
    $('#uploadCancelImport').textContent='关闭提示';
    toast('图片无法读取：'+error.message);
  } finally {
    bitmap?.close?.();
    if(version===importVersion){importTask=null;if(!status.classList.contains('has-error'))status.hidden=true;}
  }
}

// HTMLImageElement decoding is asynchronous and supported when Edge's worker
// bitmap decoder/OffscreenCanvas path is unavailable or fails to initialize.
async function readUploadImage(file) {
  const url=URL.createObjectURL(file),image=new Image();
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('图片解码超时')),15000);
      image.onload=()=>{clearTimeout(timer);resolve();};
      image.onerror=()=>{clearTimeout(timer);reject(new Error('无法解码此图片，请检查 PNG 文件是否完整'));};
      image.src=url;
    });
    const scale=Math.min(1,1800/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    return {bitmap:canvas,width:canvas.width,height:canvas.height};
  }finally{URL.revokeObjectURL(url);}
}

function renderRecog(rec) {
  const box = $('#recogBox');
  box.hidden = false;
  if (!rec.ok) {
    box.innerHTML = `<div class="recognition-warning">${esc(rec.reason)} 仍可在原图上框选三个视图区域。</div>`;
    renderSelectionControls(box);
    return;
  }
  box.innerHTML =
    `<div class="selection-head"><div><h3>框选视图，立即预览</h3></div>
      <p class="hint">拖动框内可移动，拖动边角可缩放。选择下方“空白（待求）”可只框另外两图；图片带紫色补画答案时，把答案所在视图设为待求，不框入答案。</p></div>`;
  renderSelectionControls(box);
}

function renderSelectionControls(box) {
  const names = { front: '主视图', top: '俯视图', side: '左视图' };
  const roles = state.upload.roles || {};
  const boxes = state.upload.selectionBoxes || [];
  const blankRole = state.upload.blankRole || '';
  const expected = blankRole ? 2 : 3;
  const inferred = selectedViewRoles(boxes, blankRole);
  const ready = boxes.length === expected && inferred.score >= 5 && ['front', 'top', 'side'].every((key) => roles[key]);
  const roleByBox = new Map(Object.entries(inferred.roles || {}).map(([role, region]) => [region, role]));
  const boxRows = boxes.map((item, i) => {
    const role = roleByBox.get(item.box);
    const label = blankRole ? `<select data-selection-role="${item.id}" aria-label="区域 ${i+1} 的视图">${Object.entries(names).filter(([key])=>key!==blankRole).map(([key,name])=>`<option value="${key}" ${role===key?'selected':''}>${name}</option>`).join('')}</select>` : role ? names[role] : '等待自动归位';
    const work=item.preview;
    if(!work)return `<div class="selection-result" data-selection-id="${item.id}" data-bounds="${[item.box.x,item.box.y,item.box.w,item.box.h].join(',')}"><div class="selected-region"><span>区域 ${i+1}</span><b>${label}</b><button type="button" data-remove-box="${item.id}" aria-label="移除区域 ${i+1}">×</button></div><div class="selection-line-preview hint">${item.previewError?'预览暂不可用，仍可调整选框': '后台识别线稿中，选框可继续调整…'}</div></div>`;
    const types={v:['实线','#263238'],h:['虚线','#a23c87'],c:['中心线','#3476c6'],t:['细线','#4d7280']};
    const legend=Object.entries(types).filter(([k])=>work.paths.some(p=>p.lt===k)).map(([,v])=>`<span style="color:${v[1]}">${v[0]}</span>`).join(' · ');
    return `<div class="selection-result" data-selection-id="${item.id}" data-bounds="${[item.box.x,item.box.y,item.box.w,item.box.h].join(',')}"><div class="selected-region"><span>区域 ${i + 1}</span><b>${label}</b><small>${work.paths.length} 段图线</small><button type="button" data-remove-box="${item.id}" title="移除此框" aria-label="移除区域 ${i + 1}">×</button></div><svg class="selection-line-preview" viewBox="0 0 ${work.w} ${work.h}" aria-label="区域 ${i+1} 识别线稿">${work.paths.map(p=>`<path d="${p.points.map((q,j)=>`${j?'L':'M'}${q.join(',')}`).join(' ')}" fill="none" stroke="${types[p.lt]?.[1]||'#8196a0'}" stroke-width="${p.lt==='v'?2:1}" vector-effect="non-scaling-stroke"/>`).join('')}</svg><small>${legend}</small>${work.blank?'<span class="hint">空白视图 · 由另外两图自主补全</span>':work.reference?'<span class="hint">参照线区域 · 由另外两图求解补画</span>':''}</div>`;
  }).join('');
  const controls = document.createElement('div');
  controls.className = 'selection-controls';
  controls.innerHTML = `<label class="selection-missing">要补画哪幅图？<select id="uploadBlankView" aria-label="指定空白或部分缺线的视图"><option value="">自动判断 · 框选三图</option><optgroup label="整幅空白，只框另两图">${Object.entries(names).map(([key,name])=>`<option value="${key}" ${blankRole===key?'selected':''}>${name} · 不需要框选</option>`).join('')}</optgroup><optgroup label="部分缺线，框选全部三图">${Object.entries(names).map(([key,name])=>`<option value="partial-${key}" ${state.upload.partialRole===key?'selected':''}>${name} · 保留题目已有线</option>`).join('')}</optgroup></select></label><div class="selection-status">${Object.entries(names).map(([key, name]) => {
    const region = roles[key];
    const index = region ? boxes.findIndex((item) => item.box === region) + 1 : 0;
    return `<div class="selection-chip ${region ? 'complete' : ''}"><span>${name}</span><b>${key===blankRole?'空白（待求）· 无需框选':region ? `区域 ${index} · ${Math.round(region.w)} × ${Math.round(region.h)}` : '待框选'}</b></div>`;
  }).join('')}</div>
    ${boxRows ? `<div class="selected-regions">${boxRows}</div>` : ''}
    <div class="selection-actions"><button class="ghost" id="btnClearSelections" ${boxes.length ? '' : 'disabled'}>清除选框</button><button class="primary" id="btnRecon" ${ready ? '' : 'disabled'}>开始补画与建模 →</button></div>
    <div class="upload-analysis-status" id="uploadAnalysisStatus" role="status" hidden><span></span><button class="ghost" id="uploadCancelAnalysis">取消计算</button></div>
    <p class="hint">已框选 ${boxes.length} / ${expected}。${blankRole?'待求图由另外两图求解；请核对每个区域的视图名称，可用下拉框交换。':'下方与右侧视图按布局自动归位。'}框选区域不应重叠，尽量包含完整外轮廓。</p>
    ${!blankRole && boxes.length === 3 && inferred.score < 5 ? '<p class="recognition-warning">三个框的投影对齐关系不明显，暂不生成模型。请确认主视图在左上、俯视图在其下方、左视图在主视图右方，并重框区域。</p>' : ''}`;
  box.appendChild(controls);
  controls.querySelector('#uploadBlankView').onchange = event => {
    cancelUploadTasks();
    const upload=state.upload, value=event.target.value,next=value.startsWith('partial-')?'':value;
    upload.partialRole=value.startsWith('partial-')?value.slice(8):'';
    if(next&&boxes.length===3) {
      const previous=inferViewRoles(boxes.map(item=>item.box)).roles||{};
      upload.selectionBoxes=boxes.filter(item=>item.box!==previous[next]);
      for(const item of upload.selectionBoxes)item.role=Object.keys(previous).find(key=>previous[key]===item.box);
    } else for(const item of boxes)delete item.role;
    upload.blankRole=next;syncSelectionRoles();renderRecog(upload.rec);drawSelection();
  };
  controls.querySelectorAll('[data-selection-role]').forEach(select=>{select.onchange=()=>{
    cancelUploadTasks();
    const item=boxes.find(item=>item.id===Number(select.dataset.selectionRole));
    item.role=select.value;
    for(const other of boxes.filter(other=>other!==item))other.role=Object.keys(names).find(role=>role!==blankRole&&role!==item.role);
    syncSelectionRoles();renderRecog(state.upload.rec);drawSelection();
  };});
  controls.querySelector('#btnClearSelections').onclick = () => {
    cancelUploadTasks();
    state.upload.selectionBoxes = [];
    state.upload.roles = {};
    renderRecog(state.upload.rec);
    drawSelection();
  };
  controls.querySelector('#btnRecon').onclick = () => runReconstruct();
  controls.querySelector('#uploadCancelAnalysis').onclick=()=>{cancelUploadTasks();renderRecog(state.upload.rec);};
  controls.querySelectorAll('[data-remove-box]').forEach((button) => {
    button.onclick = () => {
      cancelUploadTasks();
      state.upload.selectionBoxes = state.upload.selectionBoxes.filter((item) => item.id !== Number(button.dataset.removeBox));
      syncSelectionRoles();
      renderRecog(state.upload.rec);
      drawSelection();
    };
  });
  const pending=boxes.filter(item=>!item.preview&&!item.previewError);
  if(pending.length&&!analysisTask) {
    previewTask?.cancel();
    const upload=state.upload,task=startUploadTask(upload.rec.canvas,{task:'preview',boxes:pending.map(({id,box})=>({id,box}))});
    previewTask=task;
    task.promise.then(({previews})=>{
      if(previewTask!==task||state.upload!==upload)return;
      previewTask=null;
      for(const p of previews){const item=upload.selectionBoxes.find(item=>item.id===p.id&&JSON.stringify(item.box)===JSON.stringify(p.box));if(item)item.preview=p.work;}
      renderRecog(upload.rec);
    }).catch(error=>{
      if(error.name==='AbortError'||state.upload!==upload||previewTask!==task)return;
      previewTask=null;for(const item of pending)item.previewError=true;renderRecog(upload.rec);
    });
  }
}

async function runReconstruct() {
  if(importTask)return toast('图片正在读取，请稍候或取消读取');
  const rec = state.upload?.rec;
  if (!rec?.canvas) return toast('没有可用的图像数据，请重新上传');
  const roles = state.upload?.roles || {};
  if (!['front', 'top', 'side'].every((role) => roles[role])) {
    return toast('请先分别框选主视图、俯视图和左视图');
  }
  if(analysisTask)return;
  previewTask?.cancel();previewTask=null;
  const upload=state.upload,status=$('#uploadAnalysisStatus'),button=$('#btnRecon');
  status.hidden=false;status.querySelector('span').textContent='正在后台识别与建模，可以取消或继续修改选框…';button.disabled=true;
  let task;
  try {
    const selected={...roles};
    if(upload.partialRole)selected[upload.partialRole]={...roles[upload.partialRole],partial:true};
    task=startUploadTask(rec.canvas,{task:'analyze',roles:selected},message=>{status.querySelector('span').textContent=message;});
    analysisTask=task;
    const {analysis,geometry}=await task.promise;
    if(analysisTask!==task||state.upload!==upload)return;
    if(!analysis.ok){toast(analysis.reason);return;}
    upload.thresholded=Object.fromEntries(Object.entries(analysis.thresholded).map(([role,image])=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').putImageData(image,0,0);return [role,c];}));
    upload.linework=analysis.linework;
    acceptUploadGeometry(geometry);
    state.recon=analysis.recon;state.reconStep=0;
    enterMode({preserveRecon:true});
    toast(analysis.recon.profileStructureFit?.unresolved?'自动求解未完成，已保留已知图线；请查看具体原因。':analysis.recon.modelVerification?.status==='passed'?'模型已生成，已知视图回投核对通过；请查看详细检查结果。':'当前仅为候选实体，三视图核对未通过，请查看模型上方的差异。');
  }catch(error){if(error.name!=='AbortError'){toast('建模未完成：'+error.message);console.error(error);}}
  finally {if(analysisTask===task){analysisTask=null;status.hidden=true;button.disabled=false;}}
}

function buildUploadModel(render=true) {
  const recon=state.recon;if(!recon||recon.source!=='upload')return;
  recon.modelAttempted=true;
  if(recon.profileStructureFit?.unresolved){viewer?.clear();showStageNotice(recon.lessonError);return;}
  if(!viewer)return toast(VIEWER_UNAVAILABLE);
  if(recon.invalidReason)return toast(recon.invalidReason);
  try {
    if(!preparedUploadGeometry){refreshUploadLesson();return;}
    const geometry=preparedUploadGeometry;preparedUploadGeometry=null;
    recon.answerProjections=recon.lessonProjections;
    viewer.setWire(true);$('#chkWire').checked=true;
    viewer.setGeometry(geometry,{color:0x83aaa4,edgeAngle:30,repairJunctions:true,fitPadding:1.25,contourEdges:geometry.userData.uploadSurfaceEdges});
    displayedProblem=null;recon.modelReady=true;hideStageNotice();
    if(render)renderWork();
    $('#dimsLabel').textContent=`长 : 宽 : 高 = ${recon.modelSize.x.toFixed(3)} : ${recon.modelSize.y.toFixed(3)} : ${recon.modelSize.z.toFixed(3)} · 轮廓曲面求交`;
  } catch(error) {toast('模型需校正：'+error.message);console.error(error);}
}

// ------------------------------------------------------------ 错题本
function askStore(meta = {}) {
  if (SHARE_ONLY) return;
  const dlg = $('#askDialog');
  const p = PROBLEMS[state.index];
  $('#askWhat').textContent =
    meta.reason === 'upload'
      ? `刚上传的照片（识别到 ${state.upload?.rec?.viewCount ?? '?'} 块视图区域） · 当前题目：${p.title}`
      : meta.reason === 'recon'
        ? `刚完成三视图反推（${state.recon?.res}³ 体素） · 当前题目：${p.title}`
        : `当前题目：${p.title}（${p.tag}）`;
  dlg.showModal();
  dlg.onclose = () => {
    if (dlg.returnValue === 'yes') storeCurrent(meta);
  };
}

function storeCurrent(meta) {
  const p = PROBLEMS[state.index];
  const item = {
    id: `b${Date.now()}`,
    at: Date.now(),
    mode: state.mode === 'home' ? 'to3d' : state.mode,
    problemId: p.id,
    title: p.title,
    tag: p.tag,
    family: p.family,
    dims: p.dims.label,
    note: (state.notes[noteKey()] || '').trim(),
    source: meta.reason === 'upload' ? 'upload' : meta.reason === 'recon' ? 'recon' : 'generate',
    thumb: state.upload?.thumb || null,
    recog: state.upload?.rec?.strokes
      ? {
          viewCount: state.upload.rec.viewCount,
          thickPct: state.upload.rec.strokes.thickPct,
          dashPct: state.upload.rec.strokes.dashPct,
          confidence: state.upload.rec.confidence,
        }
      : null,
  };
  state.bank.unshift(item);
  scheduleSave();
  renderBank();
  toast('已存入错题本');
}

function renderBank() {
  $('#bankCount').textContent = String(state.bank.length);
  const list = $('#bankList');
  const empty = $('#bankEmpty');
  if (!state.bank.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = state.bank
    .map(
      (it) => `
    <button class="card" data-id="${it.id}">
      <span class="tag">${esc(it.tag)} · ${{ upload: '上传题', recon: '反推题', generate: '生成题' }[it.source] || ''}</span>
      <span class="title">${esc(it.title)}</span>
      ${it.thumb ? `<span class="thumb"><img alt="上传截图" src="${it.thumb}"></span>` : ''}
      ${it.note ? `<span class="hint">备注：${esc(it.note.slice(0, 60))}${it.note.length > 60 ? '…' : ''}</span>` : ''}
      <span class="meta"><span>收集时间 ${fmtTime(it.at)}</span><span>${esc(it.dims)}</span></span>
    </button>`
    )
    .join('');
  list.querySelectorAll('.card').forEach((c) => {
    c.onclick = () => openFromBank(c.dataset.id);
  });
}

function openFromBank(id) {
  const it = state.bank.find((x) => x.id === id);
  if (!it) return;
  const idx = PROBLEMS.findIndex((p) => p.id === it.problemId);
  switchView('learn');
  state.mode = 'to3d';
  state.recon = null;
  $('#home').hidden = true;
  $('#work').hidden = false;
  $('#workTitle').textContent = '视图与立体综合练习';
  $('.picker').hidden = false;
  $('#qTag').hidden = false;
  state.index = idx >= 0 ? idx : 0;
  state.revealed = true;
  renderPicker();
  renderWork();
  if (it.note) {
    state.notes[noteKey()] = it.note;
  }
  requestAnimationFrame(() => viewer?.resize());
  $('#work').scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('已加载该题的分步演示');
}

// ------------------------------------------------------------ 事件
function wire() {
  document.querySelectorAll('[data-nav]').forEach((b) => {
    b.onclick = () => switchView(b.dataset.nav);
  });
  $('#btnBack').onclick = backHome;
  $('#btnPractice').onclick = () => enterMode();
  $('#btnPrev').onclick = () => selectProblem(state.index - 1);
  $('#btnNext').onclick = () => selectProblem(state.index + 1);
  $('#qSelect').onchange = (e) => selectProblem(Number(e.target.value), { scroll: false });

  $('#btnReset').onclick = () => viewer?.reset();
  $('#chkWire').onchange = (e) => viewer?.setWire(e.target.checked);
  $('#chkAxes').onchange = (e) => viewer?.setAxes(e.target.checked);

  $('#btnClearBank').onclick = () => {
    if (!state.bank.length) return toast('错题本已经是空的');
    if (confirm(`确定清空 ${state.bank.length} 条错题？此操作不可撤销。`)) {
      state.bank = [];
      scheduleSave();
      renderBank();
      toast('已清空');
    }
  };

  $('#btnExport').onclick = () => {
    const blob = new Blob([JSON.stringify(state.bank, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `错题本-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) return;
    if (state.mode === 'home' || $('#work').hidden) return;
    if (state.recon?.source === 'upload' || state.revealed) {
      const prefix = state.recon?.source === 'upload' ? 'uploadStep' : 'step';
      if (e.key === 'ArrowLeft') { e.preventDefault(); document.getElementById(prefix + 'Prev')?.click(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById(prefix + 'Next')?.click(); }
      return;
    }
    if (e.key === 'ArrowLeft') selectProblem(state.index - 1);
    if (e.key === 'ArrowRight') selectProblem(state.index + 1);
  });
}

// ------------------------------------------------------------ 启动
function initViewer() {
  viewer = new Viewer($('#stage'));
  // 默认打开棱线叠加，立体图更清楚（对应「显示棱线」勾选框）
  viewer.setWire(true);
  $('#chkWire').checked = true;
  $('#chkAxes').checked = false;

  // 视角切换按钮：V 键可能被输入法拦截，给一个可点的入口
  const stageHost = $('#stage');
  const VIEW_LABEL = { iso: '立体', front: '主视图', top: '俯视图', side: '左视图' };
  viewer.onViewChange = (n) => {
    $$('[data-camera-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cameraView === n)));
  };
  stageHost.style.position = 'relative';
  const viewChoices = el('div', 'view-choices');
  for (const name of ['iso', 'front', 'top', 'side']) {
    const button = el('button', 'mini', VIEW_LABEL[name]);
    button.type = 'button';
    button.setAttribute('data-camera-view', name);
    button.onclick = () => viewer.setView(name);
    viewChoices.appendChild(button);
  }
  stageHost.appendChild(viewChoices);
}

async function boot() {
  if (SHARE_ONLY) {
    document.title = '三视图工坊 · 上传补画建模';
    $('.brand-text em').textContent = '上传图纸 · 分步补画 · 三维建模';
    $('.home-title').textContent = '上传图纸，补画与建模';
    $('.eyebrow').textContent = '三视图补画工作台';
    $('.home-intro').appendChild(el('p', 'home-sub', '免注册。照片在当前设备中处理，刷新或关闭页面后不保留本次操作。'));
  }
  observeUploadLoading();
  // 上传和二维操作不依赖 WebGL，不能被三维初始化失败阻断。
  wire();
  wireUpload();
  try {
    initViewer();
  } catch (error) {
    console.warn('三维预览初始化失败', error);
    viewer = null;
    showStageNotice(VIEWER_UNAVAILABLE);
  }
  await pull();

  if (state.last?.mode) {
    const idx = PROBLEMS.findIndex((p) => p.id === state.last.problemId);
    state.index = idx >= 0 ? idx : 0;
    enterMode();
    backHome();
  }
}

boot();
addEventListener('pagehide',()=>{cancelUploadTasks();importTask?.cancel();disposeUploadProcessor();preparedUploadGeometry?.dispose();if(state.upload?.originalURL)URL.revokeObjectURL(state.upload.originalURL);});
