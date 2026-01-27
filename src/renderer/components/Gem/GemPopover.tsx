/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IGem } from '@/common/types/gems';
import { useGems } from '@/renderer/hooks/useGems';
import { Button, Dropdown, Empty, Spin } from '@arco-design/web-react';
import { Add, Close, Right } from '@icon-park/react';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import GemCreateModal from './GemCreateModal';
import GemDetailModal from './GemDetailModal';

interface GemPopoverProps {
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  selectedGem: IGem | null;
  onSelectGem: (gem: IGem | null) => void;
  disabled?: boolean;
  children: React.ReactNode;
}

/**
 * Gem 선택 팝오버 컴포넌트 / Gem selection popover component
 * Gem 목록 표시, 선택, 상세보기, 생성 기능 제공
 */
const GemPopover: React.FC<GemPopoverProps> = ({ visible, onVisibleChange, selectedGem, onSelectGem, disabled = false, children }) => {
  const { t } = useTranslation();
  const { gems, loading, createGem, updateGem, deleteGem } = useGems();

  const [detailModalGem, setDetailModalGem] = useState<IGem | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Gem 항목 클릭 처리 / Handle gem item click
  const handleGemClick = (gem: IGem) => {
    if (selectedGem?.id === gem.id) {
      onSelectGem(null); // 이미 선택된 경우 해제
    } else {
      onSelectGem(gem);
    }
    onVisibleChange(false);
  };

  // 상세보기 버튼 클릭 / Detail button click
  const handleDetailClick = (gem: IGem, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDetailModalGem(gem);
    onVisibleChange(false);
  };

  // 선택 해제 / Clear selection
  const handleClearSelection = () => {
    onSelectGem(null);
    onVisibleChange(false);
  };

  // 팝오버 내용 렌더링 / Render popover content
  const renderContent = () => {
    if (loading) {
      return (
        <div className='flex items-center justify-center py-20px rd-8px' style={{ backgroundColor: 'var(--color-bg-popup)', boxShadow: '0 4px 10px rgba(0, 0, 0, 0.1)' }}>
          <Spin />
        </div>
      );
    }

    return (
      <div className='w-280px rd-8px' style={{ backgroundColor: 'var(--color-bg-popup)', boxShadow: '0 4px 10px rgba(0, 0, 0, 0.1)' }}>
        {/* 헤더 / Header */}
        <div className='flex items-center justify-between px-12px py-8px' style={{ borderBottom: '1px solid var(--color-border-2)' }}>
          <span className='text-14px font-500 text-t-primary'>{t('gems.title')}</span>
          <Button
            type='text'
            size='mini'
            icon={<Add size='14' />}
            onClick={(e) => {
              e.stopPropagation();
              setCreateModalVisible(true);
              onVisibleChange(false);
            }}
          >
            {t('gems.create')}
          </Button>
        </div>

        {/* Gem 목록 / Gem list */}
        <div className='max-h-300px overflow-y-auto'>
          {gems.length === 0 ? (
            <Empty className='py-20px' description={t('gems.empty')} />
          ) : (
            <div className='py-4px'>
              {/* 선택 해제 옵션 / Clear selection option */}
              {selectedGem && (
                <div className='flex items-center justify-between px-12px py-8px cursor-pointer hover:bg-fill-2 transition-colors' onClick={handleClearSelection}>
                  <div className='flex items-center gap-8px'>
                    <Close size='16' className='text-t-tertiary' />
                    <span className='text-13px text-t-secondary'>{t('gems.clearSelection')}</span>
                  </div>
                </div>
              )}

              {gems.map((gem) => (
                <div key={gem.id} className={`flex items-center justify-between px-12px py-8px cursor-pointer hover:bg-fill-2 transition-colors ${selectedGem?.id === gem.id ? 'bg-fill-2' : ''}`} onClick={() => handleGemClick(gem)}>
                  <div className='flex items-center gap-8px min-w-0 flex-1'>
                    {gem.icon && <span className='text-16px flex-shrink-0'>{gem.icon}</span>}
                    <div className='min-w-0 flex-1'>
                      <div className='text-13px text-t-primary truncate'>{gem.name}</div>
                      {gem.description && <div className='text-11px text-t-tertiary truncate'>{gem.description}</div>}
                    </div>
                  </div>
                  <Button type='text' size='mini' icon={<Right size='14' />} onClick={(e) => handleDetailClick(gem, e as unknown as React.MouseEvent)} className='flex-shrink-0 ml-4px' />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // disabled일 때는 children만 렌더링 (Dropdown 없이)
  if (disabled) {
    return (
      <>
        {children}
        {/* 상세보기 모달 / Detail modal */}
        <GemDetailModal visible={!!detailModalGem} gem={detailModalGem} onClose={() => setDetailModalGem(null)} onUpdate={updateGem} onDelete={deleteGem} />
        {/* 생성 모달 / Create modal */}
        <GemCreateModal visible={createModalVisible} onClose={() => setCreateModalVisible(false)} onCreate={createGem} />
      </>
    );
  }

  return (
    <>
      <Dropdown trigger='click' position='top' popupVisible={visible} onVisibleChange={onVisibleChange} droplist={renderContent()}>
        <div ref={dropdownRef}>{children}</div>
      </Dropdown>

      {/* 상세보기 모달 / Detail modal */}
      <GemDetailModal visible={!!detailModalGem} gem={detailModalGem} onClose={() => setDetailModalGem(null)} onUpdate={updateGem} onDelete={deleteGem} />

      {/* 생성 모달 / Create modal */}
      <GemCreateModal visible={createModalVisible} onClose={() => setCreateModalVisible(false)} onCreate={createGem} />
    </>
  );
};

export default GemPopover;
