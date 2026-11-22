// 回转体复杂组合体生成器（第二版）
// 与第一版的区别：基底改为"多层叠合体"（阶梯圆柱、锥柱、台柱、法兰轴、双锥），
// 每个形体再叠加 3 个特征（内孔、径向孔、十字孔系、横向贯穿圆柱、台阶截切、斜截、槽），
// 因此每题至少含 3~4 处截交/相贯，而不是"一个截切加一个孔"。
//
// 截交线类型判据（设被截回转面的半顶角 α，tanα = (R1−R2)/H）：
//   截平面 ⟂ 轴线 → 圆；与轴线夹角 > α → 椭圆；= α → 抛物线；< α（含平行轴线）→ 双曲线
const D2R = Math.PI / 180;
const r2 = (v) => Math.round(v * 10) / 10;
function rng(seed) {
  let s = (seed * 1103515245 + 12345) % 2147483648;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
const btw = (rand, a, b, st = 1) => Math.max(a, Math.min(b, Math.round((a + rand() * (b - a)) / st) * st));

const cyl = (x, y, z, r, h) => ({ op: '+', t: 'cyl', x, y, z, r, h });
const H2v = (rs) => Math.round(rs * 0.9 * 10) / 10;
const cone = (x, y, z, r1, r2v, h) => ({ op: '+', t: 'cone', x, y, z, r1, r2: r2v, h });

/** 叠合基底：返回 {prims, R（最大半径）, Rb（底部半径）, Htot, zTop（顶面高度）, cutZ（斜切基准高度）, alpha（被切段半顶角）} */
const STACKS = {
  cylStep: (rand) => {
    const R1 = btw(rand, 24, 30, 2);
    const H1 = btw(rand, 18, 28, 2);
    const R2 = r2(R1 * btw(rand, 0.55, 0.72, 0.05));
    const H2 = btw(rand, 26, 40, 2);
    return {
      name: '阶梯圆柱',
      prims: [cyl(0, 0, 0, R1, H1), cyl(0, 0, H1, R2, H2)],
      R: R1, R2: R2, H: H1 + H2, H1, zTop: H1 + H2, cutBase: H1, cutH: H2, alpha: 0,
    };
  },
  cylCone: (rand) => {
    const R = btw(rand, 22, 28, 2);
    const H1 = btw(rand, 22, 34, 2);
    const H2 = btw(rand, 24, 38, 2);
    return {
      name: '锥柱组合',
      prims: [cyl(0, 0, 0, R, H1), cone(0, 0, H1, R, 0, H2)],
      R, R2: 0, H: H1 + H2, H1, zTop: H1 + H2, cutBase: H1, cutH: H2,
      alpha: Math.atan(R / H2) / D2R,
    };
  },
  frustumCyl: (rand) => {
    const R1 = btw(rand, 26, 32, 2);
    const R2 = btw(rand, 14, 20, 2);
    const H1 = btw(rand, 18, 28, 2);
    const H2 = btw(rand, 24, 36, 2);
    return {
      name: '台柱组合',
      prims: [cone(0, 0, 0, R1, R2, H1), cyl(0, 0, H1, R2, H2)],
      R: R1, R2, H: H1 + H2, H1, zTop: H1 + H2, cutBase: H1, cutH: H2,
      alpha: Math.atan((R1 - R2) / H1) / D2R,
    };
  },
  cylFlange: (rand) => {
    const R1 = btw(rand, 28, 34, 2);
    const H1 = btw(rand, 8, 14, 2);
    const R2 = r2(R1 * btw(rand, 0.5, 0.64, 0.04));
    const H2 = btw(rand, 34, 48, 2);
    return {
      name: '法兰轴',
      prims: [cyl(0, 0, 0, R1, H1), cyl(0, 0, H1, R2, H2)],
      R: R1, R2, H: H1 + H2, H1, zTop: H1 + H2, cutBase: H1, cutH: H2, alpha: 0,
    };
  },
  coneCone: (rand) => {
    const R1 = btw(rand, 26, 32, 2);
    const H1 = btw(rand, 16, 24, 2);
    const R2 = btw(rand, 14, 20, 2);
    const H2 = btw(rand, 22, 34, 2);
    return {
      name: '双锥组合',
      prims: [cone(0, 0, 0, R1, R2, H1), cone(0, 0, H1, R2, 0, H2)],
      R: R1, R2, H: H1 + H2, H1, zTop: H1 + H2, cutBase: H1, cutH: H2,
      alpha: Math.atan(R2 / H2) / D2R,
    };
  },
  tubeStep: (rand) => {
    const R1 = btw(rand, 26, 32, 2);
    const H1 = btw(rand, 10, 16, 2);
    const R2 = r2(R1 * btw(rand, 0.62, 0.76, 0.04));
    const H2 = btw(rand, 30, 44, 2);
    return {
      name: '阶梯圆筒',
      prims: [cyl(0, 0, 0, R1, H1), cyl(0, 0, H1, R2, H2)],
      R: R1, R2, H: H1 + H2, H1, zTop: H1 + H2, cutBase: H1, cutH: H2, alpha: 0,
    };
  },
  sphereCyl: (rand) => {
    const R = btw(rand, 22, 28, 2);
    const H1 = btw(rand, 20, 32, 2);
    const rs = r2(R * btw(rand, 0.55, 0.72, 0.04));
    const zc = r2(H1 + rs * 0.55);
    return {
      name: '球柱组合',
      prims: [cyl(0, 0, 0, R, H1), { op: '+', t: 'sphere', x: 0, y: 0, z: zc, r: rs }],
      R, R2: R, H: r2(zc + rs), H1, zTop: r2(zc + rs), cutBase: H1, cutH: H2v(rs), alpha: 0,
    };
  },
  tubeCone: (rand) => {
    const R = btw(rand, 24, 30, 2);
    const H1 = btw(rand, 20, 30, 2);
    const H2 = btw(rand, 24, 36, 2);
    const rb = r2(R * btw(rand, 0.4, 0.55, 0.04));
    return {
      name: '圆筒锥顶',
      prims: [cyl(0, 0, 0, R, H1), cone(0, 0, H1, R, 0, H2)],
      R, R2: rb, H: H1 + H2, H1, zTop: H1 + H2, cutBase: H1, cutH: H2,
      alpha: Math.atan(R / H2) / D2R, boreR: rb,
    };
  },
  sphereFrustum: (rand) => {
    const R1 = btw(rand, 26, 32, 2);
    const R2 = btw(rand, 12, 18, 2);
    const H1 = btw(rand, 18, 26, 2);
    const rs = r2(R2 * btw(rand, 1.05, 1.3, 0.05));
    const zc = r2(H1 + rs * 0.5);
    return {
      name: '球台组合',
      prims: [cone(0, 0, 0, R1, R2, H1), { op: '+', t: 'sphere', x: 0, y: 0, z: zc, r: rs }],
      R: R1, R2, H: r2(zc + rs), H1, zTop: r2(zc + rs), cutBase: H1, cutH: r2(rs * 1.4),
      alpha: Math.atan((R1 - R2) / H1) / D2R,
    };
  },
  sphereCone: (rand) => {
    const R = btw(rand, 22, 28, 2);
    const H1 = btw(rand, 28, 40, 2);
    const rs = r2(R * btw(rand, 0.5, 0.66, 0.04));
    const zc = r2(H1 + rs * 0.45);
    return {
      name: '球锥组合',
      prims: [cone(0, 0, 0, R, 0, H1), { op: '+', t: 'sphere', x: 0, y: 0, z: zc, r: rs }],
      R, R2: 0, H: r2(zc + rs), H1, zTop: r2(zc + rs), cutBase: H1, cutH: r2(rs * 1.4),
      alpha: Math.atan(R / H1) / D2R,
    };
  },
  sphereBase: (rand) => {
    const rs = btw(rand, 20, 26, 2);
    const H1 = btw(rand, 14, 22, 2);
    const R = r2(rs * btw(rand, 0.5, 0.66, 0.04));
    return {
      name: '球底立柱',
      prims: [{ op: '+', t: 'sphere', x: 0, y: 0, z: rs, r: rs }, cyl(0, 0, r2(rs + rs * 0.55), R, H1)],
      R: rs, R2: R, H: r2(rs * 1.55 + H1), H1: r2(rs * 1.55), zTop: r2(rs * 1.55 + H1),
      cutBase: r2(rs * 1.55), cutH: H1, alpha: 0,
    };
  },
};

/** 特征：每个都产生截交或相贯 */
const FEATURES = {
  bore: (rand, g) => {
    const r = r2(g.R2 > 0 ? Math.min(g.R2, g.R) * 0.3 : g.R * 0.22);
    return {
      prims: [{ op: '-', t: 'cyl', x: 0, y: 0, z: -4, r, h: g.H + 12 }],
      label: `Ø${r2(r * 2)} 同轴通孔`,
      method: '辅助圆法',
      kind: '截交',
      step: `同轴通孔 Ø${r2(r * 2)} 贯通全高：与各层端面交出圆，主/左视图为两条贯穿虚线，俯视图与外圆同心的真形圆。`,
      trap: '同轴孔在俯视图与外圆同心；各层直径变化处要断开虚线。',
    };
  },
  radialHole: (rand, g) => {
    const r = r2(Math.min(g.R2 > 0 ? g.R2 : g.R, g.R) * 0.2);
    const z = r2(g.cutBase + g.cutH * btw(rand, 0.25, 0.6, 0.05));
    return {
      prims: [{ op: '-', t: 'cylY', x: 0, y: -(g.R + 8), z, r, h: g.R * 2 + 16 }],
      label: `Ø${r2(r * 2)} 径向孔（高 ${z}）`,
      method: '辅助平面法',
      kind: '截交',
      step: `径向孔 Ø${r2(r * 2)} 在高 ${z} 处：孔壁与被穿回转面相交为空间曲线，需用辅助平面法求交；左视图为真形圆，主视图为两条虚线。`,
      trap: '孔壁与回转面的交线是空间曲线，不能画成直线。',
    };
  },
  crossHoles: (rand, g) => {
    const r = r2(g.R * 0.17);
    const z = r2(g.cutBase + g.cutH * btw(rand, 0.35, 0.55, 0.05));
    return {
      prims: [
        { op: '-', t: 'cylY', x: 0, y: -(g.R + 8), z, r, h: g.R * 2 + 16 },
        { op: '-', t: 'cylX', x: -(g.R + 8), y: 0, z, r, h: g.R * 2 + 16 },
      ],
      label: `Ø${r2(r * 2)} 十字孔（两孔相贯）`,
      method: '辅助平面法',
      kind: '相贯',
      step: `十字孔 Ø${r2(r * 2)}：两条孔轴线正交且同高，孔壁相互贯穿形成空间相贯线；主、左视图各见两个真形圆，俯视图两根虚线十字相交。`,
      trap: '两孔相贯处轮廓线要按实际交线画出，不能简单画成两个整圆。',
    };
  },
  crossCyl: (rand, g) => {
    const r = r2(g.R * 0.62);
    const z = r2(g.H * btw(rand, 0.45, 0.62, 0.04));
    const len = r2(g.R * 2 + 18);
    return {
      prims: [{ op: '+', t: 'cylX', x: -len / 2, y: 0, z, r, h: len }],
      label: `Ø${r2(r * 2)} 横向贯穿圆柱`,
      method: '辅助平面法',
      kind: '相贯',
      step: `横向圆柱 Ø${r2(r * 2)} 与主体正交相贯：相贯线为空间曲线，弯向直径大的一侧；主视图两侧各有一条相贯线可见，左视图为真形圆。`,
      trap: '异径相贯时相贯线弯向大圆柱；等径时才是直线（45°）。',
    };
  },
  stepCut: (rand, g) => {
    const h = r2(g.H * btw(rand, 0.12, 0.2, 0.02));
    return {
      prims: [{ op: '-', t: 'half', n: [0, 0, 1], p0: [0, 0, g.zTop - h], size: 900 }],
      label: `顶部台阶截切（高 ${h}）`,
      method: '线面分析法',
      kind: '截交',
      step: `顶部水平截切 ${h}：截平面垂直于轴线，截交线为圆；主/左视图上积聚为水平直线，俯视图为与外圆同心的真形圆。`,
      trap: '水平截切只切掉一层时，下层轮廓线仍完整保留。',
    };
  },
  obliqueCut: (rand, g) => {
    // 在被切段（cutBase~zTop）内做斜切，角度决定截交线类型
    const deg = btw(rand, 16, 34, 2);
    const t = Math.tan(deg * D2R);
    const c = r2(g.cutBase + g.cutH * btw(rand, 0.45, 0.65, 0.04));
    return {
      prims: [{ op: '-', t: 'half', n: [-t, 0, 1], p0: [0, 0, c], size: 900 }],
      label: `斜截 ${deg}°`,
      method: '换面法',
      kind: '截交',
      step: `斜截平面与水平面成 ${deg}°：与轴线夹角 ${r2(90 - deg)}°，与被切段半顶角 ${r2(g.alpha)}° 相比决定截交线类型；主视图上截平面投影为直线，曲线真形在俯视图。`,
      trap: '斜截后原来那一段的轮廓线要断开，不能保留到顶点。',
    };
  },
  paraCut: (rand, g) => {
    // 截平面平行于一条素线：与轴线夹角正好等于被切段半顶角
    const deg = r2(90 - g.alpha);
    const t = Math.tan(deg * D2R);
    const c = r2(g.cutBase + g.cutH * btw(rand, 0.48, 0.62, 0.04));
    return {
      prims: [{ op: '-', t: 'half', n: [-t, 0, 1], p0: [0, 0, c], size: 900 }],
      label: `平行素线截切（${deg}°）`,
      method: '辅助平面法',
      kind: '截交',
      step: `截平面与水平面成 ${deg}°，正好等于被切段半顶角 ${r2(g.alpha)}° —— 截平面平行于一条素线，截交线为抛物线；端点落在底/顶面上，顶点在对称轴上，中间点用水平辅助面求出。`,
      trap: '抛物线的顶点要单独求（对称轴与截平面的交点），不能只连两端点。',
    };
  },
  hyperCut: (rand, g) => {
    const y = r2(g.R * btw(rand, 0.5, 0.72, 0.04));
    return {
      prims: [{ op: '-', t: 'half', n: [0, 1, 0], p0: [0, y, 0], size: 900 }],
      label: `平行轴线截切（距轴 ${y}）`,
      method: '辅助平面法',
      kind: '截交',
      step: `截平面平行于轴线、距轴线 ${y}：与被切回转面交出双曲线（夹角 0 < 半顶角 ${r2(g.alpha)}°）；截平面平行正投影面，主视图显示双曲线真形，俯/左视图积聚为直线。`,
      trap: '双曲线的顶点在对称轴上，不要画成抛物线。',
    };
  },
  slot: (rand, g) => {
    const w = r2(g.R * btw(rand, 0.5, 0.75, 0.05));
    const dep = r2(g.cutH * btw(rand, 0.3, 0.5, 0.05));
    return {
      prims: [{ op: '-', t: 'box', x: -w / 2, y: -(g.R + 6), z: g.zTop - dep, w, d: g.R * 2 + 12, h: dep + 8 }],
      label: `宽 ${w} 深 ${dep} 顶槽`,
      method: '线面分析法',
      kind: '截交',
      step: `顶槽宽 ${w} 深 ${dep}：槽的两侧壁与底面都是平面，与回转面交出直线段；主视图槽口为折线，左视图槽底为虚线。`,
      trap: '槽底被槽壁遮挡，左视图应画虚线。',
    };
  },
};

const CONIC_TEXT = {
  圆: '截平面垂直于轴线 → 截交线为圆',
  椭圆: '截平面与轴线夹角大于半顶角 → 截交线为椭圆',
  抛物线: '截平面平行于一条素线（夹角等于半顶角）→ 截交线为抛物线',
  双曲线: '截平面平行于轴线（夹角小于半顶角）→ 截交线为双曲线',
  两条平行线: '圆柱被平行轴线的平面截切 → 两条平行直素线',
};

/** 20 个复杂组合配方：叠合基底 + 3 个特征（均含椭圆/双曲线/抛物线/圆之一或孔系相贯） */
export const CONIC_RECIPES = [
  { id: 'w01', stack: 'cylStep', feats: ['bore', 'crossHoles', 'obliqueCut'], conic: '椭圆', tag: '阶梯圆柱 + 十字孔系 + 斜截' },
  { id: 'w02', stack: 'cylStep', feats: ['bore', 'radialHole', 'stepCut'], conic: '圆', tag: '阶梯圆柱 + 径向孔 + 台阶截切' },
  { id: 'w03', stack: 'cylStep', feats: ['crossHoles', 'obliqueCut', 'radialHole'], conic: '椭圆', tag: '阶梯圆柱 + 十字孔 + 斜截 + 径向孔' },
  { id: 'w04', stack: 'cylCone', feats: ['bore', 'paraCut', 'radialHole'], conic: '抛物线', tag: '锥柱组合 + 通孔 + 平行素线截切 + 径向孔' },
  { id: 'w05', stack: 'cylCone', feats: ['bore', 'crossCyl', 'stepCut'], conic: '圆', tag: '锥柱组合 + 通孔 + 横向相贯圆柱 + 台阶切' },
  { id: 'w06', stack: 'cylCone', feats: ['crossHoles', 'hyperCut', 'bore'], conic: '双曲线', tag: '锥柱组合 + 十字孔 + 平行轴线截切' },
  { id: 'w07', stack: 'frustumCyl', feats: ['bore', 'obliqueCut', 'crossHoles'], conic: '椭圆', tag: '台柱组合 + 通孔 + 斜截 + 十字孔' },
  { id: 'w08', stack: 'frustumCyl', feats: ['bore', 'hyperCut', 'radialHole'], conic: '双曲线', tag: '台柱组合 + 通孔 + 平行轴线截切 + 径向孔' },
  { id: 'w09', stack: 'frustumCyl', feats: ['stepCut', 'bore', 'crossCyl'], conic: '圆', tag: '台柱组合 + 台阶切 + 通孔 + 横向相贯' },
  { id: 'w10', stack: 'frustumCyl', feats: ['paraCut', 'crossHoles', 'bore'], conic: '抛物线', tag: '台柱组合 + 平行素线截切 + 十字孔 + 通孔' },
  { id: 'w11', stack: 'cylFlange', feats: ['bore', 'crossHoles', 'radialHole'], conic: '圆', tag: '法兰轴 + 通孔 + 十字孔 + 径向孔' },
  { id: 'w12', stack: 'cylFlange', feats: ['obliqueCut', 'bore', 'slot'], conic: '椭圆', tag: '法兰轴 + 斜截 + 通孔 + 顶槽' },
  { id: 'w13', stack: 'cylFlange', feats: ['crossCyl', 'bore', 'stepCut'], conic: '圆', tag: '法兰轴 + 横向相贯 + 通孔 + 台阶切' },
  { id: 'w14', stack: 'coneCone', feats: ['bore', 'hyperCut', 'radialHole'], conic: '双曲线', tag: '双锥组合 + 通孔 + 平行轴线截切 + 径向孔' },
  { id: 'w15', stack: 'coneCone', feats: ['bore', 'paraCut', 'crossHoles'], conic: '抛物线', tag: '双锥组合 + 通孔 + 平行素线截切 + 十字孔' },
  { id: 'w16', stack: 'coneCone', feats: ['stepCut', 'bore', 'radialHole'], conic: '圆', tag: '双锥组合 + 台阶切 + 通孔 + 径向孔' },
  { id: 'w17', stack: 'cylStep', feats: ['crossCyl', 'crossHoles', 'bore'], conic: '两条平行线', tag: '阶梯圆柱 + 横向相贯 + 十字孔 + 通孔' },
  { id: 'w18', stack: 'cylCone', feats: ['crossCyl', 'bore', 'hyperCut'], conic: '双曲线', tag: '锥柱组合 + 横向相贯 + 通孔 + 平行轴线截切' },
  { id: 'w19', stack: 'frustumCyl', feats: ['crossCyl', 'paraCut', 'bore'], conic: '抛物线', tag: '台柱组合 + 横向相贯 + 平行素线截切 + 通孔' },
  { id: 'w20', stack: 'cylFlange', feats: ['crossHoles', 'hyperCut', 'stepCut'], conic: '双曲线', tag: '法兰轴 + 十字孔 + 平行轴线截切 + 台阶切' },
  { id: 'w21', stack: 'sphereCyl', feats: ['bore', 'obliqueCut', 'radialHole'], conic: '椭圆', tag: '球柱组合 + 通孔 + 斜截 + 径向孔' },
  { id: 'w22', stack: 'sphereCyl', feats: ['hyperCut', 'bore', 'crossHoles'], conic: '双曲线', tag: '球柱组合 + 平行轴线截切 + 十字孔' },
  { id: 'w23', stack: 'tubeCone', feats: ['bore', 'stepCut', 'radialHole'], conic: '圆', tag: '圆筒锥顶 + 通孔 + 台阶切 + 径向孔' },
  { id: 'w24', stack: 'tubeCone', feats: ['bore', 'obliqueCut', 'crossCyl'], conic: '椭圆', tag: '圆筒锥顶 + 通孔 + 斜截 + 横向相贯' },
  { id: 'w25', stack: 'sphereFrustum', feats: ['bore', 'hyperCut', 'radialHole'], conic: '双曲线', tag: '球台组合 + 通孔 + 平行轴线截切 + 径向孔' },
  { id: 'w26', stack: 'sphereFrustum', feats: ['crossHoles', 'stepCut', 'bore'], conic: '圆', tag: '球台组合 + 十字孔 + 台阶切 + 通孔' },
  { id: 'w27', stack: 'sphereCone', feats: ['bore', 'paraCut', 'radialHole'], conic: '抛物线', tag: '球锥组合 + 通孔 + 平行素线截切 + 径向孔' },
  { id: 'w28', stack: 'sphereCone', feats: ['crossCyl', 'stepCut', 'bore'], conic: '圆', tag: '球锥组合 + 横向相贯 + 台阶切 + 通孔' },
  { id: 'w29', stack: 'tubeStep', feats: ['bore', 'obliqueCut', 'radialHole'], conic: '椭圆', tag: '阶梯圆筒 + 通孔 + 斜截 + 径向孔' },
  { id: 'w30', stack: 'tubeStep', feats: ['crossHoles', 'radialHole', 'bore'], conic: '圆', tag: '阶梯圆筒 + 十字孔 + 径向孔 + 通孔' },
  { id: 'w31', stack: 'sphereBase', feats: ['bore', 'stepCut', 'radialHole'], conic: '圆', tag: '球底立柱 + 通孔 + 台阶切 + 径向孔' },
  { id: 'w32', stack: 'sphereBase', feats: ['obliqueCut', 'bore', 'crossHoles'], conic: '椭圆', tag: '球底立柱 + 斜截 + 通孔 + 十字孔' },
];

export const CONIC_VARIANTS = 26;

export function makeConic(seed) {
  const ri = seed % CONIC_RECIPES.length;
  const vi = Math.floor(seed / CONIC_RECIPES.length) % CONIC_VARIANTS;
  const rec = CONIC_RECIPES[ri];
  const rand = rng(seed * 6971 + 31);
  const g = STACKS[rec.stack](rand);

  const prims = [...g.prims];
  const labels = [];
  const steps = [];
  const traps = [];
  const methods = new Set(['形体分析法']);
  const kinds = { 截交: 0, 相贯: 0 };

  // 特征全部启用；轮廓是否闭合由 build-bank3 的栅格闸门把关
  // 十字孔与同轴通孔同时存在时，中心会叠出 4 条交线 + 2 个孔口圆，
  // 在 2.5px/mm 下根本看不清结构 —— 去掉同轴通孔，保留可读的十字孔
  let feats = rec.feats.slice();
  if (feats.includes('crossHoles') && feats.includes('bore')) {
    feats = feats.filter((k) => k !== 'bore');
  }
  for (const key of feats) {
    const f = FEATURES[key](rand, g);
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
    meta: { ...g, labels, kinds },
    base: rec.stack,
    name: `${g.name}（截交线：${rec.conic}）`,
    features: rec.feats,
    recipeId: rec.id,
    variant: vi + 1,
    conic: rec.conic,
    text: {
      idea:
        `本题为「${rec.tag}」型复杂组合体，共含 ${kindText}。` +
        `解题顺序：先按各层回转体画出外形轮廓 → 逐个切除/叠加特征求交线（${CONIC_TEXT[rec.conic]}）→ 处理孔系相贯 → 最后判可见性、断开被切轮廓。`,
      steps: [
        `分层看形体：${g.name}由多段回转体叠合，先分别画出每一段的转向轮廓线，注意层与层之间直径突变处的水平线。`,
        ...steps,
        '统一核对长对正、高平齐、宽相等，并逐条检查：被切掉的那段轮廓是否已断开、孔系的相贯线是否按空间曲线画出。',
      ],
      pitfalls: [
        ...traps,
        `本题截交线为${rec.conic}，判据是：${CONIC_TEXT[rec.conic]}。类型判错则整个画法错。`,
        '多层叠合体容易漏画层间分界线（直径突变处）。',
      ],
      methods: [...methods],
    },
  };
}

export function conicCount() {
  return CONIC_RECIPES.length * CONIC_VARIANTS;
}
