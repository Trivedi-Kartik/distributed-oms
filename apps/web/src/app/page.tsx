'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Header from '../components/Header';
import OverviewTab from '../components/OverviewTab';
import OrdersTab from '../components/OrdersTab';
import InventoryTab from '../components/InventoryTab';
import PaymentsTab from '../components/PaymentsTab';
import SwaggerTab from '../components/SwaggerTab';
import CreateOrderModal from '../components/CreateOrderModal';
import RestockModal from '../components/RestockModal';
import CreateProductModal from '../components/CreateProductModal';
import ToastContainer, { ToastMessage } from '../components/Toast';
import { 
  Order, 
  OrderSummaryStats,
  InventoryItem, 
  InventorySummary,
  Reservation, 
  PaymentRecord, 
  PaymentStats,
  ProcessedEvent, 
  ServiceHealth 
} from '../lib/types';
import { 
  fetchOrderSummaryStats,
  fetchOrders, 
  fetchInventory, 
  fetchReservations, 
  fetchPaymentStats,
  fetchPayments, 
  fetchProcessedEvents, 
  checkServicesHealth,
  triggerDlqReplay
} from '../lib/api';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'inventory' | 'payments' | 'swagger'>('overview');
  
  // Telemetry & entity states
  const [orderStats, setOrderStats] = useState<OrderSummaryStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [inventorySummary, setInventorySummary] = useState<InventorySummary | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [paymentStats, setPaymentStats] = useState<PaymentStats | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [processedEvents, setProcessedEvents] = useState<ProcessedEvent[]>([]);
  
  const [health, setHealth] = useState<ServiceHealth>({
    orderService: false,
    inventoryService: false,
    paymentService: false,
    latencyMs: { orderService: 0, inventoryService: 0, paymentService: 0 },
    lastChecked: 'Checking...'
  });
  
  // UI states
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Modals
  const [isCreateOrderOpen, setIsCreateOrderOpen] = useState(false);
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [restockSku, setRestockSku] = useState<string | null>(null);
  const [isCreateProductOpen, setIsCreateProductOpen] = useState(false);

  // Toast notification dispatcher
  const showToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Primary data load across all 3 services
  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsRefreshing(true);

    try {
      const [
        healthRes,
        orderStatsRes,
        ordersRes,
        inventoryRes,
        reservationsRes,
        paymentStatsRes,
        paymentsRes,
        eventsRes
      ] = await Promise.allSettled([
        checkServicesHealth(),
        fetchOrderSummaryStats(),
        fetchOrders('ALL', 100),
        fetchInventory(),
        fetchReservations(),
        fetchPaymentStats(),
        fetchPayments('ALL'),
        fetchProcessedEvents()
      ]);

      if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
      if (orderStatsRes.status === 'fulfilled') setOrderStats(orderStatsRes.value);
      if (ordersRes.status === 'fulfilled' && ordersRes.value.orders) setOrders(ordersRes.value.orders);
      if (inventoryRes.status === 'fulfilled') {
        if (inventoryRes.value.items) setInventory(inventoryRes.value.items);
        if (inventoryRes.value.summary) setInventorySummary(inventoryRes.value.summary);
      }
      if (reservationsRes.status === 'fulfilled' && reservationsRes.value.reservations) {
        setReservations(reservationsRes.value.reservations);
      }
      if (paymentStatsRes.status === 'fulfilled') setPaymentStats(paymentStatsRes.value);
      if (paymentsRes.status === 'fulfilled' && paymentsRes.value.payments) setPayments(paymentsRes.value.payments);
      if (eventsRes.status === 'fulfilled' && eventsRes.value.events) setProcessedEvents(eventsRes.value.events);

    } catch (err) {
      console.error('Error fetching dashboard telemetry:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial load + 5-second polling interval for real-time reactivity
  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      loadData(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleOpenRestock = (sku?: string) => {
    setRestockSku(sku || null);
    setIsRestockOpen(true);
  };

  const handleTriggerDlq = async () => {
    try {
      const res = await triggerDlqReplay();
      showToast('success', res.message || 'Triggered DLQ replay successfully');
      loadData(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to trigger DLQ replay';
      showToast('error', msg);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#07090e] text-slate-100 relative">
      {/* Background Decorative Gradient Orbs */}
      <div className="fixed top-0 left-1/4 w-[500px] h-[350px] bg-cyan-600/10 rounded-full blur-[140px] pointer-events-none -z-10" />
      <div className="fixed bottom-0 right-1/4 w-[600px] h-[400px] bg-purple-600/10 rounded-full blur-[160px] pointer-events-none -z-10" />

      {/* Header bar */}
      <Header
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as typeof activeTab)}
        health={health}
        onRefresh={() => loadData(false)}
        refreshing={isRefreshing}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {isLoading ? (
          <div className="h-96 flex flex-col items-center justify-center gap-4 text-slate-500">
            <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin" />
            <p className="text-xs font-mono uppercase tracking-wider text-slate-400">
              Connecting to Saga Microservices Mesh...
            </p>
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewTab
                orderStats={orderStats}
                inventorySummary={inventorySummary}
                paymentStats={paymentStats}
                recentOrders={orders.slice(0, 6)}
                onNavigateTab={(tab) => setActiveTab(tab as typeof activeTab)}
                onOpenCreateOrder={() => setIsCreateOrderOpen(true)}
                onOpenRestock={() => handleOpenRestock()}
                onTriggerDlq={handleTriggerDlq}
              />
            )}

            {activeTab === 'orders' && (
              <OrdersTab
                orders={orders}
                inventory={inventory}
                onOpenCreateOrder={() => setIsCreateOrderOpen(true)}
                onRefresh={() => loadData(false)}
                onShowToast={(msg, type) => showToast(type, msg)}
              />
            )}

            {activeTab === 'inventory' && (
              <InventoryTab
                inventory={inventory}
                summary={inventorySummary}
                reservations={reservations}
                onOpenRestockSku={(sku) => handleOpenRestock(sku)}
                onOpenCreateProduct={() => setIsCreateProductOpen(true)}
                onRefresh={() => loadData(false)}
              />
            )}

            {activeTab === 'payments' && (
              <PaymentsTab
                payments={payments}
                processedEvents={processedEvents}
                onRefresh={() => loadData(false)}
                showToast={showToast}
              />
            )}

            {activeTab === 'swagger' && (
              <SwaggerTab />
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 py-4 text-center text-3xs text-slate-500 font-mono">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            Distributed Order Management System (OMS) • Event-Driven Saga Architecture with Apache Kafka
          </span>
          <div className="flex items-center gap-4 text-slate-400">
            <a href="http://localhost:8080" target="_blank" rel="noopener noreferrer" className="hover:text-cyan-400">Kafka UI: 8080</a>
            <span>•</span>
            <a href="http://localhost:16686" target="_blank" rel="noopener noreferrer" className="hover:text-purple-400">Jaeger: 16686</a>
            <span>•</span>
            <a href="http://localhost:3001/docs" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400">Swagger: 3001</a>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <CreateOrderModal
        inventory={inventory}
        isOpen={isCreateOrderOpen}
        onClose={() => setIsCreateOrderOpen(false)}
        onSuccess={() => loadData(false)}
        showToast={showToast}
      />

      <RestockModal
        initialSku={restockSku}
        inventory={inventory}
        isOpen={isRestockOpen}
        onClose={() => {
          setIsRestockOpen(false);
          setRestockSku(null);
        }}
        onSuccess={() => loadData(false)}
        showToast={showToast}
      />

      <CreateProductModal
        isOpen={isCreateProductOpen}
        onClose={() => setIsCreateProductOpen(false)}
        onSuccess={() => loadData(false)}
        showToast={showToast}
      />

      {/* Floating Toasts */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
