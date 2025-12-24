import { useMemo, useState, useRef, useEffect, ReactNode } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';
import type { GroupedSelectOptions } from './types';

interface MultiSelectProps {
  options: GroupedSelectOptions[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  footer?: ReactNode;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Wybierz...',
  footer,
}: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const labelByValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of options) {
      for (const opt of group.options) {
        map.set(opt.value, opt.label);
      }
    }
    return map;
  }, [options]);

  const summaryText = useMemo(() => {
    const count = value.length;
    if (count === 0) return placeholder;

    const labels = value
      .slice(0, 2)
      .map((v) => labelByValue.get(v))
      .filter(Boolean);

    if (count <= 2 && labels.length === count) {
      return labels.join(', ');
    }

    return `Wybrano: ${count}`;
  }, [labelByValue, placeholder, value]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;

    return options
      .map((group) => ({
        ...group,
        options: group.options.filter((opt) =>
          opt.label.toLowerCase().includes(q)
        ),
      }))
      .filter((group) => group.options.length > 0);
  }, [options, query]);

  const toggle = (val: string) => {
    const next = new Set(selectedSet);
    if (next.has(val)) {
      next.delete(val);
    } else {
      next.add(val);
    }
    onChange(Array.from(next));
  };

  const clearAll = () => {
    onChange([]);
  };

  const selectAllInGroup = (groupHeading: string) => {
    const group = options.find((g) => g.heading === groupHeading);
    if (!group) return;
    const next = new Set(selectedSet);
    group.options.forEach((opt) => next.add(opt.value));
    onChange(Array.from(next));
  };

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg shadow-sm hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-left"
      >
        <span className="flex-1 text-gray-700 truncate">{summaryText}</span>
        <ChevronDown
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 w-full min-w-[320px] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
          {/* Search & Clear */}
          <div className="flex items-center gap-2 p-3 border-b border-gray-200">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Szukaj..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={clearAll}
              disabled={value.length === 0}
              className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <X className="w-3 h-3" />
              Wyczyść
            </button>
          </div>

          {/* Options */}
          <div className="max-h-72 overflow-y-auto p-2">
            {filteredOptions.length === 0 ? (
              <div className="text-center text-gray-500 py-4">Brak wyników</div>
            ) : (
              filteredOptions.map((group) => (
                <div key={group.heading} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {group.heading}
                    </span>
                    <button
                      type="button"
                      onClick={() => selectAllInGroup(group.heading)}
                      className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      Zaznacz wszystkie
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {group.options.map((opt) => {
                      const checked = selectedSet.has(opt.value);
                      return (
                        <label
                          key={opt.value}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                            checked ? 'bg-blue-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(opt.value)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {footer && (
            <div className="p-3 border-t border-gray-200 bg-gray-50">{footer}</div>
          )}
        </div>
      )}
    </div>
  );
}
