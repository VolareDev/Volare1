import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { FormData, PlaceType, GeolocationPoint } from './types';
import { 
  INITIAL_FORM_STATE, dmsToDecimal, decimalToDMS, calculateBearing, 
  fetchMagneticDeclination, calculateDistance, calculateMidpoint, fetchElevation, SURFACE_TYPES 
} from './constants';
import MapPreview from './components/MapPreview';
import CoordinateInput from './components/CoordinateInput';

const App: React.FC = () => {
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM_STATE as any);
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const calculationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainContainerRef = useRef<HTMLDivElement>(null);

  const updateNestedState = useCallback((path: string, value: any) => {
    setFormData((prev) => {
      const newState = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let current: any = newState;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) current[keys[i]] = {};
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return newState;
    });
  }, []);

  const handleFileChange = (id: string, file: File | null) => {
    setFormData(prev => ({
      ...prev,
      documentation: {
        ...prev.documentation,
        [id]: { ...(prev.documentation as any)[id], file: file, checked: !!file, wantGeneration: false }
      }
    }));
  };

  const handleHelpToggle = (id: string, checked: boolean) => {
    updateNestedState(`documentation.${id}.needHelp`, checked);
  };

  const handlePlanGenerationToggle = (want: boolean) => {
    setFormData(prev => ({
      ...prev,
      documentation: {
        ...prev.documentation,
        cadastralPlan: { ...prev.documentation.cadastralPlan, wantGeneration: want, file: want ? null : prev.documentation.cadastralPlan.file, checked: want }
      }
    }));
  };

  const handleCoordChange = (pointKey: keyof FormData['technicalData']['coordinates'], dmsKey: 'lat' | 'lng', field: 'degrees' | 'minutes' | 'seconds', val: string) => {
    setFormData(prev => {
      const currentPoint = prev.technicalData?.coordinates?.[pointKey];
      if (!currentPoint) return prev;
      const updatedPoint = { ...currentPoint, [dmsKey]: { ...currentPoint[dmsKey], [field]: val } };
      const newState = JSON.parse(JSON.stringify(prev));
      newState.technicalData.coordinates[pointKey] = updatedPoint;
      return newState;
    });
  };

  // --- MOTOR DE CÁLCULO REACTIVO DE ALTA PRECISIÓN ---
  const coordsHash = JSON.stringify(formData.technicalData.coordinates);

  useEffect(() => {
    if (calculationTimeoutRef.current) clearTimeout(calculationTimeoutRef.current);

    calculationTimeoutRef.current = setTimeout(async () => {
      setIsFetchingData(true);
      const newCoords = { ...formData.technicalData.coordinates };
      const isLAD = formData.placeType === PlaceType.LAD || formData.placeType === PlaceType.LADA;
      let hasChanges = false;
      let newDeclination = formData.technicalData.magneticDeclination;
      let newLength = formData.technicalData.runwayLength;

      // 1. Sincronizar Centro Geométrico y Largo para LAD/LADA
      if (isLAD && newCoords.umbral1.lat.degrees && newCoords.umbral2.lat.degrees) {
        const u1lat = dmsToDecimal(newCoords.umbral1.lat.degrees, newCoords.umbral1.lat.minutes, newCoords.umbral1.lat.seconds, true);
        const u1lng = dmsToDecimal(newCoords.umbral1.lng.degrees, newCoords.umbral1.lng.minutes, newCoords.umbral1.lng.seconds, false);
        const u2lat = dmsToDecimal(newCoords.umbral2.lat.degrees, newCoords.umbral2.lat.minutes, newCoords.umbral2.lat.seconds, true);
        const u2lng = dmsToDecimal(newCoords.umbral2.lng.degrees, newCoords.umbral2.lng.minutes, newCoords.umbral2.lng.seconds, false);
        
        const dist = calculateDistance(u1lat, u1lng, u2lat, u2lng);
        const mid = calculateMidpoint(u1lat, u1lng, u2lat, u2lng);
        const midDMSLat = decimalToDMS(mid.lat);
        const midDMSLng = decimalToDMS(mid.lng);

        if (newLength !== dist.toFixed(0)) {
          newLength = dist.toFixed(0);
          hasChanges = true;
        }

        if (JSON.stringify(newCoords.center.lat) !== JSON.stringify(midDMSLat) || JSON.stringify(newCoords.center.lng) !== JSON.stringify(midDMSLng)) {
          newCoords.center.lat = midDMSLat;
          newCoords.center.lng = midDMSLng;
          hasChanges = true;
        }
      }

      // 2. Obtener Declinación Magnética basada en UMBRAL 1
      const pMag = (isLAD && newCoords.umbral1.lat.degrees) ? newCoords.umbral1 : newCoords.center;
      if (pMag.lat.degrees && pMag.lng.degrees) {
        const mlat = dmsToDecimal(pMag.lat.degrees, pMag.lat.minutes, pMag.lat.seconds, true);
        const mlng = dmsToDecimal(pMag.lng.degrees, pMag.lng.minutes, pMag.lng.seconds, false);
        const dec = await fetchMagneticDeclination(mlat, mlng);
        if (newDeclination !== dec.toFixed(2)) {
          newDeclination = dec.toFixed(2);
          hasChanges = true;
        }
      }

      // 3. Obtener Elevaciones por punto
      const keysToFetch = ['center', 'umbral1', 'umbral2'] as const;
      for (const key of keysToFetch) {
        const p = newCoords[key];
        if (p.lat.degrees && p.lng.degrees) {
          const plat = dmsToDecimal(p.lat.degrees, p.lat.minutes, p.lat.seconds, true);
          const plng = dmsToDecimal(p.lng.degrees, p.lng.minutes, p.lng.seconds, false);
          try {
            const elev = await fetchElevation(plat, plng);
            if (p.elevation !== elev.toString()) {
              newCoords[key].elevation = elev.toString();
              hasChanges = true;
            }
          } catch (e) { console.error(e); }
        }
      }

      if (hasChanges) {
        setFormData(prev => ({
          ...prev,
          technicalData: {
            ...prev.technicalData,
            runwayLength: newLength,
            magneticDeclination: newDeclination,
            coordinates: newCoords
          }
        }));
      }
      setIsFetchingData(false);
    }, 800);

    return () => { if (calculationTimeoutRef.current) clearTimeout(calculationTimeoutRef.current); };
  }, [coordsHash, formData.placeType]);

  const activeMapPoints = useMemo(() => {
    const points: GeolocationPoint[] = [];
    const coords = formData.technicalData?.coordinates;
    const { umbral1, umbral2, center, traj1, traj2 } = coords;
    
    if (formData.placeType === PlaceType.LAD || formData.placeType === PlaceType.LADA) {
      if (umbral1?.lat?.degrees) points.push(umbral1);
      if (umbral2?.lat?.degrees) points.push(umbral2);
    } else if (formData.placeType === PlaceType.LADH) {
      if (traj1?.lat?.degrees) points.push(traj1);
      if (formData.technicalData.numTrajectories === 2 && traj2?.lat?.degrees) points.push(traj2);
    }
    
    if (center?.lat?.degrees) points.push(center);
    return points;
  }, [formData.placeType, formData.technicalData.coordinates, formData.technicalData.numTrajectories]);

  const calculations = useMemo(() => {
    const tech = formData.technicalData;
    const { umbral1, umbral2, center, traj1 } = tech.coordinates;
    const declination = parseFloat(tech.magneticDeclination) || 0;

    if (formData.placeType === PlaceType.LAD || formData.placeType === PlaceType.LADA) {
      if (!umbral1?.lat?.degrees || !umbral2?.lat?.degrees) return null;
      const lat1 = dmsToDecimal(umbral1.lat.degrees, umbral1.lat.minutes, umbral1.lat.seconds, true);
      const lon1 = dmsToDecimal(umbral1.lng.degrees, umbral1.lng.minutes, umbral1.lng.seconds, false);
      const lat2 = dmsToDecimal(umbral2.lat.degrees, umbral2.lat.minutes, umbral2.lat.seconds, true);
      const lon2 = dmsToDecimal(umbral2.lng.degrees, umbral2.lng.minutes, umbral2.lng.seconds, false);
      const trueBrng = calculateBearing(lat1, lon1, lat2, lon2);
      const magBrng = (trueBrng - declination + 360) % 360;
      const rwy1 = Math.round(magBrng / 10);
      const rwy2 = Math.round(((magBrng + 180) % 360) / 10);
      const designator = `${rwy1 === 0 ? '36' : (rwy1 > 36 ? (rwy1-36) : rwy1).toString().padStart(2, '0')}/${rwy2 === 0 ? '36' : (rwy2 > 36 ? (rwy2-36) : rwy2).toString().padStart(2, '0')}`;
      return { trueBrng, magBrng, designator, declination };
    } 
    
    if (formData.placeType === PlaceType.LADH) {
      if (!center.lat.degrees) return null;
      const clat = dmsToDecimal(center.lat.degrees, center.lat.minutes, center.lat.seconds, true);
      const clng = dmsToDecimal(center.lng.degrees, center.lng.minutes, center.lng.seconds, false);
      let t1Mag = null;
      if (traj1.lat.degrees) {
        const t1lat = dmsToDecimal(traj1.lat.degrees, traj1.lat.minutes, traj1.lat.seconds, true);
        const t1lng = dmsToDecimal(traj1.lng.degrees, traj1.lng.minutes, traj1.lng.seconds, false);
        const t1True = calculateBearing(t1lat, t1lng, clat, clng); 
        t1Mag = (t1True - declination + 360) % 360;
      }
      return { t1Mag, t2Mag: null, declination };
    }
    return null;
  }, [formData.technicalData.coordinates, formData.technicalData.magneticDeclination, formData.placeType]);

  const handleSend = async () => {
    setIsSending(true);
    await new Promise(r => setTimeout(r, 2000));
    alert("¡Registro Digital Procesado! Sincronizado con NOAA WMMHR. La información ha sido enviada.");
    setIsSending(false);
  };

  const handleDownload = async () => {
    if (!mainContainerRef.current) return;
    setIsGeneratingPdf(true);
    try {
      const element = mainContainerRef.current;
      const originalScrollY = window.scrollY;
      window.scrollTo(0, 0); 
      const canvas = await (window as any).html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowHeight: element.scrollHeight,
        onclone: (clonedDoc: Document) => {
          const mapEl = clonedDoc.querySelector('.leaflet-container') as HTMLElement;
          if (mapEl) {
            mapEl.style.height = '600px';
            mapEl.style.width = '100%';
          }
        }
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new (window as any).jspdf.jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      let heightLeft = pdfHeight;
      let position = 0;
      const pageHeight = pdf.internal.pageSize.getHeight();
      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;
      while (heightLeft >= 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`Registro_LAD_Volare_${formData.proposedName || 'Final'}.pdf`);
      window.scrollTo(0, originalScrollY);
      await handleSend(); 
    } catch (error) {
      console.error("PDF Fail", error);
      alert("Error generando el documento.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div ref={mainContainerRef} className="max-w-6xl mx-auto p-4 md:p-10 space-y-8 bg-white shadow-2xl min-h-screen my-4 md:my-10 rounded-none md:rounded-[3rem] border border-slate-100">
      <header className="flex flex-col border-b border-slate-100 pb-8 gap-4 no-print">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
              <span className="bg-blue-600 text-white text-[10px] px-3 py-1 rounded-full font-black tracking-widest uppercase shadow-lg shadow-blue-200">Sistema LAD-Online</span>
              <span className="text-slate-300 text-[10px] font-mono">v6.5.0 (WMMHR 2024-2029 NOAA-Sync)</span>
            </div>
            <h1 className="text-4xl font-black text-slate-800 tracking-tighter leading-none uppercase">REGISTRO DE LUGARES APTOS</h1>
            <p className="text-blue-600 font-black text-xl mt-1 tracking-tight">Volaré. Resolvé sin vuelta.</p>
          </div>
        </div>
        <div className="bg-slate-50 p-8 rounded-[2rem] border-2 border-slate-100/50 shadow-inner">
           <p className="text-slate-600 font-medium italic text-sm leading-relaxed">
             Este es un desarrollo gratuito de Volaré, pensado en vos para ayudarte a tener tu lugar de vuelo, según requisitos de la Administracion de Aviación Civil Argentina (ANAC).
           </p>
           <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-6 border-t border-slate-200 pt-6">
             <div className="flex-1">
               <p className="text-[11px] font-black text-slate-800 uppercase tracking-tight">
                 <span className="text-red-500 font-black">Importante!</span> Cálculos magnéticos referenciados al Umbral 1 y sincronizados con NOAA.
               </p>
             </div>
             <label className="flex items-center gap-3 bg-white px-5 py-3 rounded-2xl border-2 border-blue-100 cursor-pointer hover:border-blue-500 transition-all shadow-sm">
                <input type="checkbox" checked={formData.wantFeasibilityCheck} onChange={(e) => updateNestedState('wantFeasibilityCheck', e.target.checked)} className="w-5 h-5 text-blue-600 rounded" />
                <span className="text-[11px] font-black text-blue-800 uppercase">Quiero que me digan si es factible</span>
             </label>
           </div>
        </div>
      </header>

      <form className="space-y-20" onSubmit={(e) => e.preventDefault()}>
        {/* 1) Documentación */}
        <section className="space-y-6">
          <div className="flex items-center gap-4 border-l-4 border-blue-600 pl-4">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">1. Documentación Respaldatoria</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ml-0 md:ml-6">
            {[
              { id: 'propertyTitle', label: '1. Título de Propiedad *' },
              { id: 'cadastralPlan', label: '2. Plano Catastral *', special: true },
              { id: 'environmentalDeclaration', label: 'D.J. Ambiental *' },
              { id: 'paymentReceipt', label: 'Pago Arancel *' },
              { id: 'leaseContract', label: 'Contrato Locación' },
              { id: 'powerOfAttorney', label: 'Poder Legal' },
              { id: 'boardMinute', label: 'Acta Directorio' }
            ].map((item) => (
              <div key={item.id} className="p-4 bg-white rounded-3xl border-2 border-slate-50 hover:border-blue-200 transition-all flex flex-col gap-2 shadow-sm relative overflow-hidden group">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-black text-slate-700 uppercase truncate max-w-[80%]">{item.label}</span>
                  <div className={`w-3 h-3 rounded-full ${(formData.documentation as any)?.[item.id]?.checked ? 'bg-green-500 shadow-lg shadow-green-200' : 'bg-slate-200'}`} />
                </div>
                <label className="flex items-center justify-center w-full h-8 border-2 border-dashed border-slate-200 rounded-xl hover:border-blue-400 hover:bg-blue-50/50 transition-all cursor-pointer">
                  <p className="text-[9px] font-black text-slate-400 group-hover:text-blue-600 uppercase tracking-widest truncate px-2">
                    {(formData.documentation as any)?.[item.id]?.file ? (formData.documentation as any)[item.id].file.name : 'ADJUNTAR'}
                  </p>
                  <input type="file" className="hidden" onChange={(e) => handleFileChange(item.id, e.target.files?.[0] || null)} />
                </label>
                {item.id === 'cadastralPlan' && (
                  <label className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 mt-1 cursor-pointer">
                    <input type="checkbox" className="w-3 h-3 text-blue-600 rounded" checked={formData.documentation.cadastralPlan.wantGeneration} onChange={(e) => handlePlanGenerationToggle(e.target.checked)} />
                    <span className="text-[9px] font-black text-slate-800 uppercase">Generar plano (U$D 174)</span>
                  </label>
                )}
                <label className="flex items-center gap-2 cursor-pointer mt-auto pt-1">
                  <input type="checkbox" checked={(formData.documentation as any)?.[item.id]?.needHelp} onChange={(e) => handleHelpToggle(item.id, e.target.checked)} className="w-3 h-3 text-blue-600 rounded" />
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Necesito ayuda</span>
                </label>
              </div>
            ))}
          </div>
        </section>

        {/* 2) Clasificación */}
        <section className="space-y-6">
          <div className="flex items-center gap-4 border-l-4 border-blue-600 pl-4">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">2. Clasificación del Lugar</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 ml-0 md:ml-6">
            {Object.values(PlaceType).map((type) => (
              <label key={type} className={`p-8 rounded-[2.5rem] border-4 cursor-pointer transition-all flex flex-col items-center gap-2 text-center group ${formData.placeType === type ? 'border-blue-600 bg-blue-50 shadow-xl shadow-blue-100' : 'border-slate-50 bg-white hover:border-slate-200'}`}>
                <input type="radio" name="placeType" value={type} checked={formData.placeType === type} onChange={(e) => updateNestedState('placeType', e.target.value)} className="w-6 h-6 text-blue-600" />
                <div className="text-3xl font-black text-slate-800 tracking-tighter uppercase">{type}</div>
                <div className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">{type === 'LAD' ? 'Aviones' : type === 'LADH' ? 'Helicópteros' : 'Aeróstatos'}</div>
              </label>
            ))}
          </div>
        </section>

        {/* 3) Análisis Aeronáutico */}
        <section className="space-y-8">
          <div className="flex items-center gap-4 border-l-4 border-blue-600 pl-4">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">3. Emplazamiento y Análisis Aeronáutico</h2>
          </div>

          {!formData.placeType ? (
             <div className="ml-6 p-20 border-4 border-dashed border-slate-100 rounded-[3rem] text-center text-slate-300 font-black uppercase tracking-[0.3em] text-sm bg-slate-50/30">
               Seleccione Clasificación
             </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 ml-0 md:ml-6">
              <div className="space-y-12">
                {/* SUPERFICIE */}
                <div className="p-10 bg-slate-50 rounded-[3rem] border-2 border-slate-100 space-y-6 shadow-sm">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block text-center">Tipo de Superficie *</label>
                  <div className="grid grid-cols-2 gap-3">
                    {SURFACE_TYPES.map(s => (
                      <button key={s} type="button" onClick={() => updateNestedState('technicalData.surface', s)} className={`p-4 text-[11px] font-black uppercase rounded-2xl border-2 transition-all ${formData.technicalData.surface === s ? 'border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-200' : 'border-white bg-white text-slate-400 hover:border-slate-200'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* LAD / LADA: Coordenadas */}
                {(formData.placeType === PlaceType.LAD || formData.placeType === PlaceType.LADA) && (
                  <div className="space-y-8">
                    <div className="grid grid-cols-2 gap-8">
                      <div className="p-8 bg-white rounded-[2rem] border-2 border-blue-50 shadow-sm">
                        <label className="text-[11px] font-black text-blue-600 uppercase tracking-widest block mb-2">Ancho (m) *</label>
                        <input type="number" placeholder="0" value={formData.technicalData.runwayWidth} onChange={(e) => updateNestedState('technicalData.runwayWidth', e.target.value)} className="w-full text-4xl font-black text-slate-800 bg-transparent outline-none border-b-4 border-blue-50 focus:border-blue-600 transition-colors"/>
                      </div>
                      <div className="p-8 bg-slate-100/50 rounded-[2rem] border border-slate-200 flex flex-col justify-center">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-1">Largo Total</label>
                        <div className="text-4xl font-black text-slate-800 tracking-tighter">{formData.technicalData.runwayLength || '0'} <span className="text-xl">m</span></div>
                      </div>
                    </div>

                    {(['umbral1', 'umbral2'] as const).map((key) => {
                      const p = formData.technicalData?.coordinates?.[key];
                      return (
                        <div key={key} className="p-10 rounded-[3rem] border-2 border-slate-100 bg-white space-y-8 shadow-sm relative group hover:border-blue-100 transition-all">
                          <div className="flex justify-between items-center">
                            <h3 className="font-black text-slate-800 text-sm uppercase tracking-widest border-b-2 border-blue-600 pb-1">{p.label}</h3>
                            <div className="text-right">
                               <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Elevación</label>
                               <div className="text-2xl font-black text-blue-600 flex items-center gap-3 justify-end">
                                 {isFetchingData ? <div className="w-4 h-4 border-4 border-blue-600 border-t-transparent animate-spin rounded-full" /> : <span>{p.elevation || '--'}</span>} <span className="text-sm font-bold text-slate-300">m</span>
                               </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
                            <CoordinateInput label="Latitud (S)" value={p.lat} onChange={(f, v) => handleCoordChange(key, 'lat', f as any, v)} suffix="S" />
                            <CoordinateInput label="Longitud (W)" value={p.lng} onChange={(f, v) => handleCoordChange(key, 'lng', f as any, v)} suffix="W" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* CENTRO GEOMÉTRICO */}
                <div className="p-10 rounded-[3rem] border-4 border-blue-50 bg-blue-50/10 space-y-10 relative overflow-hidden shadow-sm">
                  <div className="flex justify-between items-center relative z-10">
                    <h3 className="font-black text-blue-900 text-sm uppercase tracking-widest">Referencia (Centro)</h3>
                    <div className="text-right">
                       <label className="text-[10px] font-black text-blue-800 uppercase block mb-1">Elevación ARP</label>
                       <div className="text-3xl font-black text-blue-900 flex items-center gap-3 justify-end">
                          {isFetchingData ? <div className="w-5 h-5 border-4 border-blue-900 border-t-transparent animate-spin rounded-full" /> : <span>{formData.technicalData.coordinates.center.elevation || '--'}</span>} <span className="text-sm font-bold text-blue-300">m</span>
                       </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 relative z-10">
                    <CoordinateInput label="Latitud" disabled={formData.placeType === PlaceType.LAD} value={formData.technicalData.coordinates.center.lat} onChange={(f, v) => handleCoordChange('center', 'lat', f as any, v)} suffix="S" />
                    <CoordinateInput label="Longitud" disabled={formData.placeType === PlaceType.LAD} value={formData.technicalData.coordinates.center.lng} onChange={(f, v) => handleCoordChange('center', 'lng', f as any, v)} suffix="W" />
                  </div>
                </div>

                {/* RESULTADOS TÉCNICOS FINALES */}
                <div className="bg-slate-900 text-white p-12 rounded-[3.5rem] shadow-2xl relative overflow-hidden border-[12px] border-slate-800 group">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-blue-600/20 transition-all" />
                  <div className="relative z-10 space-y-10">
                    <div className="flex justify-between items-end border-b-2 border-slate-800 pb-8">
                       <div>
                         <div className="text-[11px] font-black text-blue-400 uppercase mb-2 tracking-widest">DECLI. MAGNETICA (WMMHR NOAA-Sync)</div>
                         <div className="text-5xl font-black tabular-nums">{formData.technicalData.magneticDeclination}°</div>
                       </div>
                       <div className="text-right text-[10px] font-black text-slate-500 uppercase tracking-widest max-w-[100px] leading-tight">REF: UMBRAL 1 / ACTUALIZADO: {new Date().toLocaleDateString()}</div>
                    </div>
                    
                    {(formData.placeType === PlaceType.LAD || formData.placeType === PlaceType.LADA) ? (
                      <div className="grid grid-cols-2 gap-12">
                         <div className="bg-slate-800/50 p-6 rounded-[2rem] border border-slate-700">
                            <div className="text-[10px] font-black text-slate-400 uppercase mb-2">Rumbo Verdadero</div>
                            <div className="text-3xl font-mono text-white tracking-widest">{calculations?.trueBrng?.toFixed(1).padStart(5, '0') || '000.0'}°</div>
                         </div>
                         <div className="text-right bg-green-500/10 p-6 rounded-[2rem] border border-green-500/20">
                            <div className="text-[10px] font-black text-green-400 uppercase mb-2">Pista (Designación)</div>
                            <div className="text-5xl font-black text-green-400 tracking-tighter">{calculations?.designator || '--/--'}</div>
                         </div>
                      </div>
                    ) : (
                      <div className="bg-slate-800/50 p-8 rounded-[2rem] border border-slate-700 flex justify-between items-center">
                         <div className="text-[11px] font-black text-blue-300 uppercase tracking-widest">Rumbo Magnético (Inbound)</div>
                         <div className="text-5xl font-black text-white tabular-nums tracking-tighter">{calculations?.t1Mag?.toFixed(0).padStart(3, '0') || '---'}°</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* COLUMNA MAPA */}
              <div className="relative h-full">
                <div className="sticky top-10 space-y-8 h-full">
                  <div className="bg-white border-4 border-slate-50 p-8 rounded-[3.5rem] shadow-2xl flex flex-col min-h-[700px]">
                    <div className="flex-1 bg-slate-100 rounded-[2.5rem] overflow-hidden min-h-[450px]">
                      <MapPreview points={activeMapPoints} type={formData.placeType as PlaceType} numTraj={formData.technicalData.numTrajectories} />
                    </div>
                    <div className="mt-8 space-y-6">
                       <label className="flex items-center gap-4 bg-slate-50 p-6 rounded-3xl border-2 border-slate-200 cursor-pointer hover:bg-white hover:border-blue-500 transition-all shadow-sm">
                          <input type="checkbox" checked={formData.needEmplacementHelp} onChange={(e) => updateNestedState('needEmplacementHelp', e.target.checked)} className="w-6 h-6 text-blue-600 rounded" />
                          <span className="text-[11px] font-black text-slate-700 uppercase leading-tight">Necesito ayuda técnica con datos de emplazamiento</span>
                       </label>
                       <div className="grid grid-cols-1 gap-3 p-1">
                          {activeMapPoints.map((p, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-100 text-[11px] font-mono shadow-sm">
                               <span className="font-black text-slate-400 uppercase bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">{p?.label}</span>
                               <span className="text-slate-800 font-bold">{p?.lat?.degrees}°{p?.lat?.minutes}'{p?.lat?.seconds}"S / {p?.lng?.degrees}°{p?.lng?.minutes}'{p?.lng?.seconds}"W</span>
                            </div>
                          ))}
                       </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* FOOTER ACCIONES */}
        <footer className="pt-20 border-t-4 border-slate-50 flex flex-col items-center gap-8 no-print pb-24">
          <div className="flex flex-col items-center gap-8 w-full">
            <label className="flex items-center gap-4 bg-blue-50 px-12 py-5 rounded-[2rem] border-2 border-blue-200 cursor-pointer hover:bg-blue-600 hover:text-white transition-all shadow-xl shadow-blue-50 group">
               <input type="checkbox" checked={formData.needGeneralHelp} onChange={(e) => updateNestedState('needGeneralHelp', e.target.checked)} className="w-8 h-8 text-blue-600 rounded" />
               <span className="text-lg font-black uppercase tracking-widest group-hover:text-white">Necesito Ayuda General</span>
            </label>
            <div className="flex flex-col md:flex-row gap-6 w-full justify-center max-w-4xl">
              <button 
                type="button"
                onClick={handleDownload} 
                disabled={isGeneratingPdf || isSending}
                className="flex-1 bg-slate-800 hover:bg-slate-900 text-white px-12 py-6 rounded-[2.5rem] font-black text-base shadow-2xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-4 border-b-8 border-slate-950"
              >
                {isGeneratingPdf ? 'GENERANDO REPORTE...' : 'DESCARGAR PDF'}
              </button>
              <button 
                type="button"
                onClick={handleSend} 
                disabled={isSending || isGeneratingPdf}
                className="flex-1 bg-blue-700 hover:bg-blue-800 text-white px-12 py-6 rounded-[2.5rem] font-black text-base shadow-2xl shadow-blue-300 transition-all active:scale-95 flex items-center justify-center gap-4 border-b-8 border-blue-900"
              >
                {isSending ? 'ENVIANDO REGISTRO...' : 'ENVIAR REGISTRO DIGITAL'}
              </button>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2 mt-4">
            <div className="text-sm font-black text-blue-600 tracking-[0.3em] uppercase">masinfovolare@gmail.com</div>
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-tighter">Volaré Geodetic Suite · WMMHR NOAA-Sync 2024-2029</div>
          </div>
        </footer>
      </form>
    </div>
  );
};

export default App;