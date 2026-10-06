import { createReducer, on } from '@ngrx/store';
import {
  activateTheater,
  activateVersion,
  addVersion,
  clearDenial,
  confirmCue,
  deleteLine,
  editLineText,
  mergeOutbox as mergeOutboxAction,
  overrideCue,
  recomputeCue,
  reorderLines,
  reviewCue,
  reviewLine,
  setOnline,
  switchRole,
  toggleRehearsal
} from './script.actions';
import {
  AdaptItem,
  ConfirmationRecord,
  CueDecision,
  DENIAL_TEXT,
  Receipt,
  ScriptVersion,
  Theater,
  Role,
  buildInitialTheaters,
  buildInitialVersions,
  buildQueue,
  denyConfirm,
  denyOverride,
  lineFingerprint,
  mergeOutbox,
  pickEquipment,
  recordKey,
  receiptFingerprintKey,
  rehearsalGate
} from './tour.model';

export type { CueDecision, ScriptVersion } from './tour.model';

export interface MergeSummary {
  merged: number;
  duplicates: number;
  pending: number;
  rejected: number;
  at: number;
}

export interface ScriptState {
  versions: ScriptVersion[];
  activeVersionId: string;
  theaters: Theater[];
  activeTheaterId: string;
  /** 各场馆确认结果分库保存（key = theaterId:cueId） */
  records: ConfirmationRecord[];
  /** 离线确认回执，回网后按设备序号合并 */
  outbox: Receipt[];
  /** 服务端已入账的去重键 */
  ledger: string[];
  currentRole: Role;
  rehearsalMode: boolean;
  online: boolean;
  denial: { code: string; at: number } | null;
  lastMerge: MergeSummary | null;
}

const STORAGE_KEY = 'yf52-tour-state-v1';

function freshState(): ScriptState {
  return {
    versions: buildInitialVersions(),
    activeVersionId: 'v12',
    theaters: buildInitialTheaters(),
    activeTheaterId: 't-hz',
    records: [],
    outbox: [],
    ledger: [],
    currentRole: 'stageManager',
    rehearsalMode: false,
    online: true,
    denial: null,
    lastMerge: null
  };
}

function getInitialState(): ScriptState {
  if (typeof localStorage === 'undefined') return freshState();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return freshState();
    const parsed = JSON.parse(saved) as ScriptState;
    return { ...freshState(), ...parsed, rehearsalMode: false, denial: null };
  } catch {
    return freshState();
  }
}

function patchActiveVersion(state: ScriptState, patch: (version: ScriptVersion) => ScriptVersion): ScriptState {
  return {
    ...state,
    versions: state.versions.map((version) => (version.id === state.activeVersionId ? patch(version) : version))
  };
}

function activeTheater(state: ScriptState): Theater {
  return state.theaters.find((item) => item.id === state.activeTheaterId) ?? state.theaters[0];
}

function queueFor(state: ScriptState, versionId = state.activeVersionId): AdaptItem[] {
  const version = state.versions.find((item) => item.id === versionId);
  if (!version) return [];
  return buildQueue(version, activeTheater(state), state.records);
}

function uniqueId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function upsertRecord(records: ConfirmationRecord[], record: ConfirmationRecord): ConfirmationRecord[] {
  return [...records.filter((item) => item.key !== record.key), record];
}

function runMerge(state: ScriptState, injectFailure: boolean): ScriptState {
  const version = state.versions.find((item) => item.id === state.activeVersionId);
  if (!version || !state.outbox.some((item) => item.status === 'pending')) return state;
  const result = mergeOutbox({
    receipts: state.outbox,
    version,
    ledger: state.ledger,
    injectFailure
  });
  // 合并成功的回执按场馆分库落账；重复回执不再覆盖既有确认
  let records = state.records;
  for (const record of result.records) {
    records = upsertRecord(records, record);
  }
  const summary: MergeSummary = {
    merged: result.merged.length,
    duplicates: result.duplicates.length,
    pending: result.pending.length,
    rejected: result.rejected.length,
    at: Date.now()
  };
  return { ...state, outbox: result.receipts, ledger: result.ledger, records, lastMerge: summary };
}

export const scriptReducer = createReducer(
  getInitialState(),
  on(addVersion, (state, { version }) => ({ ...state, versions: [...state.versions, version] })),
  on(activateVersion, (state, { id }) => ({ ...state, activeVersionId: id, denial: null })),
  on(activateTheater, (state, { id }) => ({ ...state, activeTheaterId: id, denial: null })),
  on(switchRole, (state, { role }) => ({ ...state, currentRole: role, denial: null })),
  on(clearDenial, (state) => ({ ...state, denial: null })),

  on(reviewLine, (state, { id, decision }) =>
    patchActiveVersion(state, (version) => ({
      ...version,
      lines: version.lines.map((line) => (line.id === id ? { ...line, status: decision } : line))
    }))
  ),
  on(reorderLines, (state, { from, to }) =>
    patchActiveVersion(state, (version) => {
      if (from === to) return version;
      const lines = [...version.lines];
      const [moved] = lines.splice(from, 1);
      lines.splice(to, 0, moved);
      return { ...version, lines };
    })
  ),
  on(reviewCue, (state, { id, decision }) =>
    patchActiveVersion(state, (version) => ({
      ...version,
      cues: version.cues.map((cue) => (cue.id === id ? { ...cue, status: decision } : cue))
    }))
  ),

  // 台词一改：绑定该台词的提示指纹立即不匹配，相关场馆确认自动转为失效
  on(editLineText, (state, { id, text }) =>
    patchActiveVersion(state, (version) => ({
      ...version,
      lines: version.lines.map((line) => (line.id === id ? { ...line, text, status: 'pending' } : line))
    }))
  ),
  on(deleteLine, (state, { id }) =>
    patchActiveVersion(state, (version) => ({
      ...version,
      lines: version.lines.filter((line) => line.id !== id)
    }))
  ),

  // 重算锚点：锚点修订号 +1，旧修订号上的所有场馆确认立即作废
  on(recomputeCue, (state, { cueId, lineId }) => {
    const version = state.versions.find((item) => item.id === state.activeVersionId);
    if (!version) return state;
    const cue = version.cues.find((item) => item.id === cueId);
    if (!cue) return state;
    const targetId = lineId ?? cue.anchor.lineId;
    const line = version.lines.find((item) => item.id === targetId);
    if (!line) return { ...state, denial: { code: 'recompute-unbound', at: Date.now() } };
    return patchActiveVersion(state, (current) => ({
      ...current,
      cues: current.cues.map((item) =>
        item.id === cueId
          ? {
              ...item,
              anchor: {
                lineId: targetId,
                fingerprint: lineFingerprint(line.text),
                anchorRevision: item.anchor.anchorRevision + 1
              }
            }
          : item
      )
    }));
  }),

  on(confirmCue, (state, { cueId }) => {
    const item = queueFor(state).find((entry) => entry.cue.id === cueId);
    if (!item) return state;
    const denial = denyConfirm(state.currentRole, item);
    if (denial) return { ...state, denial: { code: denial, at: Date.now() } };

    const receipt: Receipt = {
      id: uniqueId('r-'),
      theaterId: state.activeTheaterId,
      cueId,
      equipmentSerial: item.equipment ? item.equipment.serial : null,
      role: state.currentRole,
      fingerprint: item.cue.anchor.fingerprint,
      anchorRevision: item.cue.anchor.anchorRevision,
      at: Date.now(),
      attempts: 0,
      status: 'pending'
    };

    // 离线：进回执队列，回网按设备序号合并
    if (!state.online) {
      return { ...state, outbox: [...state.outbox, receipt], denial: null };
    }

    // 在线：直接入账，同时写入服务端去重账本
    const record: ConfirmationRecord = {
      key: recordKey(state.activeTheaterId, cueId),
      theaterId: state.activeTheaterId,
      cueId,
      equipmentSerial: receipt.equipmentSerial,
      role: state.currentRole,
      fingerprint: receipt.fingerprint,
      anchorRevision: receipt.anchorRevision,
      receiptId: receipt.id,
      at: receipt.at,
      overridden: false
    };
    const ledgerKey = receiptFingerprintKey(receipt);
    return {
      ...state,
      records: upsertRecord(state.records, record),
      ledger: state.ledger.includes(ledgerKey) ? state.ledger : [...state.ledger, ledgerKey],
      denial: null
    };
  }),

  on(overrideCue, (state, { cueId }) => {
    const item = queueFor(state).find((entry) => entry.cue.id === cueId);
    if (!item) return state;
    const denial = denyOverride(state.currentRole, item);
    if (denial) return { ...state, denial: { code: denial, at: Date.now() } };
    // 导演覆盖只作用于当前场馆，其他场馆的确认结果互不影响
    const record: ConfirmationRecord = {
      key: recordKey(state.activeTheaterId, cueId),
      theaterId: state.activeTheaterId,
      cueId,
      equipmentSerial: item.equipment ? item.equipment.serial : null,
      role: 'director',
      fingerprint: item.cue.anchor.fingerprint,
      anchorRevision: item.cue.anchor.anchorRevision,
      receiptId: uniqueId('ov-'),
      at: Date.now(),
      overridden: true
    };
    return { ...state, records: upsertRecord(state.records, record), denial: null };
  }),

  on(mergeOutboxAction, (state, { injectFailure }) => runMerge(state, injectFailure)),

  on(setOnline, (state, { online }) => {
    if (online === state.online) return state;
    // 回网自动续传：按设备序号合并未完成回执，失败则保留队列继续重试
    if (online) return runMerge({ ...state, online: true, denial: null }, false);
    return { ...state, online: false };
  }),

  on(toggleRehearsal, (state) => {
    if (state.rehearsalMode) return { ...state, rehearsalMode: false };
    const version = state.versions.find((item) => item.id === state.activeVersionId);
    if (!version) return state;
    const gate = rehearsalGate(version, activeTheater(state), state.records);
    if (!gate.allowed) {
      return { ...state, denial: { code: 'rehearsal-blocked', at: Date.now() } };
    }
    return { ...state, rehearsalMode: true, denial: null };
  })
);

export { DENIAL_TEXT, pickEquipment, rehearsalGate, buildQueue };
