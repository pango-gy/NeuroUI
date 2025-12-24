/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import FlexFullContainer from '@renderer/components/FlexFullContainer';
import GeminiConnectionBanner from '@renderer/components/GeminiConnectionBanner';
import MessageList from '@renderer/messages/MessageList';
import { MessageListProvider, useMessageLstCache } from '@renderer/messages/hooks';
import HOC from '@renderer/utils/HOC';
import React, { useEffect, useState } from 'react';
import LocalImageView from '../../../components/LocalImageView';
import GeminiSendBox from './GeminiSendBox';
import { ConversationProvider } from '@/renderer/context/ConversationContext';
import type { GeminiModelSelection } from './useGeminiModelSelection';

// GeminiChat 接收共享的模型选择状态，避免组件内重复管理
// GeminiChat consumes shared model selection state to avoid duplicate logic
const GeminiChat: React.FC<{
  conversation_id: string;
  workspace: string;
  modelSelection: GeminiModelSelection;
}> = ({ conversation_id, workspace, modelSelection }) => {
  useMessageLstCache(conversation_id);
  const updateLocalImage = LocalImageView.useUpdateLocalImage();
  const [showGeminiBanner, setShowGeminiBanner] = useState(true);

  useEffect(() => {
    updateLocalImage({ root: workspace });
  }, [workspace]);

  // Gemini API 키가 설정되어 있는지 확인 (모델 설정에서)
  const hasApiKey = modelSelection.currentModel?.apiKey && modelSelection.currentModel.apiKey.length > 0;

  return (
    <ConversationProvider value={{ conversationId: conversation_id, workspace, type: 'gemini' }}>
      <div className='flex-1 flex flex-col px-20px'>
        <FlexFullContainer>
          <MessageList className='flex-1'></MessageList>
        </FlexFullContainer>
        {/* Gemini API 키 미설정 시 안내 배너 */}
        {!hasApiKey && <GeminiConnectionBanner visible={showGeminiBanner} onDismiss={() => setShowGeminiBanner(false)} />}
        <GeminiSendBox conversation_id={conversation_id} modelSelection={modelSelection}></GeminiSendBox>
      </div>
    </ConversationProvider>
  );
};

export default HOC.Wrapper(MessageListProvider, LocalImageView.Provider)(GeminiChat);
