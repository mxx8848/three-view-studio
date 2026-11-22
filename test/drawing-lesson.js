import assert from 'node:assert/strict';
import { PROBLEMS } from '../public/js/problems.js';
import { DRAWING_STEPS, lessonView, projectionCoordinates } from '../public/js/drawing-lesson.js';
import { renderViewSVG } from '../public/js/views2d.js';

for (const problem of PROBLEMS) {
  for (const role of ['front', 'top', 'side']) {
    const view = problem.views[role];
    let previous = 0;
    for (let step = 0; step < DRAWING_STEPS.length; step += 1) {
      const current = lessonView(view, role, step);
      assert.ok(current.items.length >= previous, `${problem.id}: geometry must accumulate`);
      if (step < 4) assert.ok(current.items.every(i => i.lt === 'v'), 'hidden lines must wait for visibility analysis');
      previous = current.items.length;
    }
    assert.deepEqual(lessonView(view, role, 5).items, view.items, 'final frame must preserve the source drawing');
    assert.equal(lessonView(view, role, 0).items.length, 0);
    assert.ok(projectionCoordinates(view, 0).every(x => x >= 0 && x <= view.w));
  }
}
const circle = { w: 20, h: 20, items: [{ t: 'circle', c: [10, 10], r: 5, lt: 'v' }] };
assert.ok(!renderViewSVG(circle, { showCenters: false }).includes('lt-c'));
console.log(`${PROBLEMS.length} lessons: cumulative geometry, hidden-line stages, final fidelity passed`);
