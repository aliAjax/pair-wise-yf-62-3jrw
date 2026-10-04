'use client';

import { useEffect, useRef } from 'react';
import type { FillLayerSpecification, GeoJSONSource, LineLayerSpecification, Map as MapLibreMap, Marker } from 'maplibre-gl';
import { Marker as MapMarker, LngLatBounds } from 'maplibre-gl';
import type { MissionArchive, RescueAsset, SearchArea, TrackRecord } from '@/lib/types';

interface SearchMapProps {
  areas: SearchArea[];
  assets: RescueAsset[];
  archives?: MissionArchive[];
  tracks?: TrackRecord[];
}

function areaPolygon(bounds: SearchArea['bounds']) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]], [bounds[0], bounds[1]]]]
    }
  };
}

export function SearchMap({ areas, assets, archives = [], tracks = [] }: SearchMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const readyRef = useRef(false);

  const syncLayers = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.isStyleLoaded()) return;
    const layerIds = new Set<string>();

    // 当前搜索区（填充 + 实线）
    areas.forEach((area) => {
      const sourceId = `area-${area.id}`;
      layerIds.add(`${sourceId}-fill`);
      layerIds.add(`${sourceId}-line`);
      const source = map.getSource(sourceId) as GeoJSONSource | undefined;
      if (source) {
        source.setData(areaPolygon(area.bounds));
        map.setPaintProperty(`${sourceId}-fill`, 'fill-color', area.status === 'active' ? '#0e7490' : '#f59e0b');
        map.setPaintProperty(`${sourceId}-line`, 'line-color', area.status === 'active' ? '#0e7490' : '#f59e0b');
      } else {
        map.addSource(sourceId, { type: 'geojson', data: areaPolygon(area.bounds) });
        map.addLayer({ id: `${sourceId}-fill`, type: 'fill', source: sourceId, paint: { 'fill-color': area.status === 'active' ? '#0e7490' : '#f59e0b', 'fill-opacity': .22 } } as FillLayerSpecification);
        map.addLayer({ id: `${sourceId}-line`, type: 'line', source: sourceId, paint: { 'line-color': area.status === 'active' ? '#0e7490' : '#f59e0b', 'line-width': 2 } } as LineLayerSpecification);
      }
    });

    // 已完成任务的范围快照：虚线灰框留档，不随后续修订移动
    archives.slice(0, 6).forEach((archive) => {
      const sourceId = `archive-${archive.missionId}`;
      layerIds.add(`${sourceId}-line`);
      const source = map.getSource(sourceId) as GeoJSONSource | undefined;
      if (source) source.setData(areaPolygon(archive.boundsSnapshot));
      else {
        map.addSource(sourceId, { type: 'geojson', data: areaPolygon(archive.boundsSnapshot) });
        map.addLayer({ id: `${sourceId}-line`, type: 'line', source: sourceId, paint: { 'line-color': '#64748b', 'line-width': 1.5, 'line-dasharray': [2, 2] } } as LineLayerSpecification);
      }
    });

    map.getStyle()?.layers.forEach((layer) => {
      if (layer.id.startsWith('area-') || layer.id.startsWith('archive-')) {
        if (!layerIds.has(layer.id)) {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id);
          const sourceId = layer.id.replace(/-fill$|-line$/, '');
          if (map.getSource(sourceId)) map.removeSource(sourceId);
        }
      }
    });
  };

  const syncMarkers = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    assets.forEach((asset) => {
      const color = asset.status === 'offline' ? '#dc2626' : asset.type === 'shore' ? '#7c3aed' : '#0f766e';
      markersRef.current.push(new MapMarker({ color }).setLngLat([asset.lng, asset.lat]).addTo(map));
    });

    // 归档航迹点：灰色（过期为橙色），tooltip 注明留档时刻
    tracks.flatMap((track) => track.points).forEach((point) => {
      const el = document.createElement('div');
      el.title = `${point.assetName} 航迹留档${point.stale ? '（归档时位置已过期）' : ''}`;
      el.style.cssText = `width:9px;height:9px;border-radius:50%;background:${point.stale ? '#f97316' : '#94a3b8'};border:1.5px solid #fff;box-shadow:0 0 0 2px rgba(148,163,184,.35);`;
      markersRef.current.push(new MapMarker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map));
    });
  };

  // 地图只初始化一次：搜索区范围变化不再重建地图，单位位置标记不再被连带重置
  useEffect(() => {
    let disposed = false;
    void import('maplibre-gl').then(({ Map, LngLatBounds }) => {
      if (disposed || !containerRef.current) return;
      const map = new Map({ container: containerRef.current, center: [121.68, 30.82], zoom: 8.5, style: 'https://demotiles.maplibre.org/style.json' });
      mapRef.current = map;
      map.on('load', () => {
        readyRef.current = true;
        syncLayers();
        syncMarkers();
        const all = [...areas.map((area) => area.bounds), ...archives.map((archive) => archive.boundsSnapshot)];
        if (all.length > 0) {
          const bounds = all.reduce(
            (acc, b) => acc.extend(new LngLatBounds([b[0], b[1]], [b[2], b[3]])),
            new LngLatBounds([all[0][0], all[0][1]], [all[0][2], all[0][3]])
          );
          map.fitBounds(bounds, { padding: 60 });
        }
      });
    });
    return () => {
      disposed = true;
      readyRef.current = false;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { syncLayers(); }, [areas, archives]);
  useEffect(() => { syncMarkers(); }, [assets, tracks]);

  return <div ref={containerRef} className="map-shell" aria-label="搜救海域地图" />;
}
