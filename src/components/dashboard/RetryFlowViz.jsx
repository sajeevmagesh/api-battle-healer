import React from 'react';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";
import { 
  RefreshCw, 
  ArrowRight, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Zap,
  Shield,
  Database,
  Sparkles
} from 'lucide-react';

const flowSteps = [
  { id: 'request', label: 'Request', icon: Zap },
  { id: 'retry', label: 'Retry Logic', icon: RefreshCw },
  { id: 'failover', label: 'Failover', icon: Shield },
  { id: 'repair', label: 'Repair', icon: Sparkles },
  { id: 'queue', label: 'Queue', icon: Database },
  { id: 'result', label: 'Result', icon: CheckCircle },
];

export default function RetryFlowViz({ activeStep = 'request', events = [] }) {
  const recentEvents = events.slice(0, 5);
  const activeIndex = flowSteps.findIndex(s => s.id === activeStep);

  return (
    <div className="bg-white border border-[#d0d7de] rounded-md p-6">
      <div className="mb-6">
        <h3 className="text-base font-semibold text-[#24292f] mb-1">Recovery Flow Pipeline</h3>
        <p className="text-sm text-[#57606a]">Request healing journey visualization</p>
      </div>

      {/* Flow Visualization */}
      <div className="relative mb-8">
        <div className="flex items-center justify-between">
          {flowSteps.map((step, idx) => {
            const Icon = step.icon;
            const isActive = idx <= activeIndex;
            const isCurrent = idx === activeIndex;
            
            return (
              <React.Fragment key={step.id}>
                <motion.div
                  className="relative flex flex-col items-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                >
                  <div className={cn(
                    "relative w-12 h-12 rounded-lg flex items-center justify-center border-2 transition-all duration-500",
                    isActive 
                      ? "bg-blue-50 border-blue-500" 
                      : "bg-gray-50 border-gray-200"
                  )}>
                    <Icon className={cn(
                      "w-5 h-5 transition-colors",
                      isActive ? "text-blue-600" : "text-gray-400"
                    )} />
                  </div>
                  <span className={cn(
                    "mt-2 text-xs font-medium transition-colors",
                    isActive ? "text-gray-900" : "text-gray-400"
                  )}>
                    {step.label}
                  </span>
                </motion.div>

                {idx < flowSteps.length - 1 && (
                  <div className="flex-1 mx-2 relative">
                    <div className="h-0.5 bg-gray-200 rounded-full" />
                    <motion.div
                      className="absolute inset-y-0 left-0 h-0.5 rounded-full bg-blue-500"
                      initial={{ width: 0 }}
                      animate={{ width: idx < activeIndex ? "100%" : "0%" }}
                      transition={{ duration: 0.5, delay: idx * 0.1 }}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Recent Events */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-500 mb-3">Recent Recovery Events</h4>
        {recentEvents.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            No recent events
          </div>
        ) : (
          recentEvents.map((event, idx) => (
            <motion.div
              key={event.id || idx}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                event.outcome === 'success' 
                  ? "bg-green-50 border-green-200" 
                  : event.outcome === 'failed'
                  ? "bg-red-50 border-red-200"
                  : "bg-amber-50 border-amber-200"
              )}
            >
              {event.outcome === 'success' ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : event.outcome === 'failed' ? (
                <XCircle className="w-4 h-4 text-red-600" />
              ) : (
                <Clock className="w-4 h-4 text-amber-600" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 truncate">{event.endpoint}</p>
                <p className="text-xs text-gray-500">
                  {event.healing_applied?.join(' → ') || 'No healing applied'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">{event.retry_count || 0} retries</p>
                <p className="text-xs text-gray-400">{event.latency_ms || 0}ms</p>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}