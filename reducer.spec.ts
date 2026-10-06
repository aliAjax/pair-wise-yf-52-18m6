import assert from 'assert';
import '@angular/compiler';
import { scriptReducer, ScriptState } from './src/app/state/script.reducer';
import { buildQueue } from './src/app/state/tour.model';
import * as A from './src/app/state/script.actions';

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log('  ok -', name); };

let s: ScriptState = scriptReducer(undefined, { type: '__init__' } as never);

const queue = (state: ScriptState) => {
  const v = state.versions.find((x) => x.id === state.activeVersionId)!;
  const t = state.theaters.find((x) => x.id === state.activeTheaterId)!;
  return { v, t, items: buildQueue(v, t, state.records) };
};

check('初始：v12 锁定、杭州、舞台监督、门禁拦截', () => {
  assert.strictEqual(s.activeVersionId, 'v12');
  assert.strictEqual(s.currentRole, 'stageManager');
  assert.ok(queue(s).items.length === 3);
  s = scriptReducer(s, A.toggleRehearsal());
  assert.strictEqual(s.rehearsalMode, false);
  assert.strictEqual(s.denial?.code, 'rehearsal-blocked');
  s = scriptReducer(s, A.clearDenial());
});

check('越权：演员确认被拒；切换为场务后确认成功（杭州 c1）', () => {
  s = scriptReducer(s, A.switchRole({ role: 'actor' }));
  s = scriptReducer(s, A.confirmCue({ cueId: 'c1' }));
  assert.strictEqual(s.denial?.code, 'unauthorized-confirm');
  s = scriptReducer(s, A.clearDenial());
  s = scriptReducer(s, A.switchRole({ role: 'crew' }));
  s = scriptReducer(s, A.confirmCue({ cueId: 'c1' }));
  assert.strictEqual(s.denial, null);
  assert.strictEqual(queue(s).items.find((i) => i.cue.id === 'c1')?.status, 'confirmed');
});

check('台词一改：c1 立即失效为 stale，旧确认不复活', () => {
  s = scriptReducer(s, A.editLineText({ id: 'l1', text: '换场后新台词：今晚必须把话说完。' }));
  assert.strictEqual(queue(s).items.find((i) => i.cue.id === 'c1')?.status, 'stale');
  // 场务无法确认失效项
  s = scriptReducer(s, A.confirmCue({ cueId: 'c1' }));
  assert.strictEqual(s.denial?.code, 'anchor-invalid');
  s = scriptReducer(s, A.clearDenial());
});

check('非导演覆盖被拒；导演覆盖后杭州放行该提示', () => {
  s = scriptReducer(s, A.switchRole({ role: 'stageManager' }));
  s = scriptReducer(s, A.overrideCue({ cueId: 'c1' }));
  assert.strictEqual(s.denial?.code, 'unauthorized-override');
  s = scriptReducer(s, A.clearDenial());
  s = scriptReducer(s, A.switchRole({ role: 'director' }));
  s = scriptReducer(s, A.overrideCue({ cueId: 'c1' }));
  assert.strictEqual(s.denial, null);
  assert.strictEqual(queue(s).items.find((i) => i.cue.id === 'c1')?.status, 'overridden');
});

check('重算锚点 r2：导演覆盖随旧修订作废，需重新处置', () => {
  s = scriptReducer(s, A.switchRole({ role: 'stageManager' }));
  s = scriptReducer(s, A.recomputeCue({ cueId: 'c1' }));
  const item = queue(s).items.find((i) => i.cue.id === 'c1')!;
  assert.strictEqual(item.anchorState, 'bound');
  assert.strictEqual(item.cue.anchor.anchorRevision, 2);
  assert.strictEqual(item.status, 'pending');
  // 重新确认
  s = scriptReducer(s, A.confirmCue({ cueId: 'c1' }));
  assert.strictEqual(queue(s).items.find((i) => i.cue.id === 'c1')?.status, 'confirmed');
});

check('分场馆：杭州已闭环的 c1 在南京仍为 pending', () => {
  s = scriptReducer(s, A.activateTheater({ id: 't-nj' }));
  assert.strictEqual(queue(s).items.find((i) => i.cue.id === 'c1')?.status, 'pending');
  // 南京 c2 缺道具设备
  assert.strictEqual(queue(s).items.find((i) => i.cue.id === 'c2')?.status, 'missingDevice');
});

check('离线：场务确认 c2 缺设备被拒；导演覆盖后进离线回执队列（c3 音效）', () => {
  s = scriptReducer(s, A.switchRole({ role: 'crew' }));
  s = scriptReducer(s, A.setOnline({ online: false }));
  s = scriptReducer(s, A.confirmCue({ cueId: 'c2' }));
  assert.strictEqual(s.denial?.code, 'device-missing');
  s = scriptReducer(s, A.clearDenial());
  // c1 灯光、c3 音效可离线确认
  s = scriptReducer(s, A.confirmCue({ cueId: 'c1' }));
  s = scriptReducer(s, A.confirmCue({ cueId: 'c3' }));
  // 重复点 c3：离线允许再次入队（合并端去重），验证重复回执只算一次
  s = scriptReducer(s, A.confirmCue({ cueId: 'c3' }));
  assert.strictEqual(s.outbox.filter((r) => r.cueId === 'c3').length, 2);
});

check('回网自动按设备序号合并：入账2条，重复1条，南京 c1/c3 已确认', () => {
  s = scriptReducer(s, A.setOnline({ online: true }));
  assert.strictEqual(s.lastMerge?.merged, 2);
  assert.strictEqual(s.lastMerge?.duplicates, 1);
  assert.strictEqual(s.lastMerge?.pending, 0);
  const q = queue(s).items;
  assert.strictEqual(q.find((i) => i.cue.id === 'c1')?.status, 'confirmed');
  assert.strictEqual(q.find((i) => i.cue.id === 'c3')?.status, 'confirmed');
});

check('南京仍缺 c2 道具设备：导演覆盖后门禁全部放行，进入提词', () => {
  assert.ok(!queue(s).items.every((i) => i.status === 'confirmed' || i.status === 'overridden'));
  s = scriptReducer(s, A.switchRole({ role: 'director' }));
  s = scriptReducer(s, A.overrideCue({ cueId: 'c2' }));
  s = scriptReducer(s, A.toggleRehearsal());
  assert.strictEqual(s.rehearsalMode, true);
  assert.strictEqual(s.denial, null);
  s = scriptReducer(s, A.toggleRehearsal()); // 退出提词
});

check('断点续传：合并中途断网保留队列，手动续传成功', () => {
  s = scriptReducer(s, A.activateTheater({ id: 't-hz' }));
  s = scriptReducer(s, A.setOnline({ online: false }));
  s = scriptReducer(s, A.switchRole({ role: 'stageManager' }));
  // c2 道具尚未在杭州确认，离线确认；c1 已闭环再点会被 already-resolved 拦截
  s = scriptReducer(s, A.confirmCue({ cueId: 'c2' }));
  s = scriptReducer(s, A.confirmCue({ cueId: 'c1' }));
  assert.strictEqual(s.denial?.code, 'already-resolved');
  s = scriptReducer(s, A.clearDenial());
  assert.strictEqual(s.outbox.filter((r) => r.status === 'pending' && r.theaterId === 't-hz').length, 1);
  // 模拟两张待传回执：c2 正常入账，另一张 c2 重复回执只算一次
  const outboxState = s;
  const dupReceipt = structuredClone(outboxState.outbox.find((r) => r.cueId === 'c2' && r.status === 'pending')!);
  dupReceipt.id = 'r-dup-manual';
  s = { ...s, outbox: [...s.outbox, dupReceipt] };
  s = scriptReducer(s, A.mergeOutbox({ injectFailure: true })); // floor(2/2)=1 入账，1 保留
  assert.strictEqual(s.lastMerge?.pending, 1);
  assert.ok(s.outbox.some((r) => r.status === 'pending' && r.attempts === 1));
  s = scriptReducer(s, A.mergeOutbox({ injectFailure: false })); // 续传：第二张判 duplicate
  const c2Receipts = s.outbox.filter((r) => r.cueId === 'c2' && r.theaterId === 't-hz');
  assert.ok(c2Receipts.some((r) => r.status === 'duplicate'));
  assert.ok(c2Receipts.some((r) => r.status === 'merged'));
  assert.strictEqual(s.outbox.filter((r) => r.status === 'pending').length, 0);
});

check('锚点删除：提示 missingAnchor，门禁拦截且重算被拒', () => {
  s = scriptReducer(s, A.setOnline({ online: true }));
  s = scriptReducer(s, A.activateTheater({ id: 't-hz' }));
  s = scriptReducer(s, A.deleteLine({ id: 'l2' }));
  assert.strictEqual(queue(s).items.find((i) => i.cue.id === 'c2')?.status, 'missingAnchor');
  s = scriptReducer(s, A.switchRole({ role: 'stageManager' }));
  s = scriptReducer(s, A.recomputeCue({ cueId: 'c2' }));
  assert.strictEqual(s.denial?.code, 'recompute-unbound');
});

console.log(`\n${passed} 组 reducer 集成断言全部通过`);
