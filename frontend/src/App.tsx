import { BrowserRouter, NavLink, Routes, Route } from 'react-router-dom';
import { AirQualityDashboard } from './components/AirQualityDashboard';
import { TrendsPage } from './components/TrendsPage';

function App() {
  return (
    <BrowserRouter>
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <NavLink to="/" className="font-semibold text-gray-900 hover:text-blue-700 transition-colors">
            app.smogw.pl
          </NavLink>
          <div className="flex items-center gap-6 text-sm">
            <NavLink
              to="/"
              className={({ isActive }) =>
                isActive
                  ? 'text-blue-700 font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }
              end
            >
              Trendy Wieloletnie
            </NavLink>
            <NavLink
              to="/explorer"
              className={({ isActive }) =>
                isActive
                  ? 'text-blue-700 font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }
            >
              Eksplorator Danych
            </NavLink>
          </div>
        </div>
      </div>

      <Routes>
        <Route path="/" element={<TrendsPage />} />
        <Route path="/explorer" element={<AirQualityDashboard />} />
        <Route path="*" element={<TrendsPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
