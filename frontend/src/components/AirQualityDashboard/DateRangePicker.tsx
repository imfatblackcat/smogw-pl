import { useState, useRef, useEffect } from 'react';
import { DateRange, RangeKeyDict } from 'react-date-range';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';
import { Calendar, ChevronDown } from 'lucide-react';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

interface DateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onStartDateChange: (date: Date) => void;
  onEndDateChange: (date: Date) => void;
}

export function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectionRange = {
    startDate: startDate,
    endDate: endDate,
    key: 'selection',
  };

  const handleSelect = (ranges: RangeKeyDict) => {
    const selection = ranges.selection;
    if (selection.startDate) {
      onStartDateChange(selection.startDate);
    }
    if (selection.endDate) {
      onEndDateChange(selection.endDate);
    }
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
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">Zakres dat</label>
      
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg shadow-sm hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
        >
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="flex-1 text-left text-gray-700">
            {format(startDate, 'dd.MM.yyyy', { locale: pl })} — {format(endDate, 'dd.MM.yyyy', { locale: pl })}
          </span>
          <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute z-50 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <DateRange
              ranges={[selectionRange]}
              onChange={handleSelect}
              locale={pl}
              months={1}
              direction="horizontal"
              showMonthAndYearPickers={true}
              editableDateInputs={true}
              rangeColors={['#3b82f6']}
              color="#3b82f6"
            />
          </div>
        )}
      </div>
    </div>
  );
}
