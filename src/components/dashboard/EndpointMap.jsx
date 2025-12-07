import React from 'react';
import { StatusPulse, ProviderIcon } from './UIComponents';
import { cn } from "@/lib/utils";
import { Globe } from 'lucide-react';

const regionPositions = {
  'us-east': { x: 25, y: 35 },
  'us-west': { x: 15, y: 38 },
  'eu-west': { x: 48, y: 32 },
  'eu-central': { x: 52, y: 30 },
  'asia-east': { x: 78, y: 36 },
  'asia-south': { x: 68, y: 42 },
  'ap-southeast': { x: 75, y: 52 },
  'sa-east': { x: 32, y: 65 },
};

export default function EndpointMap({ endpoints }) {
  const groupedByRegion = endpoints.reduce((acc, ep) => {
    const region = ep.region || 'unknown';
    if (!acc[region]) acc[region] = [];
    acc[region].push(ep);
    return acc;
  }, {});

  return (
    <div className="bg-white border border-[#d0d7de] rounded-md">
      {/* Header */}
      <div className="border-b border-[#d0d7de] bg-[#f6f8fa] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#57606a]" />
            <h3 className="text-sm font-semibold text-[#24292f]">Endpoint Health</h3>
          </div>
          <p className="text-xs text-[#57606a]">{endpoints.length} endpoints • {Object.keys(groupedByRegion).length} regions</p>
        </div>
      </div>

      {/* Endpoint list */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
        {endpoints.map((ep, idx) => (
          <div
            key={ep.id || idx}
            className="flex items-center gap-3 p-3 rounded-md border border-[#d0d7de] hover:bg-[#f6f8fa] transition-colors"
          >
            <StatusPulse status={ep.status} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <ProviderIcon provider={ep.provider} size="sm" />
                <span className="text-xs font-medium text-[#24292f] truncate">{ep.region}</span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-[#57606a]">
                <span>{ep.latency_avg_ms || 0}ms</span>
                <span>•</span>
                <span>{((ep.success_rate || 0) * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}