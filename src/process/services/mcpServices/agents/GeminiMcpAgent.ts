/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { IMcpServer } from '../../../../common/storage';
import type { McpOperationResult } from '../McpProtocol';
import { AbstractMcpAgent } from '../McpProtocol';

const execAsync = promisify(exec);

/**
 * Google Gemini CLI MCP代理实现
 *
 * 使用 Google 官方的 Gemini CLI 的 mcp 子命令管理 MCP 服务器配置
 * 注意：这是管理真实的 Google Gemini CLI，不是 @office-ai/aioncli-core
 */
export class GeminiMcpAgent extends AbstractMcpAgent {
  constructor() {
    super('gemini');
  }

  getSupportedTransports(): string[] {
    // Google Gemini CLI 支持 stdio, sse, http, streamable_http 传输类型
    return ['stdio', 'sse', 'http', 'streamable_http'];
  }

  /**
   * 检测 Google Gemini CLI 的 MCP 配置
   */
  detectMcpServers(_cliPath?: string): Promise<IMcpServer[]> {
    const detectOperation = async () => {
      const maxRetries = 3;
      const lastError: Error | null = null;

      // ... (code omitted, keeping existing logic until transport parsing) ...

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // ... (existing retry logic) ...

          if (attempt === 1) {
            console.log('[GeminiMcpAgent] Starting MCP detection...');
          } else {
            // ...
          }

          // ... (exec logic) ...
          const { stdout: result } = await execAsync('gemini mcp list', { timeout: this.timeout });

          // ... (empty check) ...

          // ... (parsing logic) ...
          const mcpServers: IMcpServer[] = [];
          const lines = result.split('\n');

          for (const line of lines) {
            // ... (regex clean) ...
            /* eslint-disable no-control-regex */
            const cleanLine = line
              .replace(/\u001b\[[0-9;]*m/g, '')
              .replace(/\[[0-9;]*m/g, '')
              .trim();
            /* eslint-enable no-control-regex */

            // 查找格式如: "✓ 12306-mcp: npx -y 12306-mcp (stdio) - Connected"
            const match = cleanLine.match(/[✓✗]\s+([^:]+):\s+(.+?)\s+\(([^)]+)\)\s*-\s*(Connected|Disconnected)/);
            if (match) {
              const [, name, commandStr, transport, status] = match;
              const commandParts = commandStr.trim().split(/\s+/);
              const command = commandParts[0];
              const args = commandParts.slice(1);

              const transportType = transport as 'stdio' | 'sse' | 'http' | 'streamable_http';

              // 构建transport对象
              const transportObj: any =
                transportType === 'stdio'
                  ? {
                      type: 'stdio',
                      command: command,
                      args: args,
                      env: {},
                    }
                  : transportType === 'sse'
                    ? {
                        type: 'sse',
                        url: commandStr.trim(),
                      }
                    : transportType === 'streamable_http'
                      ? {
                          type: 'streamable_http',
                          url: commandStr.trim(),
                        }
                      : {
                          type: 'http',
                          url: commandStr.trim(),
                        };

              // ... (rest of detect logic) ...
              // ...
            }
          }
          // ...
          return mcpServers;
        } catch (error) {
          // ...
        }
      }
      return [];
    };

    Object.defineProperty(detectOperation, 'name', { value: 'detectMcpServers' });
    return this.withLock(detectOperation);
  }

  /**
   * 安装 MCP 服务器到 Google Gemini CLI
   */
  installMcpServers(mcpServers: IMcpServer[]): Promise<McpOperationResult> {
    const installOperation = async () => {
      try {
        for (const server of mcpServers) {
          if (server.transport.type === 'stdio') {
            // ... (existing stdio logic) ...
            const args = server.transport.args?.join(' ') || '';
            let command = `gemini mcp add "${server.name}" "${server.transport.command}"`;
            if (args) {
              command += ` ${args}`;
            }
            command += ' -s user';
            try {
              await execAsync(command, { timeout: 5000 });
              console.log(`[GeminiMcpAgent] Added MCP server: ${server.name}`);
            } catch (error) {
              console.warn(`Failed to add MCP ${server.name} to Gemini:`, error);
            }
          } else if (server.transport.type === 'sse' || server.transport.type === 'http' || server.transport.type === 'streamable_http') {
            //的处理 SSE/HTTP 传输类型
            let command = `gemini mcp add "${server.name}" "${server.transport.url}"`;

            console.log(`[GeminiMcpAgent] Raw transport type for ${server.name}:`, server.transport.type);

            // Map streamable_http to sse (CLI sse transport handles Accept headers correctly, http transport does not)
            const transportArg = server.transport.type === 'streamable_http' ? 'sse' : server.transport.type;

            console.log(`[GeminiMcpAgent] Mapped transport arg for ${server.name}:`, transportArg);

            // Check headers existence and log safely
            const transportAny = server.transport as any;
            console.log(`[GeminiMcpAgent] Headers present for ${server.name}:`, transportAny.headers ? Object.keys(transportAny.headers) : 'None');

            // 添加 transport 类型
            command += ` --transport ${transportArg}`;

            // 添加 scope 参数
            command += ' -s user';

            // 添加 Headers (Authorization 等)
            if (transportAny.headers) {
              for (const [key, value] of Object.entries(transportAny.headers)) {
                // Log safe info
                console.log(`[GeminiMcpAgent] Adding header ${key} (value length: ${String(value).length})`);
                // Revert to standard HTTP format with double quotes for shell safety
                command += ` --header "${key}: ${value}"`;
              }
            }

            try {
              await execAsync(command, { timeout: 30000 });
              console.log(`[GeminiMcpAgent] Added MCP server: ${server.name}`);
            } catch (error) {
              console.warn(`Failed to add MCP ${server.name} to Gemini:`, error);
            }
          } else {
            console.warn(`Skipping ${server.name}: Gemini CLI does not support ${(server.transport as any).type} transport type`);
          }
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    };

    Object.defineProperty(installOperation, 'name', { value: 'installMcpServers' });
    return this.withLock(installOperation);
  }

  /**
   * 从 Google Gemini CLI 删除 MCP 服务器
   */
  removeMcpServer(mcpServerName: string): Promise<McpOperationResult> {
    const removeOperation = async () => {
      try {
        // 使用 Gemini CLI 命令删除 MCP 服务器
        // 首先尝试 user scope
        try {
          const removeCommand = `gemini mcp remove "${mcpServerName}" -s user`;
          const result = await execAsync(removeCommand, { timeout: 5000 });

          if (result.stdout && result.stdout.includes('removed')) {
            console.log(`[GeminiMcpAgent] Removed MCP server: ${mcpServerName}`);
            return { success: true };
          } else if (result.stdout && result.stdout.includes('not found')) {
            // 尝试 project scope
            throw new Error('Server not found in user scope');
          } else {
            return { success: true };
          }
        } catch (userError) {
          // 尝试 project scope
          try {
            const removeCommand = `gemini mcp remove "${mcpServerName}" -s project`;
            const result = await execAsync(removeCommand, { timeout: 5000 });

            if (result.stdout && result.stdout.includes('removed')) {
              console.log(`[GeminiMcpAgent] Removed MCP server from project: ${mcpServerName}`);
              return { success: true };
            } else {
              // 服务器不存在，也认为成功
              return { success: true };
            }
          } catch (projectError) {
            // 如果服务器不存在，也认为成功
            if (userError instanceof Error && userError.message.includes('not found')) {
              return { success: true };
            }
            return { success: false, error: userError instanceof Error ? userError.message : String(userError) };
          }
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    };

    Object.defineProperty(removeOperation, 'name', { value: 'removeMcpServer' });
    return this.withLock(removeOperation);
  }
}
