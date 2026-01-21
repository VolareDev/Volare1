
import React, { useEffect, useRef } from 'react';
import { dmsToDecimal } from '../constants';
import { GeolocationPoint, PlaceType } from '../types';

declare var L: any;

interface MapPreviewProps {
  points: (GeolocationPoint | undefined)[];
  type: PlaceType;
  numTraj: number;
}

const MapPreview: React.FC<MapPreviewProps> = ({ points, type, numTraj }) => {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<any[]>([]);
  const linesRef = useRef<any[]>([]);

  useEffect(() => {
    if (typeof L === 'undefined') return;
    if (!containerRef.current || mapRef.current) return;
    try {
      mapRef.current = L.map(containerRef.current).setView([-38.4161, -63.6167], 4);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(mapRef.current);
    } catch (e) { console.error(e); }
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  useEffect(() => {
    if (!mapRef.current || typeof L === 'undefined') return;

    markersRef.current.forEach(m => mapRef.current.removeLayer(m));
    linesRef.current.forEach(l => mapRef.current.removeLayer(l));
    markersRef.current = [];
    linesRef.current = [];

    const coordsMap: Record<string, [number, number]> = {};
    const validCoords: [number, number][] = [];

    points.forEach((p) => {
      if (!p?.lat?.degrees) return;
      const latVal = dmsToDecimal(p.lat.degrees, p.lat.minutes, p.lat.seconds, true);
      const lngVal = dmsToDecimal(p.lng.degrees, p.lng.minutes, p.lng.seconds, false);
      if (isNaN(latVal)) return;

      const pos: [number, number] = [latVal, lngVal];
      const marker = L.marker(pos).addTo(mapRef.current).bindPopup(`<b>${p.label}</b>`);
      markersRef.current.push(marker);
      validCoords.push(pos);
      coordsMap[p.label] = pos;
    });

    // DRAW LINES
    if (type === PlaceType.LAD && coordsMap['Umbral 1'] && coordsMap['Umbral 2']) {
      const line = L.polyline([coordsMap['Umbral 1'], coordsMap['Umbral 2']], { color: '#2563eb', weight: 4, dashArray: '10, 10' }).addTo(mapRef.current);
      linesRef.current.push(line);
    } else if (type === PlaceType.LADH && coordsMap['Centro Geométrico']) {
      const center = coordsMap['Centro Geométrico'];
      if (coordsMap['Punto Trayectoria 1']) {
        const line1 = L.polyline([coordsMap['Punto Trayectoria 1'], center], { color: '#ef4444', weight: 3, opacity: 0.6 }).addTo(mapRef.current);
        linesRef.current.push(line1);
      }
      if (numTraj === 2 && coordsMap['Punto Trayectoria 2']) {
        const line2 = L.polyline([coordsMap['Punto Trayectoria 2'], center], { color: '#ef4444', weight: 3, opacity: 0.6 }).addTo(mapRef.current);
        linesRef.current.push(line2);
      }
    }

    if (validCoords.length > 0) {
      try {
        const bounds = L.latLngBounds(validCoords);
        mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      } catch (e) {}
    }
  }, [points, type, numTraj]);

  return (
    <div className="w-full h-full min-h-[300px] bg-slate-100 flex items-center justify-center relative">
      {typeof L === 'undefined' ? <div className="text-[10px] font-black text-slate-300">CARGANDO MAPA...</div> : <div ref={containerRef} className="w-full h-full" />}
    </div>
  );
};

export default MapPreview;
