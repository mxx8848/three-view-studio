// 组合体生成器：基底 + 特征组合
// 每个形体的结构由"基底类型 + 2~3 个特征"唯一确定，尺寸也随种子变化，
// 因此每一题都是不同的形体（而非同一形体改尺寸）。
// 特征一律选取"会产生截交或相贯"的：通孔、凸台、凹槽、斜切、相交圆柱、肋板。

const D2R = Math.PI / 180;
const r2 = (v) => Math.round(v * 10) / 10;

/** 线性同余伪随机，保证同一 seed 结果固定 */
function rng(seed) {
  let s = (seed * 1103515245 + 12345) % 2147483648;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length) % arr.length];
const between = (rand, a, b, step = 1) => {
  const v = a + rand() * (b - a);
  return Math.max(a, Math.min(b, Math.round(v / step) * step));
};

// ---------------------------------------------------------------- 基底
// 返回 { prims, dims:{W,D,H}, name, outer: 用于判断特征是否可放 }
export const BASES = {
  plate: (rand) => {
    const W = between(rand, 60, 100, 5);
    const D = between(rand, 40, 70, 5);
    const H = between(rand, 14, 30, 2);
    return {
      name: '矩形底板',
      prims: [{ op: '+', t: 'box', x: 0, y: 0, z: 0, w: W, d: D, h: H }],
      dims: { W, D, H },
    };
  },
  L: (rand) => {
    const W = between(rand, 60, 90, 5);
    const D = between(rand, 30, 50, 5);
    const H1 = between(rand, 16, 26, 2);
    const H2 = between(rand, 18, 34, 2);
    const W2 = between(rand, 22, 34, 2);
    return {
      name: 'L 形块',
      prims: [
        { op: '+', t: 'box', x: 0, y: 0, z: 0, w: W, d: D, h: H1 },
        { op: '+', t: 'box', x: 0, y: 0, z: H1, w: W2, d: D, h: H2 },
      ],
      dims: { W, D, H: H1 + H2, H1, W2 },
    };
  },
  T: (rand) => {
    const W = between(rand, 70, 100, 5);
    const D = between(rand, 30, 50, 5);
    const H1 = between(rand, 14, 24, 2);
    const W2 = between(rand, 22, 32, 2);
    const H2 = between(rand, 22, 38, 2);
    const x2 = (W - W2) / 2;
    return {
      name: 'T 形块',
      prims: [
        { op: '+', t: 'box', x: 0, y: 0, z: 0, w: W, d: D, h: H1 },
        { op: '+', t: 'box', x: x2, y: 0, z: H1, w: W2, d: D, h: H2 },
      ],
      dims: { W, D, H: H1 + H2, H1, W2, x2, x3: x2 + W2 },
    };
  },
  cyl: (rand) => {
    const R = between(rand, 18, 30, 2);
    const H = between(rand, 36, 60, 4);
    return {
      name: '立圆柱',
      prims: [{ op: '+', t: 'cyl', x: 0, y: 0, z: 0, r: R, h: H }],
      dims: { W: 2 * R, D: 2 * R, H, R },
      round: true,
    };
  },
  hex: (rand) => {
    const R = between(rand, 20, 30, 2);
    const dep = between(rand, 30, 48, 2);
    return {
      name: '六棱柱',
      prims: [{ op: '+', t: 'prism', x: 0, y: 0, z: 0, n: 6, r: R, depth: dep }],
      dims: { W: R * Math.sqrt(3), D: dep, H: 2 * R, R },
    };
  },
};

// ---------------------------------------------------------------- 特征
// 每个特征：{ prims, label, method, step(dims), trap, kind:'截交'|'相贯' }
export const FEATURES = {
  /** 竖直通孔：圆柱面与上下平面相交 —— 截交 */
  vhole: (rand, dims) => {
    const R = Math.min(dims.W, dims.D) * (0.12 + rand() * 0.06);
    const r = r2(R);
    const off = dims.W * (0.2 + rand() * 0.2);
    const x = dims.round ? 0 : r2(off);
    const y = dims.round ? 0 : r2(dims.D * (0.3 + rand() * 0.4));
    return {
      prims: [{ op: '-', t: 'cyl', x, y, z: -3, r, h: (dims.H || 40) + 8 }],
      label: `Ø${r2(r * 2)} 竖直通孔`,
      method: '辅助圆法',
      kind: '截交',
      step: `孔 Ø${r2(r * 2)}：孔壁两条素线落在主/左视图，贯穿全高，被实体遮挡 → 虚线；俯视图为真形圆（粗实线）。`,
      trap: `孔在主视图应是虚线；俯视图的圆弧不可漏画。`,
    };
  },

  /** 前后向通孔：圆柱面与前后平面相交 —— 截交 */
  hholeY: (rand, dims) => {
    const r = r2(Math.min(dims.D, dims.H || 30) * (0.12 + rand() * 0.05));
    const x = dims.round ? 0 : r2(dims.W * (0.3 + rand() * 0.4));
    const z = r2((dims.H || 30) * (0.45 + rand() * 0.2));
    return {
      prims: [{ op: '-', t: 'cylY', x, y: -6, z, r, h: dims.D + 12 }],
      label: `Ø${r2(r * 2)} 前后向通孔`,
      method: '线面分析法',
      kind: '截交',
      step: `孔 Ø${r2(r * 2)} 沿宽度贯通：左视图为真形圆，主/俯视图各两条虚线，间距等于直径。`,
      trap: `真形圆只出现在孔轴垂直的那个视图，另外两个视图是虚线。`,
    };
  },

  /** 左右向通孔 —— 截交 */
  hholeX: (rand, dims) => {
    const r = r2(Math.min(dims.D, dims.H || 30) * (0.12 + rand() * 0.05));
    const y = dims.round ? 0 : r2(dims.D * (0.3 + rand() * 0.4));
    const z = r2((dims.H || 30) * (0.45 + rand() * 0.2));
    return {
      prims: [{ op: '-', t: 'cylX', x: -6, y, z, r, h: dims.W + 12 }],
      label: `Ø${r2(r * 2)} 左右向通孔`,
      method: '线面分析法',
      kind: '截交',
      step: `孔 Ø${r2(r * 2)} 沿长度贯通：主视图为真形圆，俯/左视图各两条虚线。`,
      trap: `孔的可见性判断：孔口朝向观察者时该视图画圆，不要误画成虚线。`,
    };
  },

  /** 凸台：圆柱与上方平面相交 —— 截交 */
  boss: (rand, dims) => {
    const r = r2(Math.min(dims.W, dims.D) * (0.16 + rand() * 0.06));
    const h = between(rand, 10, 22, 2);
    const x = dims.round ? 0 : r2(dims.W * (0.4 + rand() * 0.2));
    const y = dims.round ? 0 : r2(dims.D * (0.4 + rand() * 0.2));
    return {
      prims: [{ op: '+', t: 'cyl', x, y, z: (dims.H || 20) - 2, r, h: h + 2 }],
      label: `Ø${r2(r * 2)} 凸台（高 ${h}）`,
      method: '辅助圆法',
      kind: '截交',
      step: `凸台 Ø${r2(r * 2)} 高 ${h}：与顶面相交处为圆（截交线），俯视图可见粗实线，主/左视图为两条素线。`,
      trap: `凸台底部的截交圆与顶面轮廓易混，注意高度位置。`,
    };
  },

  /** 顶部矩形槽：三个平面与立体相交 —— 截交 */
  slot: (rand, dims) => {
    const w = r2(dims.W * (0.18 + rand() * 0.12));
    const depth = r2((dims.H || 30) * (0.35 + rand() * 0.2));
    const x = r2((dims.W - w) / 2);
    return {
      prims: [{ op: '-', t: 'box', x, y: -5, z: (dims.H || 30) - depth, w, d: dims.D + 10, h: depth + 6 }],
      label: `宽 ${w} 深 ${r2(depth)} 的顶槽`,
      method: '线面分析法',
      kind: '截交',
      step: `顶槽宽 ${w}、深 ${r2(depth)}：槽的两侧壁与底面都是平面，与立体交出直线段；主视图槽口为折线，左视图槽底为虚线。`,
      trap: `槽底从侧面看被槽壁遮挡，应画虚线；槽口朝上，主视图为粗实线。`,
    };
  },

  /** 斜切：斜面与立体相交 —— 截交 */
  chamfer: (rand, dims) => {
    const deg = between(rand, 18, 40, 2);
    const t = Math.tan(deg * D2R);
    const H = dims.H || 30;
    const c = r2(H * (0.45 + rand() * 0.2));
    return {
      prims: [{ op: '-', t: 'half', n: [-t, 0, 1], p0: [0, 0, c], size: 800 }],
      label: `倾角 ${deg}° 斜切`,
      method: '换面法',
      kind: '截交',
      step: `斜面倾角 ${deg}°：截平面垂直于正投影面，所以主视图上截交线是直线；斜面的实形需用换面法求得。`,
      trap: `主视图的斜线不要画成曲线 —— 垂直正投影面的截平面投影必为直线。`,
    };
  },

  /** 横向相交圆柱：圆柱与圆柱相贯 —— 相贯 */
  crossCyl: (rand, dims) => {
    const r = r2((dims.R || Math.min(dims.W, dims.D) / 2) * (0.4 + rand() * 0.25));
    const z = r2((dims.H || 40) * (0.55 + rand() * 0.2));
    const len = r2(dims.W + 16);
    return {
      prims: [{ op: '+', t: 'cylX', x: -len / 2, y: 0, z, r, h: len }],
      label: `Ø${r2(r * 2)} 横向相交圆柱`,
      method: '辅助平面法',
      kind: '相贯',
      step: `横向圆柱 Ø${r2(r * 2)} 与主体正交相贯：相贯线为空间曲线，需用辅助平面法取点，曲线弯向大的一侧。`,
      trap: `相贯线弯曲方向易画反（应朝大圆柱轴线弯）；异径时不能画成直线。`,
    };
  },

  /** 肋板：薄板与主体相交 —— 截交 */
  rib: (rand, dims) => {
    const t = between(rand, 6, 12, 2);
    const h = r2((dims.H || 30) * (0.5 + rand() * 0.3));
    return {
      prims: [{ op: '+', t: 'box', x: dims.W * 0.15, y: (dims.D - t) / 2, z: 0, w: dims.W * 0.5, d: t, h }],
      label: `厚 ${t} 的肋板`,
      method: '线面分析法',
      kind: '截交',
      step: `肋板厚 ${t}：两侧面平行于正投影面，所以主视图上肋板只显示为一条线（厚度方向与投影方向一致）。`,
      trap: `肋板在主视图不应画成有宽度的矩形。`,
    };
  },
};

const FEATURE_KEYS = Object.keys(FEATURES);
const BASE_KEYS = Object.keys(BASES);

/** 预生成所有 2 元与 3 元特征组合（顺序固定，保证 seed → 唯一结构） */
const COMBOS = (() => {
  const keys = FEATURE_KEYS;
  const out = [];
  for (let i = 0; i < keys.length; i += 1)
    for (let j = i + 1; j < keys.length; j += 1) out.push([keys[i], keys[j]]);
  for (let i = 0; i < keys.length; i += 1)
    for (let j = i + 1; j < keys.length; j += 1)
      for (let k = j + 1; k < keys.length; k += 1) out.push([keys[i], keys[j], keys[k]]);
  return out;
})();

/**
 * 生成第 seed 个形体
 * @returns {{prims:Array, meta:Object, text:Object, features:string[], base:string, name:string}}
 */
export function makeComposite(seed) {
  const rand = rng(seed * 7919 + 13);
  const baseIdx = seed % BASE_KEYS.length;
  const comboIdx = Math.floor(seed / BASE_KEYS.length) % COMBOS.length;
  const baseKey = BASE_KEYS[baseIdx];
  const base = BASES[baseKey](rand);
  const dims = { ...base.dims };

  // 由组合表唯一确定特征集合；圆柱基底上不放肋板/槽，替换为等效特征
  let chosen = [...COMBOS[comboIdx]];
  if (baseKey === 'cyl') {
    chosen = chosen.filter((k) => k !== 'rib' && k !== 'slot');
    for (const alt of ['vhole', 'boss', 'crossCyl', 'chamfer']) {
      if (chosen.length >= Math.min(3, COMBOS[comboIdx].length)) break;
      if (!chosen.includes(alt)) chosen.push(alt);
    }
  }
  if (chosen.length < 2) chosen = ['vhole', 'boss'];

  const prims = [...base.prims];
  const meta = { ...dims, base: baseKey };
  const labels = [];
  const steps = [];
  const traps = [];
  const methods = new Set(['形体分析法']);
  const kinds = { 截交: 0, 相贯: 0 };

  for (const key of chosen) {
    const f = FEATURES[key](rand, meta);
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
    meta: { ...meta, labels, kinds },
    base: baseKey,
    name: `${base.name} + ${labels.length} 特征`,
    features: chosen,
    text: {
      idea:
        `本题以「${base.name}」为基底，叠加${labels.map((l) => `「${l}」`).join('、')}，` +
        `共含 ${kindText}。解题时先按基本体定出外形，再逐个特征求截交线或相贯线。`,
      steps: [
        `先按基底「${base.name}」画出三视图外轮廓，确定长、宽、高三个尺寸。`,
        ...steps,
        `最后统一检查投影关系：长对正、高平齐、宽相等，并核对每条虚线是否确实被遮挡。`,
      ],
      pitfalls: [...traps, `被叠加/切除的特征必须逐个求交线，漏一个就会少线或多线。`],
      methods: [...methods],
    },
  };
}

export const COMPOSITE_BASES = BASE_KEYS;
export const COMPOSITE_FEATURES = FEATURE_KEYS;
