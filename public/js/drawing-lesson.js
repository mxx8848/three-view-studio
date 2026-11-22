// 作图阶段直接筛选题目线稿；不按数组顺序或虚构特征点演示。
const NAMES = { front: '主视图', top: '俯视图', side: '左视图' };
export const DRAWING_STEPS = [
  { title: '确定投影位置与尺寸范围', roles: ['front', 'top', 'side'] },
  { title: '绘制主视图可见线', roles: ['front'] },
  { title: '长对正，绘制俯视图可见线', roles: ['front', 'top'] },
  { title: '高平齐、宽相等，绘制左视图可见线', roles: ['top', 'side'] },
  { title: '补画不可见轮廓与中心线', roles: ['front', 'top', 'side'] },
  { title: '核对三视图与三维实体', roles: ['front', 'top', 'side'] },
];

export function lessonView(view, role, step) {
  const visibleFrom = { front: 1, top: 2, side: 3 }[role];
  return { ...view,
    items: view.items.filter((item) => step >= 4 || (step >= visibleFrom && item.lt === 'v')),
    axes: step >= 4 ? view.axes || [] : [],
  };
}

export function lessonExplanation(problem, step) {
  const { front, top, side } = problem.views;
  if (step === 0) return `采用第一角投影：主视在上、俯视在下、左视在右。长度 ${front.w}，宽度 ${top.h}，高度 ${front.h}；绿色细线仅为作图辅助线。`;
  if (step === 1) return `从前向后观察，将主视图中可见的外轮廓、台阶与交线画为粗实线。本步显示 ${front.items.filter(i => i.lt === 'v').length} 个可见线图元，内部不可见线稍后补画。`;
  if (step === 2) return `把主视图的长度坐标传到俯视图：两图长度均为 ${front.w}。俯视图反映长与宽，宽度 ${top.h} 取自已知题图，不能仅靠主视图推定。`;
  if (step === 3) return `左视图高度 ${side.h} 与主视图平齐，宽度 ${side.w} 与俯视图深度 ${top.h} 相等。左视图右侧对应物体前方，转移深度时需要反向。`;
  if (step === 4) return ['front', 'top', 'side'].map(role => `${NAMES[role]} ${problem.views[role].items.filter(i => i.lt === 'h').length} 个虚线图元`).join('、') + '。被实体遮挡的轮廓画虚线；轴线和对称中心线画细点画线，不能把所有内线都当作孔。';
  return '三等规律：长对正、高平齐、宽相等。点击三维区的主视、俯视、左视按钮，从正投影视角逐一对照图线；具体形体分析见下方本题讲解。';
}

// 使用图中真实端点的坐标作为投影基准，限制数量以避免遮住题图。
export function projectionCoordinates(view, axis) {
  const maximum = axis === 0 ? view.w : view.h;
  const values = [0, maximum];
  for (const item of view.items) {
    if (item.lt !== 'v') continue;
    const pts = item.t === 'circle'
      ? [[item.c[0] - item.r, item.c[1] - item.r], [item.c[0] + item.r, item.c[1] + item.r]]
      : item.p || item.pts || [];
    for (const pt of pts) if (pt[axis] >= 0 && pt[axis] <= maximum) values.push(pt[axis]);
  }
  const sorted = [...new Set(values.map(v => +v.toFixed(2)))].sort((a, b) => a - b);
  if (sorted.length <= 7) return sorted;
  return Array.from({ length: 7 }, (_, i) => sorted[Math.round(i * (sorted.length - 1) / 6)]);
}
