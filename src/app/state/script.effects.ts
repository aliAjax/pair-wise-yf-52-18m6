import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, from, map, of, switchMap, withLatestFrom } from 'rxjs';
import { mergeReceipts, mergeReceiptsProgress, retryFailedMerges } from './script.actions';
import {
  Cue,
  CueConfirmation,
  DirectorOverride,
  Line,
  Receipt,
  ScriptState,
  Theater,
  hashText,
} from './script.reducer';

// ---------------------------------------------------------------------------
// 合并服务：离线确认回网后按设备序号合并，模拟网络冲突与重试
// ---------------------------------------------------------------------------

export interface MergeResult {
  receiptId: string;
  success: boolean;
  error: string | null;
}

interface MergeContext {
  cues: Cue[];
  lines: Line[];
  theaters: Theater[];
  confirmations: CueConfirmation[];
  overrides: DirectorOverride[];
}

@Injectable({ providedIn: 'root' })
export class MergeService {
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 锚点是否仍有效：绑定了台词，且当前台词文本哈希与绑定时一致。 */
  private isAnchorValid(cue: Cue, lines: Line[]): boolean {
    if (!cue.anchorLineId || !cue.anchorHash) return false;
    const line = lines.find((l) => l.id === cue.anchorLineId);
    return !!line && hashText(line.text) === cue.anchorHash;
  }

  /**
   * 按设备序号合并回执。
   * - 锚点已失效且未被导演覆盖 → 失败（需先覆盖）
   * - 设备缺失 → 失败
   * - 重复回执（同 提示+剧场+设备+结论）→ 幂等跳过，只算一次
   * - 其余偶发网络冲突 → 失败，保留队列重试
   */
  async merge(receipts: Receipt[], context: MergeContext): Promise<MergeResult[]> {
    const results: MergeResult[] = [];
    for (const receipt of receipts) {
      await this.delay(100);
      const cue = context.cues.find((c) => c.id === receipt.cueId);
      const theater = context.theaters.find((t) => t.id === receipt.theaterId);

      if (!cue) {
        results.push({ receiptId: receipt.id, success: false, error: '提示不存在' });
        continue;
      }
      if (!this.isAnchorValid(cue, context.lines)) {
        results.push({ receiptId: receipt.id, success: false, error: '锚点已失效，需导演覆盖' });
        continue;
      }
      const overridden = context.overrides.some((o) => o.cueId === cue.id && o.theaterId === receipt.theaterId);
      if (!overridden) {
        // 锚点有效但仍需确认设备可用
      }

      const equipment = theater?.equipment.find((e) => e.serialNumber === receipt.equipmentSerialNumber);
      if (!equipment || !equipment.available) {
        results.push({ receiptId: receipt.id, success: false, error: '设备缺失或不可用' });
        continue;
      }

      // 幂等：同一 提示+剧场+设备+结论 的确认只保留一条
      const dupKey = `${receipt.cueId}|${receipt.theaterId}|${receipt.equipmentSerialNumber}|${receipt.decision}`;
      const already = context.confirmations.some(
        (c) => `${c.cueId}|${c.theaterId}|${c.equipmentSerialNumber}|${c.decision}` === dupKey
      );
      if (already) {
        results.push({ receiptId: receipt.id, success: true, error: null });
        continue;
      }

      // 偶发网络冲突，模拟合并失败以验证重试队列
      if (Math.random() < 0.22) {
        results.push({ receiptId: receipt.id, success: false, error: '网络冲突，重试中' });
        continue;
      }

      results.push({ receiptId: receipt.id, success: true, error: null });
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function buildContext(state: ScriptState): MergeContext {
  const version = state.versions.find((v) => v.id === state.activeVersionId) ?? state.versions[0];
  return {
    cues: version.cues,
    lines: version.lines,
    theaters: state.theaters,
    confirmations: state.confirmations,
    overrides: state.directorOverrides,
  };
}

@Injectable()
export class ScriptEffects {
  constructor(
    private readonly actions$: Actions,
    private readonly store: Store<{ script: ScriptState }>,
    private readonly mergeService: MergeService
  ) {}

  /** 合并所有未合并回执。 */
  mergeReceipts$ = createEffect(() =>
    this.actions$.pipe(
      ofType(mergeReceipts),
      withLatestFrom(this.store.select('script')),
      switchMap(([, state]) => {
        const pending = state.receipts.filter((r) => !r.merged);
        if (pending.length === 0) return of({ type: '[Merge] No-op' });
        return this.runMerge(pending, state);
      })
    )
  );

  /** 仅重试之前失败的回执。 */
  retryFailedMerges$ = createEffect(() =>
    this.actions$.pipe(
      ofType(retryFailedMerges),
      withLatestFrom(this.store.select('script')),
      switchMap(([, state]) => {
        const failed = state.receipts.filter((r) => !r.merged && r.mergeAttempts > 0);
        if (failed.length === 0) return of({ type: '[Merge] No-op' });
        return this.runMerge(failed, state);
      })
    )
  );

  private runMerge(receipts: Receipt[], state: ScriptState) {
    return from(this.mergeService.merge(receipts, buildContext(state))).pipe(
      map((results) => mergeReceiptsProgress({ results })),
      catchError(() =>
        of(
          mergeReceiptsProgress({
            results: receipts.map((r) => ({ receiptId: r.id, success: false, error: '合并服务异常，稍后重试' })),
          })
        )
      )
    );
  }
}
