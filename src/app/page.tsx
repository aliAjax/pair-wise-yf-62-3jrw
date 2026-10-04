'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Grid,
  Group,
  List,
  NumberInput,
  Progress,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Timeline,
  Title,
  Tooltip
} from '@mantine/core';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useState } from 'react';
import { useCommandStore } from '@/lib/store';
import type { AreaRevision, Bounds, SubmitRevisionResult } from '@/lib/types';
import { SearchMap } from '@/components/SearchMap';

const missionSchema = z.object({
  title: z.string().min(3, '任务名称至少3个字'),
  areaId: z.string().min(1),
  assetIds: z.array(z.string()).min(1, '至少调派一个单位'),
  priority: z.enum(['normal', 'urgent']),
  note: z.string().max(160)
});

const REVISION_STATUS_META: Record<AreaRevision['status'], { label: string; color: string }> = {
  pending: { label: '待执行', color: 'amber' },
  applied: { label: '已应用', color: 'teal' },
  returned: { label: '已退回', color: 'red' }
};

function boundsLabel(bounds: Bounds): string {
  return `西 ${bounds[0].toFixed(2)}° · 南 ${bounds[1].toFixed(2)}° · 东 ${bounds[2].toFixed(2)}° · 北 ${bounds[3].toFixed(2)}°`;
}

/** 范围修订单提交区：记录所采用的海况预报版本与通信窗口版本，冲突时按新版重提 */
function RevisionComposer() {
  const areas = useCommandStore((s) => s.areas);
  const forecast = useCommandStore((s) => s.forecast);
  const commWindow = useCommandStore((s) => s.commWindow);
  const submitRevision = useCommandStore((s) => s.submitRevision);
  const [areaId, setAreaId] = useState(areas[0]?.id ?? '');
  const [bounds, setBounds] = useState<Bounds>(areas[0]?.bounds ?? [121.4, 30.6, 121.7, 30.9]);
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState<SubmitRevisionResult['conflict'] | null>(null);

  const area = areas.find((a) => a.id === areaId);
  const baseVersion = area?.version ?? 1;

  const pickArea = (id: string) => {
    const target = areas.find((a) => a.id === id);
    setAreaId(id);
    setConflict(null);
    if (target) setBounds(target.bounds);
  };

  const handleSubmit = (useBaseVersion?: number) => {
    const result = submitRevision({ areaId, bounds, note, baseVersion: useBaseVersion ?? baseVersion });
    if (!result.ok && result.conflict) {
      setConflict(result.conflict);
      return;
    }
    setConflict(null);
    setNote('');
  };

  return (
    <Card withBorder>
      <Group justify="space-between">
        <Title order={3}>范围修订单</Title>
        <Group gap={6}>
          <Badge variant="light" color="blue">采用海况预报 v{forecast.version}</Badge>
          <Badge variant="light" color="grape">通信窗口 v{commWindow.version}</Badge>
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>提交时锁定所采用的预报与窗口版本；版本一变，未执行修订自动退回重算，已完成任务与航迹留档。</Text>

      <Stack mt="md" gap="sm">
        <label>
          <Text size="sm" mb={4}>搜索区</Text>
          <select value={areaId} onChange={(e) => pickArea(e.currentTarget.value)} style={{ width: '100%', padding: 8 }}>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <Group gap="xs" align="flex-end">
          {(['西界', '南界', '东界', '北界'] as const).map((label, i) => (
            <NumberInput
              key={label}
              label={label}
              size="xs"
              step={0.01}
              decimalScale={2}
              value={bounds[i]}
              onChange={(v) => setBounds((prev) => {
                const next = [...prev] as Bounds;
                next[i] = typeof v === 'number' ? v : Number(v) || 0;
                return next;
              })}
              style={{ width: '22%' }}
            />
          ))}
        </Group>
        <Text size="xs" c="dimmed">当前范围：{boundsLabel(bounds)} · 提交基线：最新版次 v{baseVersion}</Text>
        <TextInput label="修订说明" value={note} onChange={(e) => setNote(e.currentTarget.value)} placeholder="如：向北扩展 0.05°，避开商船航路" />
        <Group>
          <Button onClick={() => handleSubmit()}>提交修订（待执行）</Button>
          <Button variant="subtle" onClick={() => area && setBounds(area.bounds)}>恢复当前范围</Button>
        </Group>

        {conflict && (
          <Alert color="red" variant="light" title="先写入的算准：该区域已有最新版次" withCloseButton onClose={() => setConflict(null)}>
            <Text size="sm">
              最新为 v{conflict.currentVersion}（{boundsLabel(conflict.latest.bounds)}），你的提交基于已过期的 v{conflict.latest.baseVersion}。
            </Text>
            {conflict.diff.edges.length > 0 && (
              <Text size="sm" mt={4}>差异：{conflict.diff.edges.join('；')}</Text>
            )}
            <Button size="xs" mt="sm" color="red" onClick={() => handleSubmit(conflict.currentVersion)}>按最新版次 v{conflict.currentVersion} 重提</Button>
          </Alert>
        )}
      </Stack>
    </Card>
  );
}

/** 某区修订历史：执行 / 退回重算 / 通知重试 */
function RevisionList() {
  const areas = useCommandStore((s) => s.areas);
  const revisions = useCommandStore((s) => s.revisions);
  const applyRevision = useCommandStore((s) => s.applyRevision);
  const resubmitRevision = useCommandStore((s) => s.resubmitRevision);
  const retryNotification = useCommandStore((s) => s.retryNotification);
  const [areaId, setAreaId] = useState(areas[0]?.id ?? '');

  const list = revisions
    .filter((r) => r.areaId === areaId)
    .sort((a, b) => b.version - a.version);

  return (
    <Card withBorder>
      <Group justify="space-between">
        <Title order={3}>修订历史</Title>
        <select value={areaId} onChange={(e) => setAreaId(e.currentTarget.value)} style={{ padding: 6 }}>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Group>
      <Stack mt="md" gap="sm">
        {list.length === 0 && <Text size="sm" c="dimmed">暂无修订</Text>}
        {list.map((rev) => {
          const meta = REVISION_STATUS_META[rev.status];
          const area = areas.find((a) => a.id === rev.areaId);
          return (
            <Card key={rev.id} withBorder padding="sm">
              <Group justify="space-between">
                <Group gap={6}>
                  <Badge color={meta.color}>v{rev.version} · {meta.label}</Badge>
                  <Text size="xs" c="dimmed">{new Date(rev.createdAt).toLocaleString()}</Text>
                </Group>
                <Group gap={6}>
                  <Tooltip label={`海况预报 v${rev.forecastVersion} / 通信窗口 v${rev.commWindowVersion}（提交时采用）`}>
                    <Badge variant="outline" size="xs">预报 v{rev.forecastVersion} · 窗口 v{rev.commWindowVersion}</Badge>
                  </Tooltip>
                </Group>
              </Group>
              <Text size="xs" mt={4}>{area?.name} · {boundsLabel(rev.bounds)}</Text>
              {rev.diff.edges.length > 0 && <Text size="xs" c="dimmed" mt={2}>差异：{rev.diff.edges.join('；')}</Text>}
              {rev.note && <Text size="xs" mt={2}>说明：{rev.note}</Text>}
              {rev.status === 'returned' && (
                <Alert color="red" variant="light" mt={6} p="xs">
                  <Text size="xs">退回原因：{rev.returnReason}</Text>
                </Alert>
              )}
              {rev.status === 'applied' && (
                <Group gap={6} mt={6}>
                  <Badge size="xs" color={rev.notificationStatus === 'delivered' ? 'teal' : rev.notificationStatus === 'partial' ? 'amber' : 'red'}>
                    通知 {rev.notificationStatus === 'delivered' ? '全部送达' : rev.notificationStatus === 'partial' ? '部分送达' : '未送达'} {rev.deliveredTo.length}/{rev.notifyTargets.length}
                  </Badge>
                  {rev.notificationStatus !== 'delivered' && rev.notifyTargets.length > 0 && (
                    <Button size="compact-xs" variant="light" onClick={() => retryNotification(rev.id)}>重试未送达</Button>
                  )}
                </Group>
              )}
              <Group mt={6}>
                {rev.status === 'pending' && <Button size="compact-xs" onClick={() => applyRevision(rev.id)}>执行修订</Button>}
                {rev.status === 'returned' && <Button size="compact-xs" variant="light" onClick={() => resubmitRevision(rev.id)}>按新版重算重提</Button>}
              </Group>
            </Card>
          );
        })}
      </Stack>
    </Card>
  );
}

/** 版本与通信窗口：发布新版 → 未执行修订退回 */
function VersionPanel() {
  const forecast = useCommandStore((s) => s.forecast);
  const commWindow = useCommandStore((s) => s.commWindow);
  const lowBandwidth = useCommandStore((s) => s.lowBandwidth);
  const publishForecast = useCommandStore((s) => s.publishForecast);
  const updateCommWindow = useCommandStore((s) => s.updateCommWindow);

  return (
    <Card withBorder>
      <Title order={3}>版本与通信窗口</Title>
      <Stack mt="md" gap="sm">
        <Card withBorder padding="sm">
          <Group justify="space-between">
            <Badge color="blue">海况预报 v{forecast.version}</Badge>
            <Button size="compact-xs" variant="light" onClick={publishForecast}>发布新预报</Button>
          </Group>
          {!lowBandwidth && <Text size="xs" mt={4}>{forecast.summary}</Text>}
          <Text size="xs" c="dimmed" mt={2}>{formatDistanceToNow(new Date(forecast.issuedAt), { addSuffix: true, locale: zhCN })}发布</Text>
        </Card>
        <Card withBorder padding="sm">
          <Group justify="space-between">
            <Badge color="grape">通信窗口 v{commWindow.version}</Badge>
            <Button size="compact-xs" variant="light" onClick={updateCommWindow}>更新通信窗口</Button>
          </Group>
          {!lowBandwidth && <Text size="xs" mt={4}>{commWindow.summary}</Text>}
          <Text size="xs" c="dimmed" mt={2}>{formatDistanceToNow(new Date(commWindow.issuedAt), { addSuffix: true, locale: zhCN })}更新</Text>
        </Card>
        <Text size="xs" c="dimmed">预报或窗口版本一变，未执行修订立即退回重算；已完成任务与航迹留档不受影响。</Text>
      </Stack>
    </Card>
  );
}

/** 通知队列：失败留队列，回网只重试未送达部分；低带宽先看摘要 */
function NotificationQueue() {
  const revisions = useCommandStore((s) => s.revisions);
  const lowBandwidth = useCommandStore((s) => s.lowBandwidth);
  const retryNotification = useCommandStore((s) => s.retryNotification);
  const [expanded, setExpanded] = useState(!lowBandwidth);

  const queued = revisions.filter((r) => r.status === 'applied' && r.notificationStatus !== 'delivered' && r.notifyTargets.length > 0);
  const totalTargets = queued.reduce((n, r) => n + r.notifyTargets.length, 0);
  const totalDelivered = queued.reduce((n, r) => n + r.deliveredTo.length, 0);

  return (
    <Card withBorder>
      <Group justify="space-between">
        <Title order={3}>通知队列</Title>
        <Badge color={queued.length === 0 ? 'teal' : 'amber'}>{queued.length} 条待重试</Badge>
      </Group>
      <Text size="sm" mt="xs">
        摘要：已送达 {totalDelivered}/{totalTargets} 个单位 · {queued.length} 条修订留在队列
      </Text>
      {lowBandwidth && (
        <Button size="compact-xs" variant="subtle" mt={4} onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起明细' : '展开明细'}
        </Button>
      )}
      <Collapse in={expanded}>
        <Stack mt="md" gap="sm">
          {queued.length === 0 && <Text size="xs" c="dimmed">全部修订通知已送达，队列清空。</Text>}
          {queued.map((rev) => (
            <Card key={rev.id} withBorder padding="sm">
              <Group justify="space-between">
                <Group gap={6}>
                  <Badge size="xs" color={rev.notificationStatus === 'partial' ? 'amber' : 'red'}>
                    {rev.notificationStatus === 'partial' ? '部分送达' : '未送达'}
                  </Badge>
                  <Text size="xs">修订 v{rev.version}</Text>
                </Group>
                <Button size="compact-xs" variant="light" onClick={() => retryNotification(rev.id)}>重试未送达（{rev.notifyTargets.length - rev.deliveredTo.length}）</Button>
              </Group>
              <Text size="xs" c="dimmed" mt={2}>已送达单位：{rev.deliveredTo.join('、') || '无'}；未送达：{rev.notifyTargets.filter((t) => !rev.deliveredTo.includes(t)).join('、')}</Text>
            </Card>
          ))}
        </Stack>
      </Collapse>
    </Card>
  );
}

/** 留档记录：已完成任务与单位航迹 */
function ArchiveList() {
  const archives = useCommandStore((s) => s.archives);
  const areas = useCommandStore((s) => s.areas);
  return (
    <Card withBorder>
      <Title order={3}>留档记录</Title>
      <Text size="xs" c="dimmed" mt={4}>修订应用时冻结：已完成任务清单与当时单位航迹，不随后续范围变更而改动。</Text>
      <Stack mt="md" gap="sm">
        {archives.length === 0 && <Text size="xs" c="dimmed">暂无留档</Text>}
        {archives.map((arch) => {
          const area = areas.find((a) => a.id === arch.areaId);
          return (
            <Card key={arch.id} withBorder padding="sm">
              <Group justify="space-between">
                <Badge size="xs" variant="outline">{area?.name ?? arch.areaId} v{arch.version}</Badge>
                <Text size="xs" c="dimmed">{new Date(arch.at).toLocaleString()}</Text>
              </Group>
              <Text size="xs" mt={4}>已完成任务 {arch.missions.length} 项：{arch.missions.map((m) => m.title).join('、') || '无'}</Text>
              <Text size="xs" c="dimmed" mt={2}>航迹点 {arch.positions.length} 条：{arch.positions.map((p) => `${p.name}(${p.lat.toFixed(2)},${p.lng.toFixed(2)})`).join('；')}</Text>
            </Card>
          );
        })}
      </Stack>
    </Card>
  );
}

export default function CommandPage() {
  const state = useCommandStore();
  const [selectedAssets, setSelectedAssets] = useState<string[]>(['ship-01']);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof missionSchema>>({
    resolver: zodResolver(missionSchema),
    defaultValues: { title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' }
  });
  const brief = useQuery({
    queryKey: ['sea-state'],
    queryFn: async () => ({ wind: '东北风 6级', visibility: '4.2海里', tide: '涨潮' }),
    refetchInterval: state.lowBandwidth ? false : 60_000
  });

  const submitMission = (values: z.infer<typeof missionSchema>) => {
    state.dispatchMission({ ...values, assetIds: selectedAssets });
    reset({ title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' });
  };

  const stats: [string, number][] = [
    ['活动搜索区', state.areas.filter((item) => item.status === 'active').length],
    ['在线单位', state.assets.filter((item) => item.status !== 'offline').length],
    ['进行中任务', state.missions.filter((item) => item.status === 'in_progress').length],
    ['过期位置', state.assets.filter((item) => Date.now() - new Date(item.lastSeen).getTime() > 10 * 60_000).length],
    ['待执行修订', state.revisions.filter((item) => item.status === 'pending').length],
    ['通知待送达', state.revisions.filter((item) => item.status === 'applied' && item.notificationStatus !== 'delivered' && item.notifyTargets.length > 0).length]
  ];

  return (
    <main className={state.lowBandwidth ? 'low-bandwidth' : ''}>
      <Stack p="xl" gap="lg" maw={1600} mx="auto">
        <Group justify="space-between" align="flex-end">
          <div><Badge color={state.offline ? 'red' : 'teal'}>{state.offline ? '离线缓存模式' : '联合指挥在线'}</Badge><Title order={1} className="section-title">海上搜救联合指挥</Title><Text c="dimmed">搜索区、力量与任务在同一时间线上协同</Text></div>
          <Group><Switch label="低带宽" checked={state.lowBandwidth} onChange={state.toggleBandwidth} /><Switch label="模拟离线" checked={state.offline} onChange={state.toggleOffline} /></Group>
        </Group>

        <SimpleGrid cols={{ base: 2, md: 3, xl: 6 }}>
          {stats.map(([label, value]) => <Card key={String(label)} withBorder><Text size="sm" c="dimmed">{label}</Text><Title order={2}>{value}</Title></Card>)}
        </SimpleGrid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 8 }}><Card withBorder><Group justify="space-between"><Title order={3}>搜救态势</Title><Text size="sm">风况：{brief.data?.wind ?? '读取中'} · 能见度：{brief.data?.visibility ?? '--'}</Text></Group><SearchMap areas={state.areas} assets={state.assets} /></Card></Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}><Card withBorder h="100%"><Title order={3}>单位状态</Title><Stack mt="md">{state.assets.map((asset) => {
            const stale = Date.now() - new Date(asset.lastSeen).getTime() > 10 * 60_000;
            return <Card key={asset.id} withBorder padding="sm"><Group justify="space-between"><b>{asset.name}</b><Badge color={asset.status === 'offline' ? 'red' : asset.status === 'assigned' ? 'blue' : 'teal'}>{asset.status}</Badge></Group><Text size="xs" c={stale ? 'red' : 'dimmed'}>{stale ? '位置已过期 · ' : ''}{formatDistanceToNow(new Date(asset.lastSeen), { addSuffix: true, locale: zhCN })}</Text><Group mt="xs"><Button size="compact-xs" onClick={() => state.setAssetStatus(asset.id, asset.status === 'offline' ? 'ready' : 'offline')}>{asset.status === 'offline' ? '恢复在线' : '标记失联'}</Button></Group></Card>;
          })}</Stack></Card></Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 5 }}><Card withBorder><Title order={3}>派发新任务</Title><form onSubmit={handleSubmit(submitMission)}><Stack mt="md"><TextInput label="任务名称" {...register('title')} error={errors.title?.message} /><label>搜索区<select {...register('areaId')} style={{ width: '100%', padding: 8 }}>{state.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>调派单位（可多选）<select multiple value={selectedAssets} onChange={(event) => setSelectedAssets(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} style={{ width: '100%', minHeight: 86 }}>{state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><label>优先级<select {...register('priority')} style={{ width: '100%', padding: 8 }}><option value="urgent">紧急</option><option value="normal">常规</option></select></label><Textarea label="任务说明" {...register('note')} /><Button type="submit">派发任务</Button></Stack></form></Card></Grid.Col>
          <Grid.Col span={{ base: 12, lg: 7 }}><Card withBorder><Title order={3}>任务与搜索区</Title><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th align="left">搜索区</th><th align="left">状态</th><th align="left">覆盖率</th><th align="left">范围版本</th></tr></thead><tbody>{state.areas.map((area) => <tr key={area.id}><td style={{ padding: '8px 0' }}>{area.name}</td><td>{area.status}</td><td style={{ width: '32%' }}><Progress value={area.coverage} /></td><td>v{area.version}</td></tr>)}</tbody></table><List mt="lg" spacing="sm">{state.missions.map((mission) => <List.Item key={mission.id}><Group justify="space-between"><div><b>{mission.title}</b><Text size="xs" c="dimmed">{mission.areaId} · {mission.assetIds.join(' / ')}</Text></div><Group><Badge>{mission.status}</Badge><Button size="compact-xs" onClick={() => state.setMissionStatus(mission.id, mission.status === 'in_progress' ? 'closed' : 'in_progress')}>{mission.status === 'closed' ? '重开' : '推进'}</Button></Group></Group></List.Item>)}</List></Card></Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 7 }}><Stack gap="lg"><RevisionComposer /><RevisionList /></Stack></Grid.Col>
          <Grid.Col span={{ base: 12, lg: 5 }}><Stack gap="lg"><VersionPanel /><NotificationQueue /><ArchiveList /></Stack></Grid.Col>
        </Grid>

        <Card withBorder><Title order={3}>联合事件时间线</Title><Timeline mt="lg" active={1} bulletSize={18} lineWidth={2}>{state.events.slice(0, 12).map((event) => <Timeline.Item key={event.id} title={`${event.actor} · ${new Date(event.time).toLocaleTimeString()}`}><Text size="sm">{event.message}</Text></Timeline.Item>)}</Timeline></Card>
      </Stack>
    </main>
  );
}
