import React from 'react';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";
import { 
  ArrowRight, 
  AlertTriangle,
  CheckCircle,
  Sparkles,
  RefreshCw
} from 'lucide-react';

const schemaDrifts = [
  {
    id: 1,
    field: 'user_name',
    expected: 'username',
    type: 'rename',
    resolved: true,
    mappedTo: 'username'
  },
  {
    id: 2,
    field: 'created_timestamp',
    expected: 'created_at',
    type: 'rename',
    resolved: true,
    mappedTo: 'created_at'
  },
  {
    id: 3,
    field: 'metadata.tags',
    expected: 'tags',
    type: 'restructure',
    resolved: true,
    mappedTo: 'tags'
  },
  {
    id: 4,
    field: 'status_code',
    expected: 'status',
    type: 'missing',
    resolved: false,
    mappedTo: null
  }
];

export default function SchemaRecoveryPanel({ drifts = schemaDrifts }) {
  const resolvedCount = drifts.filter(d => d.resolved).length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-300 transition-colors">
      <div className="mb-6">
        <h3 className="text-[15px] font-semibold text-black mb-1">Schema Drift Recovery</h3>
        <p className="text-[13px] text-gray-500">Auto-detect and map field changes</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="p-3 rounded-md border border-gray-200 bg-white text-center">
          <p className="text-xl font-semibold text-gray-900">{drifts.length}</p>
          <p className="text-[11px] text-gray-500">Drifts Detected</p>
        </div>
        <div className="p-3 rounded-md border border-gray-200 bg-white text-center">
          <p className="text-xl font-semibold text-green-600">{resolvedCount}</p>
          <p className="text-[11px] text-gray-500">Auto-Resolved</p>
        </div>
        <div className="p-3 rounded-md border border-gray-200 bg-white text-center">
          <p className="text-xl font-semibold text-amber-600">{drifts.length - resolvedCount}</p>
          <p className="text-[11px] text-gray-500">Pending</p>
        </div>
      </div>

      {/* Drift Mappings */}
      <div className="space-y-2">
        {drifts.map((drift, idx) => (
          <motion.div
            key={drift.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.1 }}
            className={cn(
              "p-4 rounded-md border",
              drift.resolved 
                ? "bg-green-50/50 border-green-200"
                : "bg-amber-50/50 border-amber-200"
            )}
          >
            <div className="flex items-center gap-3">
              {/* Source Field */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-medium border",
                    drift.type === 'rename' 
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : drift.type === 'restructure'
                      ? "bg-violet-50 text-violet-700 border-violet-200"
                      : "bg-red-50 text-red-700 border-red-200"
                  )}>
                    {drift.type}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="px-2 py-1 rounded bg-gray-100 text-red-700 text-[11px] font-mono border border-gray-200">
                    {drift.field}
                  </code>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                  <code className={cn(
                    "px-2 py-1 rounded text-[11px] font-mono border",
                    drift.resolved 
                      ? "bg-green-100 text-green-700 border-green-200"
                      : "bg-amber-100 text-amber-700 border-amber-200"
                  )}>
                    {drift.mappedTo || drift.expected}
                  </code>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center gap-2">
                {drift.resolved ? (
                  <>
                    <Sparkles className="w-4 h-4 text-green-600" />
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 text-amber-600 animate-spin" />
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                  </>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-6 flex items-center justify-center gap-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          Rename
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-violet-500" />
          Restructure
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          Missing
        </span>
      </div>
    </div>
  );
}