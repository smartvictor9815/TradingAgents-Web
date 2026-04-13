import { useMemo } from 'react';

interface CustomRadarChartProps {
  data: Record<string, number>;
  compact?: boolean;
}

export function CustomRadarChart({ data, compact = false }: CustomRadarChartProps) {
  const agents = useMemo(
    () =>
      Object.entries(data)
        .filter(([, v]) => Number.isFinite(v))
        .map(([key, value]) => ({
          label: key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          value: Math.max(0, Math.min(100, Math.round(Number(value)))),
        })),
    [data],
  );

  const averageConfidence = useMemo(() => {
    if (!agents.length) return 0;
    return Math.round(agents.reduce((acc, a) => acc + a.value, 0) / agents.length);
  }, [agents]);

  const axisCount = Math.max(agents.length, 3);

  // Calculate polygon points for radar chart
  const points = useMemo(() => {
    const centerX = 200;
    const centerY = 200;
    const maxRadius = 150;
    const angleStep = (Math.PI * 2) / axisCount;
    
    return agents.map((agent, index) => {
      const angle = angleStep * index - Math.PI / 2; // Start from top
      const radius = (agent.value / 100) * maxRadius;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      return { x, y, angle, fullRadius: maxRadius, label: agent.label, value: agent.value };
    });
  }, [agents, axisCount]);

  const polygonPoints = points.map(p => `${p.x},${p.y}`).join(' ');

  // Generate grid circles
  const gridLevels = [20, 40, 60, 80, 100];
  const gridPolygons = gridLevels.map(level => {
    const angleStep = (Math.PI * 2) / axisCount;
    const radius = (level / 100) * 150;
    const centerX = 200;
    const centerY = 200;
    
    const pts = [];
    for (let i = 0; i < axisCount; i++) {
      const angle = angleStep * i - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      pts.push(`${x},${y}`);
    }
    return pts.join(' ');
  });

  if (!agents.length) {
    return (
      <div className="rounded border border-[#30363d] bg-[#0d1117] p-3 text-xs text-[#8b949e]">
        No confidence dimensions available.
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 ${compact ? "gap-3" : "gap-6 lg:grid-cols-3"}`}>
      {/* Custom SVG Radar Chart */}
      <div className={`${compact ? "" : "lg:col-span-2"} bg-black/50 rounded-lg border border-green-700 ${compact ? "p-3" : "p-4"}`}>
        <div className={compact ? "h-[250px]" : "h-full"}>
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
            const labelRadius = compact ? 162 : 170;
            const labelX = 200 + labelRadius * Math.cos(point.angle);
            const labelY = 200 + labelRadius * Math.sin(point.angle);
            
            return (
              <text
                key={`label-${idx}`}
                x={labelX}
                y={labelY}
                fill="rgb(74, 222, 128)"
                fontSize={compact ? "10" : "12"}
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
        {compact && (
          <div className="mt-2 border-t border-green-800/60 pt-2">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-green-500">Confidence Scores</h3>
              <p className="text-[11px] text-green-600">
                Avg <span className="font-bold text-green-400">{averageConfidence}%</span>
              </p>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {agents.map((item) => (
                <div key={item.label} className="rounded border border-green-800/60 bg-green-950/20 px-2 py-1">
                  <div className="mb-0.5 flex items-center justify-between">
                    <span className="truncate text-[10px] text-green-400">{item.label}</span>
                    <span className="text-[10px] font-semibold text-green-300">{item.value}%</span>
                  </div>
                  <div className="h-1 w-full rounded-full bg-green-900/40">
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
            </div>
          </div>
        )}
      </div>

      {/* Confidence Scores List */}
      <div className={`space-y-3 ${compact ? "hidden" : ""}`}>
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
