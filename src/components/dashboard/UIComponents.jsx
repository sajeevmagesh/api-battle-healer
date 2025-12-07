import React from 'react';
import { motion } from 'framer-motion';
import { Bot, Cloud, Sparkles, Server, Cpu, Boxes } from 'lucide-react';
import { cn } from "@/lib/utils";

export function StatusPulse({ status, size = "md" }) {
  const sizeMap = {
    sm: "w-2 h-2",
    md: "w-3 h-3",
    lg: "w-4 h-4"
  };

  const colorMap = {
    healthy: "bg-emerald-500",
    degraded: "bg-amber-500",
    unhealthy: "bg-rose-500",
    maintenance: "bg-blue-500",
    active: "bg-emerald-500",
    rotating: "bg-cyan-500",
    expired: "bg-rose-500",
    disabled: "bg-slate-500",
    quota_exceeded: "bg-amber-500",
    pending: "bg-amber-500",
    retrying: "bg-blue-500",
    completed: "bg-emerald-500",
    failed: "bg-rose-500",
    success: "bg-emerald-500"
  };

  const color = colorMap[status] || "bg-slate-500";

  return (
    <span className="relative inline-flex">
      <span className={cn("rounded-full", sizeMap[size], color)} />
      <motion.span
        className={cn(
          "absolute inline-flex rounded-full opacity-75",
          sizeMap[size],
          color
        )}
        animate={{ scale: [1, 1.5, 1], opacity: [0.75, 0, 0.75] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
    </span>
  );
}

const providerConfig = {
  openai: { icon: Sparkles, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  anthropic: { icon: Bot, color: "text-amber-400", bg: "bg-amber-500/10" },
  gemini: { icon: Sparkles, color: "text-blue-400", bg: "bg-blue-500/10" },
  azure: { icon: Cloud, color: "text-cyan-400", bg: "bg-cyan-500/10" },
  aws: { icon: Server, color: "text-orange-400", bg: "bg-orange-500/10" },
  custom: { icon: Boxes, color: "text-violet-400", bg: "bg-violet-500/10" }
};

export function ProviderIcon({ provider, size = "md", showLabel = false }) {
  const config = providerConfig[provider] || providerConfig.custom;
  const Icon = config.icon;
  
  const sizeMap = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6"
  };

  const containerSize = {
    sm: "p-1.5",
    md: "p-2",
    lg: "p-2.5"
  };

  return (
    <div className="flex items-center gap-2">
      <div className={cn("rounded-lg", containerSize[size], config.bg)}>
        <Icon className={cn(sizeMap[size], config.color)} />
      </div>
      {showLabel && (
        <span className="text-sm font-medium text-slate-300 capitalize">
          {provider}
        </span>
      )}
    </div>
  );
}