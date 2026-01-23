/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { auth, db } from '@/renderer/config/firebase';
import { useAuth } from '@/renderer/context/AuthContext';
import { DatePicker, Empty, Select, Spin, Statistic, Table } from '@arco-design/web-react';
import { Timestamp, collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import SettingsPageWrapper from './components/SettingsPageWrapper';

// Chart.js imports
import { CategoryScale, Chart as ChartJS, Legend, LineElement, LinearScale, PointElement, Title, Tooltip } from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const { RangePicker } = DatePicker;
const { Option } = Select;

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
  workspaceId?: string;
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

// Helper to get YYYY-MM-DD in local time
const getLocalDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const UsageSettings: React.FC = () => {
  const { workspaces } = useAuth();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('all');
  const [dateRange, setDateRange] = useState<[Date, Date]>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0); // Start from beginning of the day
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

        if (selectedWorkspaceId !== 'all') {
          // Client-side filtering because Firestore requires composite index for multiple fields
          // and we want to avoid creating too many indexes if possible.
          // However, if the volume is huge, we should use server-side filter.
          // For now, let's fetch by user + date and filter by workspace in memory
          // since 'workspaceId' might be missing in old logs.
        }

        const snapshot = await getDocs(q);

        const fetchedLogs: UsageLog[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data() as Omit<UsageLog, 'id'>;
          // Filter by workspace if selected
          if (selectedWorkspaceId === 'all' || data.workspaceId === selectedWorkspaceId) {
            fetchedLogs.push({ id: doc.id, ...data });
          }
        });
        setLogs(fetchedLogs);
      } catch (error) {
        console.error('[UsageSettings] Failed to fetch logs:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchLogs();
  }, [dateRange, selectedWorkspaceId]);

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

  // Aggregate by day for chart and table (filling missing dates)
  const dailyUsage = useMemo(() => {
    const dailyMap = new Map<string, DailyUsage>();

    // 1. Populate map with actual data
    logs.forEach((log) => {
      // Use local time for grouping
      const date = getLocalDateString(log.timestamp.toDate());
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

    // 2. Fill in missing dates from range
    const result: DailyUsage[] = [];
    const currentDate = new Date(dateRange[0]);
    const endDate = new Date(dateRange[1]);

    // Normalize to YYYY-MM-DD string for comparison
    const endStr = getLocalDateString(endDate);

    while (getLocalDateString(currentDate) <= endStr) {
      const dateStr = getLocalDateString(currentDate);
      if (dailyMap.has(dateStr)) {
        result.push(dailyMap.get(dateStr)!);
      } else {
        result.push({
          date: dateStr,
          input_tokens: 0,
          output_tokens: 0,
          thoughts_tokens: 0,
          cached_tokens: 0,
          total_tokens: 0,
          cost: 0,
        });
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return result;
  }, [logs, dateRange]);

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
  const tableData = useMemo(() => {
    return [...dailyUsage].reverse();
  }, [dailyUsage]);

  return (
    <SettingsPageWrapper contentClassName='max-w-1200px'>
      <div className='flex flex-col gap-24px'>
        {/* Header */}
        <div className='flex justify-between items-center'>
          <h2 className='text-20px font-600 m-0'>사용량</h2>
          <div className='flex items-center gap-12px'>
            <Select placeholder='워크스페이스 선택' style={{ width: 200 }} value={selectedWorkspaceId} onChange={setSelectedWorkspaceId}>
              <Option value='all'>모든 워크스페이스</Option>
              {workspaces.map((ws) => (
                <Option key={ws.id} value={ws.id}>
                  {ws.name}
                </Option>
              ))}
            </Select>
            <RangePicker
              value={dateRange}
              onChange={(_dateStrings, dates) => {
                if (dates && dates[0] && dates[1]) {
                  const start = dates[0].toDate();
                  start.setHours(0, 0, 0, 0);
                  const end = dates[1].toDate();
                  end.setHours(23, 59, 59, 999);
                  setDateRange([start, end]);
                }
              }}
              style={{ width: 280 }}
            />
          </div>
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

            {/* Line Chart - Always show if we have a valid date range */}
            <div className='bg-aou-1 rd-12px p-16px'>
              <h3 className='text-16px font-500 m-0 mb-16px'>일별 사용량</h3>
              <div style={{ height: 300 }}>
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>

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
