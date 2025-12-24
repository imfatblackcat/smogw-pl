import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { AirQualityDashboard } from './components/AirQualityDashboard';
import { RankingPage } from './components/RankingPage';

function App() {
  return (
    <BrowserRouter>
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="font-semibold text-gray-900">smogw.pl</div>
          <div className="flex items-center gap-4 text-sm">
            <NavLink
              to="/"
              className={({ isActive }) =>
                isActive
                  ? 'text-blue-700 font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }
              end
            >
              Wykresy
            </NavLink>
            <NavLink
              to="/ranking"
              className={({ isActive }) =>
                isActive
                  ? 'text-blue-700 font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }
            >
              Ranking
            </NavLink>
          </div>
        </div>
      </div>

      <Routes>
        <Route path="/" element={<AirQualityDashboard />} />
        <Route path="/ranking" element={<RankingPage />} />
        <Route path="*" element={<AirQualityDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
