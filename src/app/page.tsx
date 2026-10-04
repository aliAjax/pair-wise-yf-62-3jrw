'use client';

import { Badge, Button, Card, Grid, Group, List, Progress, Select, SimpleGrid, Stack, Switch, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useEffect, useMemo, useState } from 'react';
import { useCommandStore } from '@/lib/store';
import { SearchMap } from '@/components/SearchMap';
import type { AreaRevision, Bounds } from '@/lib/types';

const missionSchema = z.object({
  title: z.string().min(3, '任务名称至少3个字'),
  areaId: z.string().min(1),
  assetIds: z.array(z.string()).min(1, '至少调派一个单位'),
  priority: z.enum(['normal', 'urgent']),
  note: z.string().max(160)
});

const revisionSchema = z.object({
  areaId: z.string().min(1, '请选择搜索区'),
  west: z.string().refine((v) => Number(v) >= 115 && Number(v) <= 130, '经度须在 115–130 之间'),
  south: z.string().refine((v) => Number(v) >= 20 && Number(v) <= 40, '纬度须在 20–40 之间'),
  east: z.string().refine((v) => Number(v) >= 115 && Number(v) <= 130, '经度须在 115–130 之间'),
  north: z.string().refine((v) => Number(v) >= 20 && Number(v) <= 40, '纬度须在 20–40 之间'),
  reason: z.string().min(2, '请说明修订原因（至少2个字）').max(160)
}).refine((v) => Number(v.east) > Number(v.west) && Number(v.north) > Number(v.south), { message: '东界须大于西界、北界须大于南界', path: ['east'] });

type RevisionFormValues = z.infer<typeof revisionSchema>;

const toBounds = (v: RevisionFormValues): Bounds => [Number(v.west), Number(v.south), Number(v.east), Number(v.north)];

const statusColor: Record<AreaRevision['status'], string> = {
  queued: 'orange',
  applied: 'teal',
  returned: 'red',
  rejected: 'red'
};
const statusLabel: Record<AreaRevision['status'], string> = {
  queued: '待执行',
  applied: '已生效',
  returned: '退回重算',
  rejected: '并发拒收'
};

const fmtBounds = (b: Bounds) => `${b[0].toFixed(2)}, ${b[1].toFixed(2)} → ${b[2].toFixed(2)}, ${b[3].toFixed(2)}`;

const STALE_MS = 10 * 60_000;
const isStalePosition = (lastSeen: string) => Date.now() - new Date(lastSeen).getTime() > STALE_MS;

/** 两版范围的逐边差异，供后到指挥员对照 */
function boundsDiff(a: Bounds, b: Bounds) {
  const edges = ['西界', '南界', '东界', '北界'] as const;
  return edges.map((label, i) => ({ label, from: a[i], to: b[i], changed: Math.abs(a[i] - b[i]) > 1e-9 }));
}

export default function CommandPage() {
  const state = useCommandStore();
  const [commander, setCommander] = useState('指挥员甲');
  const [selectedAssets, setSelectedAssets] = useState<string[]>(['ship-01']);
  const [sourceRevisionId, setSourceRevisionId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ winner: AreaRevision; draft: RevisionFormValues } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<RevisionFormValues>({
    resolver: zodResolver(revisionSchema),
    defaultValues: {
      areaId: state.areas[0]?.id,
      west: String(state.areas[0]?.bounds[0] ?? ''),
      south: String(state.areas[0]?.bounds[1] ?? ''),
      east: String(state.areas[0]?.bounds[2] ?? ''),
      north: String(state.areas[0]?.bounds[3] ?? ''),
      reason: ''
    }
  });
  const missionForm = useForm<z.infer<typeof missionSchema>>({
    resolver: zodResolver(missionSchema),
    defaultValues: { title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' }
  });

  const selectedAreaId = watch('areaId');
  const selectedArea = state.areas.find((area) => area.id === selectedAreaId);

  // 切换搜索区时，把表单范围同步为该区域当前版次的范围
  useEffect(() => {
    const area = state.areas.find((item) => item.id === selectedAreaId);
    if (area) {
      setValue('west', String(area.bounds[0]));
      setValue('south', String(area.bounds[1]));
      setValue('east', String(area.bounds[2]));
      setValue('north', String(area.bounds[3]));
    }
    setConflict(null);
  }, [selectedAreaId, state.areas, setValue]);

  const sea = state.seaForecasts[0];
  const comms = state.commsWindows[0];

  const pendingDeliveries = state.deliveries.filter((delivery) => delivery.status !== 'delivered').length;
  const queuedRevisions = state.revisions.filter((revision) => revision.status === 'queued');
  const openRevisions = state.revisions.filter((revision) => revision.status !== 'applied');

  const deliveriesByRevision = useMemo(() => {
    const map = new Map<string, { delivered: number; failed: number; total: number }>();
    state.deliveries.forEach((delivery) => {
      const entry = map.get(delivery.revisionId) ?? { delivered: 0, failed: 0, total: 0 };
      entry.total += 1;
      if (delivery.status === 'delivered') entry.delivered += 1;
      else entry.failed += 1;
      map.set(delivery.revisionId, entry);
    });
    return map;
  }, [state.deliveries]);

  const submitRevision = (values: RevisionFormValues) => {
    const bounds = toBounds(values);
    const result = sourceRevisionId
      ? state.resubmitRevision(sourceRevisionId, { commander, bounds, reason: values.reason })
      : state.submitRevision({ areaId: values.areaId, commander, bounds, reason: values.reason });
    if (result.ok) {
      setSourceRevisionId(null);
      setConflict(null);
      setNotice(null);
      reset({ areaId: values.areaId, west: String(bounds[0]), south: String(bounds[1]), east: String(bounds[2]), north: String(bounds[3]), reason: '' });
      return;
    }
    if (result.reason === 'conflict') {
      // 后到的指挥员：看到先写入的一版和自己的差异，再按新版重提
      setConflict({ winner: result.current, draft: values });
      setNotice(`冲突：${result.current.commander} 的第 ${result.current.revisionNo} 版先写入并算准，请对照下方差异后按最新版重提。`);
    } else {
      setNotice('该区域已有在途修订，请等其生效或退回后再提交。');
    }
  };

  const loadForResubmit = (revision: AreaRevision) => {
    setSourceRevisionId(revision.id);
    reset({
      areaId: revision.areaId,
      west: String(revision.bounds[0]),
      south: String(revision.bounds[1]),
      east: String(revision.bounds[2]),
      north: String(revision.bounds[3]),
      reason: revision.reason
    });
    setConflict(null);
    setNotice(`已载入第 ${revision.revisionNo} 版退回修订，按当前最新预报/窗口调整后重提。`);
  };

  const submitMission = (values: z.infer<typeof missionSchema>) => {
    state.dispatchMission({ ...values, assetIds: selectedAssets });
    missionForm.reset({ title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' });
  };

  const assetCards = state.assets.map((asset) => {
    const isStale = isStalePosition(asset.lastSeen);
    return (
      <Card key={asset.id} withBorder padding="sm">
        <Group justify="space-between"><b>{asset.name}</b><Badge color={asset.status === 'offline' ? 'red' : asset.status === 'assigned' ? 'blue' : 'teal'}>{asset.status}</Badge></Group>
        <Text size="xs" c={isStale ? 'red' : 'dimmed'}>{isStale ? '位置已过期 · ' : ''}{formatDistanceToNow(new Date(asset.lastSeen), { addSuffix: true, locale: zhCN })}</Text>
        <Group mt="xs"><Button size="compact-xs" onClick={() => state.setAssetStatus(asset.id, asset.status === 'offline' ? 'ready' : 'offline')}>{asset.status === 'offline' ? '恢复在线' : '标记失联'}</Button></Group>
      </Card>
    );
  });

  return (
    <main className={state.lowBandwidth ? 'low-bandwidth' : ''}>
      <Stack p="xl" gap="lg" maw={1600} mx="auto">
        <Group justify="space-between" align="flex-end">
          <div>
            <Badge color={state.offline ? 'red' : 'teal'}>{state.offline ? '离线缓存模式' : '联合指挥在线'}</Badge>
            <Title order={1} className="section-title">海上搜救联合指挥</Title>
            <Text c="dimmed">范围修订以修订单流转，不直接覆盖在执行任务与单位位置</Text>
          </div>
          <Group>
            <Select
              label="当前指挥员"
              data={['指挥员甲', '指挥员乙']}
              value={commander}
              onChange={(value) => value && setCommander(value)}
              allowDeselect={false}
            />
            <Switch label="低带宽" checked={state.lowBandwidth} onChange={state.toggleBandwidth} />
            <Switch label="模拟离线" checked={state.offline} onChange={state.toggleOffline} />
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 5 }}>
          {[
            ['活动搜索区', state.areas.filter((item) => item.status === 'active').length],
            ['在线单位', state.assets.filter((item) => item.status !== 'offline').length],
            ['进行中任务', state.missions.filter((item) => item.status === 'in_progress').length],
            ['待执行修订', queuedRevisions.length],
            ['未送达通知', pendingDeliveries]
          ].map(([label, value]) => <Card key={String(label)} withBorder><Text size="sm" c="dimmed">{label}</Text><Title order={2} c={label === '未送达通知' && value ? 'red' : undefined}>{value}</Title></Card>)}
        </SimpleGrid>

        {/* 版本栏：海况预报与通信窗口的当前版次，修订提交时锁定其一，换版即触发退回重算 */}
        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder>
              <Group justify="space-between">
                <div>
                  <Group gap="xs"><Title order={4}>海况预报</Title><Badge variant="light">{sea.version}</Badge></Group>
                  <Text size="sm" mt={4}>{sea.wind} · 能见度 {sea.visibility} · {sea.tide}</Text>
                  <Text size="xs" c="dimmed">发布于 {formatDistanceToNow(new Date(sea.issuedAt), { addSuffix: true, locale: zhCN })}</Text>
                </div>
                <Button size="compact-sm" variant="light" onClick={() => state.bumpSeaForecast()}>模拟预报换版</Button>
              </Group>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder>
              <Group justify="space-between">
                <div>
                  <Group gap="xs"><Title order={4}>通信窗口</Title><Badge variant="light">{comms.version}</Badge></Group>
                  <Text size="sm" mt={4}>{state.lowBandwidth ? `共 ${comms.windows.length} 个窗口` : comms.windows.join('；')}</Text>
                  <Text size="xs" c="dimmed">发布于 {formatDistanceToNow(new Date(comms.issuedAt), { addSuffix: true, locale: zhCN })}</Text>
                </div>
                <Button size="compact-sm" variant="light" onClick={() => state.bumpCommsWindow()}>模拟窗口换版</Button>
              </Group>
            </Card>
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Card withBorder>
              <Group justify="space-between">
                <Title order={3}>搜救态势</Title>
                <Text size="sm">实线＝当前范围；灰色虚线＝已完成任务范围快照；灰/橙点＝归档航迹</Text>
              </Group>
              <SearchMap areas={state.areas} assets={state.assets} archives={state.archives} tracks={state.tracks} />
              {state.lowBandwidth && <Text size="sm" c="dimmed" mt="xs">低带宽模式已停用地图，态势以文字摘要为准。</Text>}
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Card withBorder style={{ height: '100%' }}>
              <Title order={3}>单位状态</Title>
              <Stack mt="md">{assetCards}</Stack>
            </Card>
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          {/* 范围修订单 */}
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Card withBorder>
              <Title order={3}>提交范围修订单</Title>
              <Text size="xs" c="dimmed" mt={4}>
                提交即锁定 <b>{sea.version}</b> 与 <b>{comms.version}</b>；执行时只更新搜索区范围，不动在执行任务与单位位置。
                {sourceRevisionId && <Text component="span" c="orange" fw={700}> 当前为退回单重提模式。</Text>}
              </Text>
              {notice && <Text size="sm" c="red" mt="xs">{notice}</Text>}
              {conflict && selectedArea && (
                <Card withBorder padding="sm" mt="sm" style={{ borderColor: '#fa5252' }}>
                  <Text size="sm" fw={700} c="red">先写入版本（第 {conflict.winner.revisionNo} 版 · {conflict.winner.commander}）与您提交范围的差异：</Text>
                  <Table withRowBorders={false} mt={6}>
                    <tbody>
                      {boundsDiff(conflict.winner.bounds, toBounds(conflict.draft)).map((row) => (
                        <tr key={row.label}>
                          <td><Text size="xs" fw={row.changed ? 700 : 400} c={row.changed ? 'red' : 'dimmed'}>{row.label}</Text></td>
                          <td><Text size="xs" c="dimmed">{row.from.toFixed(2)}</Text></td>
                          <td><Text size="xs" c={row.changed ? 'red' : 'dimmed'} fw={row.changed ? 700 : 400}>{`→ ${row.to.toFixed(2)}`}</Text></td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <Text size="xs" mt={4}>先写入单锁定 {conflict.winner.seaForecastVersion} / {conflict.winner.commsWindowVersion}，为当前最新在途版次；请按它重提。</Text>
                </Card>
              )}
              <form onSubmit={handleSubmit(submitRevision)}>
                <Stack mt="md">
                  <label>搜索区<select {...register('areaId')} style={{ width: '100%', padding: 8 }}>{state.areas.map((area) => <option key={area.id} value={area.id}>{area.name}（当前第 {area.revisionNo} 版）</option>)}</select></label>
                  {selectedArea && <Text size="xs" c="dimmed">当前生效范围：{fmtBounds(selectedArea.bounds)}</Text>}
                  <SimpleGrid cols={2}>
                    <TextInput type="number" step="0.01" label="西界经度" {...register('west')} error={errors.west && '经度无效'} />
                    <TextInput type="number" step="0.01" label="南界纬度" {...register('south')} error={errors.south && '纬度无效'} />
                    <TextInput type="number" step="0.01" label="东界经度" {...register('east')} error={(errors.east?.message as string) || (errors.east && '经度无效')} />
                    <TextInput type="number" step="0.01" label="北界纬度" {...register('north')} error={errors.north && '纬度无效'} />
                  </SimpleGrid>
                  <Textarea label="修订原因" {...register('reason')} error={errors.reason?.message} />
                  <Group>
                    <Button type="submit">{sourceRevisionId ? '按新版重提' : '提交修订单'}</Button>
                    {sourceRevisionId && <Button variant="subtle" color="gray" onClick={() => { setSourceRevisionId(null); setNotice(null); }}>取消重提</Button>}
                  </Group>
                </Stack>
              </form>
            </Card>
          </Grid.Col>

          {/* 修订队列与历史 */}
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Card withBorder>
              <Group justify="space-between">
                <Title order={3}>修订单队列与版次</Title>
                {pendingDeliveries > 0
                  ? <Button size="compact-sm" color="orange" onClick={() => state.retryPendingDeliveries()} disabled={state.offline}>回网补送未达通知（{pendingDeliveries}）</Button>
                  : <Badge color="teal">通知全部送达</Badge>}
              </Group>
              <Stack mt="md">
                {(state.lowBandwidth ? openRevisions.slice(0, 4) : openRevisions.slice(0, 8)).map((revision) => {
                  const area = state.areas.find((item) => item.id === revision.areaId);
                  const delivery = deliveriesByRevision.get(revision.id);
                  const winner = revision.conflictWithRevisionId ? state.revisions.find((item) => item.id === revision.conflictWithRevisionId) : undefined;
                  const revisionDeliveries = state.deliveries.filter((delivery) => delivery.revisionId === revision.id);
                  return (
                    <Card key={revision.id} withBorder padding="sm">
                      {/* 低带宽先看摘要：一行版次/状态/送达概况，细节折叠 */}
                      <Group justify="space-between">
                        <Group gap="xs">
                          <Badge color={statusColor[revision.status]}>{statusLabel[revision.status]}</Badge>
                          <Text size="sm" fw={700}>{area?.name ?? revision.areaId} · 第 {revision.revisionNo} 版</Text>
                          <Text size="xs" c="dimmed">{revision.commander} · {formatDistanceToNow(new Date(revision.submittedAt), { addSuffix: true, locale: zhCN })}</Text>
                        </Group>
                        {revision.status === 'queued' && (
                          <Button size="compact-xs" onClick={() => {
                            const result = state.applyRevision(revision.id);
                            if (!result.ok && result.undelivered) setNotice(`第 ${revision.revisionNo} 版还有 ${result.undelivered} 个单位通知未送达，修订留在队列，回网补送后再生效。`);
                            else setNotice(null);
                          }}>生效执行</Button>
                        )}
                        {(revision.status === 'returned' || revision.status === 'rejected') && !revision.followUpRevisionId && (
                          <Button size="compact-xs" variant="light" onClick={() => loadForResubmit(revision)}>按新版重提</Button>
                        )}
                        {revision.followUpRevisionId && <Badge variant="light" color="gray">已由新单接替</Badge>}
                      </Group>
                      <Text size="xs" c="dimmed" mt={4}>范围 {fmtBounds(revision.bounds)} · 锁定 {revision.seaForecastVersion} / {revision.commsWindowVersion}{delivery ? ` · 送达 ${delivery.delivered}/${delivery.total}` : ''}</Text>
                      {!state.lowBandwidth && (
                        <details>
                          <summary style={{ cursor: 'pointer', fontSize: 12 }}>查看细节与通知名单</summary>
                          <Stack gap={4} mt={6}>
                            <Text size="xs">原因：{revision.reason}</Text>
                            <Text size="xs">基于第 {revision.baseRevisionNo} 版提交{revision.appliedAt ? `，${formatDistanceToNow(new Date(revision.appliedAt), { addSuffix: true, locale: zhCN })}生效` : ''}</Text>
                            {revision.returnedReason && <Text size="xs" c="red">退回原因：{revision.returnedReason}{winner ? `（先写入：第 ${winner.revisionNo} 版 ${winner.commander}）` : ''}</Text>}
                            {revisionDeliveries.length > 0 && (
                              <List size="xs" spacing={2}>
                                {revisionDeliveries.map((delivery) => (
                                  <List.Item key={delivery.id}>
                                    <Group gap="xs">
                                      <Text size="xs" c={delivery.status === 'delivered' ? 'teal' : 'red'}>{delivery.recipientName}：{delivery.status === 'delivered' ? '已送达' : `未送达（尝试 ${delivery.attempts} 次）`}</Text>
                                      {delivery.status !== 'delivered' && <Button size="compact-xs" variant="subtle" disabled={state.offline} onClick={() => state.retryDelivery(delivery.id)}>仅重试此条</Button>}
                                    </Group>
                                  </List.Item>
                                ))}
                              </List>
                            )}
                          </Stack>
                        </details>
                      )}
                    </Card>
                  );
                })}
                {openRevisions.length === 0 && <Text size="sm" c="dimmed">没有在途修订，所有提交均已生效留档。</Text>}
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Card withBorder>
              <Title order={3}>派发新任务</Title>
              <form onSubmit={missionForm.handleSubmit(submitMission)}>
                <Stack mt="md">
                  <TextInput label="任务名称" {...missionForm.register('title')} error={missionForm.formState.errors.title?.message} />
                  <label>搜索区<select {...missionForm.register('areaId')} style={{ width: '100%', padding: 8 }}>{state.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
                  <label>调派单位（可多选）
                    <select multiple value={selectedAssets} onChange={(event) => setSelectedAssets(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} style={{ width: '100%', minHeight: 86 }}>
                      {state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                    </select>
                  </label>
                  <label>优先级<select {...missionForm.register('priority')} style={{ width: '100%', padding: 8 }}><option value="urgent">紧急</option><option value="normal">常规</option></select></label>
                  <Textarea label="任务说明" {...missionForm.register('note')} />
                  <Button type="submit">派发任务</Button>
                </Stack>
              </form>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Card withBorder>
              <Title order={3}>任务与搜索区</Title>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th align="left">搜索区</th><th align="left">状态</th><th align="left">版次</th><th align="left">覆盖率</th></tr></thead>
                <tbody>{state.areas.map((area) => (
                  <tr key={area.id}>
                    <td style={{ padding: '8px 0' }}>{area.name}</td>
                    <td>{area.status}</td>
                    <td>v{area.revisionNo}</td>
                    <td style={{ width: '38%' }}><Progress value={area.coverage} /></td>
                  </tr>
                ))}</tbody>
              </table>
              <List mt="lg" spacing="sm">
                {state.missions.map((mission) => (
                  <List.Item key={mission.id}>
                    <Group justify="space-between">
                      <div>
                        <b>{mission.title}</b>
                        <Text size="xs" c="dimmed">{mission.areaId} · {mission.assetIds.join(' / ')}</Text>
                      </div>
                      <Group>
                        <Badge>{mission.status}</Badge>
                        <Button size="compact-xs" onClick={() => state.setMissionStatus(mission.id, mission.status === 'in_progress' ? 'closed' : 'in_progress', commander)}>
                          {mission.status === 'closed' ? '重开' : mission.status === 'in_progress' ? '完成并归档' : '推进'}
                        </Button>
                      </Group>
                    </Group>
                  </List.Item>
                ))}
              </List>
            </Card>
          </Grid.Col>
        </Grid>

        {/* 已完成任务与航迹留档 */}
        <Card withBorder>
          <Title order={3}>已完成任务与航迹留档</Title>
          <Text size="sm" c="dimmed" mt={4}>按任务关闭瞬间的范围与单位位置快照保存，后续海况、窗口和范围换版均不改写留档。</Text>
          <SimpleGrid mt="md" cols={{ base: 1, md: 2 }}>
            {state.archives.map((archive) => {
              const track = state.tracks.find((item) => item.missionId === archive.missionId);
              return (
                <Card key={archive.id} withBorder padding="sm">
                  <Group justify="space-between">
                    <Text size="sm" fw={700}>{archive.title}</Text>
                    <Badge variant="light">{archive.areaName}</Badge>
                  </Group>
                  <Text size="xs" c="dimmed" mt={4}>关闭于 {new Date(archive.closedAt).toLocaleString()} · {archive.closedBy} · 范围 {fmtBounds(archive.boundsSnapshot)}</Text>
                  <Text size="xs" c="dimmed">说明：{archive.note || '—'}</Text>
                  {track && (
                    <List size="xs" mt={6}>
                      {track.points.map((point) => (
                        <List.Item key={`${track.id}-${point.assetId}`}>
                          <Text size="xs" c={point.stale ? 'orange' : undefined}>{point.assetName} @ {point.lat.toFixed(3)}, {point.lng.toFixed(3)}{point.stale ? '（归档时位置已过期，如实标注）' : ''}</Text>
                        </List.Item>
                      ))}
                    </List>
                  )}
                </Card>
              );
            })}
            {state.archives.length === 0 && <Text size="sm" c="dimmed">暂无归档任务。</Text>}
          </SimpleGrid>
        </Card>

        <Card withBorder>
          <Title order={3}>联合事件时间线</Title>
          <table className="event-table" aria-label="事件列表" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {state.events.slice(0, 10).map((event) => (
                <tr key={event.id}>
                  <td style={{ padding: '4px 8px 4px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}><Text size="xs" c="dimmed">{new Date(event.time).toLocaleTimeString()}</Text></td>
                  <td style={{ padding: '4px 0' }}><Text size="sm"><b>{event.actor}</b> · {event.message}</Text></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Stack>
    </main>
  );
}
