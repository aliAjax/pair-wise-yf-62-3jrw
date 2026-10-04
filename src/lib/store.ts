'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ArchiveRecord,
  AreaRevision,
  AreaStatus,
  AssetStatus,
  Bounds,
  CommWindowVersion,
  EventLog,
  ForecastVersion,
  Mission,
  MissionStatus,
  RescueAsset,
  SearchArea,
  SubmitRevisionResult
} from './types';

const now = Date.now();
const iso = (offsetMs = 0) => new Date(now - offsetMs).toISOString();

const initialAreas: SearchArea[] = [
  { id: 'area-a', name: 'A区 · 最后目击点', bounds: [121.42, 30.65, 121.68, 30.88], status: 'active', coverage: 68, version: 1 },
  { id: 'area-b', name: 'B区 · 北向漂流', bounds: [121.64, 30.82, 121.96, 31.06], status: 'planned', coverage: 32, version: 1 }
];
const initialAssets: RescueAsset[] = [
  { id: 'ship-01', name: '海巡071', type: 'ship', status: 'assigned', lat: 30.75, lng: 121.55, lastSeen: iso(35_000) },
  { id: 'heli-02', name: '救助B-712', type: 'helicopter', status: 'ready', lat: 30.82, lng: 121.73, lastSeen: iso(7 * 60_000) },
  { id: 'drone-03', name: '无人机D-9', type: 'drone', status: 'offline', lat: 30.69, lng: 121.61, lastSeen: iso(18 * 60_000) }
];
const initialMissions: Mission[] = [
  { id: 'mission-1', title: 'A区扇形搜索', areaId: 'area-a', assetIds: ['ship-01', 'drone-03'], status: 'in_progress', priority: 'urgent', note: '优先核验橙色漂浮物', updatedAt: iso(6 * 60_000) }
];
const initialEvents: EventLog[] = [
  { id: 'event-1', time: iso(15 * 60_000), actor: '指挥员', message: 'A区任务下发，海巡071开始扇形搜索' },
  { id: 'event-2', time: iso(6 * 60_000), actor: '无人机D-9', message: '链路中断，最后位置已标记为过期' }
];

const initialForecast: ForecastVersion = {
  version: 1,
  issuedAt: iso(20 * 60_000),
  summary: '东北风6级 · 能见度4.2海里 · 涨潮'
};
const initialCommWindow: CommWindowVersion = {
  version: 1,
  issuedAt: iso(20 * 60_000),
  summary: '通信窗口 08:00-12:00 · 带宽正常'
};

/** 海况预报版本轮换摘要（模拟新版预报） */
const FORECAST_SUMMARIES = [
  '东北风6级 · 能见度4.2海里 · 涨潮',
  '东南风4级 · 能见度6.8海里 · 落潮',
  '西北风7级 · 能见度2.1海里 · 大浪'
];
/** 通信窗口版本轮换摘要（模拟新窗口） */
const WINDOW_SUMMARIES = [
  '通信窗口 08:00-12:00 · 带宽正常',
  '通信窗口 13:00-15:00 · 低带宽',
  '通信窗口 18:00-20:00 · 链路中断风险'
];

/** 由近及远取某区最新一条修订 */
const latestRevision = (revisions: AreaRevision[], areaId: string): AreaRevision | undefined =>
  revisions.filter((r) => r.areaId === areaId).sort((a, b) => b.version - a.version)[0];

/** 人类可读的边界差异（prev → next） */
function diffBounds(prev: Bounds, next: Bounds): string[] {
  const labels = ['西界', '南界', '东界', '北界'];
  const edges: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    if (prev[i] !== next[i]) edges.push(`${labels[i]} ${prev[i].toFixed(2)}° → ${next[i].toFixed(2)}°`);
  }
  return edges;
}

function makeEvent(actor: string, message: string): EventLog {
  return { id: crypto.randomUUID(), time: new Date().toISOString(), actor, message };
}

/** 计算可送达单位：指挥所在线且单位未失联 */
function deliverableTargets(targets: string[], already: string[], isOnline: boolean, assets: RescueAsset[]): string[] {
  return targets.filter((id) => !already.includes(id)).filter((id) => isOnline && assets.find((a) => a.id === id)?.status !== 'offline');
}

function deliveryStatus(delivered: number, total: number): AreaRevision['notificationStatus'] {
  if (total === 0 || delivered === total) return 'delivered';
  if (delivered === 0) return 'failed';
  return 'partial';
}

interface CommandState {
  areas: SearchArea[];
  assets: RescueAsset[];
  missions: Mission[];
  events: EventLog[];
  offline: boolean;
  lowBandwidth: boolean;
  forecast: ForecastVersion;
  commWindow: CommWindowVersion;
  revisions: AreaRevision[];
  archives: ArchiveRecord[];
  setAreaStatus: (id: string, status: AreaStatus) => void;
  setAssetStatus: (id: string, status: AssetStatus) => void;
  setMissionStatus: (id: string, status: MissionStatus) => void;
  dispatchMission: (input: { title: string; areaId: string; assetIds: string[]; priority: 'normal' | 'urgent'; note: string }) => void;
  submitRevision: (input: { areaId: string; bounds: Bounds; note: string; baseVersion: number }) => SubmitRevisionResult;
  applyRevision: (id: string) => void;
  resubmitRevision: (id: string) => SubmitRevisionResult;
  publishForecast: () => void;
  updateCommWindow: () => void;
  retryNotification: (id: string) => void;
  toggleOffline: () => void;
  toggleBandwidth: () => void;
}

export const useCommandStore = create<CommandState>()(
  persist(
    (set, get) => ({
      areas: initialAreas,
      assets: initialAssets,
      missions: initialMissions,
      events: initialEvents,
      offline: false,
      lowBandwidth: false,
      forecast: initialForecast,
      commWindow: initialCommWindow,
      revisions: [
        {
          id: 'revision-a-v1',
          areaId: 'area-a',
          version: 1,
          status: 'applied',
          bounds: initialAreas[0].bounds,
          note: '初始范围划定',
          baseVersion: 0,
          forecastVersion: initialForecast.version,
          commWindowVersion: initialCommWindow.version,
          diff: { boundsChanged: false, edges: [] },
          notifyTargets: ['ship-01', 'drone-03'],
          deliveredTo: ['ship-01', 'drone-03'],
          notificationStatus: 'delivered',
          createdAt: iso(20 * 60_000),
          appliedAt: iso(20 * 60_000),
          createdBy: '指挥员'
        }
      ],
      archives: [
        {
          id: 'archive-a-v1',
          revisionId: 'revision-a-v1',
          areaId: 'area-a',
          version: 1,
          at: iso(20 * 60_000),
          missions: [],
          positions: initialAssets.map((a) => ({ assetId: a.id, name: a.name, lat: a.lat, lng: a.lng, at: iso(20 * 60_000) }))
        }
      ],
      setAreaStatus: (id, status) => set((state) => ({
        areas: state.areas.map((area) => area.id === id ? { ...area, status } : area),
        events: [makeEvent('指挥员', `搜索区 ${id} 状态改为 ${status}`), ...state.events]
      })),
      setAssetStatus: (id, status) => set((state) => ({
        assets: state.assets.map((asset) => asset.id === id ? { ...asset, status, lastSeen: new Date().toISOString() } : asset),
        events: [makeEvent('值班员', `${id} 状态改为 ${status}，已生成恢复记录`), ...state.events]
      })),
      setMissionStatus: (id, status) => set((state) => ({
        missions: state.missions.map((mission) => mission.id === id ? { ...mission, status, updatedAt: new Date().toISOString() } : mission),
        events: [makeEvent('指挥员', `任务 ${id} 状态改为 ${status}`), ...state.events]
      })),
      dispatchMission: (input) => set((state) => {
        const mission: Mission = { id: crypto.randomUUID(), ...input, status: 'dispatched', updatedAt: new Date().toISOString() };
        return {
          missions: [mission, ...state.missions],
          assets: state.assets.map((asset) => input.assetIds.includes(asset.id) ? { ...asset, status: 'assigned' } : asset),
          events: [makeEvent('指挥员', `任务“${input.title}”已派发`), ...state.events]
        };
      }),
      submitRevision: (input) => {
        let result: SubmitRevisionResult = { ok: false };
        set((state) => {
          const area = state.areas.find((a) => a.id === input.areaId);
          if (!area) return { revisions: state.revisions };
          const currentVersion = area.version ?? 1;
          if (input.baseVersion !== currentVersion) {
            // 先写入的算准：后到的提交看到差异与最新版次，按新版重提
            const latest = latestRevision(state.revisions, input.areaId);
            const latestBounds = latest ? latest.bounds : area.bounds;
            result = {
              ok: false,
              conflict: {
                currentVersion,
                latest: latest ?? ({ version: currentVersion, bounds: area.bounds } as AreaRevision),
                diff: { boundsChanged: true, edges: diffBounds(latestBounds, input.bounds) }
              }
            };
            return { revisions: state.revisions };
          }
          const prev = latestRevision(state.revisions, input.areaId);
          const baseBounds = prev ? prev.bounds : area.bounds;
          const version = currentVersion + 1;
          const edges = diffBounds(baseBounds, input.bounds);
          const revision: AreaRevision = {
            id: crypto.randomUUID(),
            areaId: input.areaId,
            version,
            status: 'pending',
            bounds: input.bounds,
            note: input.note,
            baseVersion: currentVersion,
            forecastVersion: state.forecast.version,
            commWindowVersion: state.commWindow.version,
            diff: { boundsChanged: edges.length > 0, edges },
            notifyTargets: state.missions
              .filter((m) => m.areaId === input.areaId && m.status !== 'closed')
              .flatMap((m) => m.assetIds),
            deliveredTo: [],
            notificationStatus: 'pending',
            createdAt: new Date().toISOString(),
            createdBy: '指挥员'
          };
          result = { ok: true, revision };
          return {
            areas: state.areas.map((a) => a.id === input.areaId ? { ...a, version } : a),
            revisions: [revision, ...state.revisions],
            events: [
              makeEvent('指挥员', `已提交 ${area.name} 范围修订 v${version}（采用海况预报 v${state.forecast.version}、通信窗口 v${state.commWindow.version}），待执行`),
              ...state.events
            ]
          };
        });
        return result;
      },
      applyRevision: (id) => set((state) => {
        const rev = state.revisions.find((r) => r.id === id);
        if (!rev || rev.status !== 'pending') return { revisions: state.revisions };
        const area = state.areas.find((a) => a.id === rev.areaId);
        const stale = rev.forecastVersion !== state.forecast.version || rev.commWindowVersion !== state.commWindow.version;
        if (stale) {
          const reason = '海况预报或通信窗口版本已更新，未执行修订退回，需按新版重算后重提';
          return {
            revisions: state.revisions.map((r) => r.id === id ? { ...r, status: 'returned', returnedAt: new Date().toISOString(), returnReason: reason } : r),
            events: [makeEvent('指挥员', `修订 v${rev.version} 退回重算：${reason}`), ...state.events]
          };
        }
        const nowIso = new Date().toISOString();
        const delivered = deliverableTargets(rev.notifyTargets, [], !state.offline, state.assets);
        const archive: ArchiveRecord = {
          id: crypto.randomUUID(),
          revisionId: rev.id,
          areaId: rev.areaId,
          version: rev.version,
          at: nowIso,
          missions: state.missions
            .filter((m) => m.areaId === rev.areaId && m.status === 'closed')
            .map((m) => ({ id: m.id, title: m.title, status: m.status })),
          positions: state.assets.map((a) => ({ assetId: a.id, name: a.name, lat: a.lat, lng: a.lng, at: nowIso }))
        };
        const status = deliveryStatus(delivered.length, rev.notifyTargets.length);
        return {
          // 只更新范围本身：在执行任务与单位位置不被覆盖，留档另存
          areas: state.areas.map((a) => a.id === rev.areaId ? { ...a, bounds: rev.bounds } : a),
          revisions: state.revisions.map((r) => r.id === id
            ? { ...r, status: 'applied', appliedAt: nowIso, deliveredTo: delivered, notificationStatus: status }
            : r),
          archives: [archive, ...state.archives],
          events: [
            makeEvent('指挥员', `${area?.name ?? rev.areaId} 修订 v${rev.version} 已应用；已留档完成任务 ${archive.missions.length} 项、单位航迹 ${archive.positions.length} 条；通知送达 ${delivered.length}/${rev.notifyTargets.length}`),
            ...state.events
          ]
        };
      }),
      resubmitRevision: (id) => {
        let result: SubmitRevisionResult = { ok: false };
        set((state) => {
          const old = state.revisions.find((r) => r.id === id);
          if (!old) return { revisions: state.revisions };
          const area = state.areas.find((a) => a.id === old.areaId);
          if (!area) return { revisions: state.revisions };
          const currentVersion = area.version ?? 1;
          const version = currentVersion + 1;
          const prev = latestRevision(state.revisions, old.areaId);
          const baseBounds = prev ? prev.bounds : area.bounds;
          const edges = diffBounds(baseBounds, old.bounds);
          const revision: AreaRevision = {
            id: crypto.randomUUID(),
            areaId: old.areaId,
            version,
            status: 'pending',
            bounds: old.bounds,
            note: old.note ? `${old.note}（退回重算后重提）` : '退回重算后重提',
            baseVersion: currentVersion,
            forecastVersion: state.forecast.version,
            commWindowVersion: state.commWindow.version,
            diff: { boundsChanged: edges.length > 0, edges },
            notifyTargets: state.missions
              .filter((m) => m.areaId === old.areaId && m.status !== 'closed')
              .flatMap((m) => m.assetIds),
            deliveredTo: [],
            notificationStatus: 'pending',
            createdAt: new Date().toISOString(),
            createdBy: '指挥员'
          };
          result = { ok: true, revision };
          return {
            areas: state.areas.map((a) => a.id === old.areaId ? { ...a, version } : a),
            revisions: [revision, ...state.revisions],
            events: [
              makeEvent('指挥员', `修订 v${old.version} 已按新版次重算重提为 v${version}（采用海况预报 v${state.forecast.version}、通信窗口 v${state.commWindow.version}）`),
              ...state.events
            ]
          };
        });
        return result;
      },
      publishForecast: () => set((state) => {
        const next = state.forecast.version + 1;
        const nowIso = new Date().toISOString();
        const pending = state.revisions.filter((r) => r.status === 'pending');
        const reason = '海况预报版本已更新，未执行修订退回，需按新版重算后重提';
        return {
          forecast: { version: next, issuedAt: nowIso, summary: FORECAST_SUMMARIES[next % FORECAST_SUMMARIES.length] },
          revisions: state.revisions.map((r) => r.status === 'pending'
            ? { ...r, status: 'returned', returnedAt: nowIso, returnReason: reason }
            : r),
          events: [
            makeEvent('指挥员', `海况预报已发布 v${next}，${pending.length} 条未执行修订退回重算`),
            ...state.events
          ]
        };
      }),
      updateCommWindow: () => set((state) => {
        const next = state.commWindow.version + 1;
        const nowIso = new Date().toISOString();
        const pending = state.revisions.filter((r) => r.status === 'pending');
        const reason = '通信窗口版本已更新，未执行修订退回，需按新版重算后重提';
        return {
          commWindow: { version: next, issuedAt: nowIso, summary: WINDOW_SUMMARIES[next % WINDOW_SUMMARIES.length] },
          revisions: state.revisions.map((r) => r.status === 'pending'
            ? { ...r, status: 'returned', returnedAt: nowIso, returnReason: reason }
            : r),
          events: [
            makeEvent('指挥员', `通信窗口已更新 v${next}，${pending.length} 条未执行修订退回重算`),
            ...state.events
          ]
        };
      }),
      retryNotification: (id) => set((state) => {
        const rev = state.revisions.find((r) => r.id === id);
        if (!rev || rev.status !== 'applied') return { revisions: state.revisions };
        const newly = deliverableTargets(rev.notifyTargets, rev.deliveredTo, !state.offline, state.assets);
        if (newly.length === 0) return { revisions: state.revisions };
        const deliveredTo = [...rev.deliveredTo, ...newly];
        return {
          revisions: state.revisions.map((r) => r.id === id
            ? { ...r, deliveredTo, notificationStatus: deliveryStatus(deliveredTo.length, rev.notifyTargets.length) }
            : r),
          events: [
            makeEvent('值班员', `修订 v${rev.version} 通知重试：新送达 ${newly.length} 个单位，累计 ${deliveredTo.length}/${rev.notifyTargets.length}`),
            ...state.events
          ]
        };
      }),
      toggleOffline: () => set((state) => {
        const goingOnline = state.offline;
        const nowIso = new Date().toISOString();
        const retried: string[] = [];
        const revisions = goingOnline
          ? state.revisions.map((rev) => {
              if (rev.status !== 'applied' || rev.notificationStatus === 'delivered') return rev;
              const newly = deliverableTargets(rev.notifyTargets, rev.deliveredTo, true, state.assets);
              if (newly.length === 0) return rev;
              retried.push(rev.version.toString());
              const deliveredTo = [...rev.deliveredTo, ...newly];
              return { ...rev, deliveredTo, notificationStatus: deliveryStatus(deliveredTo.length, rev.notifyTargets.length) };
            })
          : state.revisions;
        return {
          offline: !state.offline,
          revisions,
          events: [
            makeEvent('值班员', goingOnline
              ? `通信恢复在线，通知队列开始重试（修订 ${retried.join('、') || '无'}）`
              : '已切换离线，修订通知留在队列，回网后只重试未送达部分'),
            ...state.events
          ]
        };
      }),
      toggleBandwidth: () => set((state) => ({ lowBandwidth: !state.lowBandwidth }))
    }),
    {
      name: 'maritime-command-v2',
      version: 2,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<CommandState>;
        return {
          ...p,
          areas: (p.areas ?? initialAreas).map((a) => ({ ...a, version: a.version ?? 1 })),
          forecast: p.forecast ?? initialForecast,
          commWindow: p.commWindow ?? initialCommWindow,
          revisions: p.revisions ?? [],
          archives: p.archives ?? []
        };
      }
    }
  )
);
