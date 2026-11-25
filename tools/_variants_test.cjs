// 新玩法验收：固定解谜盘、回响鼓和无尽改造的关卡流程
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]+?)<\/script>/)[1];
const noop = () => {};
const nodes = new Map();
const storage = new Map();

function element() {
  const classes = new Set();
  const events = new Map();
  return {
    style: {}, children: [], clientWidth: 400, clientHeight: 620,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    set innerHTML(value) { this.children = []; },
    appendChild(child) { this.children.push(child); },
    addEventListener(name, handler) { events.set(name, handler); },
    click() { events.get('click')(); },
    getContext: () => ({ setTransform: noop })
  };
}

function node(id) {
  if (!nodes.has(id)) nodes.set(id, element());
  return nodes.get(id);
}

const expose = [
  'draw = function () {};',
  'return { get state() { return S; }, home, startLevel, knock, clearLevel,',
  '  advance: function (ms) { frame(last + ms); } };',
  '})();'
].join('\n');
const game = new vm.Script(script.replace(/\}\)\(\);\s*$/, expose), { filename: 'index.html' }).runInNewContext({
  document: { getElementById: node, createElement: element, body: element(), addEventListener: noop },
  window: { addEventListener: noop },
  location: { search: '' },
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  requestAnimationFrame: noop, setTimeout: noop, clearTimeout: noop
});

function click(prefix) {
  const button = node('card').children[0].children.find(child => child.textContent.startsWith(prefix));
  assert.ok(button, '找不到按钮 ' + prefix);
  button.click();
}

function settle(fps = 60) {
  for (let n = 0; n < fps * 4 && game.state.puzzle.active; n++) game.advance(1000 / fps);
  assert.equal(game.state.puzzle.active, false, '这一锤应当结算');
  assert.equal(game.state.waves.length, 0, '等冲击波消散后才结算');
}

function positions() {
  return Array.from(game.state.balls, ball => [ball.lv, ball.x, ball.y]);
}

click('🧩 一锤解谜');
click('1 · 圈内合体');
const initial = positions();
game.knock(237, 592);
settle();
const miss = game.state.puzzle.lastMerge;
assert.equal(miss.lv, 2);
assert.equal(game.state.puzzle.solved, false, '圈外合出猫仍须重试');
click('原盘重试');
assert.deepEqual(positions(), initial);
assert.equal(game.state.puzzle.lastMerge, miss);

// 验证首题的触屏容差。改变帧率也应得到同一个解谜结果。
for (const x of [21, 36, 51]) {
  for (const y of [567, 582, 597]) {
    game.startLevel(1, 'puzzle');
    game.knock(x, y);
    settle(y === 582 ? 30 : 60);
    assert.ok(game.state.puzzle.solved, '首题应接受落点 ' + x + ', ' + y);
  }
}

click('下一题');
game.knock(37, 591);
game.knock(378, 602);
assert.equal(game.state.taps, 1, '连锁期间不能消耗第二锤');
settle(30);
assert.equal(game.state.frozen, false);
assert.equal(game.state.puzzle.solved, false);
assert.ok(game.state.balls[0].x > 150, '首锤把左兔送到中间');
game.knock(378, 602);
settle(60);
assert.ok(game.state.puzzle.solved);

click('下一题');
const waves = game.state.waves;
let echoes = 0;
waves.push = function (wave) {
  if (wave.kind === 'echo') echoes++;
  return Array.prototype.push.call(this, wave);
};
game.knock(55, 570);
settle();
assert.equal(echoes, 1, '一锤只能触发一次回响');
assert.ok(game.state.puzzle.solved);
assert.deepEqual(JSON.parse(storage.get('zz_puzzles')), { 1: true, 2: true, 3: true });
game.startLevel(3, 'puzzle');
game.state.plan = { ...game.state.plan, drum: null };
game.knock(55, 570);
settle();
assert.equal(game.state.puzzle.solved, false, '同一落点靠鼓的第二道波才会合体');
console.log('PASS 解谜通关、落点容差、原盘重试、回响触发与存档');

function completeWave() {
  const state = game.state;
  const total = state.runScore + state.target + state.taps * 15;
  state.score = state.target;
  game.clearLevel();
  assert.equal(node('hChain').textContent, '总分 ' + total, '本波得分只计入一次');
  return total;
}

game.home();
click('♾️ 无尽模式');
for (const wave of [1, 2]) {
  assert.equal(game.state.level, wave);
  assert.equal(game.state.hammerMod, null);
  const total = completeWave();
  click('下一波');
  assert.equal(game.state.runScore, total);
}
const firstTotal = completeWave();
click('小范围强冲击');
assert.equal(game.state.level, 4);
assert.equal(game.state.runScore, firstTotal);
game.knock(200, 450);
assert.ok(game.state.waves[0].max < 205 && game.state.waves[0].power > 760);
game.knock(200, 450, 'heavy');
assert.equal(game.state.waves[1].power, 1180);
node('btnRestart').click();
assert.equal(game.state.level, 4);
assert.equal(game.state.hammerMod, 'focused');
assert.equal(game.state.runScore, firstTotal);

for (const wave of [4, 5, 6]) {
  assert.equal(game.state.level, wave);
  assert.equal(game.state.hammerMod, 'focused');
  const total = completeWave();
  if (wave < 6) click('下一波');
  else click('大范围弱冲击');
  assert.equal(game.state.runScore, total);
}
assert.equal(game.state.level, 7);
assert.equal(game.state.hammerMod, 'wide');
game.knock(200, 450);
assert.ok(game.state.waves[0].max > 205 && game.state.waves[0].power < 760);
const banked = completeWave();
click('见好就收');
assert.deepEqual(JSON.parse(storage.get('zz_endless')), { wave: 7, score: banked });
console.log('PASS 无尽改造生效三波、重敲保留改造、换档与结算');
