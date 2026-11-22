// 三维视图：Three.js + OrbitControls，鼠标旋转 / 缩放 / 平移
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildCsgGeometry, buildFeatureEdges } from './csg3d.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { surfaceEdges } from './surface-edges.js';

export class Viewer {
  constructor(host) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.OrthographicCamera(-60, 60, 60, -60, 0.001, 5000);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2.5));
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.9;
    this.controls.minDistance = 0.3;
    // 左键旋转、中键平移（右键不再平移，避免与浏览器菜单冲突）
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: null,
    };
    this.controls.screenSpacePanning = true;

    // 标准视角循环：主视图 → 俯视图 → 左视图，按 V 切换；初始停在 iso 立体视角
    this.viewNames = ['front', 'top', 'side'];
    this.viewIdx = -1;
    this._onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // 中文输入法激活时 e.key 可能是 'Process'，所以同时判断 e.code / keyCode
      const isV = (e.key && e.key.toLowerCase() === 'v') || e.code === 'KeyV' || e.keyCode === 86;
      if (isV) {
        e.preventDefault();
        this.cycleView();
      }
    };
    addEventListener('keydown', this._onKey);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd9cfbe, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1.4, 2.0, 1.6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1.6, 0.8, -1.2);
    this.scene.add(fill);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.grid = new THREE.GridHelper(200, 20, 0xd9cfbe, 0xeee6d8);
    this.grid.rotateX(Math.PI / 2);
    this.grid.material.opacity = 0.55;
    this.grid.material.transparent = true;
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(30);
    // Axes are an optional teaching aid. Keep them out of the default model
    // screenshot so they cannot be mistaken for a part edge or slot wall.
    this.axes.visible = false;
    this.scene.add(this.axes);

    this.mesh = null;
    this.edges = null;
    this.fitRadius = 40;
    this.wire = false;

    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
    this.resize();
    this._loop();
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(320, r.width);
    const h = Math.max(320, r.height || 460);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const halfHeight = (this.fitRadius || 40) * (this.fitPadding || 1.9) / Math.min(1, aspect);
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.edges?.material?.resolution?.set(w,h);
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    if(document.hidden||!this.host.getClientRects().length)return;
    this.controls.update();
    this.updateContours();
    this.renderer.render(this.scene, this.camera);
  }

  clear() {
    for (const obj of [this.mesh, this.edges]) {
      if (!obj) continue;
      this.root.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
    this.mesh = null;
    this.edges = null;
    this.contourEdges=null;
    this.contourCamera=null;
  }

  /** 显示任意几何体（已居中） */
  setGeometry(geo, opts = {}) {
    this.clear();
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const size = new THREE.Vector3();
    bb.getSize(size);

    const mat = new THREE.MeshStandardMaterial({
      color: opts.color ?? 0xe9e0cd,
      metalness: 0.02,
      roughness: 0.56,
      flatShading: !!opts.flat,
      polygonOffset: true,
      polygonOffsetFactor: opts.repairJunctions?2:1,
      polygonOffsetUnits: opts.repairJunctions?2:1,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.root.add(this.mesh);

    // 棱线：只输出"两面共享且夹角 > 30°"的真实棱线
    // （EdgesGeometry 会把裂缝边也画出来，在回转体上表现为一片假线）
    if(opts.repairJunctions) {
      this.contourEdges=opts.contourEdges||surfaceEdges(geo);
      const material=new LineMaterial({color:0x173f43,linewidth:1.8,worldUnits:false,alphaToCoverage:false,depthTest:true,depthWrite:false});
      // Keep the screen-space stroke just in front of its own surface, while
      // retaining depth testing against the rest of the solid.
      material.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace('gl_Position = clip;','gl_Position = clip; gl_Position.z -= 0.00004 * gl_Position.w;');};
      this.edges=new LineSegments2(new LineSegmentsGeometry(),material);
      this.edges.frustumCulled=false;this.edges.renderOrder=1;
    } else {
      const eg=buildFeatureEdges(geo,opts.edgeAngle??30);
      this.edges=new THREE.LineSegments(eg,new THREE.LineBasicMaterial({color:0x1d1813}));
    }
    this.edges.visible = this.wire;
    this.root.add(this.edges);

    this.grid.position.set(0, 0, bb.min.z - size.z * 0.002);
    this.fitRadius = size.length() * 0.5 || 1;
    this.fitPadding = opts.fitPadding ?? 1.9;
    this.grid.scale.setScalar(this.fitRadius * 3 / 200);
    this.axes.scale.setScalar(this.fitRadius * 0.8 / 30);
    this.camera.near = Math.max(0.00001, this.fitRadius / 1000);
    this.camera.far = this.fitRadius * 30;
    this.resize();
    this.reset();
    return { size: { x: size.x, y: size.y, z: size.z } };
  }

  updateContours() {
    if(!this.contourEdges||!this.edges?.visible)return;
    const direction=this.camera.getWorldDirection(new THREE.Vector3());
    const key=direction.toArray().map(v=>v.toFixed(5)).join(',');if(key===this.contourCamera)return;this.contourCamera=key;
    const positions=[],cos=Math.cos(Math.PI/6);
    for(const edge of this.contourEdges) {
      const sharp=edge.n.some((n,i)=>edge.n.slice(i+1).some(m=>n.dot(m)<cos));
      const tangent=edge.n.some((n,i)=>edge.n.slice(i+1).some(m=>n.dot(direction)*m.dot(direction)<-1e-9));
      if(sharp||tangent)positions.push(...edge.a,...edge.b);
    }
    const previous=this.edges.geometry;this.edges.geometry=new LineSegmentsGeometry();this.edges.geometry.setPositions(positions);previous.dispose();
  }

  /** 由 CSG 图元列表构建并显示 */
  setPrims(prims) {
    const geo = buildCsgGeometry(prims);
    return this.setGeometry(geo, { edgeAngle: 30 });
  }

  /** 切到标准视角：iso = 初始三维立体视角；front/top/side = 三视图方向 */
  setView(name) {
    const r = this.fitRadius || 40;
    const d = r * 4.2; // 距离放大，初始状态能看清整个形体
    const presets = {
      // 初始：略带俯角的 3/4 视角，能同时看到顶面、前面和侧面
      iso: { pos: [d * 0.62, -d * 0.70, d * 0.48], up: [0, 0, 1] },
      front: { pos: [0, -d, 0], up: [0, 0, 1] },
      top: { pos: [0, 0, d], up: [0, 1, 0] },
      side: { pos: [-d, 0, 0], up: [0, 0, 1] },
    };
    const p = presets[name] || presets.iso;
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.camera.up.set(p.up[0], p.up[1], p.up[2]);
    this.camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.camera.lookAt(0, 0, 0);
    this.currentView = name;
    this.viewIdx = this.viewNames.indexOf(name);
    if (typeof this.onViewChange === 'function') this.onViewChange(name);
  }

  /** 按 V 循环：主视 → 俯视 → 左视 → 主视…（初始停在 iso 立体视角） */
  cycleView() {
    this.viewIdx = (this.viewIdx + 1) % this.viewNames.length;
    const name = this.viewNames[this.viewIdx];
    this.setView(name);
    return name;
  }

  reset() {
    // viewIdx < 0 表示还没按过 V，此时保持 iso 立体视角
    this.setView(this.viewIdx < 0 ? 'iso' : this.viewNames[this.viewIdx]);
  }

  setWire(v) {
    this.wire = v;
    if (this.edges) this.edges.visible = v;
  }

  setAxes(v) {
    this.axes.visible = v;
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    removeEventListener('resize', this._onResize);
    removeEventListener('keydown', this._onKey);
    this.clear();
    this.renderer.dispose();
    this.controls.dispose();
    this.host.innerHTML = '';
  }
}
