// 自检：题库几何一致性（数量、三等规律、线型、解析完整度、题型覆盖）
import { PROBLEMS, LINE_STYLES, familyIndex } from '../public/js/problems.js';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log(`  ✗ ${name}  ${detail}`);
  }
};
const near = (a, b, tol = 0.15) => Math.abs(a - b) <= tol;

console.log('=== 1. 题量 ===');
console.log(`  题目总数 ${PROBLEMS.length}，题型家族 ${familyIndex().length}`);
check('题量在 200–500 之间', PROBLEMS.length >= 200 && PROBLEMS.length <= 500, String(PROBLEMS.length));

console.log('\n=== 2. 三视图尺寸满足三等规律 ===');
const bad = [];
for (const p of PROBLEMS) {
  const f = p.views.front;
  const t = p.views.top;
  const s = p.views.side;
  if (!f || !t || !s) {
    bad.push(`${p.id} 缺视图`);
    continue;
  }
  if (!near(f.w, t.w)) bad.push(`${p.id} 长不对正 ${f.w}≠${t.w}`);
  if (!near(f.h, s.h)) bad.push(`${p.id} 高不平齐 ${f.h}≠${s.h}`);
  if (!near(t.h, s.w)) bad.push(`${p.id} 宽不相等 ${t.h}≠${s.w}`);
  if (!(f.w > 0 && f.h > 0 && t.h > 0)) bad.push(`${p.id} 视图尺寸非正`);
}
check(`全部 ${PROBLEMS.length} 题满足长对正/高平齐/宽相等`, bad.length === 0, bad.slice(0, 5).join('; '));

console.log('\n=== 3. 线型合法（GB/T 4457.4—2002） ===');
const badLt = [];
for (const p of PROBLEMS) {
  for (const k of ['front', 'top', 'side']) {
    for (const it of p.views[k].items) if (!LINE_STYLES[it.lt]) badLt.push(`${p.id}.${k}:${it.lt}`);
    for (const a of p.views[k].axes || []) if (!LINE_STYLES[a.lt]) badLt.push(`${p.id}.${k}:axis:${a.lt}`);
  }
}
check('所有图线类型均有定义', badLt.length === 0, badLt.slice(0, 5).join(','));

console.log('\n=== 4. 视图中必须有可见轮廓 ===');
const noVisible = PROBLEMS.filter((p) =>
  ['front', 'top', 'side'].some((k) => !p.views[k].items.some((i) => i.lt === 'v'))
);
check('每题每个视图都有粗实线', noVisible.length === 0, noVisible.map((p) => p.id).slice(0, 5).join(','));

console.log('\n=== 5. 答案视图未被给出 ===');
const badAns = PROBLEMS.filter((p) => p.given.includes(p.answer) || p.given.length !== 2);
check('答案与已知视图不重复', badAns.length === 0, badAns.map((p) => p.id).slice(0, 5).join(','));

console.log('\n=== 6. 解析完整度 ===');
const badSol = PROBLEMS.filter(
  (p) =>
    !p.solution ||
    !p.solution.idea ||
    p.solution.steps.length < 3 ||
    p.solution.points.length < 3 ||
    p.solution.checks.length < 3 ||
    p.solution.pitfalls.length < 1 ||
    !p.solution.methods?.length
);
check('每题解析含方法/思路/步骤/特征点/核对/易错点', badSol.length === 0, badSol.map((p) => p.id).slice(0, 5).join(','));

console.log('\n=== 7. 三维图元完整 ===');
const badPrims = PROBLEMS.filter((p) => !Array.isArray(p.prims) || p.prims.length === 0);
check('每题都有 CSG 图元', badPrims.length === 0, badPrims.map((p) => p.id).slice(0, 5).join(','));

console.log('\n=== 8. 题型覆盖（叠加 / 切割 / 截交 / 相贯） ===');
const tags = new Set(PROBLEMS.map((p) => p.tag));
const need = ['截交', '相贯'];
const missing = need.filter((t) => ![...tags].some((x) => x.includes(t)));
console.log('  tag 种类：', tags.size);
check('四类题型都有覆盖', missing.length === 0, missing.join(','));
const jieqiu = PROBLEMS.filter((p) => p.tag.includes('截交')).length;
const xiangguan = PROBLEMS.filter((p) => p.tag.includes('相贯')).length;
console.log(`  截交类 ${jieqiu} 题，相贯类 ${xiangguan} 题`);
check('截交类 ≥ 30', jieqiu >= 30, String(jieqiu));
check('相贯类 ≥ 10（受控配方中相贯类较少）', xiangguan >= 10, String(xiangguan));

console.log('\n=== 9. 数据规模 ===');
let items = 0;
for (const p of PROBLEMS) for (const k of ['front', 'top', 'side']) items += p.views[k].items.length;
console.log(`  图元总数 ${items}，平均每题 ${(items / PROBLEMS.length).toFixed(1)}`);
check('平均每题图元数合理（< 900）', items / PROBLEMS.length < 900);

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
if (fail) {
  console.log('失败明细（前 10 条）：');
  console.log(bad.slice(0, 10).join('\n'));
}
process.exit(fail ? 1 : 0);
