export type DashboardChart = "health" | "daily"
export const DASHBOARD_CHART_KEY = "lucaplan:dashboard-chart"

export function getDashboardChartPreference(): DashboardChart {
  if (typeof window === "undefined") return "health"
  try {
    return window.localStorage.getItem(DASHBOARD_CHART_KEY) === "daily" ? "daily" : "health"
  } catch {
    return "health"
  }
}

export function setDashboardChartPreference(chart: DashboardChart) {
  try {
    window.localStorage.setItem(DASHBOARD_CHART_KEY, chart)
    window.dispatchEvent(new Event("lucaplan:dashboard-chart-changed"))
  } catch {
    // La preferencia es opcional (modo privado/sin almacenamiento).
  }
}
