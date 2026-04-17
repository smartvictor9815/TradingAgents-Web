import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router";
import { LayoutDashboard, Settings, Database, FileText, BarChart3, Menu, X, Github } from "lucide-react";
import { Button } from "./ui/button";
import { getMostRecentReport } from "../utils/analysisReportsStorage";

export function MainLayout() {
  const repoUrl = "https://github.com/smartvictor9815/TradingAgents-Web";
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const menuItems = [
    { path: "/", label: "Analysis", icon: LayoutDashboard },
    { path: "/history", label: "History", icon: FileText },
    { path: "/settings", label: "Settings", icon: Settings },
    { path: "/providers", label: "Providers", icon: Database },
    { path: "/stats", label: "Statistics", icon: BarChart3 },
  ];

  const isActive = (path: string) => {
    if (path === "/analysis") {
      return location.pathname === "/" || location.pathname === "/analysis";
    }
    return location.pathname === path;
  };

  const navigateWithResumeHint = (path: string) => {
    if (path !== "/" && path !== "/analysis") {
      navigate(path);
      return;
    }

    const recent = getMostRecentReport();
    if (!recent?.id) {
      navigate(path);
      return;
    }

    navigate(path, {
      state: {
        resumeHint: {
          id: recent.id,
          ticker: recent.ticker,
          analysisDate: recent.analysisDate,
          status: recent.status,
        },
      },
    });
  };

  return (
    <div className="min-h-screen bg-[#0a0e14] text-[#e6edf3]">
      {/* Header with Logo and Mobile Menu Toggle */}
      <div className="bg-[#0d1117] border-b border-[#30363d] px-4 py-3 flex items-center justify-between sticky top-0 z-50 backdrop-blur-sm bg-[#0d1117]/95">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden text-[#ffa657] hover:text-[#ffb86c] transition-colors"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-[#f85149] to-[#ffa657] rounded flex items-center justify-center text-white font-bold text-sm">
              TA
            </div>
            <div>
              <h1 className="text-base font-semibold text-[#e6edf3]">Tradingagents-Web</h1>
              <p className="text-[10px] text-[#6e7681] hidden sm:block">Multi-Agent LLM Trading Framework</p>
            </div>
          </div>
        </div>
        
        {/* Quick Stats in Header */}
        <div className="hidden md:flex items-center gap-4 text-xs">
          <a
            href={repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#161b22] rounded border border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#8b949e] transition-colors"
          >
            <Github className="w-3.5 h-3.5" />
            <span>GitHub</span>
          </a>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#161b22] rounded border border-[#30363d]">
            <div className="w-1.5 h-1.5 bg-[#3fb950] rounded-full animate-pulse"></div>
            <span className="text-[#8b949e]">System Ready</span>
          </div>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar Navigation - Desktop */}
        <aside className="hidden lg:block w-56 bg-[#0d1117] border-r border-[#30363d] min-h-[calc(100vh-57px)]">
          <nav className="p-3 space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.path}
                  onClick={() => navigateWithResumeHint(item.path)}
                  variant="ghost"
                  className={`w-full justify-start text-sm h-9 ${
                    isActive(item.path)
                      ? "bg-[#f85149]/10 text-[#f85149] border border-[#f85149]/20 hover:bg-[#f85149]/15 font-medium"
                      : "text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#161b22] border border-transparent"
                  }`}
                >
                  <Icon className="w-4 h-4 mr-2.5" />
                  {item.label}
                </Button>
              );
            })}
          </nav>
          
          <div className="p-4 mt-6 mx-3 border-t border-[#30363d]">
            <div className="text-[10px] text-[#6e7681] space-y-1.5 leading-relaxed">
              <p className="font-semibold text-[#ffa657] text-xs mb-2">Analysis Pipeline</p>
              <div className="space-y-1">
                <p className="flex items-center gap-2">
                  <span className="w-4 text-[#8b949e]">I.</span> Analyst Team
                </p>
                <p className="flex items-center gap-2">
                  <span className="w-4 text-[#8b949e]">II.</span> Research Team
                </p>
                <p className="flex items-center gap-2">
                  <span className="w-4 text-[#8b949e]">III.</span> Trader
                </p>
                <p className="flex items-center gap-2">
                  <span className="w-4 text-[#8b949e]">IV.</span> Risk Management
                </p>
                <p className="flex items-center gap-2">
                  <span className="w-4 text-[#8b949e]">V.</span> Portfolio Mgmt
                </p>
              </div>
            </div>
          </div>
        </aside>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-50 bg-[#0a0e14]">
            <div className="bg-[#0d1117] border-b border-[#30363d] p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-[#f85149] to-[#ffa657] rounded flex items-center justify-center text-white font-bold text-sm">
                  TA
                </div>
                <h1 className="text-base font-semibold text-[#e6edf3]">Tradingagents-Web</h1>
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#8b949e] hover:text-[#e6edf3] transition-colors"
                  aria-label="Open GitHub repository"
                  title="GitHub repository"
                >
                  <Github className="w-4 h-4" />
                </a>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="text-[#ffa657] hover:text-[#ffb86c]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="p-3 space-y-1">
              {menuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.path}
                    onClick={() => {
                      navigateWithResumeHint(item.path);
                      setMobileMenuOpen(false);
                    }}
                    variant="ghost"
                    className={`w-full justify-start text-sm h-10 ${
                      isActive(item.path)
                        ? "bg-[#f85149]/10 text-[#f85149] border border-[#f85149]/20 hover:bg-[#f85149]/15"
                        : "text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#161b22] border border-transparent"
                    }`}
                  >
                    <Icon className="w-4 h-4 mr-2.5" />
                    {item.label}
                  </Button>
                );
              })}
            </nav>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 p-4 lg:p-6 bg-[#0a0e14]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}