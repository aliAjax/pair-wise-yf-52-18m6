import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Store } from '@ngrx/store';
import { TranslocoModule } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import {
  activateVersion,
  addEquipment,
  addTheater,
  addVersion,
  bindCueToLine,
  clearMergeLog,
  clearRejection,
  confirmCueRequest,
  directorOverrideCue,
  mergeReceipts,
  removeEquipment,
  reorderLines,
  retryFailedMerges,
  reviewCue,
  reviewLine,
  setActiveTheater,
  setOnline,
  setRole,
  toggleEquipmentAvailability,
  toggleRehearsal,
  unbindCue,
  updateLineText,
} from './state/script.actions';
import {
  AdaptationItem,
  Cue,
  CueType,
  GateStatus,
  Line,
  Role,
  ScriptState,
  ScriptVersion,
  Theater,
  hashText,
  selectActiveTheater,
  selectActiveVersion,
  selectActiveVersionId,
  selectAdaptationItems,
  selectCanConfirm,
  selectCanOverride,
  selectCurrentRole,
  selectFailedReceipts,
  selectGateStatus,
  selectLastRejection,
  selectMergeLog,
  selectMergedReceipts,
  selectOnline,
  selectPendingReceipts,
  selectRehearsalMode,
  selectTheaters,
  selectVersions,
} from './state/script.reducer';

const ROLE_LABELS: Record<Role, string> = {
  stage_manager: '场务',
  stage_supervisor: '舞台监督',
  director: '导演',
  playwright: '编剧',
  actor: '演员',
};

const TYPE_LABELS: Record<CueType, string> = {
  prop: '道具',
  lighting: '灯光',
  sound: '音效',
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DragDropModule,
    MatToolbarModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
    TranslocoModule,
  ],
  template: `
    <mat-toolbar color="primary" class="topbar">
      <span>{{ 'title' | transloco }}</span>
      <span class="spacer"></span>
      <button mat-stroked-button (click)="toggleOnline()">
        {{ ((online$ | async) ? 'online' : 'offline') | transloco }}
      </button>
      <button mat-flat-button color="accent" (click)="toggleRehearsal()">
        {{ ((rehearsal$ | async) ? 'normalMode' : 'rehearsalMode') | transloco }}
      </button>
    </mat-toolbar>

    <main [class.rehearsal]="(rehearsal$ | async)">
      <!-- 越权 / 门禁提示 -->
      <mat-card class="banner warn" *ngIf="lastRejection$ | async as rej">
        <mat-icon>warning</mat-icon>
        <span>{{ rej.reason }}</span>
        <button mat-button (click)="clearRejection()">知道了</button>
      </mat-card>

      <!-- 岗位切换 -->
      <section class="role-bar">
        <span class="role-label">{{ 'role' | transloco }}：</span>
        <mat-button-toggle-group [value]="currentRole$ | async" (change)="setRole($event.value)">
          <mat-button-toggle *ngFor="let r of roles" [value]="r">{{ roleLabel(r) }}</mat-button-toggle>
        </mat-button-toggle-group>
      </section>

      <!-- 排练提词模式 -->
      <ng-container *ngIf="(rehearsal$ | async) && (activeVersion$ | async) as version">
        <mat-card class="prompter">
          <mat-card-title>排练提词 · {{ (activeTheater$ | async)?.name }}</mat-card-title>
          <mat-card-subtitle>{{ version.label }}</mat-card-subtitle>
          <article class="prompt-line" *ngFor="let line of version.lines">
            <b>{{ line.role }}</b>
            <p>{{ line.text }}</p>
          </article>
          <article class="prompt-cue" *ngFor="let item of (adaptationItems$ | async)">
            <ng-container *ngIf="findCue(version, item.cueId) as cue">
              <mat-chip [class]="'chip-' + item.status">{{ statusLabel(item.status) }}</mat-chip>
              <span class="cue-text">{{ cue.text }}</span>
              <span class="cue-type">{{ typeLabel(cue.type) }}</span>
            </ng-container>
          </article>
        </mat-card>
      </ng-container>

      <!-- 正式工作模式 -->
      <ng-container *ngIf="!(rehearsal$ | async)">
        <section class="summary">
          <mat-card>
            <mat-card-title>版本控制与换场适配</mat-card-title>
            <p>巡演换场后剧本版本不变，道具、灯光、音效提示按剧场设备重新核对。每条提示绑定台词锚点，锚点一变立即失效重算。</p>
            <div class="chips">
              <button mat-stroked-button *ngFor="let version of (versions$ | async)" [color]="version.id === (activeVersionId$ | async) ? 'primary' : ''" (click)="activate(version.id)">
                {{ version.label }} · {{ version.playwright }}
              </button>
              <button mat-flat-button color="primary" (click)="createDraft()">新增导演修订</button>
            </div>
          </mat-card>
        </section>

        <section *ngIf="activeVersion$ | async as version" class="workspace">
          <mat-card class="script">
            <mat-card-title>{{ version.label }}</mat-card-title>
            <mat-card-subtitle>{{ version.note }}</mat-card-subtitle>
            <mat-tab-group>
              <!-- 角色台词 -->
              <mat-tab label="角色台词">
                <div cdkDropList (cdkDropListDropped)="dropLine($event)">
                  <article class="line" cdkDrag *ngFor="let line of version.lines">
                    <div class="line-body">
                      <b>{{ line.role }}</b>
                      <input matInput [value]="line.text" (change)="updateLine(line.id, $any($event.target).value)" class="line-input" />
                      <span class="status" [class.ok]="line.status === 'accepted'">{{ line.status }}</span>
                    </div>
                    <div class="line-actions">
                      <button mat-button color="primary" (click)="reviewLine(line.id, 'accepted')">采纳</button>
                      <button mat-button color="warn" (click)="reviewLine(line.id, 'returned')">退回</button>
                    </div>
                  </article>
                </div>
                <p class="hint">提示：编辑台词文本会改变锚点哈希，绑定该台词的提示将立即失效并重算。</p>
              </mat-tab>

              <!-- 舞台提示 + 锚点绑定 -->
              <mat-tab label="舞台提示">
                <article class="line cue-row" *ngFor="let cue of version.cues">
                  <div class="cue-body">
                    <div class="cue-head">
                      <b>{{ cue.scene }}</b>
                      <mat-chip class="cue-type-chip">{{ typeLabel(cue.type) }}</mat-chip>
                      <span class="status" [class.ok]="cue.status === 'accepted'">{{ cue.status }}</span>
                    </div>
                    <p>{{ cue.text }}</p>
                    <div class="anchor-row">
                      <span class="anchor-label">台词锚点：</span>
                      <mat-select [value]="cue.anchorLineId" (selectionChange)="bindCue(cue.id, $event.value)" placeholder="未绑定锚点" class="anchor-select">
                        <mat-option [value]="null">未绑定</mat-option>
                        <mat-option *ngFor="let line of version.lines" [value]="line.id">{{ line.role }}：{{ line.text | slice:0:12 }}…</mat-option>
                      </mat-select>
                      <button mat-button *ngIf="cue.anchorLineId" (click)="unbindCue(cue.id)">解绑</button>
                    </div>
                  </div>
                  <div class="cue-actions">
                    <button mat-button color="primary" (click)="reviewCue(cue.id, 'accepted')">采纳</button>
                    <button mat-button color="warn" (click)="reviewCue(cue.id, 'returned')">退回</button>
                  </div>
                </article>
              </mat-tab>
            </mat-tab-group>
          </mat-card>

          <!-- 剧场与设备 -->
          <mat-card class="theater">
            <mat-card-title>剧场与设备</mat-card-title>
            <mat-card-subtitle>不同剧场同一提示的确认结果分开保存；按设备序号合并回执。</mat-card-subtitle>
            <div class="theater-select-row">
              <mat-select [value]="(activeTheater$ | async)?.id" (selectionChange)="setActiveTheater($event.value)">
                <mat-option *ngFor="let t of (theaters$ | async)" [value]="t.id">{{ t.name }}</mat-option>
              </mat-select>
              <button mat-stroked-button (click)="promptAddTheater()">新增剧场</button>
            </div>

            <div *ngIf="activeTheater$ | async as theater" class="equipment-list">
              <div class="equip-row" *ngFor="let eq of theater.equipment">
                <mat-chip [class]="eq.available ? 'chip-ok' : 'chip-blocked'">{{ eq.available ? '可用' : '缺失' }}</mat-chip>
                <span class="equip-serial">{{ eq.serialNumber }}</span>
                <span class="equip-name">{{ eq.name }}</span>
                <span class="equip-type">{{ typeLabel(eq.type) }}</span>
                <span class="spacer"></span>
                <button mat-button (click)="toggleEquipment(theater.id, eq.serialNumber)">{{ eq.available ? '标记缺失' : '恢复可用' }}</button>
                <button mat-button color="warn" (click)="removeEquipment(theater.id, eq.serialNumber)">移除</button>
              </div>
              <p *ngIf="theater.equipment.length === 0" class="hint">该剧场暂无设备，请新增。</p>
              <div class="add-equip">
                <input matInput #equipName placeholder="设备名称" />
                <mat-select #equipType value="lighting" placeholder="类型">
                  <mat-option value="lighting">灯光</mat-option>
                  <mat-option value="sound">音效</mat-option>
                  <mat-option value="prop">道具</mat-option>
                </mat-select>
                <button mat-flat-button (click)="addEquipment(theater.id, equipName.value, equipType.value); equipName.value = ''">新增设备</button>
              </div>
            </div>
          </mat-card>
        </section>

        <!-- 适配队列 -->
        <section class="adaptation">
          <mat-card>
            <mat-card-title>适配队列 · {{ (activeTheater$ | async)?.name }}</mat-card-title>
            <mat-card-subtitle>每条提示绑定台词锚点；锚点一变立即失效重算。设备缺失或仍有失效锚点时不能进入排练提词。</mat-card-subtitle>
            <div class="gate" *ngIf="gate$ | async as gate">
              <mat-chip [class]="gate.allowed ? 'chip-ok' : 'chip-blocked'">{{ gate.allowed ? '可进入排练' : '门禁未通过' }}</mat-chip>
              <span *ngIf="!gate.allowed" class="gate-detail">
                <span *ngIf="gate.missingTypes.length">缺少设备：{{ gate.missingTypes.join('、') }}　</span>
                <span *ngIf="gate.invalidAnchors.length">失效锚点：{{ gate.invalidAnchors.join('、') }}</span>
              </span>
            </div>

            <div class="queue">
              <article class="queue-item" *ngFor="let item of (adaptationItems$ | async)">
                <ng-container *ngIf="activeVersion$ | async as version">
                  <ng-container *ngIf="findCue(version, item.cueId) as cue">
                    <div class="queue-main">
                      <div class="queue-head">
                        <mat-chip [class]="'chip-' + item.status">{{ statusLabel(item.status) }}</mat-chip>
                        <b>{{ cue.scene }}</b>
                        <span class="cue-type">{{ typeLabel(cue.type) }}</span>
                      </div>
                      <p class="cue-text">{{ cue.text }}</p>
                      <div class="queue-meta">
                        <span class="meta" [class.ok]="item.invalidAnchor || item.directorOverridden === false">
                          锚点：{{ anchorLabel(item, cue) }}
                        </span>
                        <span class="meta" *ngIf="item.missingTypes.length">缺少设备：{{ item.missingTypes.join('、') }}</span>
                        <span class="meta" *ngIf="item.equipmentSerial">设备序号：{{ item.equipmentSerial }}</span>
                      </div>
                    </div>
                    <div class="queue-actions">
                      <ng-container *ngIf="canConfirm$ | async">
                        <button mat-flat-button color="primary" [disabled]="!canConfirmItem(item)" (click)="confirmCue(cue.id, 'confirmed')">确认</button>
                      </ng-container>
                      <button mat-button color="warn" [disabled]="!canConfirmItem(item)" (click)="confirmCue(cue.id, 'rejected')">退回</button>
                      <button mat-stroked-button color="accent" *ngIf="(canOverride$ | async) && item.invalidAnchor && !item.directorOverridden" (click)="overrideCue(cue.id)">导演覆盖</button>
                    </div>
                  </ng-container>
                </ng-container>
              </article>
            </div>
          </mat-card>
        </section>

        <!-- 离线回执与合并 -->
        <section class="receipts">
          <mat-card>
            <mat-card-title>离线回执与合并</mat-card-title>
            <mat-card-subtitle>场务与舞台监督离线确认后回网按设备序号合并；重复回执只算一次；合并失败保留队列继续重试续传。</mat-card-subtitle>
            <div class="receipt-actions">
              <button mat-flat-button color="primary" (click)="mergeReceipts()">合并回执（{{ (pendingReceipts$ | async)?.length }}）</button>
              <button mat-stroked-button color="warn" (click)="retryFailed()" [disabled]="((failedReceipts$ | async)?.length ?? 0) === 0">重试失败（{{ (failedReceipts$ | async)?.length }}）</button>
              <button mat-button (click)="clearMergeLog()">清空日志</button>
            </div>

            <mat-tab-group>
              <mat-tab [label]="'待合并 (' + ((pendingReceipts$ | async)?.length ?? 0) + ')'">
                <div class="receipt-list">
                  <article class="receipt" *ngFor="let r of (pendingReceipts$ | async)">
                    <mat-chip [class]="r.lastError ? 'chip-failed' : 'chip-pending'">{{ r.lastError ? '失败' : '待合并' }}</mat-chip>
                    <span class="receipt-id">{{ r.id }}</span>
                    <span>提示 {{ r.cueId }}</span>
                    <span>剧场 {{ r.theaterId }}</span>
                    <span>设备 {{ r.equipmentSerialNumber }}</span>
                    <span>结论 {{ r.decision === 'confirmed' ? '确认' : '退回' }}</span>
                    <span>岗位 {{ roleLabel(r.confirmedBy) }}</span>
                    <span>尝试 {{ r.mergeAttempts }} 次</span>
                    <span class="error" *ngIf="r.lastError">{{ r.lastError }}</span>
                  </article>
                  <p *ngIf="(pendingReceipts$ | async)?.length === 0" class="hint">暂无待合并回执。</p>
                </div>
              </mat-tab>
              <mat-tab [label]="'已合并 (' + ((mergedReceipts$ | async)?.length ?? 0) + ')'">
                <div class="receipt-list">
                  <article class="receipt" *ngFor="let r of (mergedReceipts$ | async)">
                    <mat-chip class="chip-ok">已合并</mat-chip>
                    <span class="receipt-id">{{ r.id }}</span>
                    <span>提示 {{ r.cueId }}</span>
                    <span>剧场 {{ r.theaterId }}</span>
                    <span>设备 {{ r.equipmentSerialNumber }}</span>
                    <span>结论 {{ r.decision === 'confirmed' ? '确认' : '退回' }}</span>
                  </article>
                  <p *ngIf="(mergedReceipts$ | async)?.length === 0" class="hint">暂无已合并回执。</p>
                </div>
              </mat-tab>
              <mat-tab label="合并日志">
                <div class="receipt-list">
                  <article class="receipt" *ngFor="let log of (mergeLog$ | async)">
                    <mat-chip [class]="log.result === 'merged' ? 'chip-ok' : 'chip-failed'">{{ log.result === 'merged' ? '已合并' : '失败' }}</mat-chip>
                    <span class="receipt-id">{{ log.receiptId }}</span>
                    <span>设备 {{ log.equipmentSerialNumber }}</span>
                    <span class="error" *ngIf="log.error">{{ log.error }}</span>
                  </article>
                  <p *ngIf="(mergeLog$ | async)?.length === 0" class="hint">暂无合并日志。</p>
                </div>
              </mat-tab>
            </mat-tab-group>
          </mat-card>
        </section>
      </ng-container>

      <aside class="offline" *ngIf="!(online$ | async)">网络不可用，当前修改已写入本地缓存；恢复网络后按设备序号合并回执。</aside>
    </main>
  `,
  styles: [`
    .topbar { position: sticky; top: 0; z-index: 4; }
    .spacer { flex: 1; }
    main { max-width: 1240px; margin: 24px auto; padding: 0 18px 48px; }
    main.rehearsal { max-width: 920px; background: #111827; color: #f9fafb; margin-top: 0; padding: 24px; }
    main.rehearsal .prompter { background: #1f2937; color: #f9fafb; }
    main.rehearsal .prompt-line p { font-size: 34px; line-height: 1.5; margin: 12px 0; }
    main.rehearsal .prompt-cue { font-size: 22px; margin: 10px 0; opacity: .9; }
    .banner { display: flex; align-items: center; gap: 12px; padding: 12px 16px; margin-bottom: 16px; }
    .banner.warn { background: #fef3c7; color: #92400e; }
    .role-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .role-label { font-weight: 600; }
    .summary { margin-bottom: 18px; }
    .chips { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    .workspace { display: grid; grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr); gap: 18px; }
    .line { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 16px 0; border-bottom: 1px solid #e5e7eb; }
    .line-body { display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .line-input { font-size: 16px; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; }
    .line-actions, .cue-actions { display: flex; flex-direction: column; gap: 4px; }
    .cue-row { align-items: flex-start; }
    .cue-body { flex: 1; }
    .cue-head { display: flex; align-items: center; gap: 8px; }
    .cue-body p { margin: 8px 0; font-size: 16px; line-height: 1.6; }
    .cue-type-chip { font-size: 11px; }
    .anchor-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .anchor-label { font-size: 13px; color: #6b7280; }
    .anchor-select { min-width: 240px; }
    .status { font-size: 12px; color: #b45309; }
    .status.ok { color: #15803d; }
    .hint { font-size: 13px; color: #6b7280; margin-top: 12px; }
    .theater-select-row { display: flex; gap: 10px; align-items: center; margin: 12px 0; }
    .equipment-list { margin-top: 8px; }
    .equip-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .equip-serial { font-family: monospace; font-weight: 600; }
    .equip-name { flex: 1; }
    .equip-type { font-size: 12px; color: #6b7280; }
    .add-equip { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
    .add-equip input { flex: 1; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; }
    .adaptation, .receipts { margin-top: 18px; }
    .gate { display: flex; align-items: center; gap: 12px; margin: 12px 0; padding: 12px; background: #f9fafb; border-radius: 8px; }
    .gate-detail { font-size: 13px; color: #b45309; }
    .queue { display: flex; flex-direction: column; gap: 12px; }
    .queue-item { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 14px; border: 1px solid #e5e7eb; border-radius: 8px; }
    .queue-main { flex: 1; }
    .queue-head { display: flex; align-items: center; gap: 8px; }
    .queue-meta { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; font-size: 13px; color: #6b7280; }
    .queue-actions { display: flex; flex-direction: column; gap: 6px; }
    .meta.ok { color: #b45309; }
    .receipt-actions { display: flex; gap: 10px; margin: 12px 0; flex-wrap: wrap; }
    .receipt-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .receipt { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 13px; flex-wrap: wrap; }
    .receipt-id { font-family: monospace; font-weight: 600; }
    .error { color: #b91c1c; }
    .chip-ok { background: #dcfce7; color: #15803d; }
    .chip-blocked { background: #fee2e2; color: #b91c1c; }
    .chip-pending { background: #fef3c7; color: #b45309; }
    .chip-failed { background: #fee2e2; color: #b91c1c; }
    .chip-confirmed { background: #dcfce7; color: #15803d; }
    .chip-invalid { background: #fef3c7; color: #b45309; }
    .offline { position: fixed; right: 18px; bottom: 18px; padding: 14px 18px; color: #fff; background: #b45309; border-radius: 10px; box-shadow: 0 8px 30px #0003; }
    @media (max-width: 820px) { .workspace { grid-template-columns: 1fr; } }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  readonly activeVersion$ = this.store.select(selectActiveVersion);
  readonly activeTheater$ = this.store.select(selectActiveTheater);
  readonly theaters$ = this.store.select(selectTheaters);
  readonly adaptationItems$ = this.store.select(selectAdaptationItems);
  readonly gate$ = this.store.select(selectGateStatus);
  readonly pendingReceipts$ = this.store.select(selectPendingReceipts);
  readonly failedReceipts$ = this.store.select(selectFailedReceipts);
  readonly mergedReceipts$ = this.store.select(selectMergedReceipts);
  readonly mergeLog$ = this.store.select(selectMergeLog);
  readonly currentRole$ = this.store.select(selectCurrentRole);
  readonly canConfirm$ = this.store.select(selectCanConfirm);
  readonly canOverride$ = this.store.select(selectCanOverride);
  readonly online$ = this.store.select(selectOnline);
  readonly rehearsal$ = this.store.select(selectRehearsalMode);
  readonly lastRejection$ = this.store.select(selectLastRejection);
  readonly versions$ = this.store.select(selectVersions);
  readonly activeVersionId$ = this.store.select(selectActiveVersionId);

  readonly roles: Role[] = ['stage_manager', 'stage_supervisor', 'director', 'playwright', 'actor'];

  private currentRole: Role = 'stage_manager';
  private subscription?: Subscription;
  private onlineHandler = () => this.store.dispatch(setOnline({ online: navigator.onLine }));
  private offlineHandler = () => this.store.dispatch(setOnline({ online: false }));

  constructor(private readonly store: Store<{ script: ScriptState }>) {}

  ngOnInit() {
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
    this.subscription = this.store.select('script').subscribe((state) => localStorage.setItem('yf52-script-state', JSON.stringify(state)));
    this.store.select(selectCurrentRole).subscribe((role) => (this.currentRole = role));
  }

  ngOnDestroy() {
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('offline', this.offlineHandler);
    this.subscription?.unsubscribe();
  }

  roleLabel(role: Role): string { return ROLE_LABELS[role]; }
  typeLabel(type: CueType): string { return TYPE_LABELS[type]; }
  statusLabel(status: string): string {
    const map: Record<string, string> = { pending: '待确认', confirmed: '已确认', invalid: '失效', blocked: '受阻' };
    return map[status] ?? status;
  }
  anchorLabel(item: AdaptationItem, cue: Cue): string {
    if (!cue.anchorLineId) return '未绑定锚点';
    if (item.directorOverridden) return '已被导演覆盖';
    return item.invalidAnchor ? '锚点已失效' : '锚点有效';
  }
  findCue(version: ScriptVersion, cueId: string): Cue | undefined { return version.cues.find((c) => c.id === cueId); }

  canConfirmItem(item: AdaptationItem): boolean {
    // 导演可确认（含覆盖失效）；场务/舞台监督仅可确认有效且不缺设备的提示；编剧/演员不可确认
    if (this.currentRole === 'director') return item.missingTypes.length === 0;
    if (this.currentRole !== 'stage_manager' && this.currentRole !== 'stage_supervisor') return false;
    return !item.invalidAnchor && item.missingTypes.length === 0;
  }

  activate(id: string) { this.store.dispatch(activateVersion({ id })); }
  toggleRehearsal() { this.store.dispatch(toggleRehearsal()); }
  setRole(role: Role) { this.store.dispatch(setRole({ role })); }
  setActiveTheater(id: string) { this.store.dispatch(setActiveTheater({ id })); }
  clearRejection() { this.store.dispatch(clearRejection()); }

  toggleOnline() {
    this.store.select(selectOnline).subscribe((online) => this.store.dispatch(setOnline({ online: !online }))).unsubscribe();
  }

  reviewLine(id: string, decision: 'accepted' | 'returned') { this.store.dispatch(reviewLine({ id, decision })); }
  reviewCue(id: string, decision: 'accepted' | 'returned') { this.store.dispatch(reviewCue({ id, decision })); }
  dropLine(event: CdkDragDrop<unknown>) { if (event.previousIndex !== event.currentIndex) this.store.dispatch(reorderLines({ from: event.previousIndex, to: event.currentIndex })); }

  updateLine(id: string, text: string) { this.store.dispatch(updateLineText({ id, text })); }
  bindCue(cueId: string, lineId: string | null) {
    if (lineId) this.store.dispatch(bindCueToLine({ cueId, lineId }));
    else this.store.dispatch(unbindCue({ cueId }));
  }
  unbindCue(cueId: string) { this.store.dispatch(unbindCue({ cueId })); }

  promptAddTheater() {
    const name = window.prompt('剧场名称');
    if (name) this.store.dispatch(addTheater({ name }));
  }
  addEquipment(theaterId: string, name: string, equipmentType: CueType) {
    if (!name) return;
    this.store.dispatch(addEquipment({ theaterId, name, equipmentType }));
  }
  removeEquipment(theaterId: string, serialNumber: string) { this.store.dispatch(removeEquipment({ theaterId, serialNumber })); }
  toggleEquipment(theaterId: string, serialNumber: string) { this.store.dispatch(toggleEquipmentAvailability({ theaterId, serialNumber })); }

  confirmCue(cueId: string, decision: 'confirmed' | 'rejected') {
    this.store.select(selectActiveTheater).subscribe((theater) => {
      if (theater) this.store.dispatch(confirmCueRequest({ cueId, theaterId: theater.id, decision }));
    }).unsubscribe();
  }
  overrideCue(cueId: string) {
    this.store.select(selectActiveTheater).subscribe((theater) => {
      if (theater) this.store.dispatch(directorOverrideCue({ cueId, theaterId: theater.id }));
    }).unsubscribe();
  }

  mergeReceipts() { this.store.dispatch(mergeReceipts()); }
  retryFailed() { this.store.dispatch(retryFailedMerges()); }
  clearMergeLog() { this.store.dispatch(clearMergeLog()); }

  createDraft() {
    const id = `v${Date.now().toString().slice(-4)}`;
    const lineText = '这次换你告诉我，灯亮之后准备去哪里。';
    const version: ScriptVersion = {
      id,
      label: `导演修订 ${id}`,
      playwright: '本地草稿',
      note: '断网期间创建的修订，等待与编剧版本合并。',
      lines: [{ id: `${id}-l1`, role: '周岚', text: lineText, status: 'pending' }],
      cues: [{
        id: `${id}-c1`, scene: '第三场', text: '追光保持到台词结束，再执行全场收光', type: 'lighting', status: 'pending',
        anchorLineId: `${id}-l1`, anchorHash: hashText(lineText), requiredTypes: ['lighting'],
      }],
    };
    this.store.dispatch(addVersion({ version }));
    this.store.dispatch(activateVersion({ id }));
  }
}
