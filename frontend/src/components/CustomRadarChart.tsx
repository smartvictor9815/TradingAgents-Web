import { useMemo } from 'react';

interface AgentConfidence {
  analyst: number;
  strategist: number;
  riskAssessor: number;
  trader: number;
  sentiment: number;
  technical: number;
}

interface CustomRadarChartProps {
  data: AgentConfidence;
}

export function CustomRadarChart({ data }: CustomRadarChartProps) {
  const agents = useMemo(() => [
    { label: 'Analyst', value: data.analyst },
    { label: 'Strategist', value: data.strategist },
    { label: 'Risk Assessor', value: data.riskAssessor },
    { label: 'Trader', value: data.trader },
    { label: 'Sentiment', value: data.sentiment },
    { label: 'Technical', value: data.technical },
  ], [data]);

  const averageConfidence = useMemo(() => {
    return Math.round((
      data.analyst +
      data.strategist +
      data.riskAssessor +
      data.trader +
      data.sentiment +
      data.technical
    ) / 6);
  }, [data]);

  // Calculate polygon points for radar chart
  const points = useMemo(() => {
    const centerX = 200;
    const centerY = 200;
    const maxRadius = 150;
    const angleStep = (Math.PI * 2) / agents.length;
    
    return agents.map((agent, index) => {
      const angle = angleStep * index - Math.PI / 2; // Start from top
      const radius = (agent.value / 100) * maxRadius;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      return { x, y, angle, fullRadius: maxRadius, label: agent.label, value: agent.value };
    });
  }, [agents]);

  const polygonPoints = points.map(p => `${p.x},${p.y}`).join(' ');

  // Generate grid circles
  const gridLevels = [20, 40, 60, 80, 100];
  const gridPolygons = gridLevels.map(level => {
    const angleStep = (Math.PI * 2) / 6;
    const radius = (level / 100) * 150;
    const centerX = 200;
    const centerY = 200;
    
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const angle = angleStep * i - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      pts.push(`${x},${y}`);
    }
    return pts.join(' ');
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Custom SVG Radar Chart */}
      <div className="lg:col-span-2 bg-black/50 rounded-lg p-4 border border-green-700">
        <svg viewBox="0 0 400 400" className="w-full h-full">
          {/* Grid levels */}
          {gridPolygons.map((pts, idx) => (
            <polygon
              key={`grid-${idx}`}
              points={pts}
              fill="none"
              stroke="rgba(34, 197, 94, 0.2)"
              strokeWidth="1"
            />
          ))}
          
          {/* Axis lines */}
          {points.map((point, idx) => (
            <line
              key={`axis-${idx}`}
              x1="200"
              y1="200"
              x2={200 + point.fullRadius * Math.cos(point.angle)}
              y2={200 + point.fullRadius * Math.sin(point.angle)}
              stroke="rgba(34, 197, 94, 0.2)"
              strokeWidth="1"
            />
          ))}
          
          {/* Data polygon */}
          <polygon
            points={polygonPoints}
            fill="rgba(34, 197, 94, 0.3)"
            stroke="rgb(34, 197, 94)"
            strokeWidth="2"
          />
          
          {/* Data points */}
          {points.map((point, idx) => (
            <circle
              key={`point-${idx}`}
              cx={point.x}
              cy={point.y}
              r="4"
              fill="rgb(34, 197, 94)"
              stroke="rgb(16, 185, 129)"
              strokeWidth="2"
            />
          ))}
          
          {/* Labels */}
          {points.map((point, idx) => {
            const labelRadius = 170;
            const labelX = 200 + labelRadius * Math.cos(point.angle);
            const labelY = 200 + labelRadius * Math.sin(point.angle);
            
            return (
              <text
                key={`label-${idx}`}
                x={labelX}
                y={labelY}
                fill="rgb(74, 222, 128)"
                fontSize="12"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {point.label}
              </text>
            );
          })}
          
          {/* Grid level labels */}
          {gridLevels.map((level, idx) => (
            <text
              key={`grid-label-${idx}`}
              x="205"
              y={200 - (level / 100) * 150}
              fill="rgb(22, 163, 74)"
              fontSize="10"
              textAnchor="start"
            >
              {level}
            </text>
          ))}
        </svg>
      </div>

      {/* Confidence Scores List */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-green-600 mb-3">Confidence Scores</h3>
        {agents.map((item) => (
          <div key={item.label} className="bg-green-900/20 border border-green-700 rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-green-400">{item.label}</span>
              <span className={`text-lg font-bold ${
                item.value >= 75 ? 'text-green-400' :
                item.value >= 50 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {item.value}%
              </span>
            </div>
            <div className="w-full bg-green-900/30 rounded-full h-2">
              <div
                className={`h-full rounded-full transition-all ${
                  item.value >= 75 ? 'bg-green-500' :
                  item.value >= 50 ? 'bg-yellow-500' :
                  'bg-red-500'
                }`}
                style={{ width: `${item.value}%` }}
              />
            </div>
          </div>
        ))}
        <div className="mt-4 pt-4 border-t border-green-700">
          <p className="text-xs text-green-600">
            Average Confidence: <span className="font-bold text-green-400">
              {averageConfidence}%
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
