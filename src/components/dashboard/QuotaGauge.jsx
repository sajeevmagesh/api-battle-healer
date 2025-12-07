import React from 'react';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";
import { ProviderIcon } from './UIComponents';
import { TrendingUp, AlertTriangle, Zap } from 'lucide-react';

export default function QuotaGauge({ quotaData }) {
  const providers = ['openai', 'anthropic', 'gemini', 'azure'];
  
  const getUsageData = (provider) => {
    const data = quotaData.find(q => q.provider === provider);
    if (!data) return { percent: 0, used: 0, limit: 100, cost: 0, budget: 100 };
    
    const tokenPercent = data.tokens_limit ? (data.tokens_used / data.tokens_limit) * 100 : 0;
    const costPercent = data.budget_usd ? (data.cost_usd / data.budget_usd) * 100 : 0;
    
    return {
      tokenPercent: Math.min(tokenPercent, 100),
      costPercent: Math.min(costPercent, 100),
      tokensUsed: data.tokens_used || 0,
      tokensLimit: data.tokens_limit || 0,
      cost: data.cost_usd || 0,
      budget: data.budget_usd || 0,
      calls: data.calls_made || 0,
      callsLimit: data.calls_limit || 0,
      prediction: data.predicted_exhaustion
    };
  };

  return (
    <div className="bg-white border border-[#d0d7de] rounded-md p-6">
      <div className="mb-6">
        <h3 className="text-base font-semibold text-[#24292f] mb-1">Quota & Budget Tracking</h3>
        <p className="text-sm text-[#57606a]">Real-time usage monitoring</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map((provider, idx) => {
          const usage = getUsageData(provider);
          const isWarning = usage.tokenPercent > 70 || usage.costPercent > 70;
          const isCritical = usage.tokenPercent > 90 || usage.costPercent > 90;
          
          return (
            <motion.div
              key={provider}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.1 }}
              className="p-4 rounded-md border border-gray-200 bg-white"
            >
              <div className="flex items-center justify-between mb-4">
                <ProviderIcon provider={provider} showLabel size="md" />
                {isCritical && <AlertTriangle className="w-4 h-4 text-red-600" />}
              </div>

              {/* Token Usage Bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Tokens</span>
                  <span className="text-gray-900 font-medium">
                    {(usage.tokensUsed / 1000).toFixed(1)}k / {(usage.tokensLimit / 1000).toFixed(1)}k
                  </span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    className={cn(
                      "h-full rounded-full",
                      isCritical ? "bg-red-500" :
                      isWarning ? "bg-amber-500" :
                      "bg-green-500"
                    )}
                    initial={{ width: 0 }}
                    animate={{ width: `${usage.tokenPercent}%` }}
                    transition={{ duration: 1, delay: idx * 0.1 }}
                  />
                </div>
              </div>

              {/* Cost Bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">Budget</span>
                  <span className="text-gray-900 font-medium">
                    ${usage.cost.toFixed(2)} / ${usage.budget.toFixed(2)}
                  </span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    className={cn(
                      "h-full rounded-full",
                      usage.costPercent > 90 ? "bg-red-500" :
                      usage.costPercent > 70 ? "bg-amber-500" :
                      "bg-blue-500"
                    )}
                    initial={{ width: 0 }}
                    animate={{ width: `${usage.costPercent}%` }}
                    transition={{ duration: 1, delay: idx * 0.1 + 0.2 }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">{usage.calls} calls today</span>
                {usage.prediction && (
                  <span className="flex items-center gap-1 text-amber-600">
                    <TrendingUp className="w-3 h-3" />
                    Exhausts soon
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}