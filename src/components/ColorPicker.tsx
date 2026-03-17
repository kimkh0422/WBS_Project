import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  hexToHsv,
  hsvToHex,
  hexToRgb,
  rgbToHex,
  hsvToRgb,
  type Hsv,
} from '../lib/colorPickerUtils';

const PICKER_SIZE = 220;
const SLIDER_HEIGHT = 12;

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  /** 픽셀 단위. 기본 220 */
  size?: number;
  className?: string;
}

export function ColorPicker({ value, onChange, size = PICKER_SIZE, className = '' }: ColorPickerProps) {
  const hex = value.startsWith('#') ? value : `#${value}`;
  const initialHsv = hexToHsv(hex);
  const [hsv, setHsv] = useState<Hsv>(initialHsv ?? { h: 0, s: 1, v: 1 });
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const isDraggingSv = useRef(false);
  const isDraggingHue = useRef(false);

  useEffect(() => {
    const next = hexToHsv(hex);
    if (next && (next.h !== hsv.h || next.s !== hsv.s || next.v !== hsv.v)) {
      setHsv(next);
    }
  }, [hex]);

  const updateFromHsv = useCallback(
    (next: Hsv) => {
      setHsv(next);
      onChange(hsvToHex(next.h, next.s, next.v));
    },
    [onChange]
  );

  const rgb = (() => {
    const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  })();

  const handleSvMove = useCallback(
    (clientX: number, clientY: number) => {
      const el = svRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      updateFromHsv({ ...hsv, s: x, v: 1 - y });
    },
    [hsv, updateFromHsv]
  );

  const handleHueMove = useCallback(
    (clientX: number) => {
      const el = hueRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      updateFromHsv({ ...hsv, h: x * 360 });
    },
    [hsv, updateFromHsv]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isDraggingSv.current) handleSvMove(e.clientX, e.clientY);
      else if (isDraggingHue.current) handleHueMove(e.clientX);
    };
    const onMouseUp = () => {
      isDraggingSv.current = false;
      isDraggingHue.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [handleSvMove, handleHueMove]);

  const hueColor = hsvToHex(hsv.h, 1, 1);

  return (
    <div className={className} style={{ width: size }}>
      {/* Saturation / Value square */}
      <div
        ref={svRef}
        className="relative rounded-lg border border-stone-200 overflow-hidden cursor-crosshair select-none"
        style={{
          height: size,
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueColor}`,
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          isDraggingSv.current = true;
          handleSvMove(e.clientX, e.clientY);
        }}
      >
        <div
          className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md pointer-events-none"
          style={{
            left: hsv.s * (size - 16),
            top: (1 - hsv.v) * (size - 16),
            background: hsvToHex(hsv.h, hsv.s, hsv.v),
          }}
        />
      </div>

      {/* Hue slider */}
      <div className="mt-2 relative" style={{ height: SLIDER_HEIGHT + 8 }}>
        <div
          ref={hueRef}
          className="absolute inset-0 rounded-full border border-stone-200 overflow-visible cursor-pointer select-none"
          style={{
            height: SLIDER_HEIGHT,
            top: 4,
            background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            isDraggingHue.current = true;
            handleHueMove(e.clientX);
          }}
        >
          <div
            className="absolute w-4 h-4 rounded-full border-2 border-white shadow pointer-events-none -translate-y-1/2"
            style={{
              left: `calc(${(hsv.h / 360) * 100}% - 8px)`,
              top: '50%',
              background: hueColor,
            }}
          />
        </div>
      </div>

      {/* RGB inputs */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] font-bold text-stone-500 w-5">R</span>
        <input
          type="number"
          min={0}
          max={255}
          value={rgb.r}
          onChange={(e) => {
            const r = Math.max(0, Math.min(255, Number(e.target.value)));
            const prev = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
            onChange(rgbToHex(r, prev.g, prev.b));
          }}
          className="w-12 input-field py-1 text-xs text-right"
        />
        <span className="text-[10px] font-bold text-stone-500 w-5">G</span>
        <input
          type="number"
          min={0}
          max={255}
          value={rgb.g}
          onChange={(e) => {
            const g = Math.max(0, Math.min(255, Number(e.target.value)));
            const prev = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
            onChange(rgbToHex(prev.r, g, prev.b));
          }}
          className="w-12 input-field py-1 text-xs text-right"
        />
        <span className="text-[10px] font-bold text-stone-500 w-5">B</span>
        <input
          type="number"
          min={0}
          max={255}
          value={rgb.b}
          onChange={(e) => {
            const b = Math.max(0, Math.min(255, Number(e.target.value)));
            const prev = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
            onChange(rgbToHex(prev.r, prev.g, b));
          }}
          className="w-12 input-field py-1 text-xs text-right"
        />
      </div>

      {/* Preview bar */}
      <div
        className="mt-2 rounded-lg border border-stone-200 h-8"
        style={{ backgroundColor: hex }}
      />
    </div>
  );
}
