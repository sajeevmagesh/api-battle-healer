import React from 'react';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";
import { 
  Shield, 
  Archive, 
  Sparkles, 
  AlertTriangle,
  Clock,
  Layers
} from 'lucide-react';

const degradationModes = [
  {
    id: 'cache',
    icon: Archive,
    label: 'Cache Fallback',
    description: 'Return stale cached responses',
    color: 'emerald',
    active: true,
    lastUsed: '2 min ago',
    hitRate: '78%'
  },
  {
    id: 'mock',
    icon: Sparkles,
    label: 'AI Mock Response',
    description: 'Gemini-generated mock data',
    color: 'violet',
    active: true,
    lastUsed: '5 min ago',
    hitRate: '12%'
  },
  {
    id: 'partial',
    icon: Layers,
    label: 'Partial Response',
    description: 'Return available fields only',
    color: 'blue',
    active: false,
    lastUsed: 'Never',
    hitRate: '0%'
  }
];

export default function GracefulDegradation({ modes = degradationModes }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-300 transition-colors">
      <div className="mb-6">
        <h3 className="text-[15px] font-semibold text-black mb-1">Graceful Degradation</h3>
        <p className="text-[13px] text-gray-500">Fallback strategies for resilience</p>
      </div>

      {/* Degradation Flow */}
      <div className="mb-6 p-4 rounded-md bg-gray-50 border border-gray-200">
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-3">
          <span className="font-medium">Fallback Priority</span>
          <span>Higher ← Priority → Lower</span>
        </div>
        <div className="flex items-center gap-2">
          {modes.map((mode, idx) => {
            const Icon = mode.icon;
            return (
              <React.Fragment key={mode.id}>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: idx * 0.1 }}
                  className={cn(
                    "flex-1 p-3 rounded-md border text-center",
                    mode.active 
                      ? "bg-white border-gray-300"
                      : "bg-gray-100 border-gray-200 opacity-60"
                  )}
                >
                  <Icon className={cn(
                    "w-5 h-5 mx-auto mb-1",
                    mode.active 
                      ? mode.color === 'emerald' ? "text-green-600"
                        : mode.color === 'violet' ? "text-violet-600"
                        : "text-blue-600"
                      : "text-gray-400"
                  )} />
                  <p className={cn(
                    "text-[11px] font-medium",
                    mode.active ? "text-gray-900" : "text-gray-500"
                  )}>
                    {mode.label}
                  </p>
                </motion.div>
                {idx < modes.length - 1 && (
                  <div className="text-gray-400">→</div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Mode Details */}
      <div className="space-y-3">
        {modes.map((mode, idx) => {
          const Icon = mode.icon;
          
          return (
            <motion.div
              key={mode.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className={cn(
                "p-4 rounded-md border transition-all",
                mode.active 
                  ? "bg-white border-gray-200"
                  : "bg-gray-50 border-gray-200 opacity-60"
              )}
            >
              <div className="flex items-start gap-3">
                <Icon className={cn(
                  "w-5 h-5 flex-shrink-0",
                  mode.active 
                    ? mode.color === 'emerald' ? "text-green-600"
                      : mode.color === 'violet' ? "text-violet-600"
                      : "text-blue-600"
                    : "text-gray-400"
                )} />
                
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className={cn(
                      "text-[13px] font-medium",
                      mode.active ? "text-gray-900" : "text-gray-500"
                    )}>
                      {mode.label}
                    </h4>
                    {mode.active && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-green-50 text-green-700 border border-green-200 font-medium">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {mode.description}
                  </p>
                </div>

                <div className="text-right">
                  <p className={cn(
                    "text-lg font-semibold",
                    mode.active 
                      ? mode.color === 'emerald' ? "text-green-600"
                        : mode.color === 'violet' ? "text-violet-600"
                        : "text-blue-600"
                      : "text-gray-400"
                  )}>
                    {mode.hitRate}
                  </p>
                  <p className="text-[11px] text-gray-500 flex items-center gap-1 justify-end">
                    <Clock className="w-3 h-3" />
                    {mode.lastUsed}
                  </p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Degraded Response Warning */}
      <div className="mt-6 p-3 rounded-md bg-amber-50 border border-amber-200 flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-[13px] text-gray-900 font-medium">Degraded Responses Active</p>
          <p className="text-[11px] text-gray-600">
            3 responses marked as degraded in the last hour
          </p>
        </div>
        <div className="w-2 h-2 rounded-full bg-green-500" />
      </div>
    </div>
  );
}