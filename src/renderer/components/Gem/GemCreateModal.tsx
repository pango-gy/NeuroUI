/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IGem, IGemInput } from '@/common/types/gems';
import { AionModal } from '@/renderer/components/base';
import { Button, Input, Message } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface GemCreateModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: IGemInput) => Promise<IGem | null>;
}

/**
 * Gem 생성 모달 컴포넌트
 * Gem create modal component
 */
const GemCreateModal: React.FC<GemCreateModalProps> = ({ visible, onClose, onCreate }) => {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  // 폼 상태 / Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  // 폼 초기화 / Reset form
  const resetForm = () => {
    setName('');
    setDescription('');
    setSystemPrompt('');
  };

  // 닫기 처리 / Handle close
  const handleClose = () => {
    resetForm();
    onClose();
  };

  // 생성 처리 / Handle create
  const handleCreate = async () => {
    if (!name.trim() || !systemPrompt.trim()) {
      Message.warning(t('gems.validation.required'));
      return;
    }

    setSaving(true);
    try {
      const result = await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        systemPrompt: systemPrompt.trim(),
      });

      if (result) {
        Message.success(t('gems.createSuccess'));
        handleClose();
      } else {
        Message.error(t('gems.createFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <AionModal visible={visible} onCancel={handleClose} header={t('gems.createTitle')} footer={null} style={{ width: '500px', height: 'auto' }} contentStyle={{ padding: '16px' }}>
      <div className='flex flex-col gap-16px'>
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
          <p className='text-11px text-t-tertiary mt-4px m-0'>{t('gems.form.systemPromptHint')}</p>
        </div>
        <div className='flex justify-end gap-8px mt-8px'>
          <Button onClick={handleClose}>{t('common.cancel')}</Button>
          <Button type='primary' loading={saving} onClick={handleCreate}>
            {t('gems.create')}
          </Button>
        </div>
      </div>
    </AionModal>
  );
};

export default GemCreateModal;
