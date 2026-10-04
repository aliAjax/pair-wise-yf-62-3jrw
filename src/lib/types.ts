export type AreaStatus = 'planned' | 'active' | 'closed';
export type AssetStatus = 'ready' | 'assigned' | 'offline' | 'returning';
export type MissionStatus = 'draft' | 'dispatched' | 'in_progress' | 'closed';

/** 范围修订单状态：待执行 / 已应用 / 已退回重算 */
export type RevisionStatus = 'pending' | 'applied' | 'returned';
/** 通知送达状态：未尝试 / 全部送达 / 部分送达 / 全部失败 */
export type NotificationStatus = 'pending' | 'delivered' | 'partial' | 'failed';

/** 搜索区范围：[西界, 南界, 东界, 北界] */
export type Bounds = [number, number, number, number];

export interface SearchArea {
  id: string;
  name: string;
  bounds: Bounds;
  status: AreaStatus;
  coverage: number;
  /** 范围版本号，随修订单提交递增，用于乐观并发控制 */
  version: number;
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

/** 范围修订单相对上一版范围的差异 */
export interface RevisionDiff {
  boundsChanged: boolean;
  /** 人类可读的边界变更，如 “北界 30.88° → 30.95°” */
  edges: string[];
}

/** 海况预报版本 */
export interface ForecastVersion {
  version: number;
  issuedAt: string;
  summary: string;
}

/** 通信窗口版本 */
export interface CommWindowVersion {
  version: number;
  issuedAt: string;
  summary: string;
}

/** 提交修订单时所采用的版本快照 */
export interface RevisionAdoptedVersions {
  forecastVersion: number;
  commWindowVersion: number;
}

export interface AreaRevision {
  id: string;
  areaId: string;
  /** 区内单调递增版本号 */
  version: number;
  status: RevisionStatus;
  bounds: Bounds;
  note: string;
  /** 提交时基于的区版本（乐观并发基线） */
  baseVersion: number;
  /** 提交时采用的海况预报版本 */
  forecastVersion: number;
  /** 提交时采用的通信窗口版本 */
  commWindowVersion: number;
  diff: RevisionDiff;
  /** 需要送达的单位 */
  notifyTargets: string[];
  /** 已送达单位 */
  deliveredTo: string[];
  notificationStatus: NotificationStatus;
  createdAt: string;
  appliedAt?: string;
  returnedAt?: string;
  returnReason?: string;
  createdBy: string;
}

/** 应用修订单时的留档：已完成任务与单位航迹 */
export interface ArchiveRecord {
  id: string;
  revisionId: string;
  areaId: string;
  version: number;
  at: string;
  missions: { id: string; title: string; status: MissionStatus }[];
  positions: { assetId: string; name: string; lat: number; lng: number; at: string }[];
}

/** 提交修订单的返回：成功或冲突（先写入为准） */
export interface SubmitRevisionResult {
  ok: boolean;
  revision?: AreaRevision;
  conflict?: {
    currentVersion: number;
    latest: AreaRevision;
    diff: RevisionDiff;
  };
}
