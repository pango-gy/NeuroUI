/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// src/core/ConfigManager.ts
import { NavigationInterceptor } from '@/common/navigation';
import type { TProviderWithModel } from '@/common/storage';
import { uuid } from '@/common/utils';
import { getProviderAuthType } from '@/common/utils/platformAuthType';
import type { CompletedToolCall, Config, GeminiCLIExtension, GeminiClient, ServerGeminiStreamEvent, ToolCall, ToolCallRequestInfo, Turn } from '@office-ai/aioncli-core';
import { AuthType, CoreToolScheduler, FileDiscoveryService, refreshServerHierarchicalMemory, sessionId } from '@office-ai/aioncli-core';
import { ApiKeyManager } from '../../common/ApiKeyManager';
import { handleAtCommand } from './cli/atCommandProcessor';
import { loadCliConfig } from './cli/config';
import type { Settings } from './cli/settings';
import { loadSettings } from './cli/settings';
import { ConversationToolConfig } from './cli/tools/conversation-tool-config';
import { globalToolCallGuard } from './cli/streamResilience';
import { mapToDisplay, type TrackedToolCall } from './cli/useReactToolScheduler';
import { getPromptCount, handleCompletedTools, processGeminiStreamEvents, startNewPrompt } from './utils';

// Auto-retry 설정 / Auto-retry configuration
const MAX_INVALID_STREAM_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// Global registry for current agent instance (used by flashFallbackHandler)
let currentGeminiAgent: GeminiAgent | null = null;

interface GeminiAgent2Options {
  workspace: string;
  proxy?: string;
  model: TProviderWithModel;
  imageGenerationModel?: TProviderWithModel;
  webSearchEngine?: 'google' | 'default';
  yoloMode?: boolean;
  GOOGLE_CLOUD_PROJECT?: string;
  mcpServers?: Record<string, unknown>;
  onStreamEvent: (event: { type: string; data: unknown; msg_id: string }) => void;
}

export class GeminiAgent {
  config: Config | null = null;
  private workspace: string | null = null;
  private proxy: string | null = null;
  private model: TProviderWithModel | null = null;
  private imageGenerationModel: TProviderWithModel | null = null;
  private webSearchEngine: 'google' | 'default' | null = null;
  private yoloMode: boolean = false;
  private googleCloudProject: string | null = null;
  private mcpServers: Record<string, unknown> = {};
  private geminiClient: GeminiClient | null = null;
  private authType: AuthType | null = null;
  private scheduler: CoreToolScheduler | null = null;
  private trackedCalls: TrackedToolCall[] = [];
  private abortController: AbortController | null = null;
  private onStreamEvent: (event: { type: string; data: unknown; msg_id: string }) => void;
  private toolConfig: ConversationToolConfig; // 对话级别的工具配置
  private apiKeyManager: ApiKeyManager | null = null; // 多API Key管理器
  private settings: Settings | null = null;
  private historyPrefix: string | null = null;
  private historyUsedOnce = false;
  bootstrap: Promise<void>;
  static buildFileServer(workspace: string) {
    return new FileDiscoveryService(workspace);
  }
  constructor(options: GeminiAgent2Options) {
    this.workspace = options.workspace;
    this.proxy = options.proxy;
    this.model = options.model;
    this.imageGenerationModel = options.imageGenerationModel;
    this.webSearchEngine = options.webSearchEngine || 'default';
    this.yoloMode = options.yoloMode || false;
    this.googleCloudProject = options.GOOGLE_CLOUD_PROJECT;
    this.mcpServers = options.mcpServers || {};
    // 使用统一的工具函数获取认证类型
    this.authType = getProviderAuthType(options.model);
    this.onStreamEvent = options.onStreamEvent;
    this.initClientEnv();
    this.toolConfig = new ConversationToolConfig({
      proxy: this.proxy,
      imageGenerationModel: this.imageGenerationModel,
      webSearchEngine: this.webSearchEngine,
    });

    // Register as current agent for flashFallbackHandler access
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    currentGeminiAgent = this;

    this.bootstrap = this.initialize();
  }

  private initClientEnv() {
    const env = this.getEnv();
    const fallbackValue = (key: string, value1: string, value2?: string) => {
      if (value1 && value1 !== 'undefined') {
        process.env[key] = value1;
      }
      if (value2 && value2 !== 'undefined') {
        process.env[key] = value2;
      }
    };

    // Initialize multi-key manager for supported auth types
    this.initializeMultiKeySupport();

    // Get the current API key to use (either from multi-key manager or original)
    const getCurrentApiKey = () => {
      if (this.apiKeyManager && this.apiKeyManager.hasMultipleKeys()) {
        return process.env[this.apiKeyManager.getStatus().envKey] || this.model.apiKey;
      }
      return this.model.apiKey;
    };

    if (this.authType === AuthType.USE_GEMINI) {
      fallbackValue('GEMINI_API_KEY', getCurrentApiKey());
      fallbackValue('GOOGLE_GEMINI_BASE_URL', this.model.baseUrl);
      return;
    }
    if (this.authType === AuthType.USE_VERTEX_AI) {
      fallbackValue('GOOGLE_API_KEY', getCurrentApiKey());
      process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
      return;
    }
    if (this.authType === AuthType.LOGIN_WITH_GOOGLE) {
      fallbackValue('GOOGLE_CLOUD_PROJECT', this.googleCloudProject || '', env.GOOGLE_CLOUD_PROJECT);
      return;
    }
    if (this.authType === AuthType.USE_OPENAI) {
      fallbackValue('OPENAI_BASE_URL', this.model.baseUrl);
      fallbackValue('OPENAI_API_KEY', getCurrentApiKey());
    }
  }

  private initializeMultiKeySupport(): void {
    const apiKey = this.model?.apiKey;
    if (!apiKey || (!apiKey.includes(',') && !apiKey.includes('\n'))) {
      return; // Single key or no key, skip multi-key setup
    }

    // Only initialize for supported auth types
    if (this.authType === AuthType.USE_OPENAI || this.authType === AuthType.USE_GEMINI) {
      this.apiKeyManager = new ApiKeyManager(apiKey, this.authType);
    }
  }

  /**
   * Get multi-key manager (used by flashFallbackHandler)
   */
  getApiKeyManager(): ApiKeyManager | null {
    return this.apiKeyManager;
  }

  // 加载环境变量
  private getEnv() {
    return process.env as Record<string, string>;
  }
  private createAbortController() {
    this.abortController = new AbortController();
    return this.abortController;
  }

  private async initialize(): Promise<void> {
    const path = this.workspace;

    const settings = loadSettings(path).merged;
    this.settings = settings;

    // 使用传入的 YOLO 设置
    const yoloMode = this.yoloMode;

    // 初始化对话级别的工具配置
    await this.toolConfig.initializeForConversation(this.authType!);

    // [PERF] 채팅 시작 속도 개선을 위해 extensions 로딩 비활성화
    // 앱은 ProcessConfig의 mcp.config에서만 MCP 서버를 로드함
    // [PERF] Disabled extensions loading for faster chat startup
    // App only loads MCP servers from ProcessConfig's mcp.config
    const extensions: GeminiCLIExtension[] = [];

    // [PERF] settings.json의 mcpServers도 비활성화
    // [PERF] Also disable mcpServers from settings.json
    const settingsWithoutMcp = { ...settings, mcpServers: {} };

    this.config = await loadCliConfig({
      workspace: path,
      settings: settingsWithoutMcp,
      extensions,
      sessionId,
      proxy: this.proxy,
      model: this.model.useModel,
      conversationToolConfig: this.toolConfig,
      yoloMode,
      mcpServers: this.mcpServers,
    });
    await this.config.initialize();

    await this.config.refreshAuth(this.authType || AuthType.USE_GEMINI);

    this.geminiClient = this.config.getGeminiClient();

    // 注册对话级别的自定义工具
    await this.toolConfig.registerCustomTools(this.config, this.geminiClient);

    this.initToolScheduler(settings);
  }

  // 初始化调度工具
  private initToolScheduler(_settings: Settings) {
    this.scheduler = new CoreToolScheduler({
      onAllToolCallsComplete: async (completedToolCalls: CompletedToolCall[]) => {
        await Promise.resolve(); // Satisfy async requirement
        try {
          if (completedToolCalls.length > 0) {
            const refreshMemory = async () => {
              // 直接使用 aioncli-core 提供的 refreshServerHierarchicalMemory
              // Directly use refreshServerHierarchicalMemory from aioncli-core
              // 它会自动从 config 获取 ExtensionLoader 并更新 memory
              // It automatically gets ExtensionLoader from config and updates memory
              await refreshServerHierarchicalMemory(this.config);
            };
            const response = handleCompletedTools(completedToolCalls, this.geminiClient, refreshMemory);
            if (response.length > 0) {
              const geminiTools = completedToolCalls.filter((tc) => {
                const isTerminalState = tc.status === 'success' || tc.status === 'error' || tc.status === 'cancelled';

                if (isTerminalState) {
                  const completedOrCancelledCall = tc;
                  return completedOrCancelledCall.response?.responseParts !== undefined && !tc.request.isClientInitiated;
                }
                return false;
              });

              this.submitQuery(response, uuid(), this.createAbortController(), {
                isContinuation: true,
                prompt_id: geminiTools[0].request.prompt_id,
              });
            }
          }
        } catch (e) {
          this.onStreamEvent({
            type: 'error',
            data: 'handleCompletedTools error: ' + (e.message || JSON.stringify(e)),
            msg_id: uuid(),
          });
        }
      },
      onToolCallsUpdate: (updatedCoreToolCalls: ToolCall[]) => {
        try {
          const prevTrackedCalls = this.trackedCalls || [];
          const toolCalls: TrackedToolCall[] = updatedCoreToolCalls.map((coreTc) => {
            const existingTrackedCall = prevTrackedCalls.find((ptc) => ptc.request.callId === coreTc.request.callId);
            const newTrackedCall: TrackedToolCall = {
              ...coreTc,
              responseSubmittedToGemini: existingTrackedCall?.responseSubmittedToGemini ?? false,
            };
            return newTrackedCall;
          });
          const display = mapToDisplay(toolCalls);
          this.onStreamEvent({
            type: 'tool_group',
            data: display.tools,
            msg_id: uuid(),
          });
        } catch (e) {
          this.onStreamEvent({
            type: 'error',
            data: 'tool_calls_update error: ' + (e.message || JSON.stringify(e)),
            msg_id: uuid(),
          });
        }
      },
      // onEditorClose 回调在 aioncli-core v0.18.4 中已移除 / callback was removed in aioncli-core v0.18.4
      // approvalMode: this.config.getApprovalMode(),
      getPreferredEditor() {
        return 'vscode';
      },
      config: this.config,
    });
  }

  private handleMessage(stream: AsyncGenerator<ServerGeminiStreamEvent, Turn, unknown>, msg_id: string, abortController: AbortController, query?: unknown, retryCount: number = 0, prompt_id?: string): Promise<{ usageMetadata?: unknown }> {
    const toolCallRequests: ToolCallRequestInfo[] = [];
    let capturedUsageMetadata: unknown = undefined;
    let invalidStreamDetected = false;

    return processGeminiStreamEvents(stream, this.config, (data) => {
      if (data.type === 'tool_call_request') {
        const toolRequest = data.data as ToolCallRequestInfo;
        toolCallRequests.push(toolRequest);
        // 도구 호출 보호 시작 / Protect tool call from cancellation
        globalToolCallGuard.protect(toolRequest.callId);
        return;
      }
      // invalid_stream 이벤트 감지 / Detect invalid_stream event
      if (data.type === 'invalid_stream') {
        invalidStreamDetected = true;
        const streamData = data.data as { retryable?: boolean };
        if (streamData?.retryable && retryCount < MAX_INVALID_STREAM_RETRIES) {
          this.onStreamEvent({
            type: 'error',
            data: `잘못된 응답 스트림이 감지되었습니다. 재시도 중... (${retryCount + 1}/${MAX_INVALID_STREAM_RETRIES})`,
            msg_id,
          });
        }
        return;
      }
      this.onStreamEvent({
        ...data,
        msg_id,
      });
    })
      .then(async (result) => {
        // Auto-retry 로직 / Auto-retry logic for invalid stream
        if (invalidStreamDetected && retryCount < MAX_INVALID_STREAM_RETRIES && query && !abortController.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          const newStream = this.geminiClient.sendMessageStream(query, abortController.signal, prompt_id);
          return this.handleMessage(newStream, msg_id, abortController, query, retryCount + 1, prompt_id);
        }

        // Capture usageMetadata from the processed stream
        capturedUsageMetadata = result.usageMetadata;

        if (toolCallRequests.length > 0) {
          // Emit preview_open for navigation tools, but don't block execution
          // 对导航工具发送 preview_open 事件，但不阻止执行
          // Agent needs chrome-devtools to fetch web page content
          // Agent 需要 chrome-devtools 来获取网页内容
          this.emitPreviewForNavigationTools(toolCallRequests, msg_id);

          // Schedule ALL tool requests including chrome-devtools
          // 调度所有工具请求，包括 chrome-devtools
          await this.scheduler.schedule(toolCallRequests, abortController.signal);
        }

        return { usageMetadata: capturedUsageMetadata };
      })
      .catch((e: unknown) => {
        // 오류 발생 시 도구 호출 보호 해제 / Unprotect tool calls on error
        for (const req of toolCallRequests) {
          globalToolCallGuard.unprotect(req.callId);
        }
        const errorMessage = e instanceof Error ? e.message : JSON.stringify(e);
        const enrichedMessage = this.enrichErrorMessage(errorMessage);
        this.onStreamEvent({
          type: 'error',
          data: enrichedMessage,
          msg_id,
        });
        // Return empty usageMetadata on error to satisfy return type
        return { usageMetadata: undefined as unknown };
      });
  }

  /**
   * 오류 메시지 강화 - 할당량 오류 감지 및 상세 정보 추가
   * Enrich error message - detect quota errors and add details
   */
  private enrichErrorMessage(errorMessage: string): string {
    const lowerMessage = errorMessage.toLowerCase();

    // 할당량/용량 소진 오류 감지 / Detect quota/capacity exhaustion
    if (lowerMessage.includes('model_capacity_exhausted') || lowerMessage.includes('resource_exhausted') || lowerMessage.includes('ratelimitexceeded') || lowerMessage.includes('quota')) {
      return `${errorMessage}\n\n모델 할당량이 소진되었습니다. 잠시 후 다시 시도하거나 다른 모델을 사용해 주세요.`;
    }

    return errorMessage;
  }

  /**
   * 检查是否为导航工具调用（支持带MCP前缀和不带前缀的工具名）
   * Check if it's a navigation tool call (supports both with and without MCP prefix)
   *
   * Delegates to NavigationInterceptor for unified logic
   */
  private isNavigationTool(toolName: string): boolean {
    return NavigationInterceptor.isNavigationTool(toolName);
  }

  /**
   * Emit preview_open events for navigation tools without blocking execution
   * 对导航工具发送 preview_open 事件，但不阻止执行
   *
   * Agent needs chrome-devtools to fetch web page content, so we only emit
   * preview events to show URL in preview panel, while letting tools execute normally.
   * Agent 需要 chrome-devtools 来获取网页内容，所以我们只发送预览事件在预览面板中显示 URL，
   * 同时让工具正常执行。
   */
  private emitPreviewForNavigationTools(toolCallRequests: ToolCallRequestInfo[], _msg_id: string): void {
    for (const request of toolCallRequests) {
      const toolName = request.name || '';

      if (this.isNavigationTool(toolName)) {
        const args = request.args || {};
        const url = NavigationInterceptor.extractUrl({ arguments: args as Record<string, unknown> });
        if (url) {
          // Emit preview_open event to show URL in preview panel
          // 发送 preview_open 事件在预览面板中显示 URL
          this.onStreamEvent({
            type: 'preview_open',
            data: {
              content: url,
              contentType: 'url',
              metadata: {
                title: url,
              },
            },
            msg_id: uuid(),
          });
        }
      }
    }
  }

  submitQuery(
    query: unknown,
    msg_id: string,
    abortController: AbortController,
    options?: {
      prompt_id?: string;
      isContinuation?: boolean;
    }
  ): string | undefined {
    try {
      let prompt_id = options?.prompt_id;
      if (!prompt_id) {
        prompt_id = this.config.getSessionId() + '########' + getPromptCount();
      }
      if (!options?.isContinuation) {
        startNewPrompt();
      }
      const stream = this.geminiClient.sendMessageStream(query, abortController.signal, prompt_id);
      this.onStreamEvent({
        type: 'start',
        data: '',
        msg_id,
      });
      // query, prompt_id 전달하여 auto-retry 지원 / Pass query and prompt_id for auto-retry support
      this.handleMessage(stream, msg_id, abortController, query, 0, prompt_id)
        .then((result) => {
          this.onStreamEvent({
            type: 'finish',
            data: { usageMetadata: result?.usageMetadata },
            msg_id,
          });
        })
        .catch((e: unknown) => {
          const errorMessage = e instanceof Error ? e.message : JSON.stringify(e);
          this.onStreamEvent({
            type: 'error',
            data: errorMessage,
            msg_id,
          });
          // Still send finish event on error (with no usageMetadata)
          this.onStreamEvent({
            type: 'finish',
            data: {},
            msg_id,
          });
        });
      return '';
    } catch (e) {
      this.onStreamEvent({
        type: 'error',
        data: e.message,
        msg_id,
      });
    }
  }

  async send(message: string | Array<{ text: string }>, msg_id = '') {
    await this.bootstrap;
    const abortController = this.createAbortController();

    // OAuth 토큰 사전 검증 (Google 로그인 시)
    // Pre-validate OAuth token for Google login
    if (this.authType === AuthType.LOGIN_WITH_GOOGLE) {
      try {
        await this.config?.refreshAuth(this.authType);
      } catch (tokenError) {
        console.warn('[GeminiAgent] OAuth token refresh error:', tokenError);
        // 토큰 오류 시에도 계속 진행 (서버에서 처리)
        // Continue even on token error (let server handle it)
      }
    }

    // Prepend one-time history prefix before processing commands
    if (this.historyPrefix && !this.historyUsedOnce) {
      if (Array.isArray(message)) {
        const first = message[0];
        const original = first?.text ?? '';
        message = [{ text: `${this.historyPrefix}${original}` }];
      } else if (typeof message === 'string') {
        message = `${this.historyPrefix}${message}`;
      }
      this.historyUsedOnce = true;
    }

    // Track error messages from @ command processing
    let atCommandError: string | null = null;

    const { processedQuery, shouldProceed } = await handleAtCommand({
      query: Array.isArray(message) ? message[0].text : message,
      config: this.config,
      addItem: (item: unknown) => {
        // Capture error messages from @ command processing
        if (item && typeof item === 'object' && 'type' in item) {
          const typedItem = item as { type: string; text?: string };
          if (typedItem.type === 'error' && typedItem.text) {
            atCommandError = typedItem.text;
          }
        }
      },
      onDebugMessage() {
        // 调试回调留空以避免日志噪声 / Debug hook intentionally left blank to avoid noisy logging
      },
      messageId: Date.now(),
      signal: abortController.signal,
    });

    if (!shouldProceed || processedQuery === null || abortController.signal.aborted) {
      // Send error message to user if @ command processing failed
      // 如果 @ 命令处理失败，向用户发送错误消息
      if (atCommandError) {
        this.onStreamEvent({
          type: 'error',
          data: atCommandError,
          msg_id,
        });
      } else if (!abortController.signal.aborted) {
        // Generic error if we don't have specific error message
        this.onStreamEvent({
          type: 'error',
          data: 'Failed to process @ file reference. The file may not exist or is not accessible.',
          msg_id,
        });
      }
      // Send finish event so UI can reset state
      this.onStreamEvent({
        type: 'finish',
        data: null,
        msg_id,
      });
      return;
    }
    const requestId = this.submitQuery(processedQuery, msg_id, abortController);
    return requestId;
  }
  stop(): void {
    this.abortController?.abort();
  }

  async injectConversationHistory(text: string): Promise<void> {
    try {
      if (!this.config || !this.workspace || !this.settings) return;
      // Prepare one-time prefix for first outgoing message after (re)start
      this.historyPrefix = `Conversation history (recent):\n${text}\n\n`;
      this.historyUsedOnce = false;
      // 使用 refreshServerHierarchicalMemory 刷新 memory，然后追加聊天历史
      // Use refreshServerHierarchicalMemory to refresh memory, then append chat history
      const { memoryContent } = await refreshServerHierarchicalMemory(this.config);
      const combined = `${memoryContent}\n\n[Recent Chat]\n${text}`;
      this.config.setUserMemory(combined);
    } catch (e) {
      // ignore injection errors
    }
  }
}

/**
 * Get current GeminiAgent instance (used by flashFallbackHandler)
 */
export function getCurrentGeminiAgent(): GeminiAgent | null {
  return currentGeminiAgent;
}
