/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { auth, db } from '@/renderer/config/firebase';
import { DatePicker, Empty, Spin, Statistic, Table } from '@arco-design/web-react';
import { Timestamp, collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import SettingsPageWrapper from './components/SettingsPageWrapper';

// Chart.js imports
import { CategoryScale, Chart as ChartJS, Legend, LineElement, LinearScale, PointElement, Title, Tooltip } from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const { RangePicker } = DatePicker;

// Pricing with 20% markup (per 1M tokens)
const PRICING = {
  INPUT_PER_MILLION: 0.6, // $0.50 + 20%
  OUTPUT_PER_MILLION: 3.6, // $3.00 + 20%
  CACHE_PER_MILLION: 0.06, // $0.05 + 20%
};

interface UsageLog {
  id: string;
  userId: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  thoughts_tokens?: number;
  cached_tokens?: number;
  total_tokens: number;
  cost?: number;
  timestamp: Timestamp;
}

interface DailyUsage {
  date: string;
  input_tokens: number;
  output_tokens: number;
  thoughts_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  cost: number;
}

const calculateCost = (input: number, output: number, thoughts: number, cached: number): number => {
  return (input / 1_000_000) * PRICING.INPUT_PER_MILLION + ((output + thoughts) / 1_000_000) * PRICING.OUTPUT_PER_MILLION + (cached / 1_000_000) * PRICING.CACHE_PER_MILLION;
};

const formatCurrency = (value: number): string => `$${value.toFixed(4)}`;
const formatNumber = (value: number): string => value.toLocaleString();

const UsageSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [dateRange, setDateRange] = useState<[Date, Date]>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return [start, end];
  });

  // Fetch usage logs from Firestore
  useEffect(() => {
    const fetchLogs = async () => {
      if (!auth.currentUser) return;

      setLoading(true);
      try {
        const logsRef = collection(db, 'usage_logs');
        const startTimestamp = Timestamp.fromDate(dateRange[0]);
        const endDate = new Date(dateRange[1]);
        endDate.setHours(23, 59, 59, 999);
        const endTimestamp = Timestamp.fromDate(endDate);

        const q = query(logsRef, where('userId', '==', auth.currentUser.uid), where('timestamp', '>=', startTimestamp), where('timestamp', '<=', endTimestamp), orderBy('timestamp', 'desc'));

        const snapshot = await getDocs(q);

        const fetchedLogs: UsageLog[] = [];
        snapshot.forEach((doc) => {
          fetchedLogs.push({ id: doc.id, ...doc.data() } as UsageLog);
        });
        setLogs(fetchedLogs);
      } catch (error) {
        console.error('[UsageSettings] Failed to fetch logs:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchLogs();
  }, [dateRange]);

  // Aggregate totals
  const totals = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let thoughtsTokens = 0;
    let cachedTokens = 0;
    let totalTokens = 0;

    logs.forEach((log) => {
      inputTokens += log.input_tokens || 0;
      outputTokens += log.output_tokens || 0;
      thoughtsTokens += log.thoughts_tokens || 0;
      cachedTokens += log.cached_tokens || 0;
      totalTokens += log.total_tokens || 0;
    });

    const totalCost = calculateCost(inputTokens, outputTokens, thoughtsTokens, cachedTokens);

    return { inputTokens, outputTokens, thoughtsTokens, cachedTokens, totalTokens, totalCost };
  }, [logs]);

  // Aggregate by day for chart and table
  const dailyUsage = useMemo(() => {
    const dailyMap = new Map<string, DailyUsage>();

    logs.forEach((log) => {
      const date = log.timestamp.toDate().toISOString().split('T')[0];
      const existing = dailyMap.get(date) || {
        date,
        input_tokens: 0,
        output_tokens: 0,
        thoughts_tokens: 0,
        cached_tokens: 0,
        total_tokens: 0,
        cost: 0,
      };

      existing.input_tokens += log.input_tokens || 0;
      existing.output_tokens += log.output_tokens || 0;
      existing.thoughts_tokens += log.thoughts_tokens || 0;
      existing.cached_tokens += log.cached_tokens || 0;
      existing.total_tokens += log.total_tokens || 0;
      existing.cost = calculateCost(existing.input_tokens, existing.output_tokens, existing.thoughts_tokens, existing.cached_tokens);

      dailyMap.set(date, existing);
    });

    return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [logs]);

  // Chart.js data
  const chartData = useMemo(() => {
    return {
      labels: dailyUsage.map((d) => d.date),
      datasets: [
        {
          label: 'Input Tokens',
          data: dailyUsage.map((d) => d.input_tokens),
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.5)',
          tension: 0.3,
        },
        {
          label: 'Output + Thinking',
          data: dailyUsage.map((d) => d.output_tokens + d.thoughts_tokens),
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: 'rgba(16, 185, 129, 0.5)',
          tension: 0.3,
        },
        {
          label: 'Cached',
          data: dailyUsage.map((d) => d.cached_tokens),
          borderColor: 'rgb(245, 158, 11)',
          backgroundColor: 'rgba(245, 158, 11, 0.5)',
          tension: 0.3,
        },
      ],
    };
  }, [dailyUsage]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  const tableColumns = [
    { title: '날짜', dataIndex: 'date', key: 'date', width: 120 },
    { title: 'Input', dataIndex: 'input_tokens', key: 'input_tokens', render: (v: number) => formatNumber(v), width: 100 },
    { title: 'Output', dataIndex: 'output_tokens', key: 'output_tokens', render: (v: number) => formatNumber(v), width: 100 },
    { title: 'Thinking', dataIndex: 'thoughts_tokens', key: 'thoughts_tokens', render: (v: number) => formatNumber(v), width: 100 },
    { title: 'Cached', dataIndex: 'cached_tokens', key: 'cached_tokens', render: (v: number) => formatNumber(v), width: 100 },
    { title: 'Total', dataIndex: 'total_tokens', key: 'total_tokens', render: (v: number) => formatNumber(v), width: 100 },
    { title: 'Cost (USD)', dataIndex: 'cost', key: 'cost', render: (v: number) => formatCurrency(v), width: 110 },
  ];

  // Reverse for table (newest first)
  const tableData = useMemo(() => [...dailyUsage].reverse(), [dailyUsage]);

  return (
    <SettingsPageWrapper contentClassName='max-w-1200px'>
      <div className='flex flex-col gap-24px'>
        {/* Header */}
        <div className='flex justify-between items-center'>
          <h2 className='text-20px font-600 m-0'>사용량</h2>
          <RangePicker
            value={dateRange}
            onChange={(_dateStrings, dates) => {
              if (dates && dates[0] && dates[1]) {
                setDateRange([dates[0].toDate(), dates[1].toDate()]);
              }
            }}
            style={{ width: 280 }}
          />
        </div>

        {loading ? (
          <div className='flex justify-center items-center h-200px'>
            <Spin size={32} />
          </div>
        ) : (
          <>
            {/* Summary Cards - Row 1 */}
            <div className='grid grid-cols-3 gap-16px'>
              <div className='bg-aou-1 rd-12px p-16px'>
                <Statistic title='Input Tokens' value={totals.inputTokens} groupSeparator />
                <div className='text-12px text-t-secondary mt-4px'>@$0.60/1M</div>
              </div>
              <div className='bg-aou-1 rd-12px p-16px'>
                <Statistic title='Output + Thinking' value={totals.outputTokens + totals.thoughtsTokens} groupSeparator />
                <div className='text-12px text-t-secondary mt-4px'>@$3.60/1M</div>
              </div>
              <div className='bg-aou-1 rd-12px p-16px'>
                <Statistic title='Cached Tokens' value={totals.cachedTokens} groupSeparator />
                <div className='text-12px text-t-secondary mt-4px'>@$0.06/1M</div>
              </div>
            </div>

            {/* Summary Cards - Row 2 */}
            <div className='grid grid-cols-2 gap-16px'>
              <div className='bg-aou-1 rd-12px p-16px'>
                <Statistic title='Total Tokens' value={totals.totalTokens} groupSeparator />
              </div>
              <div className='bg-aou-1 rd-12px p-16px'>
                <Statistic title='Total Cost (USD)' value={totals.totalCost} precision={4} prefix='$' />
              </div>
            </div>

            {/* Line Chart */}
            {dailyUsage.length > 0 && (
              <div className='bg-aou-1 rd-12px p-16px'>
                <h3 className='text-16px font-500 m-0 mb-16px'>일별 사용량</h3>
                <div style={{ height: 300 }}>
                  <Line data={chartData} options={chartOptions} />
                </div>
              </div>
            )}

            {/* Usage Table */}
            {tableData.length > 0 ? (
              <div className='bg-aou-1 rd-12px p-16px'>
                <h3 className='text-16px font-500 m-0 mb-16px'>상세 내역</h3>
                <Table columns={tableColumns} data={tableData} rowKey='date' pagination={{ pageSize: 10 }} border={false} />
              </div>
            ) : (
              <Empty description='선택한 기간에 사용 내역이 없습니다.' />
            )}
          </>
        )}
      </div>
    </SettingsPageWrapper>
  );
};

export default UsageSettings;
