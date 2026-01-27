/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IProvider, TProviderWithModel } from '@/common/storage';
import { ConfigStorage } from '@/common/storage';
import { uuid } from '@/common/utils';
import AuggieLogo from '@/renderer/assets/logos/auggie.svg';
import ClaudeLogo from '@/renderer/assets/logos/claude.svg';
import CodexLogo from '@/renderer/assets/logos/codex.svg';
import GeminiLogo from '@/renderer/assets/logos/gemini.svg';
import GooseLogo from '@/renderer/assets/logos/goose.svg';
import IflowLogo from '@/renderer/assets/logos/iflow.svg';
import KimiLogo from '@/renderer/assets/logos/kimi.svg';
import OpenCodeLogo from '@/renderer/assets/logos/opencode.svg';
import QwenLogo from '@/renderer/assets/logos/qwen.svg';
import FilePreview from '@/renderer/components/FilePreview';
import { auth } from '@/renderer/config/firebase';
import { useAuth } from '@/renderer/context/AuthContext';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { useCompositionInput } from '@/renderer/hooks/useCompositionInput';
import { useDragUpload } from '@/renderer/hooks/useDragUpload';
import { useGeminiGoogleAuthModels } from '@/renderer/hooks/useGeminiGoogleAuthModels';
import { usePasteService } from '@/renderer/hooks/usePasteService';
import { formatFilesForMessage } from '@/renderer/hooks/useSendBoxFiles';
import { allSupportedExts, getCleanFileNames, type FileMetadata } from '@/renderer/services/FileService';
import { ModelProvisioningService } from '@/renderer/services/ModelProvisioningService';
import { iconColors } from '@/renderer/theme/colors';
import { hasSpecificModelCapability } from '@/renderer/utils/modelCapabilities';
import type { AcpBackend } from '@/types/acpTypes';
import { Button, ConfigProvider, Dropdown, Input, Menu, Message, Tooltip } from '@arco-design/web-react';
import { ArrowUp, Plus, Tips, UploadOne } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import styles from './index.module.css';

/**
 * 缓存Provider的可用模型列表，避免重复计算
 */
const availableModelsCache = new Map<string, string[]>();

/**
 * 获取提供商下所有可用的主力模型（带缓存）
 * @param provider - 提供商配置
 * @returns 可用的主力模型名称数组
 */
const getAvailableModels = (provider: IProvider): string[] => {
  // 生成缓存键，包含模型列表以检测变化
  const cacheKey = `${provider.id}-${(provider.model || []).join(',')}`;

  // 检查缓存
  if (availableModelsCache.has(cacheKey)) {
    return availableModelsCache.get(cacheKey)!;
  }

  // 计算可用模型
  const result: string[] = [];
  for (const modelName of provider.model || []) {
    const functionCalling = hasSpecificModelCapability(provider, modelName, 'function_calling');
    const excluded = hasSpecificModelCapability(provider, modelName, 'excludeFromPrimary');

    if ((functionCalling === true || functionCalling === undefined) && excluded !== true) {
      result.push(modelName);
    }
  }

  // 缓存结果
  availableModelsCache.set(cacheKey, result);
  return result;
};

/**
 * 检查提供商是否有可用的主力对话模型（高效版本）
 * @param provider - 提供商配置
 * @returns true 表示提供商有可用模型，false 表示无可用模型
 */
const hasAvailableModels = (provider: IProvider): boolean => {
  // 直接使用缓存的结果，避免重复计算
  const availableModels = getAvailableModels(provider);
  return availableModels.length > 0;
};

const useModelList = () => {
  const { geminiModeOptions, isGoogleAuth } = useGeminiGoogleAuthModels();
  const { data: modelConfig } = useSWR('model.config.welcome', () => {
    return ipcBridge.mode.getModelConfig.invoke().then((data) => {
      return (data || []).filter((platform) => !!platform.model.length);
    });
  });

  const geminiModelValues = useMemo(() => geminiModeOptions.map((option) => option.value), [geminiModeOptions]);

  const modelList = useMemo(() => {
    let allProviders: IProvider[] = [];

    if (isGoogleAuth) {
      const geminiProvider: IProvider = {
        id: uuid(),
        name: 'Gemini Google Auth',
        platform: 'gemini-with-google-auth',
        baseUrl: '',
        apiKey: '',
        model: geminiModelValues,
        capabilities: [{ type: 'text' }, { type: 'vision' }, { type: 'function_calling' }],
      };
      allProviders = [geminiProvider, ...(modelConfig || [])];
    } else {
      allProviders = modelConfig || [];
    }

    // 过滤出有可用主力模型的提供商
    return allProviders.filter(hasAvailableModels);
  }, [geminiModelValues, isGoogleAuth, modelConfig]);

  // Managed Models Integration
  const { user } = useAuth();
  const [managedModels, setManagedModels] = useState<IProvider[]>([]);

  useEffect(() => {
    const loadManagedModels = async () => {
      if (user && auth.currentUser) {
        try {
          const token = await auth.currentUser.getIdToken();
          const models = await ModelProvisioningService.getProvisionedModels(token);
          setManagedModels(models);
        } catch (e: any) {
          console.error('Failed to load managed models', e);
          // [Managed Auth] Show Toast notification for subscription/authorization failure
          // Note: Using hardcoded Korean strings since useTranslation is not available in this hook.
          const errorMsg = e?.message?.includes('Subscription Error') ? '구독이 필요합니다. 결제를 진행해주세요.' : '모델을 불러오지 못했습니다. 네트워크를 확인해주세요.';
          Message.error({
            content: errorMsg,
            duration: 5000,
          });
        }
      } else {
        setManagedModels([]);
      }
    };
    void loadManagedModels();
  }, [user]);

  // Merge managed models into the final list
  const finalModelList = useMemo(() => {
    // [Managed Auth] Enforce Managed Models Only. Disable fallback to local/BYOK models.
    // return [...managedModels, ...modelList];
    return [...managedModels];
  }, [managedModels, modelList]);

  return { modelList: finalModelList, isGoogleAuth, geminiModeOptions };
};

// Agent Logo 映射 (custom uses Robot icon from @icon-park/react)
const AGENT_LOGO_MAP: Partial<Record<AcpBackend, string>> = {
  claude: ClaudeLogo,
  gemini: GeminiLogo,
  qwen: QwenLogo,
  codex: CodexLogo,
  iflow: IflowLogo,
  goose: GooseLogo,
  auggie: AuggieLogo,
  kimi: KimiLogo,
  opencode: OpenCodeLogo,
};

import { ConnectedMcpIcons } from '@/renderer/components/ConnectedMcpIcons';
import { GemButton, GemPopover } from '@/renderer/components/Gem';
import type { IGem } from '@/common/types/gems';

const Guid: React.FC = () => {
  const { t } = useTranslation();
  const { currentWorkspace } = useAuth();
  const guidContainerRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [dir, setDir] = useState<string>('');
  const [currentModel, _setCurrentModel] = useState<TProviderWithModel>();
  const { modelList, isGoogleAuth, geminiModeOptions } = useModelList();
  const geminiModeLookup = useMemo(() => {
    const lookup = new Map<string, (typeof geminiModeOptions)[number]>();
    geminiModeOptions.forEach((option) => lookup.set(option.value, option));
    return lookup;
  }, [geminiModeOptions]);
  const formatGeminiModelLabel = useCallback(
    (provider: { platform?: string } | undefined, modelName?: string) => {
      if (!modelName) return '';
      const isGoogleProvider = provider?.platform?.toLowerCase().includes('gemini-with-google-auth');
      if (isGoogleProvider) {
        return geminiModeLookup.get(modelName)?.label || modelName;
      }
      return modelName;
    },
    [geminiModeLookup]
  );
  // 记录当前选中的 provider+model，方便列表刷新时判断是否仍可用
  const selectedModelKeyRef = useRef<string | null>(null);
  // 支持在初始化页展示 Codex（MCP）选项，先做 UI 占位
  // 对于自定义代理，使用 "custom:uuid" 格式来区分多个自定义代理
  // For custom agents, we store "custom:uuid" format to distinguish between multiple custom agents
  const [selectedAgentKey, setSelectedAgentKey] = useState<string>('gemini');
  const [availableAgents, setAvailableAgents] = useState<Array<{ backend: AcpBackend; name: string; cliPath?: string; customAgentId?: string }>>();

  /**
   * 获取代理的唯一选择键
   * 对于自定义代理返回 "custom:uuid"，其他代理返回 backend 类型
   * Helper to get agent key for selection
   * Returns "custom:uuid" for custom agents, backend type for others
   */
  const getAgentKey = (agent: { backend: AcpBackend; customAgentId?: string }) => {
    return agent.backend === 'custom' && agent.customAgentId ? `custom:${agent.customAgentId}` : agent.backend;
  };

  /**
   * 通过选择键查找代理
   * 支持 "custom:uuid" 格式和普通 backend 类型
   * Helper to find agent by key
   * Supports both "custom:uuid" format and plain backend type
   */
  const findAgentByKey = (key: string) => {
    if (key.startsWith('custom:')) {
      const customAgentId = key.slice(7);
      return availableAgents?.find((a) => a.backend === 'custom' && a.customAgentId === customAgentId);
    }
    return availableAgents?.find((a) => a.backend === key);
  };

  // 获取选中的后端类型（向后兼容）/ Get the selected backend type (for backward compatibility)
  const selectedAgent = selectedAgentKey.startsWith('custom:') ? 'custom' : (selectedAgentKey as AcpBackend);
  const [isPlusDropdownOpen, setIsPlusDropdownOpen] = useState(false);
  const [typewriterPlaceholder, setTypewriterPlaceholder] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  // Gem 상태 / Gem state
  const [selectedGem, setSelectedGem] = useState<IGem | null>(null);
  const [gemPopoverVisible, setGemPopoverVisible] = useState(false);

  /**
   * 生成唯一模型 key（providerId:model）
   * Build a unique key for provider/model pair
   */
  const buildModelKey = (providerId?: string, modelName?: string) => {
    if (!providerId || !modelName) return null;
    return `${providerId}:${modelName}`;
  };

  /**
   * 检查当前 key 是否仍存在于新模型列表中
   * Check if selected model key still exists in the new provider list
   */
  const isModelKeyAvailable = (key: string | null, providers?: IProvider[]) => {
    if (!key || !providers || providers.length === 0) return false;
    return providers.some((provider) => {
      if (!provider.id || !provider.model?.length) return false;
      return provider.model.some((modelName) => buildModelKey(provider.id, modelName) === key);
    });
  };

  const setCurrentModel = async (modelInfo: TProviderWithModel) => {
    // 记录最新的选中 key，避免列表刷新后被错误重置
    selectedModelKeyRef.current = buildModelKey(modelInfo.id, modelInfo.useModel);
    await ConfigStorage.set('gemini.defaultModel', modelInfo.useModel).catch((error) => {
      console.error('Failed to save default model:', error);
    });
    _setCurrentModel(modelInfo);
  };
  const navigate = useNavigate();
  const layout = useLayoutContext();

  // 处理粘贴的文件
  const handleFilesAdded = useCallback((pastedFiles: FileMetadata[]) => {
    // 直接使用文件路径（现在总是有效的）/ Use file paths directly (always valid now)
    const filePaths = pastedFiles.map((file) => file.path);

    setFiles((prevFiles) => [...prevFiles, ...filePaths]);
    setDir(''); // 清除文件夹选择 / Clear selected directory
  }, []);

  const handleRemoveFile = useCallback((targetPath: string) => {
    // 删除初始化面板中的已选文件 / Remove files already selected on the welcome screen
    setFiles((prevFiles) => prevFiles.filter((file) => file !== targetPath));
  }, []);

  // 使用拖拽 hook
  const { isFileDragging, dragHandlers } = useDragUpload({
    supportedExts: allSupportedExts,
    onFilesAdded: handleFilesAdded,
  });

  // 使用共享的PasteService集成
  const { onPaste, onFocus } = usePasteService({
    supportedExts: allSupportedExts,
    onFilesAdded: handleFilesAdded,
    onTextPaste: (text: string) => {
      // 按光标位置插入文本，保持现有内容
      const textarea = document.activeElement as HTMLTextAreaElement | null;
      if (textarea && textarea.tagName === 'TEXTAREA') {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? start;
        const currentValue = textarea.value;
        const newValue = currentValue.slice(0, start) + text + currentValue.slice(end);
        setInput(newValue);
        setTimeout(() => {
          textarea.setSelectionRange(start + text.length, start + text.length);
        }, 0);
      } else {
        setInput((prev) => prev + text);
      }
    },
  });

  // 获取可用的 ACP agents - 基于全局标记位
  const { data: availableAgentsData } = useSWR('acp.agents.available', async () => {
    const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
    if (result.success) {
      // 过滤掉检测到的gemini命令，只保留内置Gemini
      return result.data.filter((agent) => !(agent.backend === 'gemini' && agent.cliPath));
    }
    return [];
  });

  // 更新本地状态
  useEffect(() => {
    if (availableAgentsData) {
      setAvailableAgents(availableAgentsData);
    }
  }, [availableAgentsData]);

  const handleSend = async () => {
    // 默认情况使用 Gemini（参考 main 分支的纯粹逻辑）
    if (!selectedAgent || selectedAgent === 'gemini') {
      // [Managed Auth] ALWAYS fetch fresh API key on new conversation start
      // This ensures subscription is validated every time
      if (!auth.currentUser) {
        Message.error({
          content: '로그인이 필요합니다.',
          duration: 5000,
        });
        throw new Error('Not logged in');
      }

      let modelToUse: TProviderWithModel | null = null;

      try {
        const token = await auth.currentUser.getIdToken();
        console.log('[Guid] Fetching fresh API key for new conversation...');
        const providers = await ModelProvisioningService.getProvisionedModels(token);
        const freshProvider = providers.find((p: IProvider) => p.id === 'gemini-managed-real');

        if (freshProvider && freshProvider.model?.length > 0) {
          modelToUse = {
            ...freshProvider,
            useModel: freshProvider.model[0], // Use first available model
          };
          console.log('[Guid] Successfully got fresh API key');
        } else {
          throw new Error('No managed model available from server');
        }
      } catch (e: any) {
        console.error('[Guid] Failed to get API key:', e);
        // Show user-friendly error message
        const isSubscriptionError = e?.message?.includes('Subscription Error');
        Message.error({
          content: isSubscriptionError ? '구독이 필요합니다. 결제를 진행해주세요.' : '서버에 연결할 수 없습니다. 네트워크를 확인해주세요.',
          duration: 5000,
        });
        throw e;
      }

      // Now create conversation with the fresh model
      try {
        const conversation = await ipcBridge.conversation.create.invoke({
          type: 'gemini',
          name: input,
          model: modelToUse,
          workspaceId: currentWorkspace?.id,
          extra: {
            defaultFiles: files,
            workspace: dir,
            webSearchEngine: isGoogleAuth ? 'google' : 'default',
            selectedGemId: selectedGem?.id,
            selectedGemName: selectedGem?.name,
            selectedGemSystemPrompt: selectedGem?.systemPrompt,
          },
        });

        if (!conversation || !conversation.id) {
          throw new Error('Failed to create conversation - conversation object is null or missing id');
        }

        await ipcBridge.geminiConversation.sendMessage
          .invoke({
            input: files.length > 0 ? formatFilesForMessage(files) + ' ' + input : input,
            conversation_id: conversation.id,
            msg_id: uuid(),
          })
          .catch((error) => {
            console.error('Failed to send message:', error);
            throw error;
          });
        await navigate(`/conversation/${conversation.id}`);
      } catch (error: any) {
        console.error('Failed to create or send Gemini message:', error);
        alert(`Failed to create Gemini conversation: ${error.message || error}`);
        throw error; // Re-throw to prevent input clearing
      }
      return;
    } else if (selectedAgent === 'codex') {
      // 创建 Codex 会话并保存初始消息，由对话页负责发送
      try {
        const conversation = await ipcBridge.conversation.create.invoke({
          type: 'codex',
          name: input,
          model: currentModel!, // not used by codex, but required by type
          workspaceId: currentWorkspace?.id,
          extra: {
            defaultFiles: files,
            workspace: dir,
          },
        });

        if (!conversation || !conversation.id) {
          alert('Failed to create Codex conversation. Please ensure the Codex CLI is installed and accessible in PATH.');
          return;
        }
        // 交给对话页发送，避免事件丢失
        const initialMessage = {
          input,
          files: files.length > 0 ? files : undefined,
        };
        sessionStorage.setItem(`codex_initial_message_${conversation.id}`, JSON.stringify(initialMessage));
        await navigate(`/conversation/${conversation.id}`);
      } catch (error: any) {
        alert(`Failed to create Codex conversation: ${error.message || error}`);
        throw error;
      }
      return;
    } else {
      // ACP conversation type
      const agentInfo = findAgentByKey(selectedAgentKey);
      if (!agentInfo) {
        alert(`${selectedAgent} CLI not found or not configured. Please ensure it's installed and accessible.`);
        return;
      }

      // 如果没有工作目录，使用默认目录（参考 AcpSetup 逻辑）
      const workingDir = dir;

      try {
        const conversation = await ipcBridge.conversation.create.invoke({
          type: 'acp',
          name: input,
          model: currentModel!, // ACP needs a model too
          workspaceId: currentWorkspace?.id,
          extra: {
            defaultFiles: files,
            workspace: workingDir,
            backend: selectedAgent,
            cliPath: agentInfo.cliPath,
            agentName: agentInfo.name, // 존储自定义代理的配置名称 / Store configured name for custom agents
            customAgentId: agentInfo.customAgentId, // 自定义代理的 UUID / UUID for custom agents
          },
        });

        if (!conversation || !conversation.id) {
          alert('Failed to create ACP conversation. Please check your ACP configuration and ensure the CLI is installed.');
          return;
        }

        // For ACP, we need to wait for the connection to be ready before sending the message
        // Store the initial message and let the conversation page handle it when ready
        const initialMessage = {
          input,
          files: files.length > 0 ? files : undefined,
        };

        // Store initial message in sessionStorage to be picked up by the conversation page
        sessionStorage.setItem(`acp_initial_message_${conversation.id}`, JSON.stringify(initialMessage));

        await navigate(`/conversation/${conversation.id}`);
      } catch (error: any) {
        console.error('Failed to create ACP conversation:', error);

        // Check if it's an authentication error
        if (error?.message?.includes('[ACP-AUTH-')) {
          console.error(t('acp.auth.console_error'), error.message);
          const confirmed = window.confirm(t('acp.auth.failed_confirm', { backend: selectedAgent, error: error.message }));
          if (confirmed) {
            void navigate('/settings/model');
          }
        } else {
          alert(`Failed to create ${selectedAgent} ACP conversation. Please check your ACP configuration and ensure the CLI is installed.`);
        }
        throw error; // Re-throw to prevent input clearing
      }
    }
  };
  const sendMessageHandler = () => {
    setLoading(true);
    handleSend()
      .then(() => {
        // Only clear input on successful send
        setInput('');
      })
      .catch((error) => {
        console.error('Failed to send message:', error);
        // Keep the input content when there's an error
      })
      .finally(() => {
        setLoading(false);
      });
  };
  // 使用共享的输入法合成处理
  const { compositionHandlers, createKeyDownHandler } = useCompositionInput();
  const setDefaultModel = async () => {
    if (!modelList || modelList.length === 0) {
      return;
    }
    const currentKey = selectedModelKeyRef.current || buildModelKey(currentModel?.id, currentModel?.useModel);
    // 当前选择仍然可用则不重置 / Keep current selection when still available
    if (isModelKeyAvailable(currentKey, modelList)) {
      if (!selectedModelKeyRef.current && currentKey) {
        selectedModelKeyRef.current = currentKey;
      }
      return;
    }
    // 读取默认配置，或回落到新的第一个模型
    const useModel = await ConfigStorage.get('gemini.defaultModel');
    const defaultModel = modelList.find((m) => m.model.includes(useModel)) || modelList[0];
    if (!defaultModel || !defaultModel.model.length) return;
    const resolvedUseModel = defaultModel.model.includes(useModel) ? useModel : defaultModel.model[0];
    await setCurrentModel({
      ...defaultModel,
      useModel: resolvedUseModel,
    });
  };
  useEffect(() => {
    setDefaultModel().catch((error) => {
      console.error('Failed to set default model:', error);
    });
  }, [modelList]);

  // 打字机效果
  useEffect(() => {
    const fullText = t('conversation.welcome.placeholder');
    let currentIndex = 0;
    const typingSpeed = 80; // 每个字符的打字速度（毫秒）

    const typeNextChar = () => {
      if (currentIndex <= fullText.length) {
        // 在打字过程中添加光标
        setTypewriterPlaceholder(fullText.slice(0, currentIndex) + (currentIndex < fullText.length ? '|' : ''));
        currentIndex++;
      }
    };

    // 初始延迟，让用户看到页面加载完成
    const initialDelay = setTimeout(() => {
      const intervalId = setInterval(() => {
        typeNextChar();
        if (currentIndex > fullText.length) {
          clearInterval(intervalId);
          setIsTyping(false); // 打字完成
          setTypewriterPlaceholder(fullText); // 移除光标
        }
      }, typingSpeed);

      return () => clearInterval(intervalId);
    }, 300);

    return () => clearTimeout(initialDelay);
  }, [t]);
  return (
    <ConfigProvider getPopupContainer={() => guidContainerRef.current || document.body}>
      <div ref={guidContainerRef} className='h-full flex-center flex-col px-10px' style={{ position: 'relative' }}>
        <div className={styles.guidLayout}>
          <div className='flex items-center justify-center gap-8px mb-8'>
            <p className={`text-2xl font-semibold text-0 text-center m-0`}>{t('conversation.welcome.title')}</p>
            <ConnectedMcpIcons />
          </div>
        </div>

        <div className={`${styles.marqueeContainer} mb-6`} style={{ width: '100%', maxWidth: '1200px', margin: '0 auto 24px', padding: '0 16px', boxSizing: 'border-box' }}>
          <div className={styles.marqueeContent}>
            {[
              '저번달 광고 성과에 대한 심층적 인사이트가 필요해.',
              'Google Analytics를 토대로 지난 7일동안 전환을 많이 일으킨 광고 매체가 어디야?',
              '이번 주 Google Ads 캠페인 효율 분석해줘.',
              'ROAS가 가장 높은 캠페인은 무엇인가요?',
              '지난달 대비 CPC 변화 추이 알려줘.',
              '전환율이 가장 낮은 키워드 10개 추출해줘.',
              '이탈률이 높은 랜딩 페이지 분석해줘.',
              '모바일 기기에서의 광고 성과가 궁금해.',
              '잠재 고객(Audience) 세그먼트별 성과 분석해줘.',
              '광고 소재(Creative)별 A/B 테스트 결과 요약해줘.',
              '성과가 저조한 Google Ads 캠페인 중지 추천해줘.',
              '신규 방문자 유입이 가장 많은 채널은 어디야?',
              '고객 획득 비용(CAC)이 가장 낮은 캠페인은?',
              '재방문율을 높이기 위한 전략 제안해줘.',
              '경쟁사 대비 우리의 검색 점유율 변화 분석해줘.',
              '이번 달 목표 ROI 달성 가능성 예측해줘.',
              '동영상 광고(YouTube) 조회수 및 도달 범위 분석.',
              '디스플레이 광고 노출 대비 클릭 성과 리포트.',
              '검색 광고 품질 평가 점수 낮은 키워드 보여줘.',
              '예산 최적화를 위한 광고 입찰 전략 제안.',
              // Duplicate for seamless loop
              '저번달 광고 성과에 대한 심층적 인사이트가 필요해.',
              'Google Analytics를 토대로 지난 7일동안 전환을 많이 일으킨 광고 매체가 어디야?',
              '이번 주 Google Ads 캠페인 효율 분석해줘.',
              'ROAS가 가장 높은 캠페인은 무엇인가요?',
              '지난달 대비 CPC 변화 추이 알려줘.',
              '전환율이 가장 낮은 키워드 10개 추출해줘.',
              '이탈률이 높은 랜딩 페이지 분석해줘.',
              '모바일 기기에서의 광고 성과가 궁금해.',
              '잠재 고객(Audience) 세그먼트별 성과 분석해줘.',
              '광고 소재(Creative)별 A/B 테스트 결과 요약해줘.',
              '성과가 저조한 Google Ads 캠페인 중지 추천해줘.',
              '신규 방문자 유입이 가장 많은 채널은 어디야?',
              '고객 획득 비용(CAC)이 가장 낮은 캠페인은?',
              '재방문율을 높이기 위한 전략 제안해줘.',
              '경쟁사 대비 우리의 검색 점유율 변화 분석해줘.',
              '이번 달 목표 ROI 달성 가능성 예측해줘.',
              '동영상 광고(YouTube) 조회수 및 도달 범위 분석.',
              '디스플레이 광고 노출 대비 클릭 성과 리포트.',
              '검색 광고 품질 평가 점수 낮은 키워드 보여줘.',
              '예산 최적화를 위한 광고 입찰 전략 제안.',
            ].map((text, index) => (
              <div
                key={index}
                className='px-16px py-8px bg-fill-2 hover:bg-fill-3 cursor-pointer rounded-full text-13px text-t-secondary transition-colors duration-200 border border-transparent hover:border-border whitespace-nowrap'
                onClick={() => {
                  setInput(text);
                }}
              >
                {text}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.guidLayout}>
          <div
            className={`${styles.guidInputCard} bg-border-2 b-solid border rd-20px transition-all duration-200 overflow-hidden p-16px bg-[var(--fill-0)] ${isFileDragging ? 'border-dashed' : 'border-3'}`}
            style={{
              zIndex: 1,
              ...(isFileDragging
                ? {
                    backgroundColor: 'var(--color-primary-light-1)',
                    borderColor: 'rgb(var(--primary-3))',
                    borderWidth: '1px',
                  }
                : {
                    borderWidth: '1px',
                    borderColor: 'var(--border-special, #60577E)',
                    boxShadow: '0px 2px 20px rgba(var(--primary-rgb, 77, 60, 234), 0.1)',
                  }),
            }}
            {...dragHandlers}
          >
            <Input.TextArea rows={3} placeholder={typewriterPlaceholder || t('conversation.welcome.placeholder')} className={`text-16px focus:b-none rounded-xl !bg-transparent !b-none !resize-none !p-0 ${styles.lightPlaceholder}`} value={input} onChange={(v) => setInput(v)} onPaste={onPaste} onFocus={onFocus} {...compositionHandlers} onKeyDown={createKeyDownHandler(sendMessageHandler)}></Input.TextArea>
            {files.length > 0 && (
              // 展示待发送的文件并允许取消 / Show pending files and allow cancellation
              <div className='flex flex-wrap items-center gap-8px mt-12px mb-12px'>
                {files.map((path) => (
                  <FilePreview key={path} path={path} onRemove={() => handleRemoveFile(path)} />
                ))}
              </div>
            )}
            <div className={styles.actionRow}>
              <div className={`${styles.actionTools} flex items-center gap-10px`}>
                <Dropdown
                  trigger='click'
                  onVisibleChange={setIsPlusDropdownOpen}
                  droplist={
                    <Menu
                      className='min-w-200px'
                      onClickMenuItem={(key) => {
                        if (key === 'file') {
                          ipcBridge.dialog.showOpen
                            .invoke({ properties: ['openFile', 'multiSelections'] })
                            .then((files) => {
                              if (files && files.length > 0) {
                                setFiles((prev) => [...prev, ...files]);
                              }
                            })
                            .catch((error) => {
                              console.error('Failed to open file dialog:', error);
                            });
                        }
                      }}
                    >
                      <Menu.Item key='file'>
                        <div className='flex items-center gap-8px'>
                          <UploadOne theme='outline' size='16' fill={iconColors.secondary} style={{ lineHeight: 0 }} />
                          <span>{t('conversation.welcome.uploadFile')}</span>
                        </div>
                      </Menu.Item>
                    </Menu>
                  }
                >
                  <span className='flex items-center gap-4px cursor-pointer lh-[1]'>
                    <Button type='secondary' shape='circle' className={isPlusDropdownOpen ? styles.plusButtonRotate : ''} icon={<Plus theme='outline' size='14' strokeWidth={2} fill={iconColors.primary} />}></Button>
                    {files.length > 0 && (
                      <Tooltip className={'!max-w-max'} content={<span className='whitespace-break-spaces'>{getCleanFileNames(files).join('\n')}</span>}>
                        <span className='text-t-primary'>File({files.length})</span>
                      </Tooltip>
                    )}
                  </span>
                </Dropdown>

                {/* Gem 버튼 / Gem Button */}
                {(!selectedAgent || selectedAgent === 'gemini') && (
                  <GemPopover visible={gemPopoverVisible} onVisibleChange={setGemPopoverVisible} selectedGem={selectedGem} onSelectGem={setSelectedGem}>
                    <GemButton selectedGem={selectedGem} />
                  </GemPopover>
                )}

                {/* {selectedAgent === 'gemini' && (
                  <Dropdown
                    trigger='hover'
                    droplist={
                      <Menu selectedKeys={currentModel ? [currentModel.id + currentModel.useModel] : []}>
                        {!modelList || modelList.length === 0
                          ? [
                              // 暂无可用模型提示
                              <Menu.Item key='no-models' className='px-12px py-12px text-t-secondary text-14px text-center flex justify-center items-center' disabled>
                                {t('settings.noAvailableModels')}
                              </Menu.Item>,
                              // Add Model 选项
                              <Menu.Item key='add-model' className='text-12px text-t-secondary' onClick={() => navigate('/settings/model')}>
                                <Plus theme='outline' size='12' />
                                {t('settings.addModel')}
                              </Menu.Item>,
                            ]
                          : [
                              ...(modelList || []).map((provider) => {
                                const availableModels = getAvailableModels(provider);
                                // 只渲染有可用模型的 provider
                                if (availableModels.length === 0) return null;
                                return (
                                  <Menu.ItemGroup title={provider.name} key={provider.id}>
                                    {availableModels.map((modelName) => (
                                      <Menu.Item
                                        key={provider.id + modelName}
                                        className={currentModel?.id + currentModel?.useModel === provider.id + modelName ? '!bg-2' : ''}
                                        onClick={() => {
                                          setCurrentModel({ ...provider, useModel: modelName }).catch((error) => {
                                            console.error('Failed to set current model:', error);
                                          });
                                        }}
                                      >
                                        {(() => {
                                          const isGoogleProvider = provider.platform?.toLowerCase().includes('gemini-with-google-auth');
                                          const option = isGoogleProvider ? geminiModeLookup.get(modelName) : undefined;
                                          if (!option) {
                                            return modelName;
                                          }
                                          return (
                                            <Tooltip
                                              position='right'
                                              trigger='hover'
                                              content={
                                                <div className='max-w-240px space-y-6px'>
                                                  <div className='text-12px text-t-secondary leading-5'>{option.description}</div>
                                                  {option.modelHint && <div className='text-11px text-t-tertiary'>{option.modelHint}</div>}
                                                </div>
                                              }
                                            >
                                              <div className='flex items-center justify-between gap-12px w-full'>
                                                <span>{option.label}</span>
                                              </div>
                                            </Tooltip>
                                          );
                                        })()}
                                      </Menu.Item>
                                    ))}
                                  </Menu.ItemGroup>
                                );
                              }),
                              // Add Model 选项
                              <Menu.Item key='add-model' className='text-12px text-t-secondary' onClick={() => navigate('/settings/model')}>
                                <Plus theme='outline' size='12' />
                                {t('settings.addModel')}
                              </Menu.Item>,
                            ]}
                      </Menu>
                    }
                  >
                    <Button className={'sendbox-model-btn'} shape='round'>
                      {currentModel ? formatGeminiModelLabel(currentModel, currentModel.useModel) : t('conversation.welcome.selectModel')}
                    </Button>
                  </Dropdown>
                )} */}
              </div>
              <div className={styles.actionSubmit}>
                <Button
                  shape='circle'
                  type='primary'
                  loading={loading}
                  disabled={!input.trim() || ((!selectedAgent || selectedAgent === 'gemini') && !currentModel)}
                  icon={<ArrowUp theme='outline' size='14' fill='white' strokeWidth={2} />}
                  onClick={() => {
                    handleSend().catch((error) => {
                      console.error('Failed to send message:', error);
                    });
                  }}
                />
              </div>
            </div>
          </div>
        </div>
        <div className='mt-4 flex justify-center'>
          <a href='https://www.python.org/downloads/' target='_blank' rel='noreferrer' className='group flex items-center h-8 rounded-full bg-fill-2 hover:bg-fill-3 transition-all duration-300 ease-in-out no-underline border border-transparent hover:border-border overflow-hidden max-w-[32px] hover:max-w-[500px]' style={{ textDecoration: 'none' }}>
            <div className='flex-shrink-0 w-8 h-8 flex items-center justify-center'>
              <Tips theme='outline' size='14' fill={iconColors.secondary} />
            </div>
            <span className='whitespace-nowrap text-12px text-t-secondary opacity-0 group-hover:opacity-100 transition-opacity duration-300 pr-3'>{t('conversation.welcome.pythonTip')}</span>
          </a>
        </div>
      </div>
    </ConfigProvider>
  );
};

export default Guid;
