import { createAction, props } from '@ngrx/store';
import { CueDecision, Role, ScriptVersion } from './tour.model';

export const addVersion = createAction('[Script] Add Version', props<{ version: ScriptVersion }>());
export const activateVersion = createAction('[Script] Activate Version', props<{ id: string }>());
export const reviewLine = createAction('[Script] Review Line', props<{ id: string; decision: 'accepted' | 'returned' }>());
export const reorderLines = createAction('[Script] Reorder Lines', props<{ from: number; to: number }>());
export const reviewCue = createAction('[Script] Review Cue', props<{ id: string; decision: CueDecision }>());
export const toggleRehearsal = createAction('[Script] Toggle Rehearsal');
export const setOnline = createAction('[Script] Set Online', props<{ online: boolean }>());

// 巡演换场适配队列
export const activateTheater = createAction('[Tour] Activate Theater', props<{ id: string }>());
export const switchRole = createAction('[Tour] Switch Role', props<{ role: Role }>());
export const editLineText = createAction('[Tour] Edit Line Text', props<{ id: string; text: string }>());
export const deleteLine = createAction('[Tour] Delete Line', props<{ id: string }>());
/** 锚点失效后按当前台词重算提示（anchorRevision+1，旧场馆确认全部失效） */
export const recomputeCue = createAction('[Tour] Recompute Cue Anchor', props<{ cueId: string; lineId?: string }>());
/** 场务/舞台监督按当前场馆设备确认提示；离线时进入回执队列 */
export const confirmCue = createAction('[Tour] Confirm Cue Against Device', props<{ cueId: string }>());
/** 导演覆盖失效/缺设备提示 */
export const overrideCue = createAction('[Tour] Director Override Cue', props<{ cueId: string }>());
/** 回网合并离线回执，可注入链路故障以验证断点续传 */
export const mergeOutbox = createAction('[Tour] Merge Offline Outbox', props<{ injectFailure: boolean }>());
export const clearDenial = createAction('[Tour] Clear Denial');
