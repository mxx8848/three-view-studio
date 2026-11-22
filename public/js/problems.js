// 题库入口：合并生成的 244 道题，并保留线型定义与视图元信息
import { BANK } from './bank.generated.js';

/** GB/T 4457.4—2002 常用图线
 *  实际显示尺寸比标准略加粗（0.5→0.8 / 0.25→0.45），因为屏幕像素密度下标准线宽偏细、发灰；
 *  比例关系仍按标准：粗实线 ≈ 细线 2 倍。 */
export const LINE_STYLES = {
  v: { name: '粗实线', gb: '可见轮廓线', width: 1.0, dash: null },
  t: { name: '细实线', gb: '尺寸线/剖面线', width: 0.45, dash: null },
  h: { name: '虚线', gb: '不可见轮廓线', width: 0.55, dash: [5, 2.2] },
  c: { name: '细点画线', gb: '轴线/对称中心线', width: 0.38, dash: [14, 2, 3, 2] },
};

export const VIEW_NAME = { front: '主视图', top: '俯视图', side: '左视图' };
export const VIEW_NOTE = {
  front: '由前向后投影 · 反映长与高',
  top: '由上向下投影 · 反映长与宽',
  side: '由左向右投影 · 反映宽与高',
};

/** 全部题目（由 tools/build-bank.js 生成，勿手改） */
export const PROBLEMS = BANK;

/**
 * 已经过目视核对的题型家族。
 * 未列入的家族：三视图由 CSG 布尔运算的网格投影生成，
 * 布尔产生的 T 形接点会让少数轮廓线缺失或多余，需人工再过一遍。
 */
export const VERIFIED_FAMILIES = new Set([
  'L', 'T', 'U', 'STEP', 'HOLE_Y', 'SHAFT', 'SPHERE',
  'CYL_STEP', 'CONE_CUT', 'SPHERE_CUT', 'PRISM_SLANT',
  'CYL_CYL_EQ', 'CYL_CYL_UNEQ', 'CYL_HOLE_CROSS', 'CYL_SPHERE', 'CYL_CONE',
  'BOX_BOX', 'BOX_CYL', 'RIB', 'SLOT_THROUGH', 'WEDGE', 'PRISM_HOLE',
  'CONE_BASE', 'CYL_TWO_HOLES',
  // 回转体截交（圆锥/圆台/圆柱）
  'q01', 'q02', 'q03', 'q04', 'q05', 'q06', 'q07', 'q08', 'q09', 'q10', 'q11', 'q12', 'q13', 'q14', 'q15', 'q16', 'q17', 'q18', 'q19', 'q20',
  'w01', 'w02', 'w03', 'w04', 'w05', 'w06', 'w07', 'w08', 'w09', 'w10', 'w11', 'w12', 'w13', 'w14', 'w15', 'w16', 'w17', 'w18', 'w19', 'w20',
]);

export function isVerified(p) {
  return VERIFIED_FAMILIES.has(p.family);
}

export function getProblem(id) {
  return PROBLEMS.find((p) => p.id === id) || null;
}

/** 按家族聚合，用于题目选择器分组与"方法例子"跳转 */
export function familyIndex() {
  const map = new Map();
  for (let i = 0; i < PROBLEMS.length; i += 1) {
    const p = PROBLEMS[i];
    if (!map.has(p.family)) {
      map.set(p.family, { family: p.family, name: p.familyName, tag: p.tag, first: i, count: 0 });
    }
    map.get(p.family).count += 1;
  }
  return [...map.values()];
}

export function firstIndexOfFamily(family) {
  return PROBLEMS.findIndex((p) => p.family === family);
}
