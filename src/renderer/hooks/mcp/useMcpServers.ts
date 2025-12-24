import type { IMcpServer } from '@/common/storage';
import { ConfigStorage } from '@/common/storage';
import { useCallback, useEffect, useState } from 'react';

/**
 * MCP服务器状态管理Hook
 * 管理MCP服务器列表的加载、保存和状态更新
 */
export const useMcpServers = () => {
  const [mcpServers, setMcpServers] = useState<IMcpServer[]>([]);

  // 加载MCP服务器配置
  useEffect(() => {
    const loadConfig = () => {
      void ConfigStorage.get('mcp.config')
        .then((data) => {
          if (data) {
            setMcpServers(data);
          }
        })
        .catch((error) => {
          console.error('[useMcpServers] Failed to load MCP config:', error);
        });
    };

    loadConfig();

    const handleConfigChanged = () => {
      loadConfig();
    };

    window.addEventListener('mcp-config-changed', handleConfigChanged);

    return () => {
      window.removeEventListener('mcp-config-changed', handleConfigChanged);
    };
  }, []);

  // 保存MCP服务器配置
  const saveMcpServers = useCallback((serversOrUpdater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => {
    return new Promise<void>((resolve, reject) => {
      setMcpServers((prev) => {
        // 计算新值
        const newServers = typeof serversOrUpdater === 'function' ? serversOrUpdater(prev) : serversOrUpdater;

        // 异步保存到存储（在微任务中执行）
        queueMicrotask(() => {
          ConfigStorage.set('mcp.config', newServers)
            .then(() => resolve())
            .catch((error) => {
              console.error('Failed to save MCP servers:', error);
              reject(error);
            });
        });

        return newServers;
      });
    });
  }, []);

  return {
    mcpServers,
    setMcpServers,
    saveMcpServers,
  };
};
