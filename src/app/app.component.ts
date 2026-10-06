import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Store } from '@ngrx/store';
import { TranslocoModule } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import {
  activateTheater,
  activateVersion,
  addVersion,
  clearDenial,
  confirmCue,
  deleteLine,
  editLineText,
  mergeOutbox,
  overrideCue,
  recomputeCue,
  reviewLine,
  setOnline,
  switchRole,
  toggleRehearsal
} from './state/script.actions';
import {
  AdaptItem,
  CUE_KIND_LABEL,
  ConfirmationRecord,
  GateResult,
  Receipt,
  ROLE_INFOS,
  Role,
  ScriptVersion,
  Theater,
  buildQueue,
  lineFingerprint,
  rehearsalGate,
  roleName
} from './state/tour.model';
import { DENIAL_TEXT, ScriptState } from './state/script.reducer';

const STATUS_LABEL: Record<AdaptItem['status'], string> = {
  pending: '待确认',
  confirmed: '已确认',
  stale: '锚点失效',
  missingAnchor: '锚点缺失',
  missingDevice: '缺少设备',
  overridden: '导演已覆盖'
};

const RECEIPT_STATUS_LABEL: Record<Receipt['status'], string> = {
  pending: '待合并',
  merged: '已合并',
  duplicate: '重复回执',
  failed: '已驳回'
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, MatToolbarModule, MatButtonModule, MatCardModule, MatChipsModule, MatIconModule, TranslocoModule],
  template: `
    <ng-container *ngIf="state$ | async as s">
      <mat-toolbar color="primary" class="topbar">
        <span>{{ 'title' | transloco }}</span>
        <span class="spacer"></span>
        <button mat-stroked-button (click)="toggleOnline(s)">
          {{ (s.online ? 'online' : 'offline') | transloco }}
        </button>
        <button mat-flat-button color="accent" (click)="toggleRehearsal()">
          {{ (s.rehearsalMode ? 'normalMode' : 'rehearsalMode') | transloco }}
        </button>
      </mat-toolbar>

      <div class="denial" *ngIf="s.denial as denial">
        <mat-icon class="warn-icon">warning</mat-icon>
        <span>{{ denialText(s, denial.code) }}</span>
        <button mat-button color="warn" (click)="clearDenial()">知道了</button>
      </div>

      <!-- 排练提词：大字号 -->
      <main class="prompter" *ngIf="s.rehearsalMode">
        <h2>{{ version(s).label }} · {{ theater(s).name }}</h2>
        <p class="prompter-note">本场馆设备核对已全部闭环，提词进行中。</p>
        <section class="prompter-lines">
          <ng-container *ngFor="let line of version(s).lines">
            <article class="p-line">
              <span class="p-role">{{ line.role }}</span>
              <p>{{ line.text }}</p>
            </article>
            <article class="p-cue" *ngFor="let item of cueItemsAt(s, line.id)">
              <b>【{{ CUE_KIND_LABEL[item.cue.kind] }}】</b>{{ item.cue.text }}
              <span class="p-tag" *ngIf="item.status === 'overridden'">导演覆盖</span>
            </article>
          </ng-container>
        </section>
      </main>

      <main *ngIf="!s.rehearsalMode" class="board">
        <!-- 维度选择：剧本版本（巡演不变） / 场馆 / 当前岗位 -->
        <section class="selectors">
          <mat-card>
            <mat-card-title>剧本版本</mat-card-title>
            <p class="hint">巡演期间版本锁定，换场不换本；只重核道具、灯光、音效提示。</p>
            <div class="chips">
              <button *ngFor="let v of s.versions" mat-stroked-button
                      [color]="v.id === s.activeVersionId ? 'primary' : ''"
                      (click)="activateVersion(v.id)">
                {{ v.label }}
                <span class="lock" *ngIf="v.tourLocked">🔒 巡演锁定</span>
              </button>
              <button mat-flat-button color="primary" (click)="createDraft(s)">新增本地修订</button>
            </div>
          </mat-card>

          <mat-card>
            <mat-card-title>巡演场馆（确认结果分库保存）</mat-card-title>
            <div class="chips">
              <button *ngFor="let t of s.theaters" mat-stroked-button
                      [color]="t.id === s.activeTheaterId ? 'primary' : ''"
                      (click)="activateTheater(t.id)">
                {{ t.city }} · {{ t.name }}
              </button>
            </div>
          </mat-card>

          <mat-card>
            <mat-card-title>当前岗位</mat-card-title>
            <div class="chips">
              <button *ngFor="let r of roles" mat-stroked-button
                      [color]="r.id === s.currentRole ? 'accent' : ''"
                      (click)="switchRole(r.id)">
                {{ r.name }}<span class="role-cap">·{{ capability(r.id) }}</span>
              </button>
            </div>
          </mat-card>
        </section>

        <section class="workspace">
          <!-- 适配队列 -->
          <mat-card class="queue-card">
            <mat-card-title>换场适配队列 · {{ theater(s).name }}</mat-card-title>
            <mat-card-subtitle>
              每条提示绑定台词锚点；台词一变，相关提示立即失效并需重算。
            </mat-card-subtitle>

            <article class="q-item" *ngFor="let item of queue(s)">
              <div class="q-head">
                <span class="kind" [class]="'kind-' + item.cue.kind">{{ CUE_KIND_LABEL[item.cue.kind] }}</span>
                <b>{{ item.cue.scene }}</b>
                <span class="q-status" [class]="'st-' + item.status">{{ STATUS_LABEL[item.status] }}</span>
                <span class="q-anchor" [class]="'an-' + item.anchorState">{{ anchorLabel(item) }}</span>
              </div>
              <p class="q-text">{{ item.cue.text }}</p>

              <div class="q-meta">
                <div class="device" [class.missing]="!item.equipment">
                  <mat-icon>{{ item.equipment ? 'precision_manufacturing' : 'portable_wifi_off' }}</mat-icon>
                  <span *ngIf="item.equipment">设备 {{ item.equipment.serial }} · {{ item.equipment.label }}</span>
                  <span *ngIf="!item.equipment">本场馆缺少{{ CUE_KIND_LABEL[item.cue.kind] }}设备位</span>
                </div>
                <div class="anchor-line">
                  <mat-icon>link</mat-icon>
                  <span>锚点台词：{{ anchorSnippet(s, item) }}</span>
                </div>
                <div class="record" *ngIf="item.record">
                  <mat-icon>verified</mat-icon>
                  <span>
                    {{ roleName(item.record.role) }}{{ item.record.overridden ? '覆盖' : '确认' }}
                    <ng-container *ngIf="item.record.equipmentSerial"> · 设备 {{ item.record.equipmentSerial }}</ng-container>
                    · 锚点修订 r{{ item.record.anchorRevision }} · 回执 {{ item.record.receiptId }}
                  </span>
                </div>
              </div>

              <div class="q-actions">
                <button mat-raised-button color="primary" (click)="confirm(item.cue.id)">
                  {{ s.online ? '按设备确认' : '离线确认（入回执队列）' }}
                </button>
                <button mat-stroked-button (click)="recompute(item)" [disabled]="item.anchorState !== 'stale'">
                  重算锚点
                </button>
                <button mat-stroked-button color="accent" (click)="override(item.cue.id)">导演覆盖</button>
              </div>
            </article>
          </mat-card>

          <!-- 右栏：门禁 / 台词 / 离线队列 -->
          <div class="side">
            <mat-card [class.gate-ok]="gate(s).allowed" [class.gate-bad]="!gate(s).allowed">
              <mat-card-title>排练提词门禁</mat-card-title>
              <p class="gate-msg" *ngIf="gate(s).allowed">
                ✅ {{ theater(s).name }} 的道具、灯光、音效提示均已核对闭环，可进入排练提词。
              </p>
              <ul class="gate-list" *ngIf="!gate(s).allowed">
                <li *ngFor="let reason of gate(s).reasons">{{ reason }}</li>
              </ul>
              <button mat-flat-button color="accent" [disabled]="!gate(s).allowed" (click)="toggleRehearsal()">
                进入排练提词
              </button>
            </mat-card>

            <mat-card>
              <mat-card-title>角色台词（锚点源）</mat-card-title>
              <p class="hint">改动或删除台词，会让绑定它的提示立即失效。</p>
              <article class="line-edit" *ngFor="let line of version(s).lines">
                <b>{{ line.role }}</b>
                <div class="line-row">
                  <input [value]="editTexts[line.id] ?? line.text"
                         (input)="editTexts[line.id] = $any($event.target).value" />
                  <button mat-button color="primary"
                          [disabled]="(editTexts[line.id] ?? line.text) === line.text"
                          (click)="saveLine(line.id)">保存</button>
                  <button mat-button color="warn" (click)="removeLine(line.id)">删除</button>
                </div>
                <span class="bound">绑定提示：{{ boundCueIds(s, line.id) }}</span>
              </article>
            </mat-card>

            <mat-card class="outbox">
              <mat-card-title>离线确认回执</mat-card-title>
              <p class="hint" *ngIf="s.online">当前在线，确认直接入账；可切到离线后由场务/舞台监督确认，再回网按设备序号合并。</p>
              <p class="hint" *ngIf="!s.online">离线中：确认进入待传队列；回网自动按设备序号合并，重复回执只算一次。</p>

              <div class="ob-stats">
                <span>待传 {{ count(s, 'pending') }}</span>
                <span class="ok">已合并 {{ count(s, 'merged') }}</span>
                <span class="dup">重复 {{ count(s, 'duplicate') }}</span>
                <span class="fail">驳回 {{ count(s, 'failed') }}</span>
              </div>

              <article class="ob-item" *ngFor="let r of s.outbox">
                <div>
                  <b>设备 {{ r.equipmentSerial ?? '—' }}</b>
                  <span class="ob-cue">{{ cueText(s, r.cueId) }}</span>
                </div>
                <div class="ob-sub">
                  {{ theaterName(s, r.theaterId) }} · {{ roleName(r.role) }} ·
                  锚点 r{{ r.anchorRevision }} · {{ RECEIPT_STATUS_LABEL[r.status] }}
                  <span *ngIf="r.attempts > 0">（已重试 {{ r.attempts }} 次）</span>
                  <span class="fail-reason" *ngIf="r.failReason === 'link-down'">链路中断，保留待续传</span>
                  <span class="fail-reason" *ngIf="r.failReason === 'anchor-drifted'">合并时锚点已变更，驳回</span>
                </div>
              </article>
              <p *ngIf="s.outbox.length === 0" class="hint">暂无离线回执。</p>

              <div class="ob-actions">
                <button mat-stroked-button [disabled]="s.online" (click)="goOnline(s)">回网并自动合并</button>
                <button mat-stroked-button [disabled]="!hasPending(s)" (click)="mergeWithFailure()">模拟合并中途断网</button>
                <button mat-raised-button color="primary" [disabled]="!hasPending(s)" (click)="retryMerge()">断点续传</button>
              </div>
              <p class="merge-summary" *ngIf="s.lastMerge as m">
                上次合并：入账 {{ m.merged }} 条，重复 {{ m.duplicates }} 条，
                未完成 {{ m.pending }} 条，驳回 {{ m.rejected }} 条。
              </p>
            </mat-card>
          </div>
        </section>
      </main>
    </ng-container>
  `,
  styles: [`
    .topbar { position: sticky; top: 0; z-index: 4; }
    .spacer { flex: 1; }
    .denial { display: flex; align-items: center; gap: 10px; margin: 12px auto 0; max-width: 1180px;
      padding: 10px 16px; background: #fef2f2; border: 1px solid #fca5a5; color: #b91c1c;
      border-radius: 10px; font-size: 14px; }
    .denial span { flex: 1; white-space: pre-line; }
    .board { max-width: 1180px; margin: 20px auto; padding: 0 18px 60px; }
    .selectors { display: grid; gap: 14px; margin-bottom: 16px; }
    .hint { color: #6b7280; font-size: 13px; margin: 6px 0 10px; }
    .chips { display: flex; gap: 10px; flex-wrap: wrap; }
    .lock { color: #15803d; font-size: 12px; margin-left: 6px; }
    .role-cap { color: #9ca3af; font-size: 12px; margin-left: 4px; }
    .workspace { display: grid; grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr); gap: 16px; align-items: start; }
    .side { display: grid; gap: 16px; }
    .q-item { border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; background: #fff; }
    .q-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .kind { font-size: 12px; padding: 2px 10px; border-radius: 999px; color: #fff; }
    .kind-prop { background: #b45309; }
    .kind-light { background: #ca8a04; }
    .kind-sfx { background: #2563eb; }
    .q-status { margin-left: auto; font-size: 12px; padding: 2px 10px; border-radius: 999px; }
    .st-pending { background: #f3f4f6; color: #374151; }
    .st-confirmed { background: #dcfce7; color: #15803d; }
    .st-stale { background: #ffedd5; color: #c2410c; }
    .st-missingAnchor, .st-missingDevice { background: #fee2e2; color: #b91c1c; }
    .st-overridden { background: #ede9fe; color: #6d28d9; }
    .q-anchor { font-size: 12px; }
    .an-bound { color: #15803d; }
    .an-stale { color: #c2410c; }
    .an-missing { color: #b91c1c; }
    .q-text { font-size: 16px; margin: 10px 0; }
    .q-meta { display: grid; gap: 6px; font-size: 13px; color: #4b5563; }
    .q-meta mat-icon { font-size: 17px; width: 18px; height: 18px; vertical-align: sub; color: #6b7280; }
    .device.missing { color: #b91c1c; }
    .record { color: #15803d; }
    .q-actions { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
    .gate-ok { border-color: #86efac; }
    .gate-bad { border-color: #fca5a5; }
    .gate-msg { color: #15803d; }
    .gate-list { margin: 0 0 12px 18px; color: #b91c1c; font-size: 14px; line-height: 1.8; }
    .line-edit { padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
    .line-row { display: flex; gap: 6px; margin: 6px 0; }
    .line-row input { flex: 1; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; }
    .bound { font-size: 12px; color: #9ca3af; }
    .ob-stats { display: flex; gap: 14px; font-size: 13px; margin-bottom: 10px; }
    .ob-stats .ok { color: #15803d; }
    .ob-stats .dup { color: #b45309; }
    .ob-stats .fail { color: #b91c1c; }
    .ob-item { border-bottom: 1px solid #f3f4f6; padding: 8px 0; font-size: 13px; }
    .ob-cue { margin-left: 8px; color: #374151; }
    .ob-sub { color: #6b7280; font-size: 12px; margin-top: 2px; }
    .fail-reason { color: #b91c1c; margin-left: 6px; }
    .ob-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    .merge-summary { font-size: 12px; color: #6b7280; margin: 10px 0 0; }
    .prompter { max-width: 900px; margin: 0 auto; background: #0f172a; color: #f8fafc; min-height: calc(100vh - 64px);
      padding: 40px 36px 80px; }
    .prompter h2 { font-size: 30px; }
    .prompter-note { color: #94a3b8; font-size: 18px; }
    .p-line { margin: 34px 0 10px; }
    .p-role { font-size: 24px; color: #fbbf24; }
    .p-line p { font-size: 40px; line-height: 1.5; margin: 10px 0 0; font-weight: 500; }
    .p-cue { font-size: 26px; color: #7dd3fc; margin: 8px 0 8px 8px; }
    .p-tag { font-size: 16px; color: #c4b5fd; border: 1px solid #c4b5fd; border-radius: 6px; padding: 0 8px; margin-left: 10px; }
    @media (max-width: 900px) {
      .workspace { grid-template-columns: 1fr; }
      .p-line p { font-size: 30px; }
    }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  readonly state$ = this.store.select('script');
  readonly roles = ROLE_INFOS;
  protected readonly CUE_KIND_LABEL = CUE_KIND_LABEL;
  editTexts: Record<string, string> = {};
  private subscription?: Subscription;
  private onlineHandler = () => this.store.dispatch(setOnline({ online: navigator.onLine }));
  private offlineHandler = () => this.store.dispatch(setOnline({ online: false }));

  constructor(private readonly store: Store<{ script: ScriptState }>) {}

  ngOnInit() {
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
    this.subscription = this.state$.subscribe((state) =>
      localStorage.setItem('yf52-tour-state-v1', JSON.stringify(state))
    );
  }

  ngOnDestroy() {
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('offline', this.offlineHandler);
    this.subscription?.unsubscribe();
  }

  // ---------- 选择/派生 ----------
  version(s: ScriptState): ScriptVersion {
    return s.versions.find((v) => v.id === s.activeVersionId) ?? s.versions[0];
  }

  theater(s: ScriptState): Theater {
    return s.theaters.find((t) => t.id === s.activeTheaterId) ?? s.theaters[0];
  }

  queue(s: ScriptState): AdaptItem[] {
    return buildQueue(this.version(s), this.theater(s), s.records);
  }

  gate(s: ScriptState): GateResult {
    return rehearsalGate(this.version(s), this.theater(s), s.records);
  }

  anchorLabel(item: AdaptItem): string {
    if (item.anchorState === 'bound') return `锚点有效 · r${item.cue.anchor.anchorRevision}`;
    if (item.anchorState === 'stale') return `台词已改 · 提示失效 · r${item.cue.anchor.anchorRevision}`;
    return '锚点台词已删除';
  }

  anchorSnippet(s: ScriptState, item: AdaptItem): string {
    const line = this.version(s).lines.find((l) => l.id === item.cue.anchor.lineId);
    if (!line) return '（缺失）';
    const same = lineFingerprint(line.text) === item.cue.anchor.fingerprint;
    return same ? `「${line.text}」` : `「${line.text}」（旧锚点：${item.cue.anchor.fingerprint}）`;
  }

  cueItemsAt(s: ScriptState, lineId: string): AdaptItem[] {
    return this.queue(s).filter(
      (item) => item.cue.anchor.lineId === lineId && (item.status === 'confirmed' || item.status === 'overridden')
    );
  }

  boundCueIds(s: ScriptState, lineId: string): string {
    const ids = this.version(s).cues.filter((c) => c.anchor.lineId === lineId).map((c) => c.id);
    return ids.length ? ids.join('、') : '无';
  }

  cueText(s: ScriptState, cueId: string): string {
    for (const v of s.versions) {
      const cue = v.cues.find((c) => c.id === cueId);
      if (cue) return cue.text;
    }
    return '（提示已不存在）';
  }

  theaterName(s: ScriptState, id: string): string {
    return s.theaters.find((t) => t.id === id)?.name ?? id;
  }

  capability(role: Role): string {
    if (role === 'director') return '仅覆盖';
    if (role === 'stageManager' || role === 'crew') return '可确认';
    return '只读';
  }

  denialText(s: ScriptState, code: string): string {
    if (code === 'rehearsal-blocked') {
      const reasons = this.gate(s).reasons;
      return reasons.length
        ? `不能进入排练提词：\n${reasons.map((r) => '· ' + r).join('\n')}`
        : '设备核对未闭环，不能进入排练提词。';
    }
    return DENIAL_TEXT[code as keyof typeof DENIAL_TEXT] ?? '操作被拒绝。';
  }

  // ---------- 操作 ----------
  activateVersion(id: string) { this.store.dispatch(activateVersion({ id })); }
  activateTheater(id: string) { this.store.dispatch(activateTheater({ id })); }
  switchRole(role: Role) { this.store.dispatch(switchRole({ role })); }
  clearDenial() { this.store.dispatch(clearDenial()); }
  toggleRehearsal() { this.store.dispatch(toggleRehearsal()); }
  confirm(cueId: string) { this.store.dispatch(confirmCue({ cueId })); }
  override(cueId: string) { this.store.dispatch(overrideCue({ cueId })); }
  recompute(item: AdaptItem) { this.store.dispatch(recomputeCue({ cueId: item.cue.id })); }
  saveLine(id: string) {
    const text = this.editTexts[id];
    if (text === undefined) return;
    this.store.dispatch(editLineText({ id, text }));
    this.editTexts = { ...this.editTexts, [id]: text };
  }
  removeLine(id: string) { this.store.dispatch(deleteLine({ id })); }

  toggleOnline(s: ScriptState) { this.store.dispatch(setOnline({ online: !s.online })); }
  goOnline(s: ScriptState) { if (!s.online) this.store.dispatch(setOnline({ online: true })); }
  hasPending(s: ScriptState): boolean { return s.outbox.some((r) => r.status === 'pending'); }
  count(s: ScriptState, status: Receipt['status']): number {
    return s.outbox.filter((r) => r.status === status).length;
  }
  mergeWithFailure() { this.store.dispatch(mergeOutbox({ injectFailure: true })); }
  retryMerge() { this.store.dispatch(mergeOutbox({ injectFailure: false })); }

  reviewLine(id: string, decision: 'accepted' | 'returned') {
    this.store.dispatch(reviewLine({ id, decision }));
  }

  createDraft(s: ScriptState) {
    const id = `v${Date.now().toString().slice(-4)}`;
    const text = '这次换你告诉我，灯亮之后准备去哪里。';
    const lineId = `${id}-l1`;
    this.store.dispatch(
      addVersion({
        version: {
          id,
          label: `本地修订 ${id}`,
          playwright: '巡演草稿',
          note: '未锁定版本；巡演仍以锁定版为准。',
          tourLocked: false,
          lines: [{ id: lineId, role: '周岚', text, status: 'pending' }],
          cues: [
            {
              id: `${id}-c1`,
              scene: '第三场',
              text: '追光保持到台词结束，再执行全场收光',
              kind: 'light',
              status: 'pending',
              anchor: { lineId, fingerprint: lineFingerprint(text), anchorRevision: 1 }
            }
          ]
        }
      })
    );
    this.store.dispatch(activateVersion({ id }));
  }
}
