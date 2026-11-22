// 受控矩阵生成器：每个配方是"已知自洽"的基底 + 特征搭配
// 特征位置用相对坐标固定（同轴、避开交叠），只变化尺寸 → 每项搭配都能得到合理形体。
// 每个配方都含 ≥2 处截交/相贯。
import { BASES } from './compose.js';

const D2R = Math.PI / 180;
const r2 = (v) => Math.round(v * 10) / 10;
function rng(seed) {
  let s = (seed * 1103515245 + 12345) % 2147483648;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
const btw = (rand, a, b, step = 1) => Math.max(a, Math.min(b, Math.round((a + rand() * (b - a)) / step) * step));
/** 盒体基底以角点为原点；圆柱/棱柱基底以原点为中心 —— 特征坐标必须换算 */
const centered = (d) => d.base === 'cyl' || d.base === 'hex';
const PX = (d, fx = 0.5) => r2(centered(d) ? (fx - 0.5) * d.W : fx * d.W);
const PY = (d, fy = 0.5) => r2(centered(d) ? (fy - 0.5) * d.D : fy * d.D);

/** 特征构造：全部用相对坐标 + 尺寸夹紧，保证落在体内 */
const BUILD = {
  vhole: (d, s) => {
    const r = r2(Math.min(d.W, d.D) * (s.rf || 0.13));
    const x = PX(d, s.fx ?? 0.5);
    const y = PY(d, s.fy ?? 0.5);
    return {
      prims: [{ op: '-', t: 'cyl', x, y, z: -3, r, h: (d.H || 40) + 8 }],
      label: `Ø${r2(r * 2)} 通孔`,
      method: '辅助圆法',
      kind: '截交',
      step: `通孔 Ø${r2(r * 2)}：孔壁两素线在主/左视图贯穿全高、被遮挡 → 虚线；俯视图为真形圆。`,
      trap: '孔在非真形视图须画虚线，不可漏。',
    };
  },
  hholeY: (d, s) => {
    const r = r2(Math.min(d.D, (d.H || 30) * 0.5) * (s.rf || 0.18));
    return {
      prims: [{ op: '-', t: 'cylY', x: PX(d, s.fx ?? 0.5), y: -6, z: r2((s.fz ?? 0.5) * (d.H || 30)), r, h: d.D + 12 }],
      label: `Ø${r2(r * 2)} 前后向通孔`,
      method: '线面分析法',
      kind: '截交',
      step: `前后向通孔 Ø${r2(r * 2)}：左视图为真形圆，主/俯视图各两条虚线。`,
      trap: '真形圆只出现在孔轴垂直的视图。',
    };
  },
  hholeX: (d, s) => {
    const r = r2(Math.min(d.W, (d.H || 30) * 0.5) * (s.rf || 0.16));
    return {
      prims: [{ op: '-', t: 'cylX', x: -6, y: PY(d, s.fy ?? 0.5), z: r2((s.fz ?? 0.5) * (d.H || 30)), r, h: d.W + 12 }],
      label: `Ø${r2(r * 2)} 左右向通孔`,
      method: '线面分析法',
      kind: '截交',
      step: `左右向通孔 Ø${r2(r * 2)}：主视图为真形圆，俯/左视图各两条虚线。`,
      trap: '孔口朝向观察者的视图画圆。',
    };
  },
  boss: (d, s) => {
    const r = r2(Math.min(d.W, d.D) * (s.rf || 0.2));
    const h = r2((d.H || 20) * (s.hf || 0.35));
    return {
      prims: [{ op: '+', t: 'cyl', x: PX(d, s.fx ?? 0.5), y: PY(d, s.fy ?? 0.5), z: (d.H || 20) - 2, r, h: h + 2 }],
      label: `Ø${r2(r * 2)} 凸台高 ${r2(h)}`,
      method: '辅助圆法',
      kind: '截交',
      step: `凸台 Ø${r2(r * 2)} 高 ${r2(h)}：与顶面交线为圆，俯视图可见，主/左视图为两条素线。`,
      trap: '凸台底部截交圆与顶面轮廓易混。',
    };
  },
  slot: (d, s) => {
    const w = r2(d.W * (s.wf || 0.22));
    const dep = r2((d.H || 30) * (s.df || 0.4));
    return {
      prims: [{ op: '-', t: 'box', x: r2((s.fx ?? 0.5) * (d.W - w)), y: -5, z: (d.H || 30) - dep, w, d: d.D + 10, h: dep + 6 }],
      label: `宽 ${w} 深 ${dep} 顶槽`,
      method: '线面分析法',
      kind: '截交',
      step: `顶槽宽 ${w} 深 ${dep}：侧壁与底面均为平面，交出直线；左视图槽底为虚线。`,
      trap: '槽底从侧面看被遮挡，画虚线。',
    };
  },
  chamfer: (d, s) => {
    const deg = r2(s.deg || 28);
    const t = Math.tan(deg * D2R);
    const c = r2((d.H || 30) * (s.cf || 0.5));
    return {
      prims: [{ op: '-', t: 'half', n: [-t, 0, 1], p0: [0, 0, c], size: 900 }],
      label: `斜切 ${deg}°`,
      method: '换面法',
      kind: '截交',
      step: `斜切 ${deg}°：截平面垂直正投影面，主视图截交线为直线；实形需换面法求得。`,
      trap: '主视图斜线不要画成曲线。',
    };
  },
  crossCyl: (d, s) => {
    const baseR = (d.R || Math.min(d.W, d.D) / 2) * (s.rf || 0.5);
    const r = r2(Math.min(baseR, (d.H || 40) * 0.28));
    const ext = r2(Math.min(8, r));
    const len = r2(d.W + ext * 2);
    return {
      prims: [{ op: '+', t: 'cylX', x: -len / 2, y: centered(d) ? 0 : r2(d.D / 2), z: r2((s.fz ?? 0.6) * (d.H || 40)), r, h: len }],
      label: `Ø${r2(r * 2)} 横向相交圆柱`,
      method: '辅助平面法',
      kind: '相贯',
      step: `横向圆柱 Ø${r2(r * 2)} 与主体正交相贯：相贯线为空间曲线，辅助平面法取点，曲线弯向大的一侧。`,
      trap: '相贯线弯向易画反；异径不能画成直线。',
    };
  },
  rib: (d, s) => {
    const t = r2(d.D * (s.tf || 0.18));
    const h = r2((d.H || 30) * (s.hf || 0.45));
    return {
      prims: [{ op: '+', t: 'box', x: r2(d.W * 0.3), y: r2((d.D - t) / 2), z: 0, w: r2(d.W * 0.34), d: t, h }],
      label: `肋板厚 ${t}`,
      method: '线面分析法',
      kind: '截交',
      step: `肋板厚 ${t}：两侧面平行正投影面，主视图只显示一条线。`,
      trap: '肋板在主视图不应画成矩形。',
    };
  },
};

/** 14 个受控搭配；每个都含 ≥2 处截交/相贯 */
export const RECIPES = [
  { id: 'r01', base: 'plate', tag: '板 + 凸台 + 同轴通孔', feats: [['boss', { fx: 0.5, fy: 0.5, rf: 0.2, hf: 0.4 }], ['vhole', { fx: 0.5, fy: 0.5, rf: 0.1 }]] },
  { id: 'r02', base: 'plate', tag: '板 + 双孔 + 顶槽', feats: [['vhole', { fx: 0.25, fy: 0.5, rf: 0.1 }], ['vhole', { fx: 0.75, fy: 0.5, rf: 0.1 }], ['slot', { fx: 0.5, wf: 0.18, df: 0.35 }]] },
  { id: 'r03', base: 'plate', tag: '板 + 竖直孔 + 前后向孔', feats: [['vhole', { fx: 0.3, fy: 0.5, rf: 0.12 }], ['hholeY', { fx: 0.7, fz: 0.5, rf: 0.16 }]] },
  { id: 'r05', base: 'plate', tag: '板 + 斜切 + 顶槽', feats: [['chamfer', { deg: 24, cf: 0.55 }], ['slot', { fx: 0.7, wf: 0.16, df: 0.3 }]] },
  { id: 'r06', base: 'L', tag: 'L 块 + 底板通孔 + 竖板斜切', feats: [['vhole', { fx: 0.75, fy: 0.5, rf: 0.09 }], ['chamfer', { deg: 30, cf: 0.62 }]] },
  { id: 'r07', base: 'L', tag: 'L 块 + 横向圆柱 + 左右向孔', feats: [['crossCyl', { rf: 0.45, fz: 0.7 }], ['hholeX', { fy: 0.5, fz: 0.3, rf: 0.14 }]] },
  { id: 'r08', base: 'T', tag: 'T 块 + 凸台 + 通孔', feats: [['boss', { fx: 0.5, fy: 0.5, rf: 0.24, hf: 0.3 }], ['vhole', { fx: 0.5, fy: 0.5, rf: 0.1 }]] },
  { id: 'r09', base: 'T', tag: 'T 块 + 顶槽 + 前后向孔', feats: [['slot', { fx: 0.5, wf: 0.3, df: 0.28 }], ['hholeY', { fx: 0.5, fz: 0.35, rf: 0.14 }]] },
  { id: 'r10', base: 'cyl', tag: '圆柱 + 同轴孔 + 径向孔', feats: [['vhole', { fx: 0.5, fy: 0.5, rf: 0.34 }], ['hholeY', { fx: 0.5, fz: 0.6, rf: 0.16 }]] },
  { id: 'r11', base: 'cyl', tag: '圆柱 + 斜切 + 径向孔', feats: [['chamfer', { deg: 26, cf: 0.6 }], ['hholeX', { fy: 0.5, fz: 0.35, rf: 0.15 }]] },
];

const VARIANTS = 30;

export function recipeCount() {
  return RECIPES.length * VARIANTS;
}

/** seed → (配方, 尺寸变体) */
export function makeRecipe(seed) {
  const ri = seed % RECIPES.length;
  const vi = Math.floor(seed / RECIPES.length) % VARIANTS;
  const rec = RECIPES[ri];
  const rand = rng(seed * 7919 + 13);
  const base = BASES[rec.base](rand);
  const dims = { ...base.dims, base: rec.base };

  const prims = [...base.prims];
  const labels = [];
  const steps = [];
  const traps = [];
  const methods = new Set(['形体分析法']);
  const kinds = { 截交: 0, 相贯: 0 };
  for (const [key, spec] of rec.feats) {
    const f = BUILD[key](dims, spec);
    prims.push(...f.prims);
    labels.push(f.label);
    steps.push(f.step);
    traps.push(f.trap);
    methods.add(f.method);
    kinds[f.kind] += 1;
  }
  const kindText = [kinds.截交 ? `${kinds.截交} 处截交` : '', kinds.相贯 ? `${kinds.相贯} 处相贯` : '']
    .filter(Boolean)
    .join(' + ');

  return {
    prims,
    meta: { ...dims, base: rec.base, labels, kinds },
    base: rec.base,
    name: `${base.name} + ${rec.tag.split('+').slice(1).join('+').trim()}`,
    features: rec.feats.map((f) => f[0]),
    recipeId: rec.id,
    variant: vi + 1,
    text: {
      idea: `本题为「${rec.tag}」型组合体，共含 ${kindText}。先定基本体外轮廓，再逐个特征求截交线或相贯线。`,
      steps: [
        `先按基底「${base.name}」画出三视图外轮廓，确定长、宽、高。`,
        ...steps,
        '统一核对长对正、高平齐、宽相等，并检查每条虚线是否确实被遮挡。',
      ],
      pitfalls: [...traps, '被叠加或切除的特征必须逐个求交线。'],
      methods: [...methods],
    },
  };
}
