import { ReactNode, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getDisplayName } from '../lib/utils';
import {
  Recycle, LayoutDashboard, QrCode, Trophy, MapPin, Package,
  Users, Building2, Settings, LogOut, Menu, X, ChevronRight, Star, Gift, Bot
} from 'lucide-react';

interface NavItem {
  label: string;
  icon: ReactNode;
  view: string;
}

interface AppLayoutProps {
  children: ReactNode;
  activeView: string;
  onNavigate: (view: string) => void;
}

export default function AppLayout({ children, activeView, onNavigate }: AppLayoutProps) {
  const { profile, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const studentNav: NavItem[] = [
    { label: 'Inicio', icon: <LayoutDashboard className="w-5 h-5" />, view: 'dashboard' },
    { label: 'Escanear', icon: <QrCode className="w-5 h-5" />, view: 'scanner' },
    { label: 'Ranking', icon: <Trophy className="w-5 h-5" />, view: 'ranking' },
    { label: 'Mapa', icon: <MapPin className="w-5 h-5" />, view: 'map' },
    { label: 'Mis puntos', icon: <Star className="w-5 h-5" />, view: 'points' },
  ];

  const companyNav: NavItem[] = [
    { label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, view: 'company-dashboard' },
    { label: 'Trazabilidad', icon: <Package className="w-5 h-5" />, view: 'traceability' },
    { label: 'IA Chatbot', icon: <Bot className="w-5 h-5" />, view: 'ai-chatbot' },
    { label: 'Analiticas', icon: <Trophy className="w-5 h-5" />, view: 'analytics' },
    { label: 'Mapa', icon: <MapPin className="w-5 h-5" />, view: 'map' },
  ];

  const adminNav: NavItem[] = [
    { label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, view: 'admin-dashboard' },
    { label: 'Empresas', icon: <Building2 className="w-5 h-5" />, view: 'admin-companies' },
    { label: 'Usuarios', icon: <Users className="w-5 h-5" />, view: 'admin-users' },
    { label: 'Productos', icon: <Package className="w-5 h-5" />, view: 'admin-products' },
    { label: 'Stock Refrigerios', icon: <Gift className="w-5 h-5" />, view: 'admin-stock' },
    { label: 'IA Chatbot', icon: <Bot className="w-5 h-5" />, view: 'ai-chatbot' },
    { label: 'Ranking', icon: <Trophy className="w-5 h-5" />, view: 'ranking' },
    { label: 'Mapa', icon: <MapPin className="w-5 h-5" />, view: 'map' },
    { label: 'Configuracion', icon: <Settings className="w-5 h-5" />, view: 'admin-settings' },
  ];

  const navItems =
    profile?.role === 'admin' ? adminNav :
    profile?.role === 'company' ? companyNav :
    studentNav;

  const roleLabel =
    profile?.role === 'admin' ? 'Administrador' :
    profile?.role === 'company' ? 'Empresa' : 'Estudiante';

  const roleBadgeColor =
    profile?.role === 'admin' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
    profile?.role === 'company' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
    'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';

  const Sidebar = () => (
    <aside className="flex flex-col h-full bg-slate-900 border-r border-slate-800 w-64">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-800">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
          <Recycle className="w-4 h-4 text-emerald-400" />
        </div>
        <span className="text-white font-bold text-lg tracking-tight">TraceQR</span>
      </div>

      {/* User info */}
      <div className="px-4 py-4 border-b border-slate-800">
        <div className="flex items-center gap-3 px-2">
          <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-semibold text-sm uppercase">
            {getDisplayName(profile?.display_name, profile?.email)[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{getDisplayName(profile?.display_name, profile?.email)}</p>
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full border font-medium mt-0.5 ${roleBadgeColor}`}>
              {roleLabel}
            </span>
          </div>
        </div>
        {profile?.role === 'student' && (
          <div className="flex items-center gap-2 mt-3 px-2">
            <Star className="w-4 h-4 text-amber-400" />
            <span className="text-amber-300 text-sm font-semibold">{(profile?.total_points ?? 0).toLocaleString('es-CO')} pts</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(item => (
          <button
            key={item.view}
            onClick={() => { onNavigate(item.view); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
              activeView === item.view
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <span className={activeView === item.view ? 'text-emerald-400' : 'group-hover:text-slate-300'}>{item.icon}</span>
            <span>{item.label}</span>
            {activeView === item.view && <ChevronRight className="w-3 h-3 ml-auto text-emerald-400" />}
          </button>
        ))}
      </nav>

      {/* Sign out */}
      <div className="px-3 py-4 border-t border-slate-800">
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <LogOut className="w-5 h-5" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-10 w-64">
            <Sidebar />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-400 hover:text-white">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Recycle className="w-5 h-5 text-emerald-400" />
            <span className="text-white font-bold">TraceQR</span>
          </div>
          <div className="w-5" />
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
