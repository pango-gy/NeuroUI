/**
 * Gemini 연결 안내 배너 컴포넌트
 * Gemini CLI 미연결 시 채팅 입력창 위에 표시
 */

import { Button } from '@arco-design/web-react';
import { Caution } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';

interface GeminiConnectionBannerProps {
  visible?: boolean;
  onDismiss?: () => void;
}

const GeminiConnectionBanner: React.FC<GeminiConnectionBannerProps> = ({ visible = true, onDismiss }) => {
  const { t } = useTranslation();
  const [isConnecting, setIsConnecting] = useState(false);

  // Gemini 로그인 페이지 열기
  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      // Google AI Studio 페이지 열기 (API 키 발급 안내)
      await ipcBridge.shell.openExternal.invoke('https://aistudio.google.com/apikey');
    } catch (error) {
      console.error('[GeminiConnectionBanner] Failed to open Gemini auth:', error);
    } finally {
      setIsConnecting(false);
    }
  }, []);

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
        <Button type='outline' size='small' loading={isConnecting} onClick={handleConnect} className='!rd-6px'>
          {t('gemini.getApiKey', { defaultValue: 'API 키 발급' })}
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
