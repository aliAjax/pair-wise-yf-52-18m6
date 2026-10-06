const assert = require('assert');
const M = require('/tmp/tourtest/tour.model.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('  ok -', name);
}

const versions = M.buildInitialVersions();
const theaters = M.buildInitialTheaters();
const hz = theaters.find((t) => t.id === 't-hz');
const nj = theaters.find((t) => t.id === 't-nj');

const mutate = (v, fn) => { const c = structuredClone(v); fn(c); return c; };

// 1. 初始队列：三提示，南京缺道具设备
check('初始：杭州队列状态为 2 pending + 1 pending(c3)，南京道具缺设备', () => {
  const qHz = M.buildQueue(versions[0], hz, []);
  assert.deepStrictEqual(qHz.map((i) => i.status), ['pending', 'pending', 'pending']);
  const qNj = M.buildQueue(versions[0], nj, []);
  assert.strictEqual(qNj.find((i) => i.cue.id === 'c2').status, 'missingDevice');
  assert.strictEqual(qNj.find((i) => i.cue.id === 'c1').status, 'pending');
});

// 2. 门禁：缺确认不能进；全部闭环可进
check('门禁：未确认/缺设备不放行；全绿放行', () => {
  const blocked = M.rehearsalGate(versions[0], hz, []);
  assert.strictEqual(blocked.allowed, false);
  assert.ok(blocked.reasons.some((r) => r.includes('尚未')));
  const njBlocked = M.rehearsalGate(versions[0], nj, []);
  assert.ok(njBlocked.reasons.some((r) => r.includes('缺少道具设备')));
});

// 3. 权限：只有场务/舞台监督能确认；只有导演能覆盖
check('权限：演员越权确认被拒，场务可确认，导演不可常规确认但可覆盖', () => {
  const qHz = M.buildQueue(versions[0], hz, []);
  const c1 = qHz.find((i) => i.cue.id === 'c1');
  assert.strictEqual(M.denyConfirm('actor', c1), 'unauthorized-confirm');
  assert.strictEqual(M.denyConfirm('director', c1), 'unauthorized-confirm');
  assert.strictEqual(M.denyConfirm('crew', c1), null);
  assert.strictEqual(M.denyConfirm('stageManager', c1), null);
  // 导演覆盖失效项
  const staleCue = mutate(versions[0], (v) => {
    v.lines[0].text = '你总说明天，但今晚必须把话说完。';
  });
  const qStale = M.buildQueue(staleCue, hz, []);
  const c1Stale = qStale.find((i) => i.cue.id === 'c1');
  assert.strictEqual(c1Stale.status, 'stale');
  assert.strictEqual(M.denyConfirm('crew', c1Stale), 'anchor-invalid');
  assert.strictEqual(M.denyOverride('stageManager', c1Stale), 'unauthorized-override');
  assert.strictEqual(M.denyOverride('director', c1Stale), null);
});

// 4. 台词一改，已确认提示立即失效；重算后旧确认仍失效，重新确认才闭环
check('锚点：台词变更使确认立即失效；重算 r2 后 r1 确认不复活', () => {
  // 先在杭州确认 c1（模拟 reducer 落账的 record）
  const v0 = versions[0];
  const cue = v0.cues.find((c) => c.id === 'c1');
  const rec = {
    key: 't-hz:c1', theaterId: 't-hz', cueId: 'c1', equipmentSerial: 'L-01',
    role: 'stageManager', fingerprint: cue.anchor.fingerprint,
    anchorRevision: 1, receiptId: 'r-1', at: 1, overridden: false
  };
  assert.strictEqual(M.buildQueue(v0, hz, [rec]).find((i) => i.cue.id === 'c1').status, 'confirmed');

  // 改台词 -> stale
  const v1 = mutate(v0, (v) => { v.lines[0].text = '改了台词文本'; });
  assert.strictEqual(M.buildQueue(v1, hz, [rec]).find((i) => i.cue.id === 'c1').status, 'stale');

  // 重算锚点 r2
  const v2 = mutate(v1, (v) => {
    v.cues[0].anchor.fingerprint = M.lineFingerprint(v.lines[0].text);
    v.cues[0].anchor.anchorRevision = 2;
  });
  assert.strictEqual(M.buildQueue(v2, hz, [rec]).find((i) => i.cue.id === 'c1').status, 'pending');
  assert.strictEqual(M.buildQueue(v2, hz, [rec]).find((i) => i.cue.id === 'c1').anchorState, 'bound');
});

// 5. 锚点台词删除 -> missingAnchor，重算被拒
check('锚点：台词删除为 missingAnchor', () => {
  const v = mutate(versions[0], (x) => { x.lines = x.lines.filter((l) => l.id !== 'l1'); });
  const item = M.buildQueue(v, hz, []).find((i) => i.cue.id === 'c1');
  assert.strictEqual(item.anchorState, 'missing');
  assert.strictEqual(item.status, 'missingAnchor');
});

// 6. 不同场馆确认结果分库
check('分库：杭州确认不影响南京；南京道具仍缺设备', () => {
  const cue = versions[0].cues.find((c) => c.id === 'c1');
  const recHz = {
    key: 't-hz:c1', theaterId: 't-hz', cueId: 'c1', equipmentSerial: 'L-01',
    role: 'crew', fingerprint: cue.anchor.fingerprint,
    anchorRevision: 1, receiptId: 'r-hz', at: 1, overridden: false
  };
  assert.strictEqual(M.buildQueue(versions[0], hz, [recHz]).find((i) => i.cue.id === 'c1').status, 'confirmed');
  const qNj = M.buildQueue(versions[0], nj, [recHz]);
  assert.strictEqual(qNj.find((i) => i.cue.id === 'c1').status, 'pending');
});

// 7. 导演覆盖只作用一个场馆，且能让门禁放行
check('导演覆盖：仅当前场馆生效并放开门禁', () => {
  // 南京缺道具设备，导演在南京覆盖 c2
  const cue = versions[0].cues.find((c) => c.id === 'c2');
  const rec = {
    key: 't-nj:c2', theaterId: 't-nj', cueId: 'c2', equipmentSerial: null,
    role: 'director', fingerprint: cue.anchor.fingerprint,
    anchorRevision: 1, receiptId: 'ov-1', at: 1, overridden: true
  };
  assert.strictEqual(M.buildQueue(versions[0], nj, [rec]).find((i) => i.cue.id === 'c2').status, 'overridden');
  // 杭州不受影响
  assert.strictEqual(M.buildQueue(versions[0], hz, [rec]).find((i) => i.cue.id === 'c2').status, 'pending');
});

// 8. 离线回执：按设备序号合并；重复只算一次
check('合并：按设备序号排序，重复回执只入账一次', () => {
  const fp = versions[0].cues.find((c) => c.id === 'c1').anchor.fingerprint;
  const mk = (id, serial) => ({
    id, theaterId: 't-hz', cueId: 'c1', equipmentSerial: serial, role: 'crew',
    fingerprint: fp, anchorRevision: 1, at: 1, attempts: 0, status: 'pending'
  });
  const receipts = [mk('r-9', 'S-01'), mk('r-1', 'L-01'), mk('r-1-dup', 'L-01')];
  const r1 = M.mergeOutbox({ receipts, version: versions[0], ledger: [], injectFailure: false });
  assert.strictEqual(r1.merged.length, 2);
  assert.strictEqual(r1.duplicates.length, 1);
  // 合并顺序按设备序号：L-01 在 S-01 前
  assert.deepStrictEqual(r1.merged.map((x) => x.equipmentSerial), ['L-01', 'S-01']);
  assert.strictEqual(r1.ledger.length, 2);
  // 再来一轮，已入账的全部判重
  const again = M.mergeOutbox({
    receipts: r1.receipts.map((x) => ({ ...x, status: 'pending' })),
    version: versions[0], ledger: r1.ledger, injectFailure: false
  });
  assert.strictEqual(again.merged.length, 0);
  assert.strictEqual(again.duplicates.length, 3);
});

// 9. 合并中断：未完成队列保留 + attempts，续传后成功
check('断点续传：中途故障保留 pending 并累加 attempts，续传成功', () => {
  const cues = [['c1', 'L-01'], ['c2', 'P-01'], ['c3', 'S-01']];
  const mk = (cueId, serial) => ({
    id: `r-${cueId}`, theaterId: 't-hz', cueId, equipmentSerial: serial, role: 'stageManager',
    fingerprint: versions[0].cues.find((c) => c.id === cueId).anchor.fingerprint,
    anchorRevision: 1, at: 1, attempts: 0, status: 'pending'
  });
  const receipts = cues.map(([c, s]) => mk(c, s));
  const half = M.mergeOutbox({ receipts, version: versions[0], ledger: [], injectFailure: true });
  assert.strictEqual(half.merged.length, 1); // floor(3/2)=1
  assert.strictEqual(half.pending.length, 2);
  assert.ok(half.pending.every((r) => r.attempts === 1 && r.failReason === 'link-down'));
  const rest = M.mergeOutbox({ receipts: half.receipts, version: versions[0], ledger: half.ledger, injectFailure: false });
  assert.strictEqual(rest.merged.length, 2);
  assert.strictEqual(rest.pending.length, 0);
  assert.strictEqual(rest.ledger.length, 3);
});

// 10. 合并时锚点已漂移 -> 失败回执不再续传
check('合并：锚点已变更的回执判 anchor-drifted', () => {
  const oldFp = versions[0].cues[0].anchor.fingerprint;
  const changed = mutate(versions[0], (v) => {
    v.cues[0].anchor.fingerprint = 'deadbeef';
    v.cues[0].anchor.anchorRevision = 2;
  });
  const receipts = [{
    id: 'r-old', theaterId: 't-hz', cueId: 'c1', equipmentSerial: 'L-01', role: 'crew',
    fingerprint: oldFp, anchorRevision: 1, at: 1, attempts: 0, status: 'pending'
  }];
  const r = M.mergeOutbox({ receipts, version: changed, ledger: [], injectFailure: false });
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.rejected[0].failReason, 'anchor-drifted');
  assert.strictEqual(r.rejected[0].status, 'failed');
  assert.strictEqual(r.pending.length, 0);
});

// 11. 全绿后门禁放行（含导演覆盖缺设备项）
check('门禁：确认+导演覆盖组合可闭环', () => {
  const recs = versions[0].cues.map((c, idx) => ({
    key: `t-nj:${c.id}`, theaterId: 't-nj', cueId: c.id,
    equipmentSerial: c.kind === 'prop' ? null : `L-${idx}`,
    role: c.kind === 'prop' ? 'director' : 'stageManager',
    fingerprint: c.anchor.fingerprint, anchorRevision: 1,
    receiptId: `x-${c.id}`, at: 1, overridden: c.kind === 'prop'
  }));
  const gate = M.rehearsalGate(versions[0], nj, recs);
  assert.strictEqual(gate.allowed, true);
});

console.log(`\n${passed} 组断言全部通过`);
