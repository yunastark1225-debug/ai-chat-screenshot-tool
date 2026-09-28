const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../geometry.js');
const { outputSize, tileRect } = globalThis.CaptureGeometry;

for (const dpr of [1, 1.25, 1.5, 2, 3]) {
  for (const total of [500, 800, 801, 1599, 1600, 1601, 12573, 150000]) {
    test(`continuous coverage: DPR ${dpr}, ${total} CSS pixels`, () => {
      const viewport = 800;
      const output = outputSize(1200 * dpr, Math.ceil(total * dpr));
      const state = { totalHeight: total, coveredCssY: 0 };
      let outputBottom = 0;
      while (state.coveredCssY < total) {
        const y = Math.min(state.coveredCssY, Math.max(0, total - viewport));
        const tile = tileRect(state, y, viewport, viewport * dpr, output.height);
        assert.equal(tile.dy, outputBottom);
        assert.ok(tile.sy >= 0 && tile.sy + tile.sh <= viewport * dpr + 1e-7);
        outputBottom += tile.dh;
        state.coveredCssY = tile.bottom;
      }
      assert.equal(outputBottom, output.height);
      assert.ok(output.width <= 16384 && output.height <= 16384);
      assert.ok(output.width * output.height <= 32_000_000);
    });
  }
}
test('overlapping final tile crops the already captured rows', () => {
  assert.deepEqual(tileRect({ totalHeight: 1700, coveredCssY: 1600 }, 900, 800, 1600, 3400), {
    sy: 1400, sh: 200, dy: 3200, dh: 200, bottom: 1700
  });
});
test('a subpixel scroll position inside the overlap crops at the measured position', () => {
  const tile = tileRect({ totalHeight: 2400, coveredCssY: 800 }, 798.25, 800, 1000, 3000);
  assert.equal(tile.sy, 2.1875);
  assert.equal(tile.sh, 997.8125);
  assert.equal(tile.dy, 1000);
  assert.equal(tile.dh, 998);
  assert.equal(tile.bottom, 1598.25);
});
test('refuses gaps and repeated tiles', () => {
  assert.throws(() => tileRect({ totalHeight: 2000, coveredCssY: 800 }, 801, 800, 1600, 4000));
  assert.throws(() => tileRect({ totalHeight: 2000, coveredCssY: 800 }, 0, 800, 1600, 4000));
});
test('canvas caps both total memory and individual dimensions', () => {
  for (const [width, height] of [[100000, 100000], [2000, 1000000], [20000, 1000]]) {
    const size = outputSize(width, height);
    assert.ok(size.downscaled);
    assert.ok(size.width * size.height <= 32_000_000);
    assert.ok(Math.max(size.width, size.height) <= 16384);
  }
  for (const height of [0, -1, Infinity, NaN]) assert.throws(() => outputSize(100, height));
});
