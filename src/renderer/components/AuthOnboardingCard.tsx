/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { Button, Message } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface AuthOnboardingCardProps {
  onLoginSuccess?: () => void;
}

const AuthOnboardingCard: React.FC<AuthOnboardingCardProps> = ({ onLoginSuccess }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const result = await ipcBridge.googleAuth.login.invoke({});
      if (result.success) {
        Message.success(t('onboarding.loginSuccess'));
        onLoginSuccess?.();
        // 刷新页面以重新加载模型列表 / Refresh to reload model list
        window.location.reload();
      } else {
        Message.error(result.msg || t('onboarding.loginFailed'));
      }
    } catch (error) {
      Message.error(t('onboarding.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleApiKeySetup = () => {
    // 设置页面로 이동 / Navigate to settings page
    void navigate('/settings/gemini');
  };

  return (
    <div className='flex flex-col items-center justify-center py-48px px-24px text-center'>
      <div className='text-48px mb-16px'>🚀</div>
      <h2 className='text-24px font-semibold text-t-primary mb-8px'>{t('onboarding.welcome')}</h2>
      <p className='text-14px text-t-secondary mb-24px max-w-400px'>{t('onboarding.description')}</p>

      <Button type='primary' size='large' loading={loading} onClick={handleGoogleLogin} className='rd-100px min-w-200px mb-16px'>
        {t('onboarding.googleLogin')}
      </Button>

      <button type='button' onClick={handleApiKeySetup} className='text-14px text-t-secondary hover:text-primary cursor-pointer bg-transparent border-none underline'>
        {t('onboarding.apiKeySetup')}
      </button>
    </div>
  );
};

export default AuthOnboardingCard;
