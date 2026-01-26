/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IMessageToolGroup } from '@/common/chatLib';
import { iconColors } from '@/renderer/theme/colors';
import { Alert, Button, Image, Message, Radio, Tag, Tooltip } from '@arco-design/web-react';
import { Copy, Download, LoadingOne } from '@icon-park/react';
import 'diff2html/bundles/css/diff2html.min.css';
import React, { useCallback, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CollapsibleContent from '../components/CollapsibleContent';
import Diff2Html from '../components/Diff2Html';
import LocalImageView from '../components/LocalImageView';
import MarkdownView from '../components/Markdown';
import { ToolConfirmationOutcome } from '../types/tool-confirmation';
import { ImagePreviewContext } from './MessageList';
import MessageFileChanges from './codex/MessageFileChanges';
import { COLLAPSE_CONFIG, TEXT_CONFIG } from './constants';
import type { ImageGenerationResult, WriteFileResult } from './types';

// Alert 组件样式常量 Alert component style constant
// 顶部对齐图标与内容，避免多行文本时图标垂直居中
const ALERT_CLASSES = '!items-start !rd-8px !px-8px [&_.arco-alert-icon]:flex [&_.arco-alert-icon]:items-start [&_.arco-alert-content-wrapper]:flex [&_.arco-alert-content-wrapper]:items-start [&_.arco-alert-content-wrapper]:w-full [&_.arco-alert-content]:flex-1';

// CollapsibleContent 高度常量 CollapsibleContent height constants
const RESULT_MAX_HEIGHT = COLLAPSE_CONFIG.MAX_HEIGHT;

interface IMessageToolGroupProps {
  message: IMessageToolGroup;
}

const useConfirmationButtons = (confirmationDetails: IMessageToolGroupProps['message']['content'][number]['confirmationDetails'], t: (key: string, options?: any) => string) => {
  return useMemo(() => {
    if (!confirmationDetails) return {};
    let question: string;
    const options: Array<{ label: string; value: ToolConfirmationOutcome }> = [];
    switch (confirmationDetails.type) {
      case 'edit':
        {
          question = t('messages.confirmation.applyChange');
          options.push(
            {
              label: t('messages.confirmation.yesAllowOnce'),
              value: ToolConfirmationOutcome.ProceedOnce,
            },
            {
              label: t('messages.confirmation.yesAllowAlways'),
              value: ToolConfirmationOutcome.ProceedAlways,
            },
            { label: t('messages.confirmation.no'), value: ToolConfirmationOutcome.Cancel }
          );
        }
        break;
      case 'exec':
        {
          question = t('messages.confirmation.allowExecution');
          options.push(
            {
              label: t('messages.confirmation.yesAllowOnce'),
              value: ToolConfirmationOutcome.ProceedOnce,
            },
            {
              label: t('messages.confirmation.yesAllowAlways'),
              value: ToolConfirmationOutcome.ProceedAlways,
            },
            { label: t('messages.confirmation.no'), value: ToolConfirmationOutcome.Cancel }
          );
        }
        break;
      case 'info':
        {
          question = t('messages.confirmation.proceed');
          options.push(
            {
              label: t('messages.confirmation.yesAllowOnce'),
              value: ToolConfirmationOutcome.ProceedOnce,
            },
            {
              label: t('messages.confirmation.yesAllowAlways'),
              value: ToolConfirmationOutcome.ProceedAlways,
            },
            { label: t('messages.confirmation.no'), value: ToolConfirmationOutcome.Cancel }
          );
        }
        break;
      default: {
        const mcpProps = confirmationDetails;
        question = t('messages.confirmation.allowMCPTool', {
          toolName: mcpProps.toolName,
          serverName: mcpProps.serverName,
        });
        options.push(
          {
            label: t('messages.confirmation.yesAllowOnce'),
            value: ToolConfirmationOutcome.ProceedOnce,
          },
          {
            label: t('messages.confirmation.yesAlwaysAllowTool', {
              toolName: mcpProps.toolName,
              serverName: mcpProps.serverName,
            }),
            value: ToolConfirmationOutcome.ProceedAlwaysTool,
          },
          {
            label: t('messages.confirmation.yesAlwaysAllowServer', {
              serverName: mcpProps.serverName,
            }),
            value: ToolConfirmationOutcome.ProceedAlwaysServer,
          },
          { label: t('messages.confirmation.no'), value: ToolConfirmationOutcome.Cancel }
        );
      }
    }
    return {
      question,
      options,
    };
  }, [confirmationDetails, t]);
};

const ConfirmationDetails: React.FC<{
  content: IMessageToolGroupProps['message']['content'][number];
  onConfirm: (outcome: ToolConfirmationOutcome) => void;
}> = ({ content, onConfirm }) => {
  const { t } = useTranslation();
  const { confirmationDetails } = content;
  if (!confirmationDetails) return;

  const isMcp = confirmationDetails.type === 'mcp' || !['edit', 'exec', 'info'].includes(confirmationDetails.type);

  const node = useMemo(() => {
    if (!confirmationDetails) return null;
    const isConfirm = content.status === 'Confirming';
    switch (confirmationDetails.type) {
      case 'edit':
        return (
          <div>
            <Diff2Html title={isConfirm ? confirmationDetails.title : content.description} diff={confirmationDetails?.fileDiff || ''} filePath={confirmationDetails.fileName}></Diff2Html>
          </div>
        );
      case 'exec': {
        const bashSnippet = `\`\`\`bash\n${confirmationDetails.command}\n\`\`\``;
        return (
          <div className='w-full max-w-100% min-w-0'>
            <MarkdownView codeStyle={{ marginTop: 4, marginBottom: 4 }}>{bashSnippet}</MarkdownView>
          </div>
        );
      }
      case 'info':
        return <span className='text-t-primary'>{confirmationDetails.prompt}</span>;
      case 'mcp':
        return null; // MCP는 별도 UI로 처리
    }
  }, [confirmationDetails, content]);

  const { question = '', options = [] } = useConfirmationButtons(confirmationDetails, t);

  const [selected, setSelected] = useState<ToolConfirmationOutcome | null>(null);

  // MCP 도구 권한 요청 - 컴팩트한 카드 스타일 UI
  if (isMcp && content.status === 'Confirming') {
    const mcpProps = confirmationDetails as { toolName?: string; serverName?: string; toolDisplayName?: string };
    return (
      <div className='bg-[var(--fill-1)] rd-12px p-16px border border-solid border-[var(--border-2)]'>
        {/* 헤더 - 컴팩트한 레이아웃 */}
        <div className='flex items-start gap-10px mb-12px'>
          <div className='w-32px h-32px rd-8px bg-gradient-to-br from-[rgb(var(--primary-5))] to-[rgb(var(--primary-6))] flex items-center justify-center text-16px flex-shrink-0'>🔧</div>
          <div className='flex-1 min-w-0'>
            <div className='text-14px font-semibold text-t-primary leading-tight'>{t('messages.confirmation.allowMCPTool')}</div>
            <div className='text-12px text-t-secondary mt-2px leading-tight'>
              {t('messages.confirmation.allowMCPToolDesc', {
                toolName: mcpProps.toolName,
                serverName: mcpProps.serverName,
              })}
            </div>
          </div>
        </div>

        {/* 도구 정보 태그 */}
        {mcpProps.toolDisplayName && (
          <div className='mb-10px'>
            <Tag className='!rd-6px !px-8px !py-2px !text-12px' color='arcoblue'>
              {mcpProps.toolDisplayName}
            </Tag>
          </div>
        )}

        {/* 옵션 리스트 - 컴팩트하고 체크 피드백 강화 */}
        <div className='flex flex-col gap-6px'>
          {options.map((item) => (
            <div key={item.value} className={`p-10px rd-10px border border-solid cursor-pointer transition-all duration-150 ${selected === item.value ? 'border-[#4D3CEA] bg-[rgba(77,60,234,0.08)] scale-[1.01]' : 'border-[var(--border-2)] hover:border-[var(--border-3)] hover:bg-[var(--fill-2)]'}`} onClick={() => setSelected(item.value)}>
              <div className='flex items-center gap-8px'>
                <div className={`w-16px h-16px rd-full flex items-center justify-center flex-shrink-0 transition-all duration-150 ${selected === item.value ? 'bg-[#4D3CEA]' : 'border-2 border-solid border-[var(--border-3)]'}`}>
                  {selected === item.value && (
                    <svg width='10' height='10' viewBox='0 0 10 10' fill='none'>
                      <path d='M2 5L4 7L8 3' stroke='white' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
                    </svg>
                  )}
                </div>
                <span className={`text-13px transition-colors duration-150 ${selected === item.value ? 'text-[#4D3CEA] font-medium' : 'text-t-primary'}`}>{item.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 확인 버튼 - 컴팩트 */}
        <div className='mt-12px'>
          <Button type='primary' size='default' className='!rd-10px !w-full !h-36px' disabled={!selected} onClick={() => onConfirm(selected!)}>
            {t('messages.confirm')}
          </Button>
        </div>
      </div>
    );
  }

  // 기존 스타일 (edit, exec, info) - 카드 스타일로 개선
  return (
    <div>
      {node}
      {content.status === 'Confirming' && (
        <div className='bg-[var(--fill-1)] rd-12px p-16px mt-12px border border-solid border-[var(--border-2)]'>
          <div className='text-14px font-medium text-t-primary mb-12px'>{question}</div>

          {/* 옵션 리스트 - 클릭 가능한 카드 스타일 */}
          <div className='flex flex-col gap-6px'>
            {options.map((item) => (
              <div key={item.value} className={`p-10px rd-10px border border-solid cursor-pointer transition-all duration-150 ${selected === item.value ? 'border-[#4D3CEA] bg-[rgba(77,60,234,0.08)] scale-[1.01]' : 'border-[var(--border-2)] hover:border-[var(--border-3)] hover:bg-[var(--fill-2)]'}`} onClick={() => setSelected(item.value)}>
                <div className='flex items-center gap-8px'>
                  <div className={`w-16px h-16px rd-full flex items-center justify-center flex-shrink-0 transition-all duration-150 ${selected === item.value ? 'bg-[#4D3CEA]' : 'border-2 border-solid border-[var(--border-3)]'}`}>
                    {selected === item.value && (
                      <svg width='10' height='10' viewBox='0 0 10 10' fill='none'>
                        <path d='M2 5L4 7L8 3' stroke='white' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
                      </svg>
                    )}
                  </div>
                  <span className={`text-13px transition-colors duration-150 ${selected === item.value ? 'text-[#4D3CEA] font-medium' : 'text-t-primary'}`}>{item.label}</span>
                </div>
              </div>
            ))}
          </div>

          {/* 확인 버튼 */}
          <div className='mt-12px'>
            <Button type='primary' size='default' className='!rd-10px !w-full !h-36px' disabled={!selected} onClick={() => onConfirm(selected!)}>
              {t('messages.confirm')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ImageDisplay: 图片生成结果展示组件 Image generation result display component
const ImageDisplay: React.FC<{
  imgUrl: string;
  relativePath?: string;
}> = ({ imgUrl, relativePath }) => {
  const { t } = useTranslation();
  const [messageApi, messageContext] = Message.useMessage();
  const [imageUrl, setImageUrl] = useState<string>(imgUrl);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { inPreviewGroup } = useContext(ImagePreviewContext);

  // 如果是本地路径，需要加载为 base64 Load local paths as base64
  React.useEffect(() => {
    if (imgUrl.startsWith('data:') || imgUrl.startsWith('http')) {
      setImageUrl(imgUrl);
      setLoading(false);
    } else {
      setLoading(true);
      setError(false);
      ipcBridge.fs.getImageBase64
        .invoke({ path: imgUrl })
        .then((base64) => {
          setImageUrl(base64);
          setLoading(false);
        })
        .catch((error) => {
          console.error('Failed to load image:', error);
          setError(true);
          setLoading(false);
        });
    }
  }, [imgUrl]);

  // 获取图片 blob（复用逻辑）Get image blob (reusable logic)
  const getImageBlob = useCallback(async (): Promise<Blob> => {
    const response = await fetch(imageUrl);
    return await response.blob();
  }, [imageUrl]);

  const handleCopy = useCallback(async () => {
    try {
      const blob = await getImageBlob();
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
      messageApi.success(t('messages.copySuccess', { defaultValue: 'Copied' }));
    } catch (error) {
      console.error('Failed to copy image:', error);
      messageApi.error(t('messages.copyFailed', { defaultValue: 'Failed to copy' }));
    }
  }, [getImageBlob, t, messageApi]);

  const handleDownload = useCallback(async () => {
    try {
      const blob = await getImageBlob();
      const fileName = relativePath?.split(/[\\/]/).pop() || 'image.png';

      // 创建下载链接 Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      messageApi.success(t('messages.downloadSuccess', { defaultValue: 'Download successful' }));
    } catch (error) {
      console.error('Failed to download image:', error);
      messageApi.error(t('messages.downloadFailed', { defaultValue: 'Failed to download' }));
    }
  }, [getImageBlob, relativePath, t, messageApi]);

  // 加载状态 Loading state
  if (loading) {
    return (
      <div className='flex items-center gap-8px my-8px'>
        <LoadingOne className='loading' theme='outline' size='14' fill={iconColors.primary} />
        <span className='text-t-secondary text-sm'>{t('common.loading', { defaultValue: 'Loading...' })}</span>
      </div>
    );
  }

  // 错误状态 Error state
  if (error || !imageUrl) {
    return (
      <div className='flex items-center gap-8px my-8px text-t-secondary text-sm'>
        <span>{t('messages.imageLoadFailed', { defaultValue: 'Failed to load image' })}</span>
      </div>
    );
  }

  // 图片元素 Image element
  const imageElement = (
    <Image
      src={imageUrl}
      alt={relativePath || 'Generated image'}
      width={197}
      style={{
        maxHeight: '320px',
        objectFit: 'contain',
        borderRadius: '8px',
        cursor: 'pointer',
      }}
    />
  );

  return (
    <>
      {messageContext}
      <div className='flex flex-col gap-8px my-8px' style={{ maxWidth: '197px' }}>
        {/* 图片预览 Image preview - 如果已在 PreviewGroup 中则直接渲染，否则包裹 PreviewGroup */}
        {inPreviewGroup ? imageElement : <Image.PreviewGroup>{imageElement}</Image.PreviewGroup>}
        {/* 操作按钮 Action buttons */}
        <div className='flex gap-8px'>
          <Tooltip content={t('common.copy', { defaultValue: 'Copy' })}>
            <Button type='secondary' size='small' shape='circle' icon={<Copy theme='outline' size='14' fill={iconColors.primary} />} onClick={handleCopy} />
          </Tooltip>
          <Tooltip content={t('common.download', { defaultValue: 'Download' })}>
            <Button type='secondary' size='small' shape='circle' icon={<Download theme='outline' size='14' fill={iconColors.primary} />} onClick={handleDownload} />
          </Tooltip>
        </div>
      </div>
    </>
  );
};

const ToolResultDisplay: React.FC<{
  content: IMessageToolGroupProps['message']['content'][number];
}> = ({ content }) => {
  const { resultDisplay, name } = content;

  // 图片生成特殊处理 Special handling for image generation
  if (name === 'ImageGeneration' && typeof resultDisplay === 'object') {
    const result = resultDisplay as ImageGenerationResult;
    // 如果有 img_url 才显示图片，否则显示错误信息
    if (result.img_url) {
      return <LocalImageView src={result.img_url} alt={result.relative_path || result.img_url} className='max-w-100% max-h-100%' />;
    }
    // 如果是错误，继续走下面的 JSON 显示逻辑
  }

  // 将结果转换为字符串 Convert result to string
  const display = typeof resultDisplay === 'string' ? resultDisplay : JSON.stringify(resultDisplay, null, 2);

  // 使用 CollapsibleContent 包装长内容
  // Wrap long content with CollapsibleContent
  return (
    <CollapsibleContent maxHeight={RESULT_MAX_HEIGHT} defaultCollapsed={true} useMask={false}>
      <pre className='text-t-primary whitespace-pre-wrap break-words m-0' style={{ fontSize: `${TEXT_CONFIG.FONT_SIZE}px`, lineHeight: TEXT_CONFIG.LINE_HEIGHT }}>
        {display}
      </pre>
    </CollapsibleContent>
  );
};

const MessageToolGroup: React.FC<IMessageToolGroupProps> = ({ message }) => {
  const { t } = useTranslation();

  // 收集所有 WriteFile 结果用于汇总显示 / Collect all WriteFile results for summary display
  const writeFileResults = useMemo(() => {
    return message.content.filter((item) => item.name === 'WriteFile' && item.resultDisplay && typeof item.resultDisplay === 'object' && 'fileDiff' in item.resultDisplay).map((item) => item.resultDisplay as WriteFileResult);
  }, [message.content]);

  // 找到第一个 WriteFile 的索引 / Find the index of first WriteFile
  const firstWriteFileIndex = useMemo(() => {
    return message.content.findIndex((item) => item.name === 'WriteFile' && item.resultDisplay && typeof item.resultDisplay === 'object' && 'fileDiff' in item.resultDisplay);
  }, [message.content]);

  return (
    <div>
      {message.content.map((content, index) => {
        const { status, callId, name, description, resultDisplay, confirmationDetails } = content;
        const isLoading = status !== 'Success' && status !== 'Error' && status !== 'Canceled';
        // status === "Confirming" &&
        if (confirmationDetails) {
          return (
            <ConfirmationDetails
              key={callId}
              content={content}
              onConfirm={(outcome) => {
                ipcBridge.geminiConversation.confirmMessage
                  .invoke({
                    confirmKey: outcome,
                    msg_id: message.id,
                    callId: callId,
                    conversation_id: message.conversation_id,
                  })
                  .then((res) => {
                    console.log('------onConfirm.res>:', res);
                  })
                  .catch((error) => {
                    console.error('Failed to confirm message:', error);
                  });
              }}
            ></ConfirmationDetails>
          );
        }

        // WriteFile 特殊处理：使用 MessageFileChanges 汇总显示 / WriteFile special handling: use MessageFileChanges for summary display
        if (name === 'WriteFile' && typeof resultDisplay !== 'string') {
          if (resultDisplay && typeof resultDisplay === 'object' && 'fileDiff' in resultDisplay) {
            // 只在第一个 WriteFile 位置显示汇总组件 / Only show summary component at first WriteFile position
            if (index === firstWriteFileIndex && writeFileResults.length > 0) {
              return (
                <div className='w-full min-w-0' key={callId}>
                  <MessageFileChanges writeFileChanges={writeFileResults} />
                </div>
              );
            }
            // 跳过其他 WriteFile / Skip other WriteFile
            return null;
          }
        }

        // ImageGeneration 特殊处理：单独展示图片，不用 Alert 包裹 Special handling for ImageGeneration: display image separately without Alert wrapper
        if (name === 'ImageGeneration' && typeof resultDisplay === 'object') {
          const result = resultDisplay as ImageGenerationResult;
          if (result.img_url) {
            return <ImageDisplay key={callId} imgUrl={result.img_url} relativePath={result.relative_path} />;
          }
        }

        // 通用工具调用展示 Generic tool call display
        // 将可展开的长内容放在 Alert 下方，保持 Alert 仅展示头部信息
        // MCP 도구 여부 확인 (name 또는 description에 'MCP Server'가 포함)
        const isMcpTool = name?.includes('MCP Server') || description?.includes('MCP Server');

        return (
          <div key={callId}>
            <Alert
              className={ALERT_CLASSES}
              type={status === 'Error' ? 'error' : status === 'Success' ? 'success' : status === 'Canceled' ? 'warning' : 'info'}
              icon={isLoading && <LoadingOne theme='outline' size='12' fill={iconColors.primary} className='loading lh-[1] flex' />}
              content={
                <div>
                  <Tag className={'mr-4px'}>
                    {name}
                    {status === 'Canceled' ? `(${t('messages.canceledExecution')})` : ''}
                  </Tag>
                </div>
              }
            />

            {/* MCP 도구는 결과 숨김, 일반 도구만 표시 */}
            {!isMcpTool && (description || resultDisplay) && (
              <div className='mt-8px'>
                {description && <div className='text-12px text-t-secondary whitespace-pre-wrap break-words mb-2'>{description}</div>}
                {resultDisplay && (
                  <div>
                    {/* 在 Alert 外展示完整结果 Display full result outside Alert */}
                    {/* ToolResultDisplay 内部已包含 CollapsibleContent，避免嵌套 */}
                    {/* ToolResultDisplay already contains CollapsibleContent internally, avoid nesting */}
                    <ToolResultDisplay content={content} />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default MessageToolGroup;
