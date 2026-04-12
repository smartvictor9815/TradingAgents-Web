/** Mirrors tradingagents.default_config["data_vendors"] keys and allowed vendors. */

export const DATA_VENDOR_KEYS = [
  "core_stock_apis",
  "technical_indicators",
  "fundamental_data",
  "news_data",
] as const;

export type DataVendorKey = (typeof DATA_VENDOR_KEYS)[number];
export type DataVendorValue = "yfinance" | "alpha_vantage";

export const DEFAULT_DATA_VENDORS: Record<DataVendorKey, DataVendorValue> = {
  core_stock_apis: "yfinance",
  technical_indicators: "yfinance",
  fundamental_data: "yfinance",
  news_data: "yfinance",
};

export const DATA_VENDOR_LABELS: Record<DataVendorKey, string> = {
  core_stock_apis: "Core stock APIs",
  technical_indicators: "Technical indicators",
  fundamental_data: "Fundamental data",
  news_data: "News data",
};

export function mergeDataVendors(
  partial: Partial<Record<DataVendorKey, DataVendorValue>> | undefined,
): Record<DataVendorKey, DataVendorValue> {
  return { ...DEFAULT_DATA_VENDORS, ...partial };
}
