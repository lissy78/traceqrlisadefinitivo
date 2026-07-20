import { useEffect, useState } from 'react';

import { AuthProvider, useAuth } from './lib/auth';
import AppLayout from './components/AppLayout';
import AIChatbot from './components/AIChatbot';

import LoginPage from './pages/LoginPage';
import StudentDashboard from './pages/StudentDashboard';
import ScannerPage from './pages/ScannerPage';
import RankingPage from './pages/RankingPage';
import MapPage from './pages/MapPage';
import PointsPage from './pages/PointsPage';

import CompanyDashboard from './pages/CompanyDashboard';
import CompanyMapPage from './pages/CompanyMapPage';
import TraceabilityPage from './pages/TraceabilityPage';
import UCIDTrackingPage from './pages/UCIDTrackingPage';

import AdminDashboard from './pages/AdminDashboard';
import AdminCompanies from './pages/AdminCompanies';
import AdminUsers from './pages/AdminUsers';
import AdminProducts from './pages/AdminProducts';
import AdminProductLines from './pages/AdminProductLines';
import AdminUCID from './pages/AdminUCID';
import AdminLocations from './pages/AdminLocations';
import AdminStock from './pages/AdminStock';

function getDefaultView(role?: string) {
  if (role === 'admin') return 'admin-dashboard';
  if (role === 'company') return 'company-dashboard';
  return 'dashboard';
}

function getInitialView(role?: string) {
  const path = window.location.pathname;

  if (path === '/generate') {
    return role === 'admin' ? 'admin-ucid' : 'company-ucid';
  }

  if (path === '/scanner' || path === '/scan') {
    return 'scanner';
  }

  if (path === '/tracking' || path === '/track') {
    return 'ucid-tracking';
  }

  if (path === '/admin') {
    return 'admin-dashboard';
  }

  return getDefaultView(role);
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-slate-300 text-sm">Cargando TraceQR...</p>
      </div>
    </div>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="p-8">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
        <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
        <p className="text-slate-400">Esta sección todavía no está implementada.</p>
      </div>
    </div>
  );
}

function AppContent() {
  const { session, profile, loading } = useAuth();
  const [activeView, setActiveView] = useState('');

  useEffect(() => {
    if (!profile || activeView) return;
    setActiveView(getInitialView(profile.role));
  }, [profile, activeView]);

  if (window.location.pathname.startsWith('/s/')) {
    return <UCIDTrackingPage />;
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (!session || !profile) {
    return <LoginPage />;
  }

  const view = activeView || getDefaultView(profile.role);

  const renderPage = () => {
    switch (view) {
      case 'dashboard':
        return <StudentDashboard onNavigate={setActiveView} />;

      case 'scanner':
        return <ScannerPage />;

      case 'ranking':
        return <RankingPage />;

      case 'map':
        return <MapPage />;

      case 'points':
        return <PointsPage />;

      case 'company-dashboard':
        return <CompanyDashboard />;

      case 'company-map':
        return <CompanyMapPage />;

      case 'company-ucid':
        return <AdminUCID />;

      case 'traceability':
        return <TraceabilityPage />;

      case 'ai-chatbot':
        return <AIChatbot />;

      case 'analytics':
        return <ComingSoon title="Analíticas" />;

      case 'admin-dashboard':
        return <AdminDashboard />;

      case 'admin-companies':
        return <AdminCompanies />;

      case 'admin-users':
        return <AdminUsers />;

      case 'admin-products':
        return <AdminProducts />;

      case 'admin-product-lines':
        return <AdminProductLines />;

      case 'admin-ucid':
        return <AdminUCID />;

      case 'admin-locations':
        return <AdminLocations />;

      case 'admin-stock':
        return <AdminStock />;

      case 'admin-settings':
        return <ComingSoon title="Configuración" />;

      case 'ucid-tracking':
        return <UCIDTrackingPage />;

      default:
        return profile.role === 'admin'
          ? <AdminDashboard />
          : profile.role === 'company'
            ? <CompanyDashboard />
            : <StudentDashboard onNavigate={setActiveView} />;
    }
  };

  return (
    <AppLayout activeView={view} onNavigate={setActiveView}>
      {renderPage()}
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}