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
      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: false
      }).setView([-34.6037, -58.3816], 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        crossOrigin: true
      }).addTo(mapRef.current);
      
      const resizeObserver = new ResizeObserver(() => {
        if (mapRef.current) mapRef.current.invalidateSize();
      });
      resizeObserver.observe(containerRef.current);

      setTimeout(() => {
        if (mapRef.current) mapRef.current.invalidateSize();
      }, 500);

      return () => resizeObserver.disconnect();
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
      if (!p?.lat?.degrees || !p?.lng?.degrees) return;
      const latVal = dmsToDecimal(p.lat.degrees, p.lat.minutes, p.lat.seconds, true);
      const lngVal = dmsToDecimal(p.lng.degrees, p.lng.minutes, p.lng.seconds, false);
      if (isNaN(latVal) || isNaN(lngVal)) return;

      const pos: [number, number] = [latVal, lngVal];
      const marker = L.marker(pos).addTo(mapRef.current).bindPopup(`<b>${p.label}</b>`);
      markersRef.current.push(marker);
      validCoords.push(pos);
      coordsMap[p.label] = pos;
    });

    if (type === PlaceType.LAD && coordsMap['Umbral 1'] && coordsMap['Umbral 2']) {
      const line = L.polyline([coordsMap['Umbral 1'], coordsMap['Umbral 2']], { color: '#2563eb', weight: 4, dashArray: '10, 10' }).addTo(mapRef.current);
      linesRef.current.push(line);
    } else if (type === PlaceType.LADH && coordsMap['Centro Geométrico']) {
      const center = coordsMap['Centro Geométrico'];
      if (coordsMap['Punto Trayectoria 1']) {
        const line1 = L.polyline([coordsMap['Punto Trayectoria 1'], center], { color: '#ef4444', weight: 3, opacity: 0.6 }).addTo(mapRef.current);
        linesRef.current.push(line1);
      }
    }

    if (validCoords.length > 0) {
      try {
        const bounds = L.latLngBounds(validCoords);
        mapRef.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      } catch (e) {}
    }
    
    mapRef.current.invalidateSize();
  }, [points, type, numTraj]);

  return (
    <div className="w-full h-full min-h-[400px] bg-slate-200 flex items-center justify-center relative rounded-[2rem] overflow-hidden border-2 border-slate-100 shadow-inner">
      {typeof L === 'undefined' ? (
        <div className="text-sm font-black text-slate-400 animate-pulse">CARGANDO MAPA...</div>
      ) : (
        <div ref={containerRef} className="w-full h-full" style={{ minHeight: '400px' }} />
      )}
    </div>
  );
};

export default MapPreview;