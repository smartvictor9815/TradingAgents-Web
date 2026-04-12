import { createBrowserRouter, Navigate } from "react-router";
import { MainLayout } from "./components/MainLayout";
import { SettingsPage } from "./components/SettingsPage";
import { AnalysisPage } from "./components/AnalysisPage";
import { ProvidersPage } from "./components/ProvidersPage";
import { ReportsPage } from "./components/ReportsPage";
import { StatsPage } from "./components/StatsPage";
import { ErrorPage } from "./components/ErrorPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: MainLayout,
    errorElement: <ErrorPage />,
    children: [
      {
        index: true,
        Component: AnalysisPage,
      },
      {
        path: "analysis",
        Component: AnalysisPage,
      },
      {
        path: "reports",
        Component: ReportsPage,
      },
      {
        path: "stats",
        Component: StatsPage,
      },
      {
        path: "settings",
        Component: SettingsPage,
      },
      {
        path: "providers",
        Component: ProvidersPage,
      },
      {
        path: "audit",
        element: <Navigate to="/" replace />,
      },
      {
        path: "progress",
        element: <Navigate to="/analysis" replace />,
      },
      {
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
  {
    path: "*",
    element: <ErrorPage />,
  },
]);