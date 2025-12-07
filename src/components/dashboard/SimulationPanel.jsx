import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from "@/lib/utils";
import { 
  FlaskConical, 
  Play, 
  Pause, 
  RotateCcw, 
  Zap, 
  Server, 
  Key,
  Shield,
  Database,
  AlertTriangle,
  CheckCircle
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const simulationScenarios = [
  { id: '5xx_burst', label: '5xx Error Burst', icon: AlertTriangle, color: 'rose' },
  { id: 'rate_limit', label: 'Rate Limit (429)', icon: Zap, color: 'amber' },
  { id: 'region_outage', label: 'Region Outage', icon: Server, color: 'violet' },
  { id: 'credential_expire', label: 'Credential Expiry', icon: Key, color: 'cyan' },
  { id: 'schema_drift', label: 'Schema Drift', icon: Database, color: 'pink' },
  { id: 'full_cascade', label: 'Full Cascade', icon: Shield, color: 'red' },
];

export default function SimulationPanel({ onRunSimulation, isRunning }) {
  const [selectedScenario, setSelectedScenario] = useState('5xx_burst');
  const [intensity, setIntensity] = useState([50]);
  const [duration, setDuration] = useState([30]);
  const [autoHeal, setAutoHeal] = useState(true);
  const [simulationResults, setSimulationResults] = useState(null);
  const [progress, setProgress] = useState(0);

  const handleRun = () => {
    if (onRunSimulation) {
      onRunSimulation({
        scenario: selectedScenario,
        intensity: intensity[0],
        duration: duration[0],
        autoHeal
      });
      
      setProgress(0);
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setSimulationResults({
              recoveryRate: (95 + Math.random() * 5).toFixed(1),
              avgLatency: Math.floor(200 + Math.random() * 100),
              healsApplied: Math.floor(8 + Math.random() * 10),
              failuresDetected: Math.floor(15 + Math.random() * 20)
            });
            return 100;
          }
          return prev + 2;
        });
      }, duration[0] * 10);
    }
  };

  const handleReset = () => {
    setSimulationResults(null);
    setProgress(0);
  };

  return (
    <div className="bg-white border border-[#d0d7de] rounded-md">
      <div className="border-b border-[#d0d7de] bg-[#f6f8fa] px-4 py-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-[#57606a]" />
          <h3 className="text-sm font-semibold text-[#24292f]">Simulation Configuration</h3>
        </div>
      </div>

      <div className="p-4 space-y-5">

        {/* Scenario Selection */}
        <div>
          <Label className="text-xs font-semibold text-[#57606a] uppercase mb-2 block">Failure Scenario</Label>
          <div className="grid grid-cols-2 gap-2">
            {simulationScenarios.map((scenario) => {
              const ScenarioIcon = scenario.icon;
              const isActive = selectedScenario === scenario.id;
              
              return (
                <button
                  key={scenario.id}
                  onClick={() => !isRunning && setSelectedScenario(scenario.id)}
                  disabled={isRunning}
                  className={cn(
                    "flex items-center gap-2 p-3 rounded-md border text-left transition-all",
                    isActive 
                      ? "bg-[#f1f8ff] border-[#0969da] ring-1 ring-[#0969da]"
                      : "bg-white border-[#d0d7de] hover:border-[#0969da]/50 hover:bg-[#f6f8fa]",
                    isRunning && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                    isActive ? "bg-[#0969da] text-white" : "bg-[#f6f8fa] text-[#57606a]"
                  )}>
                    <ScenarioIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className={cn(
                      "text-xs font-semibold",
                      isActive ? "text-[#0969da]" : "text-[#24292f]"
                    )}>
                      {scenario.label}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Configuration */}
        <div className="space-y-4">
          <Label className="text-xs font-semibold text-[#57606a] uppercase block">Settings</Label>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-xs text-[#24292f]">Intensity ({intensity[0]}%)</Label>
              </div>
              <Slider
                value={intensity}
                onValueChange={setIntensity}
                max={100}
                step={10}
                disabled={isRunning}
                className="py-1"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-xs text-[#24292f]">Duration ({duration[0]}s)</Label>
              </div>
              <Slider
                value={duration}
                onValueChange={setDuration}
                max={120}
                step={10}
                disabled={isRunning}
                className="py-1"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#d0d7de] mt-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#57606a]" />
              <Label className="text-sm text-[#24292f] font-medium">Auto-Healing</Label>
            </div>
            <Switch checked={autoHeal} onCheckedChange={setAutoHeal} disabled={isRunning} />
          </div>
        </div>

        {/* Status Indicator */}
        {isRunning && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-md border border-blue-100 text-sm"
          >
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            Running simulation sequence...
          </motion.div>
        )}

        {/* Controls */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleRun}
            disabled={isRunning}
            className={cn(
              "flex-1 gap-2",
              "bg-[#1a7f37] hover:bg-[#1a7f37]/90 text-white"
            )}
          >
            <Play className="w-4 h-4" />
            {isRunning ? 'Running...' : 'Run Simulation'}
          </Button>
          <Button
            onClick={handleReset}
            variant="outline"
            className="border-[#d0d7de]"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}