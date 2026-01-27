/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import WorkerManage from '@/process/WorkerManage';
import { GeminiAgentManager } from '@/process/task/GeminiAgentManager';

/**
 * Gems IPC Bridge 초기화
 * Initialize Gems IPC Bridge for injecting/clearing system prompts
 */
export function initGemsBridge(): void {
  // Gem 시스템 프롬프트 주입 / Inject Gem system prompt
  ipcBridge.gems.injectGem.provider(async ({ conversation_id, systemPrompt }) => {
    try {
      const task = await WorkerManage.getTaskByIdRollbackBuild(conversation_id);
      if (task instanceof GeminiAgentManager) {
        await task.injectGemPrompt(systemPrompt);
        return { success: true };
      }
      return { success: false, msg: 'Task is not a GeminiAgentManager' };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Gem 시스템 프롬프트 해제 / Clear Gem system prompt
  ipcBridge.gems.clearGem.provider(async ({ conversation_id }) => {
    try {
      const task = await WorkerManage.getTaskByIdRollbackBuild(conversation_id);
      if (task instanceof GeminiAgentManager) {
        await task.clearGemPrompt();
        return { success: true };
      }
      return { success: false, msg: 'Task is not a GeminiAgentManager' };
    } catch (error) {
      return {
        success: false,
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
