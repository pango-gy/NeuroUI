/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import AuthOnboardingCard from '@renderer/components/AuthOnboardingCard';
import FlexFullContainer from '@renderer/components/FlexFullContainer';
import { ConversationProvider } from '@renderer/context/ConversationContext';
import MessageList from '@renderer/messages/MessageList';
import { MessageListProvider, useMessageLstCache } from '@renderer/messages/hooks';
import HOC from '@renderer/utils/HOC';
import React, { useEffect } from 'react';
import LocalImageView from '../../../components/LocalImageView';
import GeminiSendBox from './GeminiSendBox';
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
  const { providers, currentModel } = modelSelection;

  useEffect(() => {
    updateLocalImage({ root: workspace });
  }, [workspace]);

  // 没有可用的 provider 时显示引导卡片 / Show onboarding card when no providers available
  const needsOnboarding = providers.length === 0 && !currentModel;

  return (
    <ConversationProvider value={{ conversationId: conversation_id, workspace, type: 'gemini' }}>
      <div className='flex-1 flex flex-col px-20px'>
        <FlexFullContainer>
          <MessageList className='flex-1'></MessageList>
        </FlexFullContainer>
        {needsOnboarding ? <AuthOnboardingCard /> : <GeminiSendBox conversation_id={conversation_id} modelSelection={modelSelection}></GeminiSendBox>}
      </div>
    </ConversationProvider>
  );
};

export default HOC.Wrapper(MessageListProvider, LocalImageView.Provider)(GeminiChat);
