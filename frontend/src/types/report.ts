export interface Report {
  id: string;
  ticker: string;
  analysisDate: string;
  timestamp: string;
  status: 'completed' | 'failed' | 'running';
  summary: string;
  steps: {
    name: string;
    status: 'completed' | 'running' | 'pending' | 'failed';
    details: string;
    timestamp?: string;
  }[];
  recommendation?: {
    action: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    reasoning: string;
  };
  agentConfidence?: {
    analyst: number;
    strategist: number;
    riskAssessor: number;
    trader: number;
    sentiment: number;
    technical: number;
  };
  priceData?: {
    date: string;
    price: number;
    volume: number;
  }[];
  portfolioPerformance?: {
    date: string;
    value: number;
    benchmark: number;
  }[];
}
