/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IGem, IGemInput } from '@/common/types/gems';
import { AionModal } from '@/renderer/components/base';
import { Button, Input, Message, Modal } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface GemDetailModalProps {
  visible: boolean;
  gem: IGem | null;
  onClose: () => void;
  onUpdate: (gemId: string, input: Partial<IGemInput>) => Promise<boolean>;
  onDelete: (gemId: string) => Promise<boolean>;
}

/**
 * Gem 상세보기/편집/삭제 모달 컴포넌트
 * Gem detail view/edit/delete modal component
 */
const GemDetailModal: React.FC<GemDetailModalProps> = ({ visible, gem, onClose, onUpdate, onDelete }) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 편집 폼 상태 / Edit form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  // gem 변경 시 폼 초기화 / Reset form when gem changes
  useEffect(() => {
    if (gem) {
      setName(gem.name);
      setDescription(gem.description || '');
      setSystemPrompt(gem.systemPrompt);
    }
    setIsEditing(false);
  }, [gem]);

  // 저장 처리 / Handle save
  const handleSave = async () => {
    if (!gem || !name.trim() || !systemPrompt.trim()) {
      Message.warning(t('gems.validation.required'));
      return;
    }

    setSaving(true);
    try {
      const success = await onUpdate(gem.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        systemPrompt: systemPrompt.trim(),
      });

      if (success) {
        Message.success(t('common.saveSuccess'));
        onClose();
      } else {
        Message.error(t('common.saveFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  // 삭제 처리 / Handle delete
  const handleDelete = () => {
    if (!gem) return;

    Modal.confirm({
      title: t('gems.deleteConfirm.title'),
      content: t('gems.deleteConfirm.message', { name: gem.name }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        setDeleting(true);
        try {
          const success = await onDelete(gem.id);
          if (success) {
            Message.success(t('common.success'));
            onClose();
          } else {
            Message.error(t('common.error'));
          }
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  // 편집 취소 / Cancel editing
  const handleCancelEdit = () => {
    if (gem) {
      setName(gem.name);
      setDescription(gem.description || '');
      setSystemPrompt(gem.systemPrompt);
    }
    setIsEditing(false);
  };

  if (!gem) return null;

  return (
    <AionModal visible={visible} onCancel={onClose} header={isEditing ? t('gems.edit') : t('gems.detail')} footer={null} style={{ width: '500px', height: 'auto' }} contentStyle={{ padding: '16px' }}>
      <div className='flex flex-col gap-16px'>
        {isEditing ? (
          // 편집 모드 / Edit mode
          <>
            <div>
              <label className='text-13px text-t-secondary mb-4px block'>
                {t('gems.form.name')} <span className='text-red-500'>*</span>
              </label>
              <Input value={name} onChange={setName} placeholder={t('gems.form.namePlaceholder')} maxLength={50} />
            </div>
            <div>
              <label className='text-13px text-t-secondary mb-4px block'>{t('gems.form.description')}</label>
              <Input value={description} onChange={setDescription} placeholder={t('gems.form.descriptionPlaceholder')} maxLength={200} />
            </div>
            <div>
              <label className='text-13px text-t-secondary mb-4px block'>
                {t('gems.form.systemPrompt')} <span className='text-red-500'>*</span>
              </label>
              <Input.TextArea value={systemPrompt} onChange={setSystemPrompt} placeholder={t('gems.form.systemPromptPlaceholder')} autoSize={{ minRows: 6, maxRows: 12 }} />
            </div>
            <div className='flex justify-end gap-8px pt-8px'>
              <Button onClick={handleCancelEdit}>{t('common.cancel')}</Button>
              <Button type='primary' loading={saving} onClick={handleSave}>
                {t('common.save')}
              </Button>
            </div>
          </>
        ) : (
          // 보기 모드 / View mode
          <>
            {/* 헤더 영역 */}
            <div className='flex items-center gap-12px'>
              {gem.icon && <span className='text-28px'>{gem.icon}</span>}
              <div className='flex flex-col gap-2px'>
                <span className='text-16px font-600 text-t-primary'>{gem.name}</span>
                {gem.description && <span className='text-13px text-t-tertiary'>{gem.description}</span>}
              </div>
            </div>

            {/* 시스템 프롬프트 영역 */}
            <div>
              <label className='text-12px text-t-tertiary mb-8px block font-500'>{t('gems.form.systemPrompt')}</label>
              <div className='p-12px rd-8px max-h-240px overflow-y-auto bg-fill-2'>
                <pre className='text-13px text-t-primary m-0 whitespace-pre-wrap break-words font-sans leading-relaxed'>{gem.systemPrompt}</pre>
              </div>
            </div>

            {/* 버튼 영역 */}
            <div className='flex justify-between pt-8px'>
              <Button status='danger' loading={deleting} onClick={handleDelete}>
                {t('common.delete')}
              </Button>
              <Button type='primary' onClick={() => setIsEditing(true)}>
                {t('common.edit')}
              </Button>
            </div>
          </>
        )}
      </div>
    </AionModal>
  );
};

export default GemDetailModal;
