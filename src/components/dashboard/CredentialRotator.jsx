import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from "@/lib/utils";
import { StatusPulse, ProviderIcon } from './UIComponents';
import { Key, RotateCw, Shield, Clock, AlertCircle, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";

export default function CredentialRotator({ credentials, onRotate }) {
  const groupedCredentials = credentials.reduce((acc, cred) => {
    if (!acc[cred.provider]) acc[cred.provider] = [];
    acc[cred.provider].push(cred);
    return acc;
  }, {});

  return (
    <div className="bg-white border border-[#d0d7de] rounded-md p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-semibold text-[#24292f] mb-1">Credential Pool</h3>
          <p className="text-sm text-[#57606a]">Auto-rotating authentication keys</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-gray-200 text-gray-600 hover:bg-gray-50 h-8 text-[13px]"
          onClick={() => onRotate && onRotate()}
        >
          <RotateCw className="w-3.5 h-3.5 mr-1.5" />
          Rotate All
        </Button>
      </div>

      <div className="space-y-4">
        {Object.entries(groupedCredentials).map(([provider, creds], idx) => (
          <motion.div
            key={provider}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="p-4 rounded-md border border-gray-200 bg-white"
          >
            <div className="flex items-center justify-between mb-4">
              <ProviderIcon provider={provider} showLabel />
              <span className="text-[11px] text-gray-500 font-medium">{creds.length} keys</span>
            </div>

            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {creds.map((cred, credIdx) => (
                  <motion.div
                    key={cred.id || credIdx}
                    layout
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-md border transition-all",
                      cred.status === 'active' 
                        ? "bg-green-50/50 border-green-200" 
                        : cred.status === 'rotating'
                        ? "bg-blue-50/50 border-blue-200"
                        : cred.status === 'quota_exceeded'
                        ? "bg-amber-50/50 border-amber-200"
                        : "bg-gray-50 border-gray-200"
                    )}
                  >
                    <StatusPulse status={cred.status} />
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-gray-900">{cred.key_alias}</span>
                        {cred.is_fallback && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-200 text-gray-700 font-medium">
                            FALLBACK
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-1">
                        {cred.calls_today !== undefined && (
                          <span>{cred.calls_today}/{cred.daily_limit || '∞'} calls</span>
                        )}
                        {cred.expires_at && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Expires {format(new Date(cred.expires_at), 'MMM d')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {cred.status === 'rotating' && (
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        >
                          <RotateCw className="w-4 h-4 text-blue-600" />
                        </motion.div>
                      )}
                      {cred.status === 'active' && (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      )}
                      {cred.status === 'expired' && (
                        <AlertCircle className="w-4 h-4 text-red-600" />
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        ))}

        {Object.keys(groupedCredentials).length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Key className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-[13px]">No credentials configured</p>
          </div>
        )}
      </div>
    </div>
  );
}