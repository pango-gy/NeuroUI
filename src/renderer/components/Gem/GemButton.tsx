/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IGem } from '@/common/types/gems';
import { iconColors } from '@/renderer/theme/colors';
import { Button } from '@arco-design/web-react';
import { DiamondThree } from '@icon-park/react';
import React from 'react';

interface GemButtonProps {
  selectedGem: IGem | null;
  selectedGemName?: string | null; // fallback 이름 (selectedGem이 null일 때 사용)
  disabled?: boolean;
  onClick?: () => void;
}

/**
 * Gem 선택 버튼 컴포넌트 / Gem selection button component
 * SendBox 옆에 배치되어 Gem을 선택/관리할 수 있는 버튼
 */
const GemButton: React.FC<GemButtonProps> = ({ selectedGem, selectedGemName, disabled = false, onClick }) => {
  const displayName = selectedGem?.name || selectedGemName;
  const displayIcon = selectedGem?.icon;

  const buttonContent = displayName ? (
    <span className='flex items-center gap-4px max-w-120px'>
      {displayIcon && <span>{displayIcon}</span>}
      <span className='truncate text-12px'>{displayName}</span>
    </span>
  ) : (
    <DiamondThree theme='outline' size='16' fill={iconColors.primary} />
  );

  return (
    <span className='gem-button-wrapper inline-flex'>
      <Button
        type='secondary'
        shape={displayName ? 'round' : 'circle'}
        size='small'
        disabled={disabled}
        onClick={onClick}
        className={`gem-button ${displayName ? 'px-8px' : ''}`}
        style={{
          minWidth: displayName ? 'auto' : '32px',
          height: '32px',
        }}
      >
        {buttonContent}
      </Button>
    </span>
  );
};

export default GemButton;
