import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from "@/lib/utils";
import { 
  Wrench, 
  ArrowRight, 
  CheckCircle, 
  XCircle, 
  Sparkles,
  Code,
  AlertTriangle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

const mockRepairs = [
  {
    id: 1,
    original: '{ "name": "Test", "count": "five" }',
    repaired: '{ "name": "Test", "count": 5 }',
    issue: 'Type mismatch: string to number',
    model: 'gemini-pro',
    success: true
  },
  {
    id: 2,
    original: '{ "items": [1, 2, 3], "metadata": null }',
    repaired: '{ "items": [1, 2, 3], "metadata": {} }',
    issue: 'Null value replaced with empty object',
    model: 'gemini-pro',
    success: true
  },
  {
    id: 3,
    original: '{ "date": "invalid-date" }',
    repaired: '{ "date": "2024-01-15T00:00:00Z" }',
    issue: 'Invalid date format corrected',
    model: 'gemini-pro',
    success: true
  }
];

export default function RequestRepairViz({ repairs = mockRepairs }) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 hover:border-gray-300 transition-colors">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-[15px] font-semibold text-black mb-1">Request Repair Engine</h3>
          <p className="text-[13px] text-gray-500">AI-powered malformed request correction</p>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
          <span>Powered by Gemini</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="p-3 rounded-md border border-gray-200 bg-white text-center">
          <p className="text-xl font-semibold text-green-600">94%</p>
          <p className="text-[11px] text-gray-500">Success Rate</p>
        </div>
        <div className="p-3 rounded-md border border-gray-200 bg-white text-center">
          <p className="text-xl font-semibold text-gray-900">127</p>
          <p className="text-[11px] text-gray-500">Repairs Today</p>
        </div>
        <div className="p-3 rounded-md border border-gray-200 bg-white text-center">
          <p className="text-xl font-semibold text-blue-600">45ms</p>
          <p className="text-[11px] text-gray-500">Avg Time</p>
        </div>
      </div>

      {/* Repair Items */}
      <div className="space-y-3">
        <AnimatePresence>
          {repairs.map((repair, idx) => {
            const isExpanded = expandedId === repair.id;
            
            return (
              <motion.div
                key={repair.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className={cn(
                  "rounded-md border overflow-hidden transition-all",
                  repair.success 
                    ? "bg-green-50/50 border-green-200" 
                    : "bg-red-50/50 border-red-200"
                )}
              >
                {/* Header */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : repair.id)}
                  className="w-full p-4 flex items-center gap-3 text-left hover:bg-gray-50/50 transition-colors"
                >
                  {repair.success ? (
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-gray-900">{repair.issue}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Model: {repair.model}
                    </p>
                  </div>

                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </button>

                {/* Expanded Content */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-gray-200"
                    >
                      <div className="p-4 bg-white">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Original */}
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <XCircle className="w-3 h-3 text-red-600" />
                              <span className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">
                                Original (Malformed)
                              </span>
                            </div>
                            <pre className="p-3 rounded-md bg-red-50 border border-red-200 text-[11px] text-red-700 overflow-x-auto font-mono">
                              {repair.original}
                            </pre>
                          </div>

                          {/* Repaired */}
                          <div>
                            <div className="flex items-center gap-2 mb-2">
                              <CheckCircle className="w-3 h-3 text-green-600" />
                              <span className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">
                                Repaired
                              </span>
                            </div>
                            <pre className="p-3 rounded-md bg-green-50 border border-green-200 text-[11px] text-green-700 overflow-x-auto font-mono">
                              {repair.repaired}
                            </pre>
                          </div>
                        </div>

                        {/* Flow Visualization */}
                        <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-gray-500">
                          <span className="flex items-center gap-1">
                            <Code className="w-3 h-3" /> Parse
                          </span>
                          <ArrowRight className="w-3 h-3" />
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Detect
                          </span>
                          <ArrowRight className="w-3 h-3" />
                          <span className="flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-amber-600" /> Infer
                          </span>
                          <ArrowRight className="w-3 h-3" />
                          <span className="flex items-center gap-1">
                            <CheckCircle className="w-3 h-3 text-green-600" /> Repair
                          </span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}