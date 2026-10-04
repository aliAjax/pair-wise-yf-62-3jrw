'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AreaRevision,
  AreaStatus,
  AssetStatus,
  Bounds,
  CommsWindowVersion,
  DeliveryRecord,
  EventLog,
  Mission,
  MissionArchive,
  MissionStatus,
  RescueAsset,
  SeaForecastVersion,
  SearchArea,
  SubmitRevisionResult,
  TrackRecord
} from './types';

const now = Date.now();
const iso = (offsetMs = 0) => new Date(now - offsetMs).toISOString();

const initialSeaForecasts: SeaForecastVersion[] = [
  { version: 'SEA-20261004-06', issuedAt: iso(32 * 60_000), wind: '东北风 6级', visibility: '4.2海里', tide: '涨潮' }
];
const initialCommsWindows: CommsWindowVersion[] = [
  { version: 'COMM-20261004-A', issuedAt: iso(40 * 60_000), windows: ['08:00–08:20 主用卫星', '09:10–09:25 备用短波', '10:30–10:50 主用卫星'] }
];

const initialAreas: SearchArea[] = [
  { id: 'area-a', name: 'A区 · 最后目击点', bounds: [121.42, 30.65, 121.68, 30.88], status: 'active', coverage: 68, revisionNo: 3, activeRevisionId: 'rev-seed-3' },
  { id: 'area-b', name: 'B区 · 北向漂流', bounds: [121.64, 30.82, 121.96, 31.06], status: 'planned', coverage: 32, revisionNo: 1, activeRevisionId: 'rev-seed-b1' }
];
const initialAssets: RescueAsset[] = [
  { id: 'ship-01', name: '海巡071', type: 'ship', status: 'assigned', lat: 30.75, lng: 121.55, lastSeen: iso(35_000) },
  { id: 'heli-02', name: '救助B-712', type: 'helicopter', status: 'ready', lat: 30.82, lng: 121.73, lastSeen: iso(7 * 60_000) },
  { id: 'drone-03', name: '无人机D-9', type: 'drone', status: 'offline', lat: 30.69, lng: 121.61, lastSeen: iso(18 * 60_000) },
  { id: 'shore-01', name: '北尖岛观察哨', type: 'shore', status: 'ready', lat: 30.66, lng: 121.90, lastSeen: iso(2 * 60_000) }
];
const initialMissions: Mission[] = [
  { id: 'mission-1', title: 'A区扇形搜索', areaId: 'area-a', assetIds: ['ship-01', 'drone-03'], status: 'in_progress', priority: 'urgent', note: '优先核验橙色漂浮物', updatedAt: iso(6 * 60_000) }
];
const initialRevisions: AreaRevision[] = [
  { id: 'rev-seed-3', areaId: 'area-a', revisionNo: 3, baseRevisionNo: 2, commander: '指挥员甲', bounds: [121.42, 30.65, 121.68, 30.88], reason: '按早班海况向南收窄', status: 'applied', seaForecastVersion: 'SEA-20261004-06', commsWindowVersion: 'COMM-20261004-A', submittedAt: iso(28 * 60_000), appliedAt: iso(26 * 60_000) },
  { id: 'rev-seed-b1', areaId: 'area-b', revisionNo: 1, baseRevisionNo: 0, commander: '指挥员乙', bounds: [121.64, 30.82, 121.96, 31.06], reason: '初划北向漂流搜索带', status: 'applied', seaForecastVersion: 'SEA-20261004-06', commsWindowVersion: 'COMM-20261004-A', submittedAt: iso(90 * 60_000), appliedAt: iso(88 * 60_000) }
];
const initialArchives: MissionArchive[] = [
  { id: 'arc-1', missionId: 'mission-0', title: 'A区外圈核查', areaId: 'area-a', areaName: 'A区 · 最后目击点', boundsSnapshot: [121.40, 30.62, 121.70, 30.90], assetIds: ['ship-01'], priority: 'normal', note: '外圈已扫完，无目标', revisionId: 'rev-seed-2', closedAt: iso(50 * 60_000), closedBy: '指挥员甲' }
];
const initialTracks: TrackRecord[] = [
  { id: 'track-1', missionId: 'mission-0', areaId: 'area-a', archivedAt: iso(50 * 60_000), points: [
    { assetId: 'ship-01', assetName: '海巡071', lat: 30.66, lng: 121.50, stale: false, recordedAt: iso(50 * 60_000) }
  ] }
];
const initialEvents: EventLog[] = [
  { id: 'event-1', time: iso(15 * 60_000), actor: '指挥员', message: 'A区任务下发，海巡071开始扇形搜索' },
  { id: 'event-2', time: iso(6 * 60_000), actor: '无人机D-9', message: '链路中断，最后位置已标记为过期' }
];

const STALE_MS = 10 * 60_000;
/** 通信窗口滚动时的候用预报 */
const SEA_ROTATION: Array<Pick<SeaForecastVersion, 'wind' | 'visibility' | 'tide'>> = [
  { wind: '东北风 7级', visibility: '3.1海里', tide: '涨潮转平' },
  { wind: '北风 5级', visibility: '5.6海里', tide: '落潮' },
  { wind: '东风 6级', visibility: '4.0海里', tide: '涨潮' }
];
const COMM_ROTATION = [
  ['08:05–08:25 主用卫星', '09:20–09:35 备用短波', '11:00–11:15 主用卫星'],
  ['08:30–08:45 备用短波', '10:00–10:20 主用卫星', '12:00–12:20 主用卫星'],
  ['09:00–09:30 主用卫星', '11:10–11:25 备用短波', '13:30–13:50 主用卫星']
];

const nextSeq = (version: string) => String((parseInt(version.split('-').pop() ?? '0', 10) || 0) + 1).padStart(2, '0');

interface CommandState {
  areas: SearchArea[];
  assets: RescueAsset[];
  missions: Mission[];
  events: EventLog[];
  revisions: AreaRevision[];
  deliveries: DeliveryRecord[];
  seaForecasts: SeaForecastVersion[];
  commsWindows: CommsWindowVersion[];
  archives: MissionArchive[];
  tracks: TrackRecord[];
  offline: boolean;
  lowBandwidth: boolean;
  setAreaStatus: (id: string, status: AreaStatus) => void;
  setAssetStatus: (id: string, status: AssetStatus) => void;
  setMissionStatus: (id: string, status: MissionStatus, commander?: string) => void;
  dispatchMission: (input: { title: string; areaId: string; assetIds: string[]; priority: 'normal' | 'urgent'; note: string }) => void;
  /** 提交范围修订单：锁定当前海况/窗口版本；先写入为准，后到看到差异后按新版重提 */
  submitRevision: (input: { areaId: string; commander: string; bounds: Bounds; reason: string }) => SubmitRevisionResult;
  /** 退回/被拒后按最新版重提 */
  resubmitRevision: (revisionId: string, input: { commander: string; bounds: Bounds; reason: string }) => SubmitRevisionResult;
  /** 执行在途修订：只改搜索区范围，不动正在执行的任务与单位位置 */
  applyRevision: (revisionId: string) => { ok: boolean; undelivered?: number };
  /** 海况预报换版：所有未执行修订退回重算 */
  bumpSeaForecast: (actor?: string) => SeaForecastVersion;
  /** 通信窗口换版：所有未执行修订退回重算 */
  bumpCommsWindow: (actor?: string) => CommsWindowVersion;
  /** 回网后只重试没送到（失败/未送达）的通知，已送达不重发 */
  retryPendingDeliveries: () => { retried: number; delivered: number };
  /** 单条重试 */
  retryDelivery: (deliveryId: string) => void;
  toggleOffline: () => void;
  toggleBandwidth: () => void;
}

/** 收到修订通知的单位：相关任务参与单位 + 全部岸上观察点，去重 */
function revisionRecipients(state: CommandState, areaId: string): RescueAsset[] {
  const ids = new Set<string>();
  state.missions
    .filter((mission) => mission.areaId === areaId && mission.status !== 'closed')
    .forEach((mission) => mission.assetIds.forEach((id) => ids.add(id)));
  state.assets.filter((asset) => asset.type === 'shore').forEach((asset) => ids.add(asset.id));
  return state.assets.filter((asset) => ids.has(asset.id));
}

function makeDeliveries(state: CommandState, revision: AreaRevision): DeliveryRecord[] {
  return revisionRecipients(state, revision.areaId).map((asset) => {
    const offlineRecipient = asset.status === 'offline' || state.offline;
    return {
      id: crypto.randomUUID(),
      revisionId: revision.id,
      recipientId: asset.id,
      recipientName: asset.name,
      attempts: offlineRecipient ? 1 : 0,
      status: offlineRecipient ? 'failed' : 'delivered',
      lastAttemptAt: offlineRecipient ? new Date().toISOString() : undefined,
      deliveredAt: offlineRecipient ? undefined : new Date().toISOString()
    } satisfies DeliveryRecord;
  });
}

function queuedOfArea(revisions: AreaRevision[], areaId: string): AreaRevision | undefined {
  return revisions.find((revision) => revision.areaId === areaId && revision.status === 'queued');
}

function event(message: string, actor = '指挥员'): EventLog {
  return { id: crypto.randomUUID(), time: new Date().toISOString(), actor, message };
}

/** 预报或窗口换版时，未执行（在队列）的修订一律退回重算；已完成/已执行留档不动 */
function invalidateQueuedRevisions(
  revisions: AreaRevision[],
  events: EventLog[],
  kind: '海况预报' | '通信窗口',
  newVersion: string
): { revisions: AreaRevision[]; events: EventLog[] } {
  const touched: AreaRevision[] = [];
  const next = revisions.map((revision) => {
    if (revision.status !== 'queued') return revision;
    touched.push(revision);
    return {
      ...revision,
      status: 'returned' as const,
      returnedReason: `${kind}已换版为 ${newVersion}（本单基于旧版提交），请按新版重算后重提`
    };
  });
  const logs = touched.map((revision) =>
    event(`修订单 ${revision.revisionNo}（${revision.areaId}）所依据的${kind}已换版，未执行修订退回重算`, '系统')
  );
  return { revisions: next, events: [...logs, ...events] };
}

export const useCommandStore = create<CommandState>()(
  persist(
    (set, get) => ({
      areas: initialAreas,
      assets: initialAssets,
      missions: initialMissions,
      events: initialEvents,
      revisions: initialRevisions,
      deliveries: [],
      seaForecasts: initialSeaForecasts,
      commsWindows: initialCommsWindows,
      archives: initialArchives,
      tracks: initialTracks,
      offline: false,
      lowBandwidth: false,

      setAreaStatus: (id, status) => set((state) => ({
        areas: state.areas.map((area) => area.id === id ? { ...area, status } : area),
        events: [event(`搜索区 ${id} 状态改为 ${status}`), ...state.events]
      })),

      setAssetStatus: (id, status) => set((state) => {
        // 失联单位恢复在线：其名下未送达通知只重试该单位的部分
        const comingOnline = state.assets.find((asset) => asset.id === id)?.status === 'offline' && status !== 'offline';
        let deliveries = state.deliveries;
        const events = [...state.events];
        if (comingOnline && !state.offline) {
          let delivered = 0;
          deliveries = deliveries.map((delivery) => {
            if (delivery.recipientId !== id || delivery.status === 'delivered') return delivery;
            delivered += 1;
            return { ...delivery, status: 'delivered' as const, attempts: delivery.attempts + 1, lastAttemptAt: new Date().toISOString(), deliveredAt: new Date().toISOString() };
          });
          if (delivered > 0) events.unshift(event(`单位 ${id} 恢复在线，已补送 ${delivered} 条此前未送达的修订通知，已送达通知不重发`, '系统'));
        }
        return {
          assets: state.assets.map((asset) => asset.id === id ? { ...asset, status, lastSeen: new Date().toISOString() } : asset),
          deliveries,
          events: [event(`${id} 状态改为 ${status}，已生成恢复记录`, '值班员'), ...events]
        };
      }),

      setMissionStatus: (id, status, commander = '指挥员') => set((state) => {
        const mission = state.missions.find((item) => item.id === id);
        if (!mission) return {};
        let { missions, archives, tracks } = state;
        const events = [...state.events];
        if (status === 'closed' && mission.status !== 'closed') {
          // 已完成任务：按关闭瞬间的范围与单位位置留档，之后搜索区怎么改都不影响归档
          const area = state.areas.find((item) => item.id === mission.areaId);
          const archive: MissionArchive = {
            id: crypto.randomUUID(),
            missionId: mission.id,
            title: mission.title,
            areaId: mission.areaId,
            areaName: area?.name ?? mission.areaId,
            boundsSnapshot: area ? [...area.bounds] as Bounds : [0, 0, 0, 0],
            assetIds: [...mission.assetIds],
            priority: mission.priority,
            note: mission.note,
            revisionId: area?.activeRevisionId,
            closedAt: new Date().toISOString(),
            closedBy: commander
          };
          const points = state.assets
            .filter((asset) => mission.assetIds.includes(asset.id))
            .map((asset) => ({
              assetId: asset.id,
              assetName: asset.name,
              lat: asset.lat,
              lng: asset.lng,
              stale: Date.now() - new Date(asset.lastSeen).getTime() > STALE_MS,
              recordedAt: new Date().toISOString()
            }));
          tracks = [{ id: crypto.randomUUID(), missionId: mission.id, areaId: mission.areaId, points, archivedAt: new Date().toISOString() }, ...tracks];
          archives = [archive, ...archives];
          missions = missions.filter((item) => item.id !== id);
          events.unshift(event(`任务“${mission.title}”关闭并归档：范围快照与航迹已按第 ${area?.revisionNo ?? '?'} 版留档`, commander));
        } else {
          missions = missions.map((item) => item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item);
          events.unshift(event(`任务 ${id} 状态改为 ${status}`, commander));
        }
        return { missions, archives, tracks, events };
      }),

      dispatchMission: (input) => set((state) => {
        const mission: Mission = { id: crypto.randomUUID(), ...input, status: 'dispatched', updatedAt: new Date().toISOString() };
        return {
          missions: [mission, ...state.missions],
          assets: state.assets.map((asset) => input.assetIds.includes(asset.id) ? { ...asset, status: 'assigned' } : asset),
          events: [event(`任务“${input.title}”已派发`), ...state.events]
        };
      }),

      submitRevision: (input) => {
        const state = get();
        const area = state.areas.find((item) => item.id === input.areaId);
        if (!area) return { ok: false, reason: 'conflict', current: state.revisions[0] };
        const queued = queuedOfArea(state.revisions, input.areaId);
        // 同一片区域两名指挥员同时提交：先写入的算准
        if (queued && queued.commander !== input.commander) {
          set({
            revisions: [...state.revisions, {
              id: crypto.randomUUID(),
              areaId: input.areaId,
              revisionNo: queued.revisionNo + 1,
              baseRevisionNo: area.revisionNo,
              commander: input.commander,
              bounds: [...input.bounds] as Bounds,
              reason: input.reason,
              status: 'rejected',
              seaForecastVersion: state.seaForecasts[0].version,
              commsWindowVersion: state.commsWindows[0].version,
              submittedAt: new Date().toISOString(),
              returnedReason: `与 ${queued.commander} 先写入的第 ${queued.revisionNo} 版修订冲突，请查看差异后按最新版重提`,
              conflictWithRevisionId: queued.id
            }],
            events: [event(`${input.commander} 对 ${area.name} 的修订与先写入的第 ${queued.revisionNo} 版冲突，已拒收并回送差异`, '系统'), ...state.events]
          });
          return { ok: false, reason: 'conflict', current: queued };
        }
        if (queued) {
          return { ok: false, reason: 'already_queued', current: queued };
        }
        const revision: AreaRevision = {
          id: crypto.randomUUID(),
          areaId: input.areaId,
          revisionNo: area.revisionNo + 1,
          baseRevisionNo: area.revisionNo,
          commander: input.commander,
          bounds: [...input.bounds] as Bounds,
          reason: input.reason,
          status: 'queued',
          // 提交时记录所采用的海况预报版本与通信窗口版本
          seaForecastVersion: state.seaForecasts[0].version,
          commsWindowVersion: state.commsWindows[0].version,
          submittedAt: new Date().toISOString()
        };
        const deliveries = makeDeliveries(state, revision);
        const failed = deliveries.filter((delivery) => delivery.status !== 'delivered').length;
        set({
          revisions: [revision, ...state.revisions],
          deliveries: [...deliveries, ...state.deliveries],
          events: [
            event(`${input.commander} 提交 ${area.name} 范围修订（第 ${revision.revisionNo} 版），锁定 ${revision.seaForecastVersion} / ${revision.commsWindowVersion}${failed ? `，${failed} 个单位通知未送达，修订留在队列` : ''}`),
            ...state.events
          ]
        });
        return { ok: true, revision };
      },

      resubmitRevision: (revisionId, input) => {
        const state = get();
        const original = state.revisions.find((item) => item.id === revisionId);
        if (!original) return { ok: false, reason: 'conflict', current: state.revisions[0] };
        const area = state.areas.find((item) => item.id === original.areaId);
        if (!area) return { ok: false, reason: 'conflict', current: original };
        const queued = queuedOfArea(state.revisions, original.areaId);
        // 按新版重提时，如果别人又抢先写入，仍然先写入为准
        if (queued && queued.commander !== input.commander) {
          set({ events: [event(`${input.commander} 重提 ${area.name} 修订时再次冲突于第 ${queued.revisionNo} 版`, '系统'), ...state.events] });
          return { ok: false, reason: 'conflict', current: queued };
        }
        if (queued) return { ok: false, reason: 'already_queued', current: queued };
        const revision: AreaRevision = {
          id: crypto.randomUUID(),
          areaId: original.areaId,
          revisionNo: area.revisionNo + 1,
          baseRevisionNo: area.revisionNo,
          commander: input.commander,
          bounds: [...input.bounds] as Bounds,
          reason: input.reason,
          status: 'queued',
          seaForecastVersion: state.seaForecasts[0].version,
          commsWindowVersion: state.commsWindows[0].version,
          submittedAt: new Date().toISOString()
        };
        const deliveries = makeDeliveries(state, revision);
        set({
          revisions: [
            revision,
            ...state.revisions.map((item) => item.id === revisionId ? { ...item, followUpRevisionId: revision.id } : item)
          ],
          deliveries: [...deliveries, ...state.deliveries],
          events: [event(`${input.commander} 按最新版第 ${area.revisionNo} 版重提 ${area.name} 修订，新单为第 ${revision.revisionNo} 版，锁定 ${revision.seaForecastVersion} / ${revision.commsWindowVersion}`), ...state.events]
        });
        return { ok: true, revision };
      },

      applyRevision: (revisionId) => {
        const state = get();
        const revision = state.revisions.find((item) => item.id === revisionId);
        if (!revision || revision.status !== 'queued') return { ok: false };
        const undelivered = state.deliveries.filter(
          (delivery) => delivery.revisionId === revisionId && delivery.status !== 'delivered'
        ).length;
        // 通知未送达不丢失修订；但执行前要求送达完成，避免单位按旧范围行动
        if (undelivered > 0) return { ok: false, undelivered };
        const area = state.areas.find((item) => item.id === revision.areaId);
        set({
          areas: state.areas.map((item) => item.id === revision.areaId
            ? { ...item, bounds: [...revision.bounds] as Bounds, revisionNo: revision.revisionNo, activeRevisionId: revision.id }
            : item),
          // 只覆盖搜索区范围：正在执行的任务、单位位置一律不动
          revisions: state.revisions.map((item) => item.id === revisionId ? { ...item, status: 'applied' as const, appliedAt: new Date().toISOString() } : item),
          events: [event(`第 ${revision.revisionNo} 版范围修订（${area?.name}）已生效；在执行任务与单位位置保持不变`, revision.commander), ...state.events]
        });
        return { ok: true };
      },

      bumpSeaForecast: (actor = '气象台') => {
        const state = get();
        const current = state.seaForecasts[0];
        const pick = SEA_ROTATION.find((item) => item.wind !== current.wind) ?? SEA_ROTATION[0];
        const version: SeaForecastVersion = {
          version: `SEA-20261004-${nextSeq(current.version)}`,
          issuedAt: new Date().toISOString(),
          ...pick
        };
        const { revisions, events } = invalidateQueuedRevisions(state.revisions, state.events, '海况预报', version.version);
        set({
          seaForecasts: [version, ...state.seaForecasts],
          revisions,
          events: [event(`海况预报换版 ${current.version} → ${version.version}：${version.wind}，能见度${version.visibility}`, actor), ...events]
        });
        return version;
      },

      bumpCommsWindow: (actor = '通信值班') => {
        const state = get();
        const current = state.commsWindows[0];
        const pick = COMM_ROTATION.find((windows) => windows[0] !== current.windows[0]) ?? COMM_ROTATION[0];
        const version: CommsWindowVersion = {
          version: `COMM-20261004-${nextSeq(current.version)}`,
          issuedAt: new Date().toISOString(),
          windows: pick
        };
        const { revisions, events } = invalidateQueuedRevisions(state.revisions, state.events, '通信窗口', version.version);
        set({
          commsWindows: [version, ...state.commsWindows],
          revisions,
          events: [event(`通信窗口换版 ${current.version} → ${version.version}`, actor), ...events]
        });
        return version;
      },

      retryPendingDeliveries: () => {
        const state = get();
        if (state.offline) return { retried: 0, delivered: 0 };
        const pending = state.deliveries.filter((delivery) => delivery.status !== 'delivered');
        let delivered = 0;
        const deliveries = state.deliveries.map((delivery) => {
          if (delivery.status === 'delivered') return delivery;
          // 回网后只重试没送到的部分：对应单位也在线才送达
          const recipient = state.assets.find((asset) => asset.id === delivery.recipientId);
          if (recipient && recipient.status === 'offline') {
            return { ...delivery, attempts: delivery.attempts + 1, lastAttemptAt: new Date().toISOString(), status: 'failed' as const };
          }
          delivered += 1;
          return { ...delivery, attempts: delivery.attempts + 1, lastAttemptAt: new Date().toISOString(), deliveredAt: new Date().toISOString(), status: 'delivered' as const };
        });
        set({
          deliveries,
          events: delivered > 0
            ? [event(`回网补送：重试 ${pending.length} 条未送达通知，${delivered} 条送达；已送达通知未重发`, '系统'), ...state.events]
            : state.events
        });
        return { retried: pending.length, delivered };
      },

      retryDelivery: (deliveryId) => set((state) => {
        if (state.offline) return {};
        const target = state.deliveries.find((delivery) => delivery.id === deliveryId);
        if (!target || target.status === 'delivered') return {};
        const recipient = state.assets.find((asset) => asset.id === target.recipientId);
        if (recipient?.status === 'offline') {
          return {
            deliveries: state.deliveries.map((delivery) => delivery.id === deliveryId
              ? { ...delivery, attempts: delivery.attempts + 1, lastAttemptAt: new Date().toISOString(), status: 'failed' as const }
              : delivery)
          };
        }
        return {
          deliveries: state.deliveries.map((delivery) => delivery.id === deliveryId
            ? { ...delivery, status: 'delivered' as const, attempts: delivery.attempts + 1, lastAttemptAt: new Date().toISOString(), deliveredAt: new Date().toISOString() }
            : delivery),
          events: [event(`已向 ${target.recipientName} 补送修订通知`, '系统'), ...state.events]
        };
      }),

      toggleOffline: () => {
        const goingOffline = !get().offline;
        set((state) => ({ offline: goingOffline }));
        // 回网：只重试没送到的部分
        if (!goingOffline) get().retryPendingDeliveries();
      },
      toggleBandwidth: () => set((state) => ({ lowBandwidth: !state.lowBandwidth }))
    }),
    {
      name: 'maritime-command-v2',
      version: 2
    }
  )
);
