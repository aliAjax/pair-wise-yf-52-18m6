import { createFeatureSelector, createSelector } from '@ngrx/store';
import { createReducer, on } from '@ngrx/store';
import {
  addEquipment,
  addTheater,
  addVersion,
  bindCueToLine,
  clearMergeLog,
  clearRejection,
  confirmCueRejected,
  confirmCueRequest,
  directorOverrideCue,
  activateVersion,
  mergeReceiptsProgress,
  removeEquipment,
  reorderLines,
  reviewCue,
  reviewLine,
  setActiveTheater,
  setOnline,
  setRole,
  toggleEquipmentAvailability,
  toggleRehearsal,
  unbindCue,
  updateLineText,
} from './script.actions';

// ---------------------------------------------------------------------------
// 领域类型
// ---------------------------------------------------------------------------

export type CueDecision = 'pending' | 'accepted' | 'returned';
export type ConfirmDecision = 'confirmed' | 'rejected';
export type CueType = 'prop' | 'lighting' | 'sound';
export type Role = 'stage_manager' | 'stage_supervisor' | 'director' | 'playwright' | 'actor';

export interface Equipment {
  serialNumber: string;
  name: string;
  type: CueType;
  available: boolean;
}

export interface Theater {
  id: string;
  name: string;
  equipment: Equipment[];
}

export interface Line {
  id: string;
  role: string;
  text: string;
  status: CueDecision;
}

export interface Cue {
  id: string;
  scene: string;
  text: string;
  type: CueType;
  status: CueDecision;
  anchorLineId: string | null;
  anchorHash: string | null;
  requiredTypes: CueType[];
}

export interface ScriptVersion {
  id: string;
  label: string;
  playwright: string;
  note: string;
  lines: Line[];
  cues: Cue[];
}

export interface CueConfirmation {
  cueId: string;
  theaterId: string;
  equipmentSerialNumber: string;
  decision: ConfirmDecision;
  confirmedBy: Role;
  confirmedAt: number;
  receiptId: string;
}

export interface Receipt {
  id: string;
  cueId: string;
  theaterId: string;
  equipmentSerialNumber: string;
  decision: ConfirmDecision;
  confirmedBy: Role;
  confirmedAt: number;
  merged: boolean;
  mergeAttempts: number;
  lastError: string | null;
}

export interface DirectorOverride {
  cueId: string;
  theaterId: string;
  overriddenBy: Role;
  overriddenAt: number;
}

export interface MergeLogEntry {
  id: string;
  receiptId: string;
  cueId: string;
  theaterId: string;
  equipmentSerialNumber: string;
  result: 'merged' | 'failed';
  error: string | null;
  timestamp: number;
}

export interface ScriptState {
  versions: ScriptVersion[];
  activeVersionId: string;
  rehearsalMode: boolean;
  online: boolean;
  theaters: Theater[];
  activeTheaterId: string;
  currentRole: Role;
  confirmations: CueConfirmation[];
  receipts: Receipt[];
  directorOverrides: DirectorOverride[];
  mergeLog: MergeLogEntry[];
  lastRejection: { cueId: string; reason: string; at: number } | null;
  seq: number;
}

// ---------------------------------------------------------------------------
// 纯函数工具
// ---------------------------------------------------------------------------

/** 简单文本哈希，用于绑定台词锚点。 */
export function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(36)}-${text.length}`;
}

function nextSeq(state: ScriptState): number {
  return state.seq + 1;
}

function getActiveVersion(state: ScriptState): ScriptVersion {
  return state.versions.find((v) => v.id === state.activeVersionId) ?? state.versions[0];
}

function getActiveTheater(state: ScriptState): Theater {
  return state.theaters.find((t) => t.id === state.activeTheaterId) ?? state.theaters[0];
}

function getCue(state: ScriptState, cueId: string): Cue | undefined {
  return getActiveVersion(state).cues.find((c) => c.id === cueId);
}

function getLine(state: ScriptState, lineId: string): Line | undefined {
  return getActiveVersion(state).lines.find((l) => l.id === lineId);
}

function isAnchorValid(state: ScriptState, cue: Cue): boolean {
  if (!cue.anchorLineId || !cue.anchorHash) return false;
  const line = getLine(state, cue.anchorLineId);
  return !!line && hashText(line.text) === cue.anchorHash;
}

function isOverridden(state: ScriptState, cueId: string, theaterId: string): boolean {
  return state.directorOverrides.some((o) => o.cueId === cueId && o.theaterId === theaterId);
}

/** 提示在当前剧场所需但缺失（或不可用）的设备类型。 */
function getMissingTypes(state: ScriptState, cue: Cue, theaterId: string): CueType[] {
  const theater = state.theaters.find((t) => t.id === theaterId);
  if (!theater) return [...cue.requiredTypes];
  return cue.requiredTypes.filter((type) => !theater.equipment.some((e) => e.type === type && e.available));
}

/** 选取提示在当前剧场可用的设备序号（按所需类型取第一台）。 */
function pickEquipmentSerial(state: ScriptState, cue: Cue, theaterId: string): string | null {
  const theater = state.theaters.find((t) => t.id === theaterId);
  if (!theater) return null;
  for (const type of cue.requiredTypes) {
    const eq = theater.equipment.find((e) => e.type === type && e.available);
    if (eq) return eq.serialNumber;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 派生选择器
// ---------------------------------------------------------------------------

export interface AdaptationItem {
  cueId: string;
  theaterId: string;
  status: 'pending' | 'confirmed' | 'invalid' | 'blocked';
  missingTypes: CueType[];
  invalidAnchor: boolean;
  directorOverridden: boolean;
  confirmed: boolean;
  equipmentSerial: string | null;
}

export interface GateStatus {
  allowed: boolean;
  missingTypes: CueType[];
  invalidAnchors: string[];
}

export const selectScriptState = createFeatureSelector<ScriptState>('script');

export const selectActiveVersion = createSelector(selectScriptState, (state) => getActiveVersion(state));
export const selectVersions = createSelector(selectScriptState, (state) => state.versions);
export const selectActiveVersionId = createSelector(selectScriptState, (state) => state.activeVersionId);
export const selectActiveTheater = createSelector(selectScriptState, (state) => getActiveTheater(state));
export const selectTheaters = createSelector(selectScriptState, (state) => state.theaters);
export const selectCurrentRole = createSelector(selectScriptState, (state) => state.currentRole);
export const selectCanConfirm = createSelector(
  selectScriptState,
  (state) => state.currentRole === 'stage_manager' || state.currentRole === 'stage_supervisor' || state.currentRole === 'director'
);
export const selectCanOverride = createSelector(selectScriptState, (state) => state.currentRole === 'director');
export const selectOnline = createSelector(selectScriptState, (state) => state.online);
export const selectRehearsalMode = createSelector(selectScriptState, (state) => state.rehearsalMode);
export const selectLastRejection = createSelector(selectScriptState, (state) => state.lastRejection);

export const selectAdaptationItems = createSelector(
  selectScriptState,
  selectActiveVersion,
  selectActiveTheater,
  (state, version, theater): AdaptationItem[] => {
    if (!version || !theater) return [];
    return version.cues.map((cue) => {
      const invalidAnchor = !isAnchorValid(state, cue);
      const missingTypes = getMissingTypes(state, cue, theater.id);
      const directorOverridden = isOverridden(state, cue.id, theater.id);
      const confirmed = state.confirmations.some(
        (c) => c.cueId === cue.id && c.theaterId === theater.id && c.decision === 'confirmed'
      );
      let status: AdaptationItem['status'] = 'pending';
      if (missingTypes.length > 0) status = 'blocked';
      else if (invalidAnchor && !directorOverridden) status = 'invalid';
      else if (confirmed) status = 'confirmed';
      return {
        cueId: cue.id,
        theaterId: theater.id,
        status,
        missingTypes,
        invalidAnchor,
        directorOverridden,
        confirmed,
        equipmentSerial: pickEquipmentSerial(state, cue, theater.id),
      };
    });
  }
);

export const selectGateStatus = createSelector(selectAdaptationItems, (items): GateStatus => {
  const missingTypes = [...new Set(items.flatMap((i) => i.missingTypes))];
  const invalidAnchors = items.filter((i) => i.status === 'invalid').map((i) => i.cueId);
  return { allowed: missingTypes.length === 0 && invalidAnchors.length === 0, missingTypes, invalidAnchors };
});

export const selectPendingReceipts = createSelector(selectScriptState, (state) => state.receipts.filter((r) => !r.merged));
export const selectFailedReceipts = createSelector(selectScriptState, (state) => state.receipts.filter((r) => !r.merged && r.mergeAttempts > 0));
export const selectMergedReceipts = createSelector(selectScriptState, (state) => state.receipts.filter((r) => r.merged));
export const selectMergeLog = createSelector(selectScriptState, (state) => state.mergeLog);

// ---------------------------------------------------------------------------
// 初始状态
// ---------------------------------------------------------------------------

function buildInitialState(): ScriptState {
  const versions: ScriptVersion[] = [
    {
      id: 'v12',
      label: '排练稿 v12',
      playwright: '林编剧',
      note: '重写第三场父女冲突，舞台灯光提示延后2拍。换场后剧本版本不变，按剧场设备重新核对。',
      lines: [
        { id: 'l1', role: '周岚', text: '你每次都说等明天，可舞台不会等我们。', status: 'pending' },
        { id: 'l2', role: '周野', text: '那就让灯灭吧，我早已背熟黑暗。', status: 'pending' },
      ],
      cues: [
        { id: 'c1', scene: '第三场', text: '侧灯收至30%，雨声渐入', type: 'lighting', status: 'pending', anchorLineId: 'l1', anchorHash: hashText('你每次都说等明天，可舞台不会等我们。'), requiredTypes: ['lighting', 'sound'] },
        { id: 'c2', scene: '第三场', text: '周野坐到舞台左前区，保留两拍静默', type: 'prop', status: 'accepted', anchorLineId: 'l2', anchorHash: hashText('那就让灯灭吧，我早已背熟黑暗。'), requiredTypes: ['prop'] },
      ],
    },
    {
      id: 'v13',
      label: '导演修订 v13',
      playwright: '林编剧',
      note: '调整周岚结论，加入一次性追光变化。',
      lines: [
        { id: 'l1', role: '周岚', text: '你总说明天，但今晚我们必须把话说完。', status: 'pending' },
        { id: 'l3', role: '周岚', text: '看着灯，再说一次你为什么回来。', status: 'pending' },
      ],
      cues: [{ id: 'c3', scene: '第三场', text: '追光由冷白切换至琥珀，等待雨声下落', type: 'lighting', status: 'pending', anchorLineId: 'l3', anchorHash: hashText('看着灯，再说一次你为什么回来。'), requiredTypes: ['lighting'] }],
    },
  ];

  const theaters: Theater[] = [
    {
      id: 'theater-sh',
      name: '上海大剧院',
      equipment: [
        { serialNumber: 'LX-001', name: '灯光控制台 A', type: 'lighting', available: true },
        { serialNumber: 'SD-001', name: '音效控制台 A', type: 'sound', available: true },
        { serialNumber: 'PROP-001', name: '道具桌', type: 'prop', available: true },
      ],
    },
    {
      id: 'theater-bj',
      name: '北京艺术中心',
      equipment: [
        { serialNumber: 'LX-002', name: '灯光控制台 B', type: 'lighting', available: true },
        { serialNumber: 'SD-002', name: '音效控制台 B', type: 'sound', available: false },
        { serialNumber: 'PROP-002', name: '道具桌 B', type: 'prop', available: true },
      ],
    },
  ];

  return {
    versions,
    activeVersionId: 'v12',
    rehearsalMode: false,
    online: true,
    theaters,
    activeTheaterId: 'theater-sh',
    currentRole: 'stage_manager',
    confirmations: [],
    receipts: [],
    directorOverrides: [],
    mergeLog: [],
    lastRejection: null,
    seq: 0,
  };
}

function getInitialState(): ScriptState {
  if (typeof localStorage === 'undefined') return buildInitialState();
  const saved = localStorage.getItem('yf52-script-state');
  if (!saved) return buildInitialState();
  try {
    const parsed = JSON.parse(saved) as Partial<ScriptState>;
    return { ...buildInitialState(), ...parsed };
  } catch {
    return buildInitialState();
  }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const scriptReducer = createReducer(
  getInitialState(),

  // ---- 版本与内容 ----
  on(addVersion, (state, { version }) => ({ ...state, versions: [...state.versions, version] })),
  on(activateVersion, (state, { id }) => ({ ...state, activeVersionId: id })),
  on(reviewLine, (state, { id, decision }) => ({
    ...state,
    versions: state.versions.map((version) =>
      version.id !== state.activeVersionId
        ? version
        : { ...version, lines: version.lines.map((line) => (line.id === id ? { ...line, status: decision } : line)) }
    ),
  })),
  on(reorderLines, (state, { from, to }) => ({
    ...state,
    versions: state.versions.map((version) => {
      if (version.id !== state.activeVersionId || from === to) return version;
      const lines = [...version.lines];
      const [moved] = lines.splice(from, 1);
      lines.splice(to, 0, moved);
      return { ...version, lines };
    }),
  })),
  on(reviewCue, (state, { id, decision }) => ({
    ...state,
    versions: state.versions.map((version) =>
      version.id !== state.activeVersionId
        ? version
        : { ...version, cues: version.cues.map((cue) => (cue.id === id ? { ...cue, status: decision } : cue)) }
    ),
  })),

  // ---- 剧场与设备 ----
  on(addTheater, (state, { name }) => {
    const seq = nextSeq(state);
    const theater: Theater = { id: `theater-${seq}`, name, equipment: [] };
    return { ...state, seq, theaters: [...state.theaters, theater] };
  }),
  on(setActiveTheater, (state, { id }) => ({ ...state, activeTheaterId: id })),
  on(addEquipment, (state, { theaterId, name, equipmentType }) => {
    const seq = nextSeq(state);
    const prefix = equipmentType === 'lighting' ? 'LX' : equipmentType === 'sound' ? 'SD' : 'PROP';
    const serialNumber = `${prefix}-${String(seq).padStart(3, '0')}`;
    const equipment: Equipment = { serialNumber, name, type: equipmentType, available: true };
    return {
      ...state,
      seq,
      theaters: state.theaters.map((t) => (t.id === theaterId ? { ...t, equipment: [...t.equipment, equipment] } : t)),
    };
  }),
  on(removeEquipment, (state, { theaterId, serialNumber }) => ({
    ...state,
    theaters: state.theaters.map((t) =>
      t.id === theaterId ? { ...t, equipment: t.equipment.filter((e) => e.serialNumber !== serialNumber) } : t
    ),
  })),
  on(toggleEquipmentAvailability, (state, { theaterId, serialNumber }) => ({
    ...state,
    theaters: state.theaters.map((t) =>
      t.id === theaterId
        ? { ...t, equipment: t.equipment.map((e) => (e.serialNumber === serialNumber ? { ...e, available: !e.available } : e)) }
        : t
    ),
  })),

  // ---- 台词锚点：绑定 / 解绑 / 改词（改词即失效并重算） ----
  on(bindCueToLine, (state, { cueId, lineId }) => {
    const version = getActiveVersion(state);
    const line = version.lines.find((l) => l.id === lineId);
    const anchorHash = line ? hashText(line.text) : null;
    return {
      ...state,
      versions: state.versions.map((v) =>
        v.id !== state.activeVersionId ? v : { ...v, cues: v.cues.map((c) => (c.id === cueId ? { ...c, anchorLineId: lineId, anchorHash } : c)) }
      ),
    };
  }),
  on(unbindCue, (state, { cueId }) => ({
    ...state,
    versions: state.versions.map((v) =>
      v.id !== state.activeVersionId ? v : { ...v, cues: v.cues.map((c) => (c.id === cueId ? { ...c, anchorLineId: null, anchorHash: null } : c)) }
    ),
  })),
  on(updateLineText, (state, { id, text }) => {
    const version = getActiveVersion(state);
    const boundCueIds = version.cues.filter((c) => c.anchorLineId === id).map((c) => c.id);
    return {
      ...state,
      versions: state.versions.map((v) =>
        v.id !== state.activeVersionId ? v : { ...v, lines: v.lines.map((l) => (l.id === id ? { ...l, text } : l)) }
      ),
      // 锚点一变，相关提示的既有确认立即失效，需重算后重新确认
      confirmations: state.confirmations.filter((c) => !boundCueIds.includes(c.cueId)),
      receipts: state.receipts.filter((r) => r.merged || !boundCueIds.includes(r.cueId)),
      directorOverrides: state.directorOverrides.filter((o) => !boundCueIds.includes(o.cueId)),
    };
  }),

  // ---- 岗位角色 ----
  on(setRole, (state, { role }) => ({ ...state, currentRole: role })),

  // ---- 确认请求（离线回执）：越权 / 缺设备直接拒绝 ----
  on(confirmCueRequest, (state, { cueId, theaterId, decision }) => {
    const cue = getCue(state, cueId);
    if (!cue) return state;
    const invalidAnchor = !isAnchorValid(state, cue);
    const missingTypes = getMissingTypes(state, cue, theaterId);
    const overridden = isOverridden(state, cueId, theaterId);

    if (invalidAnchor && state.currentRole !== 'director' && !overridden) {
      return { ...state, lastRejection: { cueId, reason: '锚点已失效，仅导演可覆盖', at: state.seq } };
    }
    if (missingTypes.length > 0) {
      return { ...state, lastRejection: { cueId, reason: '设备缺失，无法确认', at: state.seq } };
    }

    let directorOverrides = state.directorOverrides;
    if (invalidAnchor && state.currentRole === 'director' && !overridden) {
      const override: DirectorOverride = { cueId, theaterId, overriddenBy: 'director', overriddenAt: state.seq };
      directorOverrides = [...directorOverrides, override];
    }

    const seq = nextSeq(state);
    const equipmentSerialNumber = pickEquipmentSerial(state, cue, theaterId) ?? 'UNASSIGNED';
    const receipt: Receipt = {
      id: `r-${seq}`,
      cueId,
      theaterId,
      equipmentSerialNumber,
      decision,
      confirmedBy: state.currentRole,
      confirmedAt: seq,
      merged: false,
      mergeAttempts: 0,
      lastError: null,
    };
    return { ...state, seq, receipts: [...state.receipts, receipt], directorOverrides, lastRejection: null };
  }),
  on(confirmCueRejected, (state, { cueId, reason }) => ({ ...state, lastRejection: { cueId, reason, at: state.seq } })),
  on(clearRejection, (state) => ({ ...state, lastRejection: null })),

  // ---- 导演覆盖失效提示 ----
  on(directorOverrideCue, (state, { cueId, theaterId }) => {
    if (state.currentRole !== 'director') {
      return { ...state, lastRejection: { cueId, reason: '仅导演可覆盖失效提示', at: state.seq } };
    }
    if (isOverridden(state, cueId, theaterId)) return state;
    const seq = nextSeq(state);
    const override: DirectorOverride = { cueId, theaterId, overriddenBy: 'director', overriddenAt: seq };
    return {
      ...state,
      seq,
      directorOverrides: [...state.directorOverrides, override],
      lastRejection: null,
    };
  }),

  // ---- 排练提词门禁：缺设备或仍有失效锚点时拒绝进入 ----
  on(toggleRehearsal, (state) => {
    if (state.rehearsalMode) return { ...state, rehearsalMode: false };
    const version = getActiveVersion(state);
    const theater = getActiveTheater(state);
    const items: AdaptationItem[] = version.cues.map((cue) => {
      const invalidAnchor = !isAnchorValid(state, cue);
      const missingTypes = getMissingTypes(state, cue, theater.id);
      const overridden = isOverridden(state, cue.id, theater.id);
      return {
        cueId: cue.id,
        theaterId: theater.id,
        status: (missingTypes.length > 0 ? 'blocked' : invalidAnchor && !overridden ? 'invalid' : 'pending') as AdaptationItem['status'],
        missingTypes,
        invalidAnchor,
        directorOverridden: overridden,
        confirmed: false,
        equipmentSerial: null,
      };
    });
    const missingTypes = [...new Set(items.flatMap((i) => i.missingTypes))];
    const invalidAnchors = items.filter((i) => i.status === 'invalid').map((i) => i.cueId);
    if (missingTypes.length > 0 || invalidAnchors.length > 0) {
      const reason = `无法进入排练提词：${missingTypes.length ? `缺少设备（${missingTypes.join('、')}）` : ''}${missingTypes.length && invalidAnchors.length ? '；' : ''}${invalidAnchors.length ? `存在失效锚点（${invalidAnchors.join('、')}）` : ''}`;
      return { ...state, lastRejection: { cueId: '', reason, at: state.seq } };
    }
    return { ...state, rehearsalMode: true, lastRejection: null };
  }),

  // ---- 在线/离线 ----
  on(setOnline, (state, { online }) => ({ ...state, online })),

  // ---- 回执合并：按设备序号合并，重复回执只算一次，失败保留队列重试 ----
  on(mergeReceiptsProgress, (state, { results }) => {
    const receipts = [...state.receipts];
    const confirmations = [...state.confirmations];
    const mergeLog = [...state.mergeLog];
    let seq = state.seq;

    for (const res of results) {
      const idx = receipts.findIndex((r) => r.id === res.receiptId);
      if (idx === -1) continue;
      const receipt = receipts[idx];
      seq += 1;
      if (res.success) {
        // 幂等：同一 提示+剧场+设备+结论 的确认只保留一条
        const dupKey = `${receipt.cueId}|${receipt.theaterId}|${receipt.equipmentSerialNumber}|${receipt.decision}`;
        const already = confirmations.some((c) => `${c.cueId}|${c.theaterId}|${c.equipmentSerialNumber}|${c.decision}` === dupKey);
        if (!already) {
          confirmations.push({
            cueId: receipt.cueId,
            theaterId: receipt.theaterId,
            equipmentSerialNumber: receipt.equipmentSerialNumber,
            decision: receipt.decision,
            confirmedBy: receipt.confirmedBy,
            confirmedAt: receipt.confirmedAt,
            receiptId: receipt.id,
          });
        }
        receipts[idx] = { ...receipt, merged: true, mergeAttempts: receipt.mergeAttempts + 1, lastError: null };
        mergeLog.push({ id: `m-${seq}`, receiptId: receipt.id, cueId: receipt.cueId, theaterId: receipt.theaterId, equipmentSerialNumber: receipt.equipmentSerialNumber, result: 'merged', error: null, timestamp: seq });
      } else {
        receipts[idx] = { ...receipt, merged: false, mergeAttempts: receipt.mergeAttempts + 1, lastError: res.error };
        mergeLog.push({ id: `m-${seq}`, receiptId: receipt.id, cueId: receipt.cueId, theaterId: receipt.theaterId, equipmentSerialNumber: receipt.equipmentSerialNumber, result: 'failed', error: res.error, timestamp: seq });
      }
    }
    return { ...state, seq, receipts, confirmations, mergeLog };
  }),
  on(clearMergeLog, (state) => ({ ...state, mergeLog: [] }))
);
