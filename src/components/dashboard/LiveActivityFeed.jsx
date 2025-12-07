import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from "@/lib/utils";
import { StatusPulse, ProviderIcon } from './UIComponents';
import { 
  Activity, 
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react';
import { format } from 'date-fns';

export default function LiveActivityFeed({ events, maxItems = 10 }) {
  const [recentEvents, setRecentEvents] = useState(events?.slice(0, maxItems) || []);

  useEffect(() => {
    setRecentEvents(events?.slice(0, maxItems) || []);
  }, [events, maxItems]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 h-full hover:border-gray-300 transition-colors">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-[15px] font-semibold text-black mb-1">Live Activity</h3>
          <p className="text-[13px] text-gray-500">Real-time request monitoring</p>
        </div>
        <span className="text-[11px] text-gray-400 font-medium">
          {recentEvents.length} events
        </span>
      </div>

      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {recentEvents.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Waiting for activity...</p>
            </div>
          ) : (
            recentEvents.map((event, idx) => (
              <motion.div
                key={event.id || idx}
                layout
                initial={{ opacity: 0, x: -20, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "relative p-3 rounded-lg border transition-all group cursor-pointer hover:border-gray-300 hover:shadow-sm",
                  event.outcome === 'success' 
                    ? "bg-green-50/50 border-green-100" 
                    : event.outcome === 'failed'
                    ? "bg-red-50/50 border-red-100"
                    : event.outcome === 'degraded'
                    ? "bg-amber-50/50 border-amber-100"
                    : "bg-gray-50 border-gray-200"
                )}
              >
                <div className="flex items-center gap-3">
                  <ProviderIcon provider={event.provider} size="sm" />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {event.endpoint}
                      </span>
                      {event.retry_count > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-blue-600">
                          <RefreshCw className="w-3 h-3" />
                          {event.retry_count}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        {event.outcome === 'success' ? (
                          <CheckCircle className="w-3 h-3 text-green-600" />
                        ) : event.outcome === 'failed' ? (
                          <XCircle className="w-3 h-3 text-red-600" />
                        ) : (
                          <Clock className="w-3 h-3 text-amber-600" />
                        )}
                        <span className={cn(
                          event.outcome === 'success' ? "text-green-600" :
                          event.outcome === 'failed' ? "text-red-600" : "text-amber-600"
                        )}>
                          {event.outcome}
                        </span>
                      </span>
                      <span>{event.status_code || '-'}</span>
                      {event.region && <span>{event.region}</span>}
                    </div>
                  </div>

                  <div className="text-right">
                    <p className={cn(
                      "text-sm font-medium",
                      event.latency_ms > 1000 ? "text-red-600" :
                      event.latency_ms > 500 ? "text-amber-600" : "text-green-600"
                    )}>
                      {event.latency_ms || 0}ms
                    </p>
                    <p className="text-xs text-gray-500">
                      {event.created_date && format(new Date(event.created_date), 'HH:mm:ss')}
                    </p>
                  </div>
                </div>

                {event.healing_applied?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {event.healing_applied.map((heal, hIdx) => (
                      <span
                        key={hIdx}
                        className="px-1.5 py-0.5 text-[10px] rounded bg-blue-100 text-blue-700 capitalize"
                      >
                        {heal}
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}