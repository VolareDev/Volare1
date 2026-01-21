
import React from 'react';
import { DMSCoordinate } from '../types';

interface CoordinateInputProps {
  label: string;
  value?: DMSCoordinate;
  onChange: (field: keyof DMSCoordinate, val: string) => void;
  suffix: string;
  disabled?: boolean;
}

const CoordinateInput: React.FC<CoordinateInputProps> = ({ label, value, onChange, suffix, disabled }) => {
  if (!value) return null;
  
  return (
    <div className={`flex flex-col gap-1 ${disabled ? 'opacity-70' : ''}`}>
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          placeholder="00"
          value={value.degrees || ''}
          disabled={disabled}
          onChange={(e) => onChange('degrees', e.target.value)}
          className="w-12 border rounded px-1 py-1 text-sm focus:ring-1 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-50 disabled:cursor-not-allowed"
        />
        <span className="text-sm font-bold">°</span>
        <input
          type="number"
          placeholder="00"
          value={value.minutes || ''}
          disabled={disabled}
          onChange={(e) => onChange('minutes', e.target.value)}
          className="w-12 border rounded px-1 py-1 text-sm focus:ring-1 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-50 disabled:cursor-not-allowed"
        />
        <span className="text-sm font-bold">'</span>
        <input
          type="number"
          step="0.1"
          placeholder="00.0"
          value={value.seconds || ''}
          disabled={disabled}
          onChange={(e) => onChange('seconds', e.target.value)}
          className="w-16 border rounded px-1 py-1 text-sm focus:ring-1 focus:ring-blue-500 outline-none bg-white disabled:bg-slate-50 disabled:cursor-not-allowed"
        />
        <span className="text-sm font-bold">"</span>
        <span className="text-sm font-bold text-slate-400 uppercase">{suffix}</span>
      </div>
    </div>
  );
};

export default CoordinateInput;
