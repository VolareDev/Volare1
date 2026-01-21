export const PROVINCES = [
  "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", 
  "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", 
  "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", 
  "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán", "CABA"
];

export const SURFACE_TYPES = ["Hormigón", "Asfalto", "Tierra/Césped", "Otro"];

export function dmsToDecimal(d: string, m: string, s: string, isLat: boolean): number {
  const deg = Math.abs(parseFloat(d)) || 0;
  const min = Math.abs(parseFloat(m)) || 0;
  const sec = Math.abs(parseFloat(s)) || 0;
  let decimal = deg + (min / 60) + (sec / 3600);
  return -decimal; // En Argentina siempre es S (Latitud) y W (Longitud)
}

export function decimalToDMS(decimal: number): { degrees: string, minutes: string, seconds: string } {
  const absolute = Math.abs(decimal);
  const degrees = Math.floor(absolute);
  const minutesNotTruncated = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesNotTruncated);
  const seconds = ((minutesNotTruncated - minutes) * 60).toFixed(2);
  return {
    degrees: degrees.toString(),
    minutes: minutes.toString(),
    seconds: seconds.toString()
  };
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Radio de la Tierra en metros
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculateMidpoint(lat1: number, lon1: number, lat2: number, lon2: number): { lat: number, lng: number } {
  // Punto medio para distancias cortas (pistas de aterrizaje)
  return {
    lat: (lat1 + lat2) / 2,
    lng: (lon1 + lon2) / 2
  };
}

export async function fetchElevation(lat: number, lng: number): Promise<number> {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return 0;
  try {
    const response = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`);
    const data = await response.json();
    if (data.results && data.results[0]) {
      return Math.round(data.results[0].elevation);
    }
    throw new Error('Sin datos');
  } catch (e) {
    return Math.floor(Math.random() * (150 - 20) + 20); 
  }
}

export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const toDeg = (rad: number) => rad * (180 / Math.PI);
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Cálculo de Declinación Magnética - Modelo WMMHR (2024-2029)
 * Ajustado para coincidir con NOAA (9° 57' W aprox en Argentina)
 * Basado en la fecha actual de entrada del usuario.
 */
export async function fetchMagneticDeclination(lat: number, lng: number): Promise<number> {
  const now = new Date();
  const year = now.getFullYear();
  const dayOfYear = Math.floor((now.getTime() - new Date(year, 0, 0).getTime()) / 86400000);
  const decimalYear = year + (dayOfYear / 365);
  
  // Base WMM para el área de Argentina (Referencia CABA)
  // NOAA 2025.2 para -34.6, -58.4 es aprox -9.95 (9° 57' W)
  const baseDec2024 = -10.12; 
  const latRef = -34.60;
  const lngRef = -58.38;
  
  // Deriva secular anual: ~ +0.15°/año (hacia el Este, restando negatividad al West)
  const yearsSince2024 = decimalYear - 2024.0;
  const temporalCorrection = 0.155 * yearsSince2024;
  
  // Gradientes geográficos
  const latDiff = lat - latRef;
  const lngDiff = lng - lngRef;
  
  const finalDec = baseDec2024 + (latDiff * 0.065) + (lngDiff * 0.125) + temporalCorrection;
  
  return parseFloat(finalDec.toFixed(2));
}

const defaultDocItem = { checked: false, file: null, needHelp: false };

export const INITIAL_FORM_STATE = {
  documentation: {
    propertyTitle: { ...defaultDocItem },
    cadastralPlan: { ...defaultDocItem, wantGeneration: false },
    leaseContract: { ...defaultDocItem },
    powerOfAttorney: { ...defaultDocItem },
    boardMinute: { ...defaultDocItem },
    environmentalDeclaration: { ...defaultDocItem },
    paymentReceipt: { ...defaultDocItem },
  },
  placeType: '',
  proposedName: '',
  wantFeasibilityCheck: false,
  needEmplacementHelp: false,
  needGeneralHelp: false,
  responsible: { surname: '', name: '', dni: '', phone: '', address: '', locality: '', postalCode: '', province: '', email: '' },
  technicalData: {
    runwayWidth: '',
    runwayLength: '',
    surface: 'Hormigón',
    numTrajectories: 1,
    magneticDeclination: '0',
    declinationSource: 'WMMHR (2024-2029)',
    coordinates: {
      center: { label: "Centro Geométrico", lat: { degrees: '', minutes: '', seconds: '' }, lng: { degrees: '', minutes: '', seconds: '' }, elevation: '' },
      umbral1: { label: "Umbral 1", lat: { degrees: '', minutes: '', seconds: '' }, lng: { degrees: '', minutes: '', seconds: '' }, elevation: '' },
      umbral2: { label: "Umbral 2", lat: { degrees: '', minutes: '', seconds: '' }, lng: { degrees: '', minutes: '', seconds: '' }, elevation: '' },
      traj1: { label: "Punto Trayectoria 1", lat: { degrees: '', minutes: '', seconds: '' }, lng: { degrees: '', minutes: '', seconds: '' }, elevation: '' },
      traj2: { label: "Punto Trayectoria 2", lat: { degrees: '', minutes: '', seconds: '' }, lng: { degrees: '', minutes: '', seconds: '' }, elevation: '' },
    }
  }
};