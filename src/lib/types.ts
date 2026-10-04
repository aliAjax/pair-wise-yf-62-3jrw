export type AreaStatus = 'planned' | 'active' | 'closed';
export type AssetStatus = 'ready' | 'assigned' | 'offline' | 'returning';
export type MissionStatus = 'draft' | 'dispatched' | 'in_progress' | 'closed';

export type Bounds = [number, number, number, number];

/** 范围修订单状态：在队列 / 已执行 / 因预报或窗口变更退回重算 / 并发被拒 */
export type RevisionStatus = 'queued' | 'applied' | 'returned' | 'rejected';
/** 修订通知的送达状态：未送达（含发送失败）/ 已送达 */
export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface SearchArea {
  id: string;
  name: string;
  bounds: Bounds;
  status: AreaStatus;
  coverage: number;
  /** 当前已生效的范围版次，每执行一单 +1 */
  revisionNo: number;
  activeRevisionId?: string;
}

export interface RescueAsset {
  id: string;
  name: string;
  type: 'ship' | 'helicopter' | 'drone' | 'shore';
  status: AssetStatus;
  lat: number;
  lng: number;
  lastSeen: string;
}

export interface Mission {
  id: string;
  title: string;
  areaId: string;
  assetIds: string[];
  status: MissionStatus;
  priority: 'normal' | 'urgent';
  note: string;
  updatedAt: string;
}

export interface EventLog {
  id: string;
  time: string;
  actor: string;
  message: string;
}

/** 海况预报版本，修订提交时锁定其一 */
export interface SeaForecastVersion {
  version: string;
  issuedAt: string;
  wind: string;
  visibility: string;
  tide: string;
}

/** 通信窗口版本，修订提交时锁定其一 */
export interface CommsWindowVersion {
  version: string;
  issuedAt: string;
  windows: string[];
}

/** 单条修订通知的送达记录，失败后按单位粒度重试 */
export interface DeliveryRecord {
  id: string;
  revisionId: string;
  recipientId: string;
  recipientName: string;
  status: DeliveryStatus;
  attempts: number;
  lastAttemptAt?: string;
  deliveredAt?: string;
}

export interface AreaRevision {
  id: string;
  areaId: string;
  /** 本单若执行，搜索区将到达的版次（提交时 = 当前版次 + 1） */
  revisionNo: number;
  /** 提交时所基于的当前已生效版次，用于并发比对 */
  baseRevisionNo: number;
  commander: string;
  bounds: Bounds;
  reason: string;
  status: RevisionStatus;
  /** 提交时锁定的海况预报版本 */
  seaForecastVersion: string;
  /** 提交时锁定的通信窗口版本 */
  commsWindowVersion: string;
  submittedAt: string;
  appliedAt?: string;
  returnedReason?: string;
  /** 并发被拒或退回后，按新版重提产生的后继单 */
  followUpRevisionId?: string;
  /** 并发冲突时，先写入生效/在途的那一单 */
  conflictWithRevisionId?: string;
}

/** 已完成任务归档：保存任务关闭瞬间的范围快照，不随后续修订改变 */
export interface MissionArchive {
  id: string;
  missionId: string;
  title: string;
  areaId: string;
  areaName: string;
  boundsSnapshot: Bounds;
  assetIds: string[];
  priority: 'normal' | 'urgent';
  note: string;
  /** 关闭瞬间生效的范围修订单 */
  revisionId?: string;
  closedAt: string;
  closedBy: string;
}

export interface TrackPoint {
  assetId: string;
  assetName: string;
  lat: number;
  lng: number;
  /** 归档瞬间该位置是否已过期，留档时如实保留 */
  stale: boolean;
  recordedAt: string;
}

/** 航迹留档：任务完成时各单位最后位置的快照 */
export interface TrackRecord {
  id: string;
  missionId: string;
  areaId: string;
  points: TrackPoint[];
  archivedAt: string;
}

export type SubmitRevisionResult =
  | { ok: true; revision: AreaRevision }
  | {
      ok: false;
      reason: 'conflict';
      /** 先写入的那一单：后到指挥员看到差异后按它重提 */
      current: AreaRevision;
    }
  | { ok: false; reason: 'already_queued'; current: AreaRevision };
