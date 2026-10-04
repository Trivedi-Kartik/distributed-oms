'use client';

import React from 'react';
import { 
  Activity, 
  ExternalLink, 
  RefreshCw, 
  Layers, 
  Server, 
  Radio, 
  FileCode2, 
  Eye 
} from 'lucide-react';
import { ServiceHealth } from '../lib/types';

interface HeaderProps {
  health: ServiceHealth;
  refreshing: boolean;
  onRefresh: () => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function Header({
  health,
  refreshing,
  onRefresh,
  activeTab,
  onTabChange,
}: HeaderProps) {
  const tabs = [
    { id: 'overview', label: 'Command Center', icon: Activity },
    { id: 'orders', label: 'Orders & Sagas', icon: Layers },
    { id: 'inventory', label: 'Warehouse & Stock', icon: Server },
    { id: 'payments', label: 'Payments & DLQ', icon: Radio },
    { id: 'swagger', label: 'API & Swagger Hub', icon: FileCode2 },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[rgba(255,255,255,0.08)] bg-[#07090e]/90 backdrop-blur-xl">
      {/* Top Banner / Status Strip */}
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 text-xs border-b border-[rgba(255,255,255,0.04)]">
        {/* Left: Health Monitors */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`pulse-dot ${health.orderService ? 'pulse-dot-online' : 'pulse-dot-offline'}`} />
            <span className="text-slate-400">Order Service :3001</span>
            {health.orderService && (
              <span className="code-font text-[10px] text-emerald-400">({health.latencyMs.orderService}ms)</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className={`pulse-dot ${health.inventoryService ? 'pulse-dot-online' : 'pulse-dot-offline'}`} />
            <span className="text-slate-400">Inventory Service :3002</span>
            {health.inventoryService && (
              <span className="code-font text-[10px] text-emerald-400">({health.latencyMs.inventoryService}ms)</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className={`pulse-dot ${health.paymentService ? 'pulse-dot-online' : 'pulse-dot-offline'}`} />
            <span className="text-slate-400">Payment Service :3003</span>
            {health.paymentService && (
              <span className="code-font text-[10px] text-emerald-400">({health.latencyMs.paymentService}ms)</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="pulse-dot pulse-dot-online" />
            <span className="text-slate-400">Kafka KRaft :9094</span>
          </div>
        </div>

        {/* Right: Observability Quick Links */}
        <div className="flex items-center gap-3">
          <a
            href="http://localhost:8080"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-slate-400 hover:text-cyan-400 transition-colors"
          >
            <span>Kafka UI</span>
            <ExternalLink size={12} />
          </a>
          <span className="text-slate-600">|</span>
          <a
            href="http://localhost:16686"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-slate-400 hover:text-indigo-400 transition-colors"
          >
            <span>Jaeger Traces</span>
            <ExternalLink size={12} />
          </a>
          <span className="text-slate-600">|</span>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-md border border-white/5"
            title="Refresh all metrics"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin text-indigo-400' : ''} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Main Header Bar */}
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-cyan-400 shadow-lg shadow-indigo-500/20">
            <Layers className="text-white" size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white">
                DISTRIBUTED <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">OMS</span>
              </h1>
              <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold text-indigo-400 border border-indigo-500/20">
                KRaft EDA
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              Saga Orchestration • Transactional Outbox • Event Streams
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex items-center gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06]">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export default Header;

