import { createAction, props } from '@ngrx/store';
import { ConfirmDecision, CueDecision, CueType, Role, ScriptVersion } from './script.reducer';

// ---- 剧本版本与内容（已有） ----
export const addVersion = createAction('[Script] Add Version', props<{ version: ScriptVersion }>());
export const activateVersion = createAction('[Script] Activate Version', props<{ id: string }>());
export const reviewLine = createAction('[Script] Review Line', props<{ id: string; decision: 'accepted' | 'returned' }>());
export const reorderLines = createAction('[Script] Reorder Lines', props<{ from: number; to: number }>());
export const reviewCue = createAction('[Script] Review Cue', props<{ id: string; decision: CueDecision }>());
export const toggleRehearsal = createAction('[Script] Toggle Rehearsal');
export const setOnline = createAction('[Script] Set Online', props<{ online: boolean }>());

// ---- 剧场与设备 ----
export const addTheater = createAction('[Theater] Add Theater', props<{ name: string }>());
export const setActiveTheater = createAction('[Theater] Set Active Theater', props<{ id: string }>());
export const addEquipment = createAction('[Theater] Add Equipment', props<{ theaterId: string; name: string; equipmentType: CueType }>());
export const removeEquipment = createAction('[Theater] Remove Equipment', props<{ theaterId: string; serialNumber: string }>());
export const toggleEquipmentAvailability = createAction('[Theater] Toggle Equipment Availability', props<{ theaterId: string; serialNumber: string }>());

// ---- 台词锚点绑定 ----
export const bindCueToLine = createAction('[Cue] Bind Cue To Line', props<{ cueId: string; lineId: string }>());
export const unbindCue = createAction('[Cue] Unbind Cue', props<{ cueId: string }>());
export const updateLineText = createAction('[Line] Update Line Text', props<{ id: string; text: string }>());

// ---- 岗位角色 ----
export const setRole = createAction('[Role] Set Role', props<{ role: Role }>());

// ---- 确认（离线回执） ----
export const confirmCueRequest = createAction('[Confirm] Confirm Cue Request', props<{ cueId: string; theaterId: string; decision: ConfirmDecision }>());
export const confirmCueRejected = createAction('[Confirm] Confirm Cue Rejected', props<{ cueId: string; reason: string }>());
export const clearRejection = createAction('[Confirm] Clear Rejection');

// ---- 导演覆盖失效提示 ----
export const directorOverrideCue = createAction('[Director] Override Cue', props<{ cueId: string; theaterId: string }>());

// ---- 回执合并与重试 ----
export const mergeReceipts = createAction('[Merge] Merge Receipts');
export const retryFailedMerges = createAction('[Merge] Retry Failed Merges');
export const mergeReceiptsProgress = createAction('[Merge] Merge Progress', props<{ results: Array<{ receiptId: string; success: boolean; error: string | null }> }>());
export const clearMergeLog = createAction('[Merge] Clear Merge Log');
