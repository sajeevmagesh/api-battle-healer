import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from "@/lib/utils";
import { StatusPulse, ProviderIcon } from './UIComponents';
import { 
  RefreshCw, 
  Clock, 
  CheckCircle,
  X
} from 'lucide-react';
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export default function RecoveryQueuePanel({ queue, onRetry, onRemove, onRetryAll }) {
  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const retryingCount = queue.filter(q => q.status === 'retrying').length;
  const failedCount = queue.filter(q => q.status === 'failed').length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-300 transition-colors">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-[15px] font-semibold text-black mb-1">Recovery Queue</h3>
          <p className="text-[13px] text-gray-500">Failed requests awaiting retry</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-gray-200 text-gray-600 hover:bg-gray-50 h-8 text-[13px]"
          onClick={() => onRetryAll && onRetryAll()}
          disabled={pendingCount === 0}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Retry All
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="p-3 rounded-md border border-gray-200 bg-white">
          <p className="text-[11px] text-gray-500 mb-1">Pending</p>
          <p className="text-xl font-semibold text-gray-900">{pendingCount}</p>
        </div>
        <div className="p-3 rounded-md border border-gray-200 bg-white">
          <p className="text-[11px] text-gray-500 mb-1">Retrying</p>
          <p className="text-xl font-semibold text-blue-600">{retryingCount}</p>
        </div>
        <div className="p-3 rounded-md border border-gray-200 bg-white">
          <p className="text-[11px] text-gray-500 mb-1">Failed</p>
          <p className="text-xl font-semibold text-red-600">{failedCount}</p>
        </div>
      </div>

      {/* Queue Items */}
      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {queue.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-[13px]">Queue is empty</p>
            </div>
          ) : (
            queue.map((item, idx) => (
              <motion.div
                key={item.id || idx}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -100 }}
                className={cn(
                  "p-4 rounded-md border transition-all bg-white",
                  item.status === 'pending' 
                    ? "border-amber-200" 
                    : item.status === 'retrying'
                    ? "border-blue-200"
                    : item.status === 'failed'
                    ? "border-red-200"
                    : "border-gray-200"
                )}
              >
                <div className="flex items-start gap-3">
                  <StatusPulse status={item.status} />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] font-medium text-gray-900 truncate">
                        {item.endpoint}
                      </span>
                      <span className={cn(
                        "px-1.5 py-0.5 text-[10px] rounded font-medium border",
                        item.status === 'pending' ? "bg-amber-50 text-amber-700 border-amber-200" :
                        item.status === 'retrying' ? "bg-blue-50 text-blue-700 border-blue-200" :
                        "bg-red-50 text-red-700 border-red-200"
                      )}>
                        {item.status}
                      </span>
                    </div>
                    
                    {/* Retry Progress */}
                    <div className="mb-2">
                      <div className="flex justify-between text-[11px] mb-1">
                        <span className="text-gray-500">Retry Progress</span>
                        <span className="text-gray-700">
                          {item.retry_attempts || 0}/{item.max_retries || 5}
                        </span>
                      </div>
                      <Progress 
                        value={((item.retry_attempts || 0) / (item.max_retries || 5)) * 100} 
                        className="h-1.5" 
                      />
                    </div>

                    {item.error_message && (
                      <p className="text-[11px] text-red-600 truncate">{item.error_message}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {item.next_retry_at 
                          ? format(new Date(item.next_retry_at), 'HH:mm:ss')
                          : 'Pending'
                        }
                      </span>
                      {item.priority && <span>Priority: {item.priority}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px] border-gray-200 text-gray-600 hover:bg-gray-50"
                      onClick={() => onRetry && onRetry(item)}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Retry
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                      onClick={() => onRemove && onRemove(item)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}