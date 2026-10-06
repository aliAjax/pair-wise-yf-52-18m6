import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideEffects } from '@ngrx/effects';
import { provideStore } from '@ngrx/store';
import { provideTransloco, TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { scriptReducer } from './state/script.reducer';
import { ScriptEffects } from './state/script.effects';

class InlineTranslocoLoader implements TranslocoLoader {
  getTranslation() {
    return of({
      title: '戏剧排练台词版本与舞台提示管控',
      subtitle: '巡演换场适配队列',
      normalMode: '正式版本',
      rehearsalMode: '排练提词模式',
      online: '在线',
      offline: '离线缓存中',
      role: '当前岗位',
      theater: '剧场',
      equipment: '设备',
      adaptationQueue: '适配队列',
      receipts: '离线回执',
      mergeReceipts: '合并回执',
      retryFailed: '重试失败',
      mergeLog: '合并日志',
      directorOverride: '导演覆盖',
      bindAnchor: '绑定台词锚点',
      anchorValid: '锚点有效',
      anchorInvalid: '锚点失效',
      missingEquipment: '设备缺失',
      confirmed: '已确认',
      pending: '待确认',
      blocked: '受阻',
      invalid: '失效',
      merged: '已合并',
      failed: '失败',
      retry: '重试',
      confirm: '确认',
      reject: '退回',
      override: '覆盖',
      editLine: '编辑台词',
      addTheater: '新增剧场',
      addEquipment: '新增设备',
      remove: '移除',
      available: '可用',
      unavailable: '不可用',
      noAnchor: '未绑定锚点',
      gateBlocked: '无法进入排练提词',
      duplicateSkipped: '重复回执已跳过',
      mergeFailedKept: '合并失败，已保留队列继续重试',
      unauthorized: '越权确认已拒绝',
    });
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideAnimations(),
    provideRouter([]),
    provideStore({ script: scriptReducer }),
    provideEffects([ScriptEffects]),
    provideTransloco({
      config: { availableLangs: ['zh'], defaultLang: 'zh', fallbackLang: 'zh' },
      loader: InlineTranslocoLoader
    }),
  ]
};
