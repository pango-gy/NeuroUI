/**
 * Gemini 연결 안내 배너 컴포넌트
 * Gemini API 키 미설정 시 채팅 입력창 위에 표시
 */

import { Button } from '@arco-design/web-react';
import { Caution } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface GeminiConnectionBannerProps {
  visible?: boolean;
  onDismiss?: () => void;
}

const GeminiConnectionBanner: React.FC<GeminiConnectionBannerProps> = ({ visible = true, onDismiss }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // 설정 > 모델 페이지로 이동
  const handleGoToSettings = () => {
    void navigate('/settings/model');
  };

  if (!visible) {
    return null;
  }

  return (
    <div className='flex items-center justify-between px-16px py-10px mx-4px mb-8px rd-8px bg-[var(--color-warning-light-1)] border border-solid border-[var(--color-warning-light-3)]'>
      <div className='flex items-center gap-8px'>
        <Caution theme='filled' size='18' fill='#ff7d00' />
        <span className='text-14px text-[var(--color-warning-6)]'>{t('gemini.connectionRequired', { defaultValue: 'Gemini API 키가 필요합니다' })}</span>
      </div>
      <div className='flex items-center gap-8px'>
        <Button type='outline' size='small' onClick={handleGoToSettings} className='!rd-6px'>
          {t('gemini.goToSettings', { defaultValue: '설정으로 이동' })}
        </Button>
        {onDismiss && (
          <Button type='text' size='small' onClick={onDismiss} className='!rd-6px'>
            {t('common.close', { defaultValue: '닫기' })}
          </Button>
        )}
      </div>
    </div>
  );
};

export default GeminiConnectionBanner;
