import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from "@/lib/utils";
import { 
  Network,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Globe,
  AlertTriangle,
  Clock,
  Zap,
  ChevronRight,
  Shield,
  Key,
  Server,
  Activity
} from 'lucide-react';

const fixActionIcons = {
  refresh_token: { icon: RefreshCw, label: 'Token Refreshed', color: 'blue' },
  rotate_token: { icon: Key, label: 'Token Rotated', color: 'purple' },
  network_error: { icon: Network, label: 'Network Error', color: 'red' },
  retry_budget_exhausted: { icon: AlertTriangle, label: 'Budget Exhausted', color: 'amber' },
};

const getStatusColor = (status) => {
  if (!status) return 'gray';
  if (status >= 200 && status < 300) return 'green';
  if (status >= 400 && status < 500) return 'amber';
  if (status >= 500) return 'red';
  return 'gray';
};

const AttemptCard = ({ attempt, index, total }) => {
  const [expanded, setExpanded] = useState(false);
  const statusColor = getStatusColor(attempt.status);
  const isSuccess = attempt.status >= 200 && attempt.status < 300;
  const isLastAttempt = index === total - 1;
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="relative"
    >
      {/* Timeline connector */}
      {!isLastAttempt && (
        <div className="absolute left-[19px] top-10 bottom-0 w-0.5 bg-gradient-to-b from-[#d0d7de] to-transparent" />
      )}
      
      <div
        className={cn(
          "relative bg-white border rounded-lg transition-all",
          isSuccess ? "border-green-200" : "border-[#d0d7de]",
          expanded && "shadow-md"
        )}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full p-4 text-left hover:bg-[#f6f8fa] transition-colors rounded-lg"
        >
          <div className="flex items-center gap-4">
            {/* Status indicator */}
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2",
              statusColor === 'green' ? "bg-green-50 border-green-500" :
              statusColor === 'amber' ? "bg-amber-50 border-amber-500" :
              statusColor === 'red' ? "bg-red-50 border-red-500" :
              "bg-gray-50 border-gray-300"
            )}>
              {isSuccess ? (
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              ) : attempt.error ? (
                <XCircle className="w-5 h-5 text-red-600" />
              ) : (
                <Activity className="w-5 h-5 text-gray-500" />
              )}
            </div>

            {/* Attempt info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-[#24292f]">
                  Attempt {attempt.attempt}
                </span>
                {attempt.status && (
                  <span className={cn(
                    "px-2 py-0.5 rounded-md text-xs font-medium",
                    statusColor === 'green' ? "bg-green-100 text-green-700" :
                    statusColor === 'amber' ? "bg-amber-100 text-amber-700" :
                    statusColor === 'red' ? "bg-red-100 text-red-700" :
                    "bg-gray-100 text-gray-700"
                  )}>
                    {attempt.status}
                  </span>
                )}
              </div>
              
              <div className="flex items-center gap-2 text-xs text-[#57606a]">
                <Globe className="w-3 h-3" />
                <span className="font-mono">{attempt.region || 'default'}</span>
                <span>•</span>
                <span className="truncate">{attempt.url}</span>
              </div>

              {attempt.error && !expanded && (
                <div className="mt-1 text-xs text-red-600 truncate">
                  {attempt.error}
                </div>
              )}
            </div>

            <ChevronRight className={cn(
              "w-4 h-4 text-[#57606a] transition-transform",
              expanded && "rotate-90"
            )} />
          </div>
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-[#d0d7de]"
            >
              <div className="p-4 space-y-3 bg-[#f6f8fa]">
                {attempt.error && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <div className="text-xs font-semibold text-red-800 mb-1">Error</div>
                    <div className="text-xs text-red-700">{attempt.error}</div>
                  </div>
                )}

                {attempt.fixActions && attempt.fixActions.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-[#24292f] mb-2">Fix Actions Applied</div>
                    <div className="flex flex-wrap gap-2">
                      {attempt.fixActions.map((action, idx) => {
                        const actionKey = action.split('_').slice(0, 2).join('_');
                        const config = fixActionIcons[actionKey];
                        const Icon = config?.icon || Shield;
                        
                        let label = config?.label;
                        if (action.startsWith('retry_status_')) {
                          const status = action.split('_')[2];
                          label = `Retry ${status}`;
                        } else if (action.startsWith('fallback_region_')) {
                          const region = action.split('_')[2];
                          label = `Fallback → ${region}`;
                        }
                        
                        return (
                          <div
                            key={idx}
                            className={cn(
                              "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium",
                              config?.color === 'blue' ? "bg-blue-100 text-blue-700" :
                              config?.color === 'purple' ? "bg-purple-100 text-purple-700" :
                              config?.color === 'red' ? "bg-red-100 text-red-700" :
                              config?.color === 'amber' ? "bg-amber-100 text-amber-700" :
                              "bg-gray-100 text-gray-700"
                            )}
                          >
                            <Icon className="w-3 h-3" />
                            {label || action}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default function SmartFetchMonitor({ requests = [] }) {
  const [selectedRequest, setSelectedRequest] = useState(null);
  
  const recentRequests = requests.slice(0, 5);
  const activeRequest = selectedRequest || recentRequests[0];

  return (
    <div className="bg-white border border-[#d0d7de] rounded-md">
      <div className="border-b border-[#d0d7de] bg-[#f6f8fa] px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-[#57606a]" />
          <h3 className="text-sm font-semibold text-[#24292f]">Request Monitor</h3>
        </div>
      </div>

      <div className="p-4">
        {!activeRequest ? (
          <div className="text-center py-16 text-[#57606a]">
            <Network className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium text-[#24292f]">No requests tracked</p>
            <p className="text-xs mt-1">Run a simulation to see results</p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-3">
              <div className="border border-[#d0d7de] rounded-md p-3">
                <div className="text-[10px] font-medium text-[#57606a] uppercase mb-1">Attempts</div>
                <div className="text-xl font-bold text-[#24292f]">
                  {activeRequest.meta?.attempts?.length || 0}
                </div>
              </div>
              
              <div className="border border-[#d0d7de] rounded-md p-3">
                <div className="text-[10px] font-medium text-[#57606a] uppercase mb-1">Retries</div>
                <div className="text-xl font-bold text-[#24292f]">
                  {activeRequest.meta?.retries || 0}
                </div>
              </div>
              
              <div className="border border-[#d0d7de] rounded-md p-3">
                <div className="text-[10px] font-medium text-[#57606a] uppercase mb-1">Regions</div>
                <div className="text-xl font-bold text-[#24292f]">
                  {activeRequest.meta?.regionsTried?.length || 0}
                </div>
              </div>
              
              <div className="border border-[#d0d7de] rounded-md p-3">
                <div className="text-[10px] font-medium text-[#57606a] uppercase mb-1">Fixes</div>
                <div className="text-xl font-bold text-[#24292f]">
                  {activeRequest.meta?.fixActions?.length || 0}
                </div>
              </div>
            </div>

            {/* Attempt Timeline */}
            <div>
              <div className="text-xs font-semibold text-[#57606a] uppercase mb-3">Timeline</div>
              <div className="space-y-2">
                {activeRequest.meta?.attempts?.map((attempt, idx) => (
                  <AttemptCard
                    key={idx}
                    attempt={attempt}
                    index={idx}
                    total={activeRequest.meta.attempts.length}
                  />
                ))}
              </div>
            </div>

            {/* Final Result */}
            {activeRequest.error ? (
              <div className="border border-red-200 bg-red-50 rounded-md p-4">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="w-4 h-4 text-red-600" />
                  <span className="text-sm font-semibold text-[#24292f]">Request Failed</span>
                </div>
                <p className="text-xs text-[#57606a]">{activeRequest.error.message}</p>
                {activeRequest.error.status && (
                  <p className="text-[10px] text-[#57606a] mt-1">HTTP {activeRequest.error.status}</p>
                )}
              </div>
            ) : (
              <div className="border border-green-200 bg-green-50 rounded-md p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-semibold text-[#24292f]">Request Successful</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}