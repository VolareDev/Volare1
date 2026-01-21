
export enum PlaceType {
  LAD = 'LAD',
  LADH = 'LADH',
  LADA = 'LADA'
}

export interface DMSCoordinate {
  degrees: string;
  minutes: string;
  seconds: string;
}

export interface GeolocationPoint {
  lat: DMSCoordinate;
  lng: DMSCoordinate;
  elevation: string;
  label: string;
}

export interface DocumentationItem {
  checked: boolean;
  file: File | null;
  needHelp: boolean;
}

export interface FormData {
  documentation: {
    propertyTitle: DocumentationItem;
    cadastralPlan: DocumentationItem & { wantGeneration: boolean };
    leaseContract: DocumentationItem;
    powerOfAttorney: DocumentationItem;
    boardMinute: DocumentationItem;
    environmentalDeclaration: DocumentationItem;
    paymentReceipt: DocumentationItem;
  };
  placeType: PlaceType | '';
  proposedName: string;
  wantFeasibilityCheck: boolean;
  needEmplacementHelp: boolean;
  needGeneralHelp: boolean;
  responsible: {
    surname: string;
    name: string;
    dni: string;
    phone: string;
    address: string;
    locality: string;
    postalCode: string;
    province: string;
    email: string;
  };
  technicalData: {
    runwayWidth: string;
    runwayLength: string;
    surface: string;
    numTrajectories: number;
    magneticDeclination: string;
    declinationSource: string;
    coordinates: {
      umbral1: GeolocationPoint;
      umbral2: GeolocationPoint;
      center: GeolocationPoint;
      traj1: GeolocationPoint;
      traj2: GeolocationPoint;
    };
  };
}
