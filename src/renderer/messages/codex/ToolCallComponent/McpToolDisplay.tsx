/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CodexToolCallUpdate } from '@/common/chatLib';
import { Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import BaseToolCallDisplay from './BaseToolCallDisplay';

type McpToolUpdate = Extract<CodexToolCallUpdate, { subtype: 'mcp_tool_call_begin' | 'mcp_tool_call_end' }>;

const McpToolDisplay: React.FC<{ content: McpToolUpdate }> = ({ content }) => {
  const { toolCallId, title, status, description, subtype, data } = content;
  const { t } = useTranslation();

  const getDisplayTitle = () => {
    if (title) return title;

    const inv = data?.invocation || {};
    const toolName = inv.tool || inv.name || inv.method || 'unknown';

    switch (subtype) {
      case 'mcp_tool_call_begin':
        return t('tools.titles.mcp_tool_starting', { toolName });
      case 'mcp_tool_call_end':
        return t('tools.titles.mcp_tool', { toolName });
      default:
        return 'MCP Tool';
    }
  };

  const getToolDetails = () => {
    if (!data?.invocation) return null;

    const inv = data.invocation;
    return {
      toolName: inv.tool || inv.name || inv.method || 'unknown',
      arguments: inv.arguments,
    };
  };

  const toolDetails = getToolDetails();

  return (
    <BaseToolCallDisplay toolCallId={toolCallId} title={getDisplayTitle()} status={status} description={description} icon='🔌'>
      {/* Display tool name only - simplified view */}
      {toolDetails && (
        <div className='text-sm'>
          <div className='flex items-center gap-2'>
            <Tag size='small' color='purple'>
              {t('tools.labels.tool')}
            </Tag>
            <span className='font-mono text-xs text-t-primary'>{toolDetails.toolName}</span>
          </div>
        </div>
      )}
    </BaseToolCallDisplay>
  );
};

export default McpToolDisplay;
