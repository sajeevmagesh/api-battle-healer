import React from 'react';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";
import { 
  RefreshCw, 
  Shield, 
  Key, 
  Wrench, 
  Database, 
  Archive, 
  Sparkles,
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight
} from 'lucide-react';
import { format } from 'date-fns';

const healingIcons = {
  retry: RefreshCw,
  failover: Shield,
  credential_rotation: Key,
  request_repair: Wrench,
  schema_recovery: Sparkles,
  cache_fallback: Archive,
  mock_response: Sparkles,
  queue_recovery: Database
};

const healingStyles = {
  retry: { bg: 'bg-blue-500/5', border: 'border-blue-500/20', iconBg: 'bg-blue-500/10', iconText: 'text-blue-400' },
  failover: { bg: 'bg-violet-500/5', border: 'border-violet-500/20', iconBg: 'bg-violet-500/10', iconText: 'text-violet-400' },
  credential_rotation: { bg: 'bg-cyan-500/5', border: 'border-cyan-500/20', iconBg: 'bg-cyan-500/10', iconText: 'text-cyan-400' },
  request_repair: { bg: 'bg-amber-500/5', border: 'border-amber-500/20', iconBg: 'bg-amber-500/10', iconText: 'text-amber-400' },
  schema_recovery: { bg: 'bg-pink-500/5', border: 'border-pink-500/20', iconBg: 'bg-pink-500/10', iconText: 'text-pink-400' },
  cache_fallback: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/20', iconBg: 'bg-emerald-500/10', iconText: 'text-emerald-400' },
  mock_response: { bg: 'bg-rose-500/5', border: 'border-rose-500/20', iconBg: 'bg-rose-500/10', iconText: 'text-rose-400' },
  queue_recovery: { bg: 'bg-orange-500/5', border: 'border-orange-500/20', iconBg: 'bg-orange-500/10', iconText: 'text-orange-400' }
};

export default function HealingTimeline({ logs, onViewDetails }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-300 transition-colors">
      <div className="mb-6">
        <h3 className="text-[15px] font-semibold text-black mb-1">Healing Timeline</h3>
        <p className="text-[13px] text-gray-500">Recovery actions and outcomes</p>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-gray-300 via-gray-200 to-transparent" />

        <div className="space-y-4">
          {logs.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-[13px]">No healing events yet</p>
            </div>
          ) : (
            logs.map((log, idx) => {
              const Icon = healingIcons[log.healing_type] || Sparkles;
              const style = healingStyles[log.healing_type] || healingStyles.retry;
              
              return (
                <motion.div
                  key={log.id || idx}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="relative pl-14"
                >
                  {/* Timeline node */}
                  <div className={cn(
                    "absolute left-4 w-5 h-5 rounded-full border-2 flex items-center justify-center bg-white",
                    log.outcome === 'resolved' 
                      ? "border-green-500"
                      : log.outcome === 'failed'
                      ? "border-red-500"
                      : "border-amber-500"
                  )}>
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      log.outcome === 'resolved' ? "bg-green-500" :
                      log.outcome === 'failed' ? "bg-red-500" : "bg-amber-500"
                    )} />
                  </div>

                  {/* Event card */}
                  <div 
                    className="p-4 rounded-md border border-gray-200 cursor-pointer transition-all hover:border-gray-300 hover:shadow-sm bg-white"
                    onClick={() => onViewDetails && onViewDetails(log)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="text-[13px] font-medium text-gray-900 capitalize">
                          {log.healing_type.replace(/_/g, ' ')}
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          {log.action_taken || 'Action performed'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[11px] font-medium",
                          log.outcome === 'resolved' 
                            ? "bg-green-50 text-green-700 border border-green-200"
                            : log.outcome === 'failed'
                            ? "bg-red-50 text-red-700 border border-red-200"
                            : "bg-amber-50 text-amber-700 border border-amber-200"
                        )}>
                          {log.outcome}
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                      </div>
                      </div>

                      <div className="flex items-center gap-4 mt-3 text-[11px] text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {log.duration_ms || 0}ms
                      </span>
                      {log.root_cause && (
                        <span className="truncate max-w-[200px]">
                          Cause: {log.root_cause}
                        </span>
                      )}
                      <span className="ml-auto">
                        {log.created_date && format(new Date(log.created_date), 'HH:mm:ss')}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}