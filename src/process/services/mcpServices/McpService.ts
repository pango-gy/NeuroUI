/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import type { IMcpServer } from '../../../common/storage';
import type { AcpBackend } from '../../../types/acpTypes';
import type { DetectedMcpServer, IMcpProtocol, McpConnectionTestResult, McpSource, McpSyncResult } from './McpProtocol';
import { AionuiMcpAgent } from './agents/AionuiMcpAgent';
import { ClaudeMcpAgent } from './agents/ClaudeMcpAgent';
import { CodexMcpAgent } from './agents/CodexMcpAgent';
import { GeminiMcpAgent } from './agents/GeminiMcpAgent';
import { IflowMcpAgent } from './agents/IflowMcpAgent';
import { QwenMcpAgent } from './agents/QwenMcpAgent';

/**
 * MCP服务 - 负责协调各个Agent的MCP操作协议
 * 新架构：只定义协议，具体实现由各个Agent类完成
 *
 * Agent 类型说明：
 * - AcpBackend ('claude', 'qwen', 'iflow', 'gemini', 'codex'等): 支持的 ACP 后端
 * - 'aionui': @office-ai/aioncli-core (AionUi 本地管理的 Gemini 实现)
 */
export class McpService {
  private agents: Map<McpSource, IMcpProtocol>;
  private mcpToken: string | null = null; // 메모리에 MCP 토큰 저장

  constructor() {
    this.agents = new Map([
      ['claude', new ClaudeMcpAgent()],
      ['qwen', new QwenMcpAgent()],
      ['iflow', new IflowMcpAgent()],
      ['gemini', new GeminiMcpAgent()],
      ['aionui', new AionuiMcpAgent()], // AionUi 本地 @office-ai/aioncli-core
      ['codex', new CodexMcpAgent()],
    ]);
  }

  /**
   * 获取特定backend的agent实例
   */
  private getAgent(backend: McpSource): IMcpProtocol | undefined {
    return this.agents.get(backend);
  }

  /**
   * Platform Credentials (MCP Token) 업데이트
   * Renderer로부터 받은 JWT 토큰을 메모리에 저장합니다.
   */
  updatePlatformCredentials(token: string): void {
    this.mcpToken = token;
    console.log('[McpService] Updated platform credentials (token stored in memory)');
  }

  /**
   * 저장된 Platform Credentials (MCP Token) 가져오기
   * GeminiAgentManager 등에서 호출하여 사용
   */
  getPlatformCredentials(): string | null {
    return this.mcpToken;
  }

  /**
   * 헬퍼 메서드: MCP 서버 설정에 토큰 및 URL 주입
   * 1. 헤더에 <token> 플레이스홀더가 있으면 메모리에 저장된 실제 토큰으로 교체
   * 2. google-ads-mcp, google-analytics-mcp 등 플랫폼 MCP는 항상 현재 토큰 및 URL로 업데이트
   */
  private injectCredentials(server: IMcpServer): IMcpServer {
    const token = this.getPlatformCredentials();
    if (!token) {
      console.log(`[McpService] No credentials available for ${server.name}`);
      return server;
    }

    // 플랫폼 MCP 서버 URL 매핑 (환경변수에서 읽음)
    const platformMcpUrls: Record<string, string | undefined> = {
      'google-ads-mcp': process.env.VITE_GOOGLE_ADS_MCP_URL,
      'google-analytics-mcp': process.env.VITE_GOOGLE_ANALYTICS_MCP_URL,
      'naver-ads-mcp': process.env.VITE_NAVER_ADS_MCP_URL,
      'naver-openapi-mcp': process.env.VITE_NAVER_OPENAPI_MCP_URL,
    };

    // transport 타입에 따라 헤더 및 URL 확인
    if (server.transport.type === 'http' || server.transport.type === 'sse' || server.transport.type === 'streamable_http') {
      const headers = server.transport.headers || {};
      const newHeaders = { ...headers };
      let configChanged = false;
      let newUrl = (server.transport as any).url;

      // 1. <token> 플레이스홀더 치환
      for (const [key, value] of Object.entries(newHeaders)) {
        if (typeof value === 'string' && value.includes('<token>')) {
          newHeaders[key] = value.replace('<token>', token);
          configChanged = true;
        }
      }

      // 2. 플랫폼 MCP 서버의 경우 URL 및 토큰 강제 업데이트
      const platformUrl = platformMcpUrls[server.name];
      if (platformUrl) {
        // URL 업데이트 (localhost에서 production으로)
        if (newUrl !== platformUrl) {
          console.log(`[McpService] Updating URL for ${server.name}: ${newUrl} -> ${platformUrl}`);
          newUrl = platformUrl;
          configChanged = true;
        }

        // Authorization 헤더 업데이트
        const expectedAuth = `Bearer ${token}`;
        if (newHeaders['Authorization'] !== expectedAuth) {
          newHeaders['Authorization'] = expectedAuth;
          configChanged = true;
          console.log(`[McpService] Injected fresh token for ${server.name}`);
        }
      }

      if (configChanged) {
        return {
          ...server,
          transport: {
            ...server.transport,
            url: newUrl,
            headers: newHeaders,
          },
        };
      }
    }

    return server;
  }

  /**
   * 从检测到的ACP agents中获取MCP配置（并发版本）
   *
   * 注意：此方法还会额外检测原生 Gemini CLI 的 MCP 配置，
   * 即使它在 ACP 配置中是禁用的（因为 fork 的 Gemini 用于 ACP）
   */
  async getAgentMcpConfigs(
    agents: Array<{
      backend: AcpBackend;
      name: string;
      cliPath?: string;
    }>
  ): Promise<DetectedMcpServer[]> {
    // 创建完整的检测列表，包含 ACP agents 和额外的 MCP-only agents
    const allAgentsToCheck = [...agents];

    // 检查是否需要添加原生 Gemini CLI（如果它不在 ACP agents 中）
    const hasNativeGemini = agents.some((a) => a.backend === 'gemini' && a.cliPath === 'gemini');
    if (!hasNativeGemini) {
      // 检查系统中是否安装了原生 Gemini CLI
      try {
        const isWindows = process.platform === 'win32';
        const whichCommand = isWindows ? 'where' : 'which';
        execSync(`${whichCommand} gemini`, { encoding: 'utf-8', stdio: 'pipe', timeout: 1000 });

        // 如果找到了原生 Gemini CLI，添加到检测列表
        allAgentsToCheck.push({
          backend: 'gemini' as AcpBackend,
          name: 'Google Gemini CLI',
          cliPath: 'gemini',
        });
        console.log('[McpService] Added native Gemini CLI for MCP detection');
      } catch {
        // 原生 Gemini CLI 未安装，跳过
      }
    }

    // 并发执行所有agent的MCP检测
    const promises = allAgentsToCheck.map(async (agent) => {
      try {
        // 跳过 fork 的 Gemini（backend='gemini' 且 cliPath=undefined）
        // fork 的 Gemini 的 MCP 配置应该由 AionuiMcpAgent 管理
        if (agent.backend === 'gemini' && !agent.cliPath) {
          console.log(`[McpService] Skipping fork Gemini (ACP only, MCP managed by AionuiMcpAgent)`);
          return null;
        }

        const agentInstance = this.getAgent(agent.backend);
        if (!agentInstance) {
          console.warn(`[McpService] No agent instance for backend: ${agent.backend}`);
          return null;
        }

        const servers = await agentInstance.detectMcpServers(agent.cliPath);
        console.log(`[McpService] Detected ${servers.length} MCP servers for ${agent.backend} (cliPath: ${agent.cliPath || 'default'})`);

        if (servers.length > 0) {
          return {
            source: agent.backend as McpSource,
            servers,
          };
        }
        return null;
      } catch (error) {
        console.warn(`[McpService] Failed to detect MCP servers for ${agent.backend}:`, error);
        return null;
      }
    });

    const results = await Promise.all(promises);
    return results.filter((result): result is DetectedMcpServer => result !== null);
  }

  /**
   * 测试MCP服务器连接
   */
  async testMcpConnection(server: IMcpServer): Promise<McpConnectionTestResult> {
    console.log(`[McpService] testMcpConnection called for: ${server.name}`);
    console.log(`[McpService] Current token available: ${!!this.mcpToken}`);

    // 使用第一个可用的agent进行连接测试，因为测试逻辑在基类中是通用的
    const firstAgent = this.agents.values().next().value;
    if (firstAgent) {
      // 运行时动态注入认证信息
      const serverWithAuth = this.injectCredentials(server);

      // 디버그: 주입 후 헤더 확인
      if (serverWithAuth.transport.type === 'streamable_http' || serverWithAuth.transport.type === 'http' || serverWithAuth.transport.type === 'sse') {
        const authHeader = (serverWithAuth.transport as any).headers?.Authorization;
        console.log(`[McpService] Authorization header present: ${!!authHeader}, length: ${authHeader?.length || 0}`);
      }

      return await firstAgent.testMcpConnection(serverWithAuth);
    }
    return { success: false, error: 'No agent available for connection testing' };
  }

  /**
   * 将MCP配置同步到所有检测到的agent
   */
  async syncMcpToAgents(
    mcpServers: IMcpServer[],
    agents: Array<{
      backend: AcpBackend;
      name: string;
      cliPath?: string;
    }>
  ): Promise<McpSyncResult> {
    // 只同步启用的MCP服务器
    const enabledServers = mcpServers.filter((server) => server.enabled);

    if (enabledServers.length === 0) {
      return { success: true, results: [] };
    }

    // 运行时动态注入认证信息到所有服务器配置
    const serversWithAuth = enabledServers.map((server) => this.injectCredentials(server));

    // 并发执行所有agent的MCP同步
    const promises = agents.map(async (agent) => {
      try {
        const agentInstance = this.getAgent(agent.backend);
        if (!agentInstance) {
          return {
            agent: agent.name,
            success: false,
            error: `Unsupported agent backend: ${agent.backend}`,
          };
        }

        const result = await agentInstance.installMcpServers(serversWithAuth);
        return {
          agent: agent.name,
          success: result.success,
          error: result.error,
        };
      } catch (error) {
        return {
          agent: agent.name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const results = await Promise.all(promises);

    const allSuccess = results.every((r) => r.success);

    return { success: allSuccess, results };
  }

  /**
   * 从所有检测到的agent中删除MCP配置
   */
  async removeMcpFromAgents(
    mcpServerName: string,
    agents: Array<{
      backend: AcpBackend;
      name: string;
      cliPath?: string;
    }>
  ): Promise<McpSyncResult> {
    // 并发执行所有agent的MCP删除
    const promises = agents.map(async (agent) => {
      try {
        const agentInstance = this.getAgent(agent.backend);
        if (!agentInstance) {
          return {
            agent: `${agent.backend}:${agent.name}`,
            success: false,
            error: `Unsupported agent backend: ${agent.backend}`,
          };
        }

        const result = await agentInstance.removeMcpServer(mcpServerName);
        return {
          agent: `${agent.backend}:${agent.name}`,
          success: result.success,
          error: result.error,
        };
      } catch (error) {
        return {
          agent: `${agent.backend}:${agent.name}`,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const results = await Promise.all(promises);

    return { success: true, results };
  }
}

export const mcpService = new McpService();
