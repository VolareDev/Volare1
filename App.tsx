
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
  const [isFetchingDeclination, setIsFetchingDeclination] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const elevationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

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

  // AUTO CALCULATIONS
  const u1Coords = JSON.stringify(formData.technicalData.coordinates.umbral1);
  const u2Coords = JSON.stringify(formData.technicalData.coordinates.umbral2);
  const centerCoords = JSON.stringify(formData.technicalData.coordinates.center);

  useEffect(() => {
    const { umbral1, umbral2 } = formData.technicalData.coordinates;
    const isLAD = formData.placeType === PlaceType.LAD;

    if (isLAD && umbral1.lat.degrees && umbral1.lng.degrees && umbral2.lat.degrees && umbral2.lng.degrees) {
      const lat1 = dmsToDecimal(umbral1.lat.degrees, umbral1.lat.minutes, umbral1.lat.seconds, true);
      const lon1 = dmsToDecimal(umbral1.lng.degrees, umbral1.lng.minutes, umbral1.lng.seconds, false);
      const lat2 = dmsToDecimal(umbral2.lat.degrees, umbral2.lat.minutes, umbral2.lat.seconds, true);
      const lon2 = dmsToDecimal(umbral2.lng.degrees, umbral2.lng.minutes, umbral2.lng.seconds, false);

      const distance = calculateDistance(lat1, lon1, lat2, lon2);
      const mid = calculateMidpoint(lat1, lon1, lat2, lon2);
      const midLat = decimalToDMS(mid.lat);
      const midLng = decimalToDMS(mid.lng);
      
      setFormData(prev => ({
        ...prev,
        technicalData: {
          ...prev.technicalData,
          runwayLength: distance.toFixed(0),
          coordinates: { ...prev.technicalData.coordinates, center: { ...prev.technicalData.coordinates.center, lat: midLat, lng: midLng } }
        }
      }));
    }

    if (elevationTimeoutRef.current) clearTimeout(elevationTimeoutRef.current);
    elevationTimeoutRef.current = setTimeout(() => {
        const c = formData.technicalData.coordinates.center;
        if (c.lat.degrees && c.lng.degrees) {
            const clat = dmsToDecimal(c.lat.degrees, c.lat.minutes, c.lat.seconds, true);
            const clng = dmsToDecimal(c.lng.degrees, c.lng.minutes, c.lng.seconds, false);
            setIsFetchingDeclination(true);
            Promise.all([
                fetchMagneticDeclination(clat, clng),
                fetchElevation(clat, clng)
            ]).then(([dec, elev]) => {
                setFormData(prev => ({
                    ...prev,
                    technicalData: {
                        ...prev.technicalData,
                        magneticDeclination: dec.toFixed(2),
                        declinationSource: 'NOAA WMM Est.',
                        coordinates: { ...prev.technicalData.coordinates, center: { ...prev.technicalData.coordinates.center, elevation: elev.toFixed(1) } }
                    }
                }));
                setIsFetchingDeclination(false);
            });
        }
    }, 1000);

    return () => { if (elevationTimeoutRef.current) clearTimeout(elevationTimeoutRef.current); };
  }, [u1Coords, u2Coords, centerCoords, formData.placeType]);

  const activeMapPoints = useMemo(() => {
    const points: GeolocationPoint[] = [];
    const coords = formData.technicalData?.coordinates;
    const { umbral1, umbral2, center, traj1, traj2 } = coords;
    
    if (formData.placeType === PlaceType.LAD) {
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
    const { umbral1, umbral2, center, traj1, traj2 } = tech.coordinates;
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
        const t1True = calculateBearing(t1lat, t1lng, clat, clng); // Inbound
        t1Mag = (t1True - declination + 360) % 360;
      }

      let t2Mag = null;
      if (tech.numTrajectories === 2 && traj2.lat.degrees) {
        const t2lat = dmsToDecimal(traj2.lat.degrees, traj2.lat.minutes, traj2.lat.seconds, true);
        const t2lng = dmsToDecimal(traj2.lng.degrees, traj2.lng.minutes, traj2.lng.seconds, false);
        const t2True = calculateBearing(t2lat, t2lng, clat, clng); // Inbound
        t2Mag = (t2True - declination + 360) % 360;
      }
      return { t1Mag, t2Mag, declination };
    }

    return null;
  }, [formData.technicalData.coordinates, formData.technicalData.magneticDeclination, formData.placeType, formData.technicalData.numTrajectories]);

  const handleSubmit = () => {
    alert("El registro se procesará y enviará a masinfovolare@gmail.com con la información adjunta.");
  };

  const handleDownload = async () => {
    if (!formRef.current) return;
    setIsGeneratingPdf(true);
    
    try {
      const canvas = await (window as any).html2canvas(formRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new (window as any).jspdf.jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Registro_LAD_${formData.proposedName || 'Lugar'}.pdf`);
      handleSubmit(); // Also trigger the alert
    } catch (error) {
      console.error("PDF Generation failed", error);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div ref={formRef} className="max-w-6xl mx-auto p-4 md:p-8 space-y-8 bg-white shadow-2xl min-h-screen my-4 md:my-10 rounded-none md:rounded-[2.5rem] border border-slate-100 overflow-hidden">
      <header className="flex flex-col border-b border-slate-100 pb-8 gap-4 no-print">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
              <span className="bg-blue-600 text-white text-[10px] px-3 py-1 rounded-full font-black tracking-widest uppercase">Sistema LAD-Online</span>
              <span className="text-slate-300 text-[10px] font-mono">v5.0.0</span>
            </div>
            <h1 className="text-4xl font-black text-slate-800 tracking-tighter leading-none">REGISTRO DE LUGARES APTOS</h1>
            <p className="text-blue-600 font-black text-xl mt-1">Volaré. Resolvé sin vuelta.</p>
          </div>
        </div>
        <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
           <p className="text-slate-600 font-medium italic text-sm">
             Este es un desarrollo gratuito de Volaré, pensado en vos para ayudarte a tener tu lugar de vuelo, según requisitos de la Administracion de Aviación Civil Argentina (ANAC).
           </p>
           <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-4">
             <div className="flex-1">
               <p className="text-xs font-black text-slate-800 uppercase tracking-tight">
                 <span className="text-red-500">Importante!</span> Esto es solo documental, el análisis de si es factible la ubicación esta en desarrollo. Al momento te podemos ayudar a verificarlo:
               </p>
             </div>
             <label className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-blue-200 cursor-pointer hover:bg-blue-50 transition-all">
                <input type="checkbox" checked={formData.wantFeasibilityCheck} onChange={(e) => updateNestedState('wantFeasibilityCheck', e.target.checked)} className="w-5 h-5 text-blue-600 rounded" />
                <span className="text-xs font-black text-blue-700 uppercase">Quiero que me digan si es factible</span>
             </label>
           </div>
        </div>
      </header>

      <form className="space-y-16" onSubmit={(e) => e.preventDefault()}>
        {/* 1) Documentación */}
        <section className="space-y-6">
          <div className="flex items-center gap-4 border-l-4 border-blue-600 pl-4">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">1. Documentación Respaldatoria</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 ml-0 md:ml-6">
            
            {/* 1. Titulo de propiedad */}
            <div className="p-4 bg-white rounded-3xl border-2 border-slate-50 hover:border-blue-100 transition-all flex flex-col gap-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-600">1. Título de Propiedad *</span>
                <div className={`w-3 h-3 rounded-full ${formData.documentation.propertyTitle.checked ? 'bg-green-500' : 'bg-slate-200'}`} />
              </div>
              <label className="flex items-center justify-center w-full h-16 border-2 border-dashed border-slate-200 rounded-2xl hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer group">
                <div className="text-center px-4">
                  <p className="text-[10px] font-black text-slate-400 group-hover:text-blue-600 uppercase tracking-widest truncate max-w-[200px]">
                    {formData.documentation.propertyTitle.file ? formData.documentation.propertyTitle.file.name : 'Adjuntar'}
                  </p>
                </div>
                <input type="file" className="hidden" onChange={(e) => handleFileChange('propertyTitle', e.target.files?.[0] || null)} />
              </label>
              <label className="flex items-center gap-2 mt-auto cursor-pointer">
                <input type="checkbox" checked={formData.documentation.propertyTitle.needHelp} onChange={(e) => handleHelpToggle('propertyTitle', e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
                <span className="text-[10px] font-black text-slate-500 uppercase">Necesito ayuda</span>
              </label>
            </div>

            {/* 2. Plano */}
            <div className="p-6 bg-slate-50 rounded-[2rem] border-2 border-slate-100 flex flex-col gap-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-slate-700">2. Plano Catastral o de ubicación según título *</span>
                <div className={`w-3 h-3 rounded-full ${formData.documentation.cadastralPlan.checked ? 'bg-green-500' : 'bg-slate-200'}`} />
              </div>
              <div className="grid grid-cols-1 gap-4">
                <label className={`flex items-center justify-center w-full h-16 border-2 border-dashed rounded-2xl transition-all cursor-pointer ${formData.documentation.cadastralPlan.wantGeneration ? 'border-slate-200 bg-slate-100/50 opacity-40' : 'border-slate-300 hover:border-blue-500 bg-white'}`}>
                  <div className="text-center px-4">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest truncate max-w-[200px]">
                      {formData.documentation.cadastralPlan.file ? formData.documentation.cadastralPlan.file.name : 'Adjuntar'}
                    </p>
                  </div>
                  <input type="file" className="hidden" disabled={formData.documentation.cadastralPlan.wantGeneration} onChange={(e) => handleFileChange('cadastralPlan', e.target.files?.[0] || null)} />
                </label>
                <div className="bg-white p-4 rounded-2xl border border-slate-200">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="mt-1 w-5 h-5 text-blue-600 rounded" checked={formData.documentation.cadastralPlan.wantGeneration} onChange={(e) => handlePlanGenerationToggle(e.target.checked)} />
                    <div>
                      <p className="text-xs font-black text-slate-800 uppercase">Quiero que generen el plano</p>
                      <p className="text-[10px] text-slate-500 font-bold mt-0.5">
                        Valor: <span className="line-through text-slate-400">U$D 289</span> <span className="text-blue-600">USD $174</span>
                      </p>
                    </div>
                  </label>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.documentation.cadastralPlan.needHelp} onChange={(e) => handleHelpToggle('cadastralPlan', e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
                  <span className="text-[10px] font-black text-slate-500 uppercase">Necesito ayuda</span>
                </label>
              </div>
            </div>

            {[
              { id: 'environmentalDeclaration', label: 'Declaración Jurada Ambiental (Ley 25.675) *' },
              { id: 'paymentReceipt', label: 'Comprobante pago Arancel A.D.1.9 *' },
              { id: 'leaseContract', label: 'Contrato de Locación' },
              { id: 'powerOfAttorney', label: 'Poder Legal' },
              { id: 'boardMinute', label: 'Acta de Directorio' }
            ].map((item) => (
              <div key={item.id} className="p-4 bg-white rounded-3xl border-2 border-slate-50 hover:border-blue-100 transition-all flex flex-col gap-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-600">{item.label}</span>
                  <div className={`w-3 h-3 rounded-full ${(formData.documentation as any)?.[item.id]?.checked ? 'bg-green-500' : 'bg-slate-200'}`} />
                </div>
                <label className="flex items-center justify-center w-full h-16 border-2 border-dashed border-slate-200 rounded-2xl hover:border-blue-400 hover:bg-blue-50/30 transition-all cursor-pointer group">
                  <div className="text-center px-4">
                    <p className="text-[10px] font-black text-slate-400 group-hover:text-blue-600 uppercase tracking-widest truncate max-w-[200px]">
                      {(formData.documentation as any)?.[item.id]?.file ? (formData.documentation as any)[item.id].file.name : 'Adjuntar'}
                    </p>
                  </div>
                  <input type="file" className="hidden" onChange={(e) => handleFileChange(item.id, e.target.files?.[0] || null)} />
                </label>
                <label className="flex items-center gap-2 cursor-pointer mt-auto">
                  <input type="checkbox" checked={(formData.documentation as any)?.[item.id]?.needHelp} onChange={(e) => handleHelpToggle(item.id, e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
                  <span className="text-[10px] font-black text-slate-500 uppercase">Necesito ayuda</span>
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
              <label key={type} className={`p-6 rounded-[2rem] border-4 cursor-pointer transition-all flex flex-col items-center gap-2 text-center ${formData.placeType === type ? 'border-blue-600 bg-blue-50' : 'border-slate-50 bg-white hover:border-slate-200'}`}>
                <input type="radio" name="placeType" value={type} checked={formData.placeType === type} onChange={(e) => updateNestedState('placeType', e.target.value)} className="w-5 h-5 text-blue-600" />
                <div className="text-2xl font-black text-slate-800 tracking-tighter">{type}</div>
                <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{type === 'LAD' ? 'Aviones' : type === 'LADH' ? 'Helicópteros' : 'Aeróstatos'}</div>
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
             <div className="ml-6 p-16 border-4 border-dashed border-slate-100 rounded-[3rem] text-center text-slate-300 font-black uppercase tracking-[0.2em] text-sm bg-slate-50/50">
               Seleccione Clasificación
             </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 ml-0 md:ml-6">
              <div className="space-y-10">
                
                {/* SUPERFICIE (Ahora para todos) */}
                <div className="p-8 bg-slate-50 rounded-[2.5rem] border-2 border-slate-100 space-y-4">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo de Superficie *</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {SURFACE_TYPES.map(s => (
                      <button key={s} type="button" onClick={() => updateNestedState('technicalData.surface', s)} className={`p-3 text-[10px] font-black uppercase rounded-xl border-2 transition-all ${formData.technicalData.surface === s ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-white bg-white text-slate-400 hover:border-slate-200'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* LAD / LADA: Umbrales y dimensiones */}
                {(formData.placeType === PlaceType.LAD || formData.placeType === PlaceType.LADA) && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="p-6 bg-white rounded-3xl border-2 border-blue-100 shadow-sm">
                        <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest block mb-2">Ancho (m) *</label>
                        <input type="number" placeholder="0.0" value={formData.technicalData.runwayWidth} onChange={(e) => updateNestedState('technicalData.runwayWidth', e.target.value)} className="w-full text-2xl font-black text-slate-800 bg-transparent outline-none border-b-2 border-blue-100 focus:border-blue-600"/>
                      </div>
                      <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Largo (m)</label>
                        <div className="text-2xl font-black text-slate-800">{formData.technicalData.runwayLength || '--'} m</div>
                      </div>
                    </div>

                    {(['umbral1', 'umbral2'] as const).map((key) => {
                      const p = formData.technicalData?.coordinates?.[key];
                      return (
                        <div key={key} className="p-8 rounded-[2.5rem] border-2 border-slate-100 bg-white space-y-8 shadow-sm">
                          <div className="flex justify-between items-center">
                            <h3 className="font-black text-slate-800 text-sm uppercase tracking-widest">{p.label}</h3>
                            <div className="text-right">
                               <label className="text-[10px] font-black text-slate-400 uppercase">Elevación (m)</label>
                               <div className="text-lg font-black text-blue-600">{p.elevation || '--'} m</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                            <CoordinateInput label="Latitud" value={p.lat} onChange={(f, v) => handleCoordChange(key, 'lat', f as any, v)} suffix="S" />
                            <CoordinateInput label="Longitud" value={p.lng} onChange={(f, v) => handleCoordChange(key, 'lng', f as any, v)} suffix="W" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* LADH: FATO */}
                {formData.placeType === PlaceType.LADH && (
                  <div className="space-y-8 p-8 bg-slate-50 rounded-[2.5rem] border-2 border-slate-100">
                    <h3 className="font-black text-slate-800 text-sm uppercase tracking-widest">Dimensiones de FATO</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase">Largo (m) *</label>
                        <input type="number" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3 font-black" value={formData.technicalData.runwayLength} onChange={(e) => updateNestedState('technicalData.runwayLength', e.target.value)} />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase">Ancho (m) *</label>
                        <input type="number" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3 font-black" value={formData.technicalData.runwayWidth} onChange={(e) => updateNestedState('technicalData.runwayWidth', e.target.value)} />
                      </div>
                    </div>
                  </div>
                )}

                {/* CENTRO GEOMÉTRICO */}
                <div className="p-8 rounded-[2.5rem] border-4 border-blue-100 bg-blue-50/20 space-y-8 relative overflow-hidden">
                  <div className="flex justify-between items-center relative z-10">
                    <h3 className="font-black text-blue-900 text-sm uppercase tracking-widest">Punto de Referencia (Centro)</h3>
                    <div className="text-right">
                       <label className="text-[10px] font-black text-blue-800 uppercase">Elevación (m)</label>
                       <div className="text-lg font-black text-blue-900">{formData.technicalData.coordinates.center.elevation || '--'} m</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 relative z-10">
                    <CoordinateInput label="Latitud" disabled={formData.placeType === PlaceType.LAD} value={formData.technicalData.coordinates.center.lat} onChange={(f, v) => handleCoordChange('center', 'lat', f as any, v)} suffix="S" />
                    <CoordinateInput label="Longitud" disabled={formData.placeType === PlaceType.LAD} value={formData.technicalData.coordinates.center.lng} onChange={(f, v) => handleCoordChange('center', 'lng', f as any, v)} suffix="W" />
                  </div>
                </div>

                {/* LADH: TRAYECTORIAS */}
                {formData.placeType === PlaceType.LADH && (
                   <div className="space-y-8">
                     <div className="p-8 bg-blue-900 text-white rounded-[2.5rem] space-y-4">
                        <div className="flex justify-between items-center">
                          <h3 className="font-black text-sm uppercase tracking-widest">Trayectorias - Cantidad</h3>
                          <div className="flex gap-2 bg-blue-800 p-1 rounded-xl">
                            {[1, 2].map(n => (
                              <button key={n} type="button" onClick={() => updateNestedState('technicalData.numTrajectories', n)} className={`px-4 py-2 rounded-lg text-xs font-black ${formData.technicalData.numTrajectories === n ? 'bg-white text-blue-900 shadow-lg' : 'text-blue-200 hover:bg-blue-700'}`}>
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                     </div>
                     
                     <div className="space-y-6">
                        {(['traj1', 'traj2'] as const).map((key, i) => {
                          if (i === 1 && formData.technicalData.numTrajectories === 1) return null;
                          const isSingle = formData.technicalData.numTrajectories === 1;
                          return (
                            <div key={key} className="p-8 bg-white border-2 border-slate-100 rounded-[2.5rem] space-y-6 shadow-sm">
                               <div>
                                 <h4 className="font-black text-xs uppercase tracking-widest text-slate-800">
                                   {isSingle ? 'Trayectoria ÚNICA' : `Trayectoria ${i+1}`}
                                 </h4>
                                 <p className="text-[10px] text-slate-400 font-bold leading-tight mt-1 italic">
                                   Nota: Coordenadas de punto cualquiera en el eje de aproximación, se calcula automáticamente
                                 </p>
                               </div>
                               <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                                  <CoordinateInput label="Latitud" value={formData.technicalData.coordinates[key].lat} onChange={(f, v) => handleCoordChange(key, 'lat', f as any, v)} suffix="S" />
                                  <CoordinateInput label="Longitud" value={formData.technicalData.coordinates[key].lng} onChange={(f, v) => handleCoordChange(key, 'lng', f as any, v)} suffix="W" />
                               </div>
                            </div>
                          );
                        })}
                     </div>
                   </div>
                )}

                {/* RESULTADOS TÉCNICOS */}
                <div className="bg-slate-900 text-white p-10 rounded-[3rem] shadow-2xl relative overflow-hidden border-8 border-slate-800">
                  <div className="relative z-10 space-y-8">
                    <div className="flex justify-between items-end border-b border-slate-800 pb-6">
                       <div>
                         <div className="text-[10px] font-black text-blue-400 uppercase mb-1 tracking-widest">VAR MAGNETICA</div>
                         <div className="text-3xl font-black">{formData.technicalData.magneticDeclination}°</div>
                       </div>
                       <div className="text-right text-[10px] font-bold text-slate-500 uppercase tracking-widest">SISTEMA WMM-NOAA</div>
                    </div>
                    
                    {(formData.placeType === PlaceType.LAD || formData.placeType === PlaceType.LADA) ? (
                      <div className="grid grid-cols-2 gap-10">
                         <div>
                            <div className="text-[10px] font-black text-slate-500 uppercase mb-2">Rumbo Verdadero</div>
                            <div className="text-2xl font-mono text-white">{calculations?.trueBrng?.toFixed(1) || '000.0'}°</div>
                         </div>
                         <div className="text-right">
                            <div className="text-[10px] font-black text-green-400 uppercase mb-2">Pista (Designación)</div>
                            <div className="text-4xl font-black text-green-400">{calculations?.designator || '--/--'}</div>
                         </div>
                      </div>
                    ) : formData.placeType === PlaceType.LADH ? (
                      <div className="space-y-6">
                        <div className="flex justify-between items-center bg-slate-800/50 p-6 rounded-3xl border border-slate-700">
                           <div className="text-[10px] font-black text-blue-300 uppercase tracking-widest">Trayectoria 1: Rumbo Magnético</div>
                           <div className="text-3xl font-black text-white">{calculations?.t1Mag?.toFixed(0).padStart(3, '0') || '---'}°</div>
                        </div>
                        {formData.technicalData.numTrajectories === 2 && (
                          <div className="flex justify-between items-center bg-slate-800/50 p-6 rounded-3xl border border-slate-700">
                             <div className="text-[10px] font-black text-blue-300 uppercase tracking-widest">Trayectoria 2: Rumbo Magnético</div>
                             <div className="text-3xl font-black text-white">{calculations?.t2Mag?.toFixed(0).padStart(3, '0') || '---'}°</div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* MAPA */}
              <div className="relative h-full">
                <div className="sticky top-10 space-y-6 h-full">
                  <div className="bg-white border-4 border-slate-50 p-6 rounded-[3rem] shadow-2xl flex flex-col h-[650px]">
                    <div className="flex-1 bg-slate-100 rounded-[2rem] overflow-hidden">
                      <MapPreview points={activeMapPoints} type={formData.placeType as PlaceType} numTraj={formData.technicalData.numTrajectories} />
                    </div>
                    <div className="mt-8 flex flex-col gap-4">
                       <label className="flex items-center gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 cursor-pointer hover:bg-white transition-all">
                          <input type="checkbox" checked={formData.needEmplacementHelp} onChange={(e) => updateNestedState('needEmplacementHelp', e.target.checked)} className="w-5 h-5 text-blue-600 rounded" />
                          <span className="text-xs font-black text-slate-700 uppercase">Necesito ayuda con datos de emplazamiento</span>
                       </label>
                       <div className="grid grid-cols-1 gap-2 overflow-y-auto max-h-32 p-1">
                          {activeMapPoints.map((p, idx) => (
                            <div key={idx} className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100 text-[10px] font-mono">
                               <span className="font-black text-slate-400 uppercase bg-white px-2 py-0.5 rounded shadow-sm">{p?.label}</span>
                               <span className="text-slate-700">{p?.lat?.degrees}°{p?.lat?.minutes}'{p?.lat?.seconds}"S / {p?.lng?.degrees}°{p?.lng?.minutes}'{p?.lng?.seconds}"W</span>
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

        {/* Footer */}
        <footer className="pt-16 border-t-4 border-slate-50 flex flex-col items-center gap-6 no-print pb-20">
          <div className="flex flex-col items-center gap-6 w-full">
            <label className="flex items-center gap-3 bg-blue-50 px-8 py-4 rounded-[1.5rem] border-2 border-blue-100 cursor-pointer hover:bg-blue-100 transition-all">
               <input type="checkbox" checked={formData.needGeneralHelp} onChange={(e) => updateNestedState('needGeneralHelp', e.target.checked)} className="w-6 h-6 text-blue-600 rounded" />
               <span className="text-sm font-black text-blue-800 uppercase tracking-widest">Necesito Ayuda General</span>
            </label>
            
            <div className="flex flex-col md:flex-row gap-4 w-full justify-center">
              <button 
                type="button"
                onClick={handleDownload} 
                disabled={isGeneratingPdf}
                className="bg-slate-800 hover:bg-slate-900 text-white px-16 py-5 rounded-[2rem] font-black text-sm shadow-xl transition-all active:scale-95 flex items-center gap-3 disabled:opacity-50"
              >
                {isGeneratingPdf ? 'GENERANDO...' : 'DESCARGAR PDF'}
              </button>
              
              <button 
                onClick={handleSubmit} 
                className="bg-blue-700 hover:bg-blue-800 text-white px-16 py-5 rounded-[2rem] font-black text-sm shadow-[0_20px_40px_rgba(29,78,216,0.3)] transition-all active:scale-95"
              >
                ENVIAR REGISTRO DIGITAL
              </button>
            </div>
          </div>
          
          <div className="flex flex-col items-center gap-1">
            <div className="text-xs font-black text-blue-600 tracking-widest uppercase">masinfovolare@gmail.com</div>
            <div className="text-[10px] font-bold text-slate-400">Desarrollado por Volaré © 2024</div>
          </div>
        </footer>
      </form>
    </div>
  );
};

export default App;
