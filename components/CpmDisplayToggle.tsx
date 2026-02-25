/**
 * CpmDisplayToggle - Toggle between Static and Embedded CPM display types.
 *
 * Allows users to choose how Custom Payment Methods are displayed:
 * - Static: CPM shows name/logo, QR displayed separately below Payment Element
 * - Embedded: QR rendered directly inside Payment Element via handleRender callback
 *
 * Note: Embedded type requires account whitelisting from Stripe.
 *
 * @see https://docs.stripe.com/payments/payment-element/custom-payment-methods#embedded-custom-content
 */
'use client';

import { useEffect, useState } from 'react';

export type CpmDisplayType = 'static' | 'embedded';

const STORAGE_KEY = 'cpm_display_type';

interface CpmDisplayToggleProps {
  /** Callback when display type changes */
  onChange: (displayType: CpmDisplayType) => void;
  /** Initial value (will be overridden by localStorage if available) */
  defaultValue?: CpmDisplayType;
}

/**
 * Get the saved display type from localStorage
 */
export function getSavedDisplayType(): CpmDisplayType {
  if (typeof window === 'undefined') return 'static';
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'embedded' ? 'embedded' : 'static';
}

export function CpmDisplayToggle({
  onChange,
  defaultValue = 'static',
}: CpmDisplayToggleProps) {
  const [displayType, setDisplayType] = useState<CpmDisplayType>(defaultValue);
  const [mounted, setMounted] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = getSavedDisplayType();
    setDisplayType(saved);
    onChange(saved);
    setMounted(true);
  }, [onChange]);

  const handleChange = (type: CpmDisplayType) => {
    setDisplayType(type);
    localStorage.setItem(STORAGE_KEY, type);
    onChange(type);
  };

  // Avoid hydration mismatch
  if (!mounted) {
    return (
      <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="h-[72px] animate-pulse bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
      <p className="text-sm font-medium text-gray-700 mb-2">
        CPM Display Type
      </p>
      <div className="flex gap-2">
        {/* Static Option */}
        <button
          type="button"
          onClick={() => handleChange('static')}
          className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
            displayType === 'static'
              ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <span>Static</span>
          </div>
          <p className="text-xs font-normal mt-0.5 opacity-75">
            QR below element
          </p>
        </button>

        {/* Embedded Option */}
        <button
          type="button"
          onClick={() => handleChange('embedded')}
          className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
            displayType === 'embedded'
              ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <span>Embedded</span>
            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
              Beta
            </span>
          </div>
          <p className="text-xs font-normal mt-0.5 opacity-75">
            QR inside element
          </p>
        </button>
      </div>

      {/* Whitelisting note for embedded */}
      {displayType === 'embedded' && (
        <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
          <span className="font-medium">Note:</span> Embedded type requires
          account whitelisting from Stripe.{' '}
          <a
            href="https://docs.stripe.com/payments/payment-element/custom-payment-methods#embedded-custom-content"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-700 underline hover:text-amber-900"
          >
            Learn more
          </a>
        </div>
      )}
    </div>
  );
}
