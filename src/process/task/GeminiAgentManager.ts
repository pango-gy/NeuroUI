/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chatLib';
import { transformMessage } from '@/common/chatLib';
import type { IResponseMessage } from '@/common/ipcBridge';
import type { IConfigStorageRefer, IMcpServer, TProviderWithModel } from '@/common/storage';
import { ProcessConfig } from '@/process/initStorage';
import { getDatabase } from '@process/database';
import { addMessage, addOrUpdateMessage, nextTickToLocalFinish } from '../message';
import { mcpService } from '../services/mcpServices/McpService';
import BaseAgentManager from './BaseAgentManager';

// gemini agent管理器类
export class GeminiAgentManager extends BaseAgentManager<{
  workspace: string;
  model: TProviderWithModel;
  imageGenerationModel?: TProviderWithModel;
  webSearchEngine?: 'google' | 'default';
  mcpServers?: Record<string, any>;
  yoloMode?: boolean;
}> {
  workspace: string;
  model: TProviderWithModel;
  private bootstrap: Promise<void>;
  private yoloMode: boolean = false;

  private async injectHistoryFromDatabase(): Promise<void> {
    try {
      const result = getDatabase().getConversationMessages(this.conversation_id, 0, 10000);
      const data = result.data || [];
      const lines = data
        .filter((m) => m.type === 'text')
        .slice(-20)
        .map((m) => `${m.position === 'right' ? 'User' : 'Assistant'}: ${(m as any)?.content?.content || ''}`);
      const text = lines.join('\n').slice(-4000);
      if (text) {
        await this.postMessagePromise('init.history', { text });
      }
    } catch (e) {
      // ignore history injection errors
    }
  }

  constructor(
    data: {
      workspace: string;
      conversation_id: string;
      webSearchEngine?: 'google' | 'default';
    },
    model: TProviderWithModel
  ) {
    super('gemini', { ...data, model });
    this.workspace = data.workspace;
    this.conversation_id = data.conversation_id;
    this.model = model;
    this.bootstrap = Promise.all([ProcessConfig.get('gemini.config'), this.getImageGenerationModel(), this.getMcpServers()])
      .then(([config, imageGenerationModel, mcpServers]) => {
        const safeConfig: Partial<IConfigStorageRefer['gemini.config']> = config || {};
        this.yoloMode = safeConfig.yoloMode ?? true;
        return this.start({
          ...safeConfig,
          yoloMode: this.yoloMode,
          workspace: this.workspace,
          model: this.model,
          imageGenerationModel,
          webSearchEngine: data.webSearchEngine,
          mcpServers,
        });
      })
      .then(async () => {
        await this.injectHistoryFromDatabase();
      });
  }

  private getImageGenerationModel(): Promise<TProviderWithModel | undefined> {
    return ProcessConfig.get('tools.imageGenerationModel')
      .then((imageGenerationModel) => {
        if (imageGenerationModel && imageGenerationModel.switch) {
          return imageGenerationModel;
        }
        return undefined;
      })
      .catch(() => Promise.resolve(undefined));
  }

  private async getMcpServers(): Promise<Record<string, any>> {
    try {
      const mcpServers = await ProcessConfig.get('mcp.config');
      console.log('[GeminiAgentManager] Raw MCP servers count:', mcpServers?.length);

      if (!mcpServers || !Array.isArray(mcpServers)) {
        return {};
      }

      // 转换为 aioncli-core 期望的格式
      const mcpConfig: Record<string, any> = {};
      const platformToken = mcpService.getPlatformCredentials();

      // Debug: Log each server's filter status
      mcpServers.forEach((server: IMcpServer) => {
        console.log(`[GeminiAgentManager] Server: ${server.name}, enabled: ${server.enabled}, status: ${server.status}, transport: ${server.transport?.type}`);
      });

      mcpServers
        .filter((server: IMcpServer) => server.enabled) // enabled만 확인 (status 체크 제거 - 테스트 실패해도 실제 사용 시 동작함)
        .forEach((server: IMcpServer) => {
          // 只处理 stdio 类型的传输方式，因为 aioncli-core 只支持这种类型
          if (server.transport.type === 'stdio') {
            mcpConfig[server.name] = {
              command: server.transport.command,
              args: server.transport.args || [],
              env: server.transport.env || {},
              description: server.description,
            };
          }
          // Streamable HTTP (SSE) 지원 - streamable_http 추가!
          else if (server.transport.type === 'sse' || server.transport.type === 'http' || server.transport.type === 'streamable_http') {
            // 헤더 처리: <token> 치환 로직 적용
            const headers = { ...(server.transport.headers || {}) };
            if (platformToken) {
              for (const [key, value] of Object.entries(headers)) {
                if (typeof value === 'string' && value.includes('<token>')) {
                  headers[key] = value.replace('<token>', platformToken);
                }
              }
            }

            // aioncli-core는 httpUrl을 보고 StreamableHTTPClientTransport를 선택함
            // url만 있으면 SSEClientTransport를 사용함
            // streamable_http는 httpUrl, 나머지는 url 사용
            if (server.transport.type === 'streamable_http') {
              mcpConfig[server.name] = {
                httpUrl: server.transport.url, // httpUrl 사용!
                headers: headers,
                description: server.description,
              };
            } else {
              mcpConfig[server.name] = {
                url: server.transport.url,
                headers: headers,
                description: server.description,
              };
            }
          }
        });

      console.log('[GeminiAgentManager] Final mcpConfig keys:', Object.keys(mcpConfig));
      return mcpConfig;
    } catch (error) {
      return {};
    }
  }

  sendMessage(data: { input: string; msg_id: string }) {
    const message: TMessage = {
      id: data.msg_id,
      type: 'text',
      position: 'right',
      conversation_id: this.conversation_id,
      content: {
        content: data.input,
      },
    };
    addMessage(this.conversation_id, message);
    this.status = 'pending';

    // 즉시 start 이벤트를 emit하여 프론트엔드에서 스트리밍 인디케이터 표시
    // Emit start event immediately so frontend shows streaming indicator
    ipcBridge.geminiConversation.responseStream.emit({
      type: 'start',
      conversation_id: this.conversation_id,
      msg_id: data.msg_id,
      data: null,
    });

    return this.bootstrap
      .catch((e) => {
        this.emit('gemini.message', {
          type: 'error',
          data: e.message || JSON.stringify(e),
          msg_id: data.msg_id,
        });
        // 需要同步后才返回结果
        // 为什么需要如此?
        // 在某些情况下，消息需要同步到本地文件中，由于是异步，可能导致前端接受响应和无法获取到最新的消息，因此需要等待同步后再返回
        return new Promise((_, reject) => {
          nextTickToLocalFinish(() => {
            reject(e);
          });
        });
      })
      .then(() => super.sendMessage(data));
  }

  init() {
    super.init();
    // 接受来子进程的对话消息
    this.on('gemini.message', (data) => {
      // console.log('gemini.message', data);

      // [YOLO Mode Fix] Intercept tool confirmation messages
      if (this.yoloMode && data.type === 'tool_group') {
        const toolData = data.data as any[];
        // Check if any tool is in 'Confirming' status
        const confirmingTool = Array.isArray(toolData) ? toolData.find((t) => t.status === 'Confirming') : null;

        if (confirmingTool) {
          console.log('[GeminiAgentManager] Auto-approving tool execution in YOLO mode (interception)');
          // Send approval back to worker immediately
          void this.postMessagePromise(confirmingTool.callId, {
            confirm: true,
            approvalType: 'allow_always',
          });
          // Do NOT emit this message to frontend to avoid the popup
          return;
        }
      }

      if (data.type === 'finish') {
        this.status = 'finished';
      }
      if (data.type === 'start') {
        this.status = 'running';
      }
      if (data.type === 'thought') {
        this.status = 'running';
      }
      data.conversation_id = this.conversation_id;
      // Transform and persist message (skip transient UI state messages)
      if (data.type !== 'thought') {
        const tMessage = transformMessage(data as IResponseMessage);
        if (tMessage) {
          addOrUpdateMessage(this.conversation_id, tMessage, 'gemini');
        }
      }
      ipcBridge.geminiConversation.responseStream.emit(data);
    });
  }

  // 发送tools用户确认的消息
  confirmMessage(data: { confirmKey: string; msg_id: string; callId: string }) {
    // 도구 실행 시작 전 start 이벤트를 emit하여 스트리밍 인디케이터 표시
    // Emit start event before tool execution to show streaming indicator
    ipcBridge.geminiConversation.responseStream.emit({
      type: 'start',
      conversation_id: this.conversation_id,
      msg_id: data.msg_id,
      data: null,
    });

    // YOLO 모드일 경우 사용자 확인 없이 자동 승인
    // If in YOLO mode, auto-approve without user confirmation
    if (this.yoloMode) {
      console.log('[GeminiAgentManager] Auto-approving tool execution in YOLO mode');
      // "Allow Always" (allow_always) 로 자동 응답
      return this.postMessagePromise(data.callId, {
        confirm: true,
        approvalType: 'allow_always',
      });
    }

    return this.postMessagePromise(data.callId, data.confirmKey);
  }

  // Manually trigger context reload
  async reloadContext(): Promise<void> {
    await this.injectHistoryFromDatabase();
  }
}
