// 巡演换场适配队列：纯领域模型与规则（不依赖 Angular，可独立单测）

export type Role = 'director' | 'playwright' | 'stageManager' | 'crew' | 'actor';
export type CueKind = 'prop' | 'light' | 'sfx';
export type CueDecision = 'pending' | 'accepted' | 'returned';
export type AnchorState = 'bound' | 'stale' | 'missing';
export type AdaptStatus = 'pending' | 'confirmed' | 'stale' | 'missingAnchor' | 'missingDevice' | 'overridden';
export type ReceiptStatus = 'pending' | 'merged' | 'duplicate' | 'failed';

export interface RoleInfo {
  id: Role;
  name: string;
  canConfirm: boolean; // 可做常规设备确认
  canOverride: boolean; // 可覆盖失效提示
}

export const ROLE_INFOS: RoleInfo[] = [
  { id: 'director', name: '导演', canConfirm: false, canOverride: true },
  { id: 'playwright', name: '编剧', canConfirm: false, canOverride: false },
  { id: 'stageManager', name: '舞台监督', canConfirm: true, canOverride: false },
  { id: 'crew', name: '场务', canConfirm: true, canOverride: false },
  { id: 'actor', name: '演员', canConfirm: false, canOverride: false }
];

export const roleName = (role: Role): string => ROLE_INFOS.find((item) => item.id === role)?.name ?? role;
export const canConfirmRole = (role: Role): boolean => !!ROLE_INFOS.find((item) => item.id === role)?.canConfirm;

export const CUE_KIND_LABEL: Record<CueKind, string> = {
  prop: '道具',
  light: '灯光',
  sfx: '音效'
};

export interface Equipment {
  serial: string; // 设备序号，离线回执按它排序合并
  kind: CueKind;
  label: string;
}

export interface Theater {
  id: string;
  name: string;
  city: string;
  equipments: Equipment[];
}

export interface TourLine {
  id: string;
  role: string;
  text: string;
  status: 'pending' | 'accepted' | 'returned';
}

export interface CueAnchor {
  lineId: string;
  fingerprint: string; // 绑定台词文本的指纹
  anchorRevision: number; // 重算一次 +1，旧确认据此立即失效
}

export interface TourCue {
  id: string;
  scene: string;
  text: string;
  kind: CueKind;
  status: CueDecision;
  anchor: CueAnchor;
}

export interface ScriptVersion {
  id: string;
  label: string;
  playwright: string;
  note: string;
  tourLocked?: boolean; // 巡演场：剧本版本不变，只按场馆重核提示
  lines: TourLine[];
  cues: TourCue[];
}

/** 某场馆对某提示的确认结果（不同场馆分库保存） */
export interface ConfirmationRecord {
  key: string; // `${theaterId}:${cueId}`
  theaterId: string;
  cueId: string;
  equipmentSerial: string | null;
  role: Role;
  fingerprint: string;
  anchorRevision: number;
  receiptId: string;
  at: number;
  overridden: boolean;
}

/** 离线确认回执，回网后按设备序号合并 */
export interface Receipt {
  id: string;
  theaterId: string;
  cueId: string;
  equipmentSerial: string | null;
  role: Role;
  fingerprint: string;
  anchorRevision: number;
  at: number;
  attempts: number;
  status: ReceiptStatus;
  failReason?: string;
}

export interface AdaptItem {
  cue: TourCue;
  theaterId: string;
  equipment: Equipment | null;
  anchorState: AnchorState;
  status: AdaptStatus;
  record?: ConfirmationRecord;
}

export interface GateResult {
  allowed: boolean;
  reasons: string[];
}

// ---------- 锚点指纹 ----------

export function lineFingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function anchorStateOf(cue: TourCue, lines: TourLine[]): AnchorState {
  const line = lines.find((item) => item.id === cue.anchor.lineId);
  if (!line) return 'missing';
  return lineFingerprint(line.text) === cue.anchor.fingerprint ? 'bound' : 'stale';
}

// ---------- 场馆设备 ----------

export function pickEquipment(theater: Theater, kind: CueKind): Equipment | null {
  return theater.equipments.find((item) => item.kind === kind) ?? null;
}

export function recordKey(theaterId: string, cueId: string): string {
  return `${theaterId}:${cueId}`;
}

// ---------- 适配队列派生 ----------

export function buildQueue(
  version: ScriptVersion,
  theater: Theater,
  records: ConfirmationRecord[]
): AdaptItem[] {
  return version.cues.map((cue) => {
    const equipment = pickEquipment(theater, cue.kind);
    const anchorState = anchorStateOf(cue, version.lines);
    const record = records.find((item) => item.key === recordKey(theater.id, cue.id));
    const liveOverride =
      record?.overridden &&
      record.anchorRevision === cue.anchor.anchorRevision &&
      (anchorState === 'bound' ? record.fingerprint === cue.anchor.fingerprint : true);

    let status: AdaptStatus;
    if (anchorState === 'missing') {
      status = liveOverride ? 'overridden' : 'missingAnchor';
    } else if (anchorState === 'stale') {
      status = liveOverride ? 'overridden' : 'stale';
    } else if (!equipment) {
      status = liveOverride ? 'overridden' : 'missingDevice';
    } else if (record && record.anchorRevision === cue.anchor.anchorRevision && !record.overridden) {
      status = 'confirmed';
    } else if (liveOverride) {
      status = 'overridden';
    } else {
      status = 'pending';
    }
    return { cue, theaterId: theater.id, equipment, anchorState, status, record };
  });
}

// ---------- 排练提词门禁 ----------

export function rehearsalGate(
  version: ScriptVersion,
  theater: Theater,
  records: ConfirmationRecord[]
): GateResult {
  const reasons: string[] = [];
  for (const item of buildQueue(version, theater, records)) {
    const head = `「${item.cue.scene} · ${CUE_KIND_LABEL[item.cue.kind]}」${item.cue.text}`;
    if (item.status === 'missingAnchor') reasons.push(`${head}：绑定台词已删除，锚点缺失`);
    else if (item.status === 'stale') reasons.push(`${head}：台词锚点已变更，提示失效待重算`);
    else if (item.status === 'missingDevice') reasons.push(`${head}：${theater.name}缺少${CUE_KIND_LABEL[item.cue.kind]}设备`);
    else if (item.status === 'pending') reasons.push(`${head}：尚未在${theater.name}完成设备确认`);
  }
  return { allowed: reasons.length === 0, reasons };
}

// ---------- 权限 ----------

export type ConfirmDenial =
  | 'unauthorized-confirm'
  | 'unauthorized-override'
  | 'anchor-invalid'
  | 'device-missing'
  | 'already-resolved'
  | 'recompute-unbound'
  | 'offline-required'
  | null;

export function denyConfirm(role: Role, item: AdaptItem): ConfirmDenial {
  if (!canConfirmRole(role)) return 'unauthorized-confirm';
  if (item.status === 'confirmed' || item.status === 'overridden') return 'already-resolved';
  if (item.anchorState !== 'bound') return 'anchor-invalid';
  if (!item.equipment) return 'device-missing';
  return null;
}

export function denyOverride(role: Role, item: AdaptItem): ConfirmDenial {
  if (role !== 'director') return 'unauthorized-override';
  if (item.status === 'confirmed' || item.status === 'overridden') return 'already-resolved';
  return null;
}

export const DENIAL_TEXT: Record<Exclude<ConfirmDenial, null>, string> = {
  'unauthorized-confirm': '越权确认被拒绝：仅场务与舞台监督可按设备确认提示。',
  'unauthorized-override': '越权操作被拒绝：只有导演能覆盖失效提示。',
  'anchor-invalid': '锚点已失效：请先重算提示，或请导演覆盖。',
  'device-missing': '本场馆缺少对应设备：无法常规确认，请导演覆盖或更换设备方案。',
  'already-resolved': '该提示在本场馆已闭环，无需重复确认。',
  'recompute-unbound': '锚点台词已删除，无法重算，请导演处置。',
  'offline-required': '当前在线，无需走离线回执通道。'
};

// ---------- 离线回执合并 ----------

export function receiptFingerprintKey(receipt: Receipt): string {
  return [receipt.theaterId, receipt.cueId, receipt.fingerprint, receipt.equipmentSerial ?? '∅'].join('|');
}

export interface MergeInput {
  receipts: Receipt[];
  version: ScriptVersion;
  ledger: string[]; // 服务端已入账的去重键
  injectFailure: boolean; // 模拟回传链路故障
}

export interface MergeResult {
  receipts: Receipt[];
  ledger: string[];
  records: ConfirmationRecord[]; // 本次成功合并产生/更新的确认
  merged: Receipt[];
  duplicates: Receipt[];
  rejected: Receipt[];
  pending: Receipt[]; // 仍未完成、保留续传
}

/**
 * 回网合并：
 * - 只处理 pending 回执，按设备序号排序（空序号排末尾）；
 * - 链路故障时前半批入账，后半批保留 pending 并累加 attempts，等待续传；
 * - 同场馆同提示同指纹同设备的重复回执只入账一次；
 * - 合并期间锚点又变过的回执判为 anchor-drifted，不再重试。
 */
export function mergeOutbox(input: MergeInput): MergeResult {
  const pending = input.receipts
    .filter((item) => item.status === 'pending')
    .sort((a, b) => (a.equipmentSerial ?? '￿').localeCompare(b.equipmentSerial ?? '￿'));

  const cutoff = input.injectFailure ? Math.floor(pending.length / 2) : pending.length;
  const ledger = [...input.ledger];
  const records: ConfirmationRecord[] = [];
  const merged: Receipt[] = [];
  const duplicates: Receipt[] = [];
  const rejected: Receipt[] = [];
  const stillPending: Receipt[] = [];

  const receiptsById = new Map(input.receipts.map((item) => [item.id, item]));

  pending.forEach((receipt, index) => {
    if (index >= cutoff && input.injectFailure) {
      const next: Receipt = { ...receipt, attempts: receipt.attempts + 1, failReason: 'link-down' };
      receiptsById.set(receipt.id, next);
      stillPending.push(next);
      return;
    }
    const cue = input.version.cues.find((item) => item.id === receipt.cueId);
    if (!cue) {
      const next: Receipt = { ...receipt, attempts: receipt.attempts + 1, status: 'failed', failReason: 'cue-gone' };
      receiptsById.set(receipt.id, next);
      rejected.push(next);
      return;
    }
    if (receipt.fingerprint !== cue.anchor.fingerprint) {
      const next: Receipt = { ...receipt, attempts: receipt.attempts + 1, status: 'failed', failReason: 'anchor-drifted' };
      receiptsById.set(receipt.id, next);
      rejected.push(next);
      return;
    }
    const key = receiptFingerprintKey(receipt);
    if (ledger.includes(key)) {
      const next: Receipt = { ...receipt, status: 'duplicate', failReason: undefined };
      receiptsById.set(receipt.id, next);
      duplicates.push(next);
      return;
    }
    ledger.push(key);
    const next: Receipt = { ...receipt, status: 'merged', failReason: undefined };
    receiptsById.set(receipt.id, next);
    merged.push(next);
    records.push({
      key: recordKey(receipt.theaterId, receipt.cueId),
      theaterId: receipt.theaterId,
      cueId: receipt.cueId,
      equipmentSerial: receipt.equipmentSerial,
      role: receipt.role,
      fingerprint: receipt.fingerprint,
      anchorRevision: receipt.anchorRevision,
      receiptId: receipt.id,
      at: receipt.at,
      overridden: false
    });
  });

  const receipts = input.receipts.map((item) => receiptsById.get(item.id) ?? item);
  return { receipts, ledger, records, merged, duplicates, rejected, pending: stillPending };
}

// ---------- 初始演示数据 ----------

export function buildInitialTheaters(): Theater[] {
  return [
    {
      id: 't-hz',
      name: '人民大舞台',
      city: '杭州',
      equipments: [
        { serial: 'L-01', kind: 'light', label: '主侧灯调光台' },
        { serial: 'L-02', kind: 'light', label: '冷白追光塔' },
        { serial: 'S-01', kind: 'sfx', label: '环绕音效主机' },
        { serial: 'P-01', kind: 'prop', label: '道具箱 A（旧提灯/木椅）' }
      ]
    },
    {
      id: 't-nj',
      name: '星光剧场',
      city: '南京',
      // 该场馆没有道具设备位：道具提示必须由导演覆盖或补设备，否则门禁不放行
      equipments: [
        { serial: 'L-11', kind: 'light', label: '面光桥调光柜' },
        { serial: 'L-12', kind: 'light', label: '电脑摇头灯组' },
        { serial: 'S-11', kind: 'sfx', label: '数字音效台' }
      ]
    }
  ];
}

export function buildInitialVersions(): ScriptVersion[] {
  const v12Lines: TourLine[] = [
    { id: 'l1', role: '周岚', text: '你每次都说等明天，可舞台不会等我们。', status: 'pending' },
    { id: 'l2', role: '周野', text: '那就让灯灭吧，我早已背熟黑暗。', status: 'pending' }
  ];
  const v13Lines: TourLine[] = [
    { id: 'l1', role: '周岚', text: '你总说明天，但今晚我们必须把话说完。', status: 'pending' },
    { id: 'l3', role: '周岚', text: '看着灯，再说一次你为什么回来。', status: 'pending' }
  ];
  return [
    {
      id: 'v12',
      label: '巡演锁定版 v12',
      playwright: '林编剧',
      note: '巡演剧本版本不变；换场后道具、灯光、音效提示按各剧场设备重新核对。',
      tourLocked: true,
      lines: v12Lines,
      cues: [
        {
          id: 'c1',
          scene: '第三场',
          text: '侧灯收至30%，对准左前表演区',
          kind: 'light',
          status: 'pending',
          anchor: { lineId: 'l1', fingerprint: lineFingerprint(v12Lines[0].text), anchorRevision: 1 }
        },
        {
          id: 'c2',
          scene: '第三场',
          text: '旧提灯与木椅在开演前核验，置于左前台沿',
          kind: 'prop',
          status: 'accepted',
          anchor: { lineId: 'l2', fingerprint: lineFingerprint(v12Lines[1].text), anchorRevision: 1 }
        },
        {
          id: 'c3',
          scene: '第三场',
          text: '雨声渐入，周野落座后保留两拍静默',
          kind: 'sfx',
          status: 'pending',
          anchor: { lineId: 'l2', fingerprint: lineFingerprint(v12Lines[1].text), anchorRevision: 1 }
        }
      ]
    },
    {
      id: 'v13',
      label: '导演修订 v13（未进巡演）',
      playwright: '林编剧',
      note: '调整周岚结论，加入一次性追光变化；仅供对比，巡演仍使用 v12。',
      lines: v13Lines,
      cues: [
        {
          id: 'c3',
          scene: '第三场',
          text: '追光由冷白切换至琥珀，等待雨声下落',
          kind: 'light',
          status: 'pending',
          anchor: { lineId: 'l1', fingerprint: lineFingerprint(v13Lines[0].text), anchorRevision: 1 }
        }
      ]
    }
  ];
}
