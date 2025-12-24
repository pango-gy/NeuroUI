import googleLogo from '@renderer/assets/logos/google.svg';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AppLoader from '../../components/AppLoader';
import { useAuth } from '../../context/AuthContext';
import './LoginPage.css';

type MessageState = {
  type: 'error' | 'success';
  text: string;
};

const REMEMBER_KEY = 'rememberedEmail';

const LoginPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { status, login, loginWithGoogle } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [loading, setLoading] = useState(false);

  const usernameRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const messageTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    document.body.classList.add('login-page-active');
    return () => {
      document.body.classList.remove('login-page-active');
      if (messageTimer.current) {
        window.clearTimeout(messageTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    document.title = t('login.pageTitle');
  }, [t]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    // Desktop app: Always restore remembered email until logout
    const storedUsername = localStorage.getItem(REMEMBER_KEY);
    if (storedUsername) {
      setUsername(storedUsername);
      window.setTimeout(() => {
        passwordRef.current?.focus();
      }, 0);
    } else {
      window.setTimeout(() => {
        usernameRef.current?.focus();
      }, 0);
    }

    return () => {
      if (messageTimer.current) {
        window.clearTimeout(messageTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      void navigate('/guid', { replace: true });
    }
  }, [navigate, status]);

  const clearMessageLater = useCallback(() => {
    if (messageTimer.current) {
      window.clearTimeout(messageTimer.current);
    }
    messageTimer.current = window.setTimeout(() => {
      setMessage((prev) => (prev?.type === 'success' ? prev : null));
    }, 5000);
  }, []);

  const showMessage = useCallback(
    (next: MessageState) => {
      setMessage(next);
      if (next.type === 'error') {
        clearMessageLater();
      }
    },
    [clearMessageLater]
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedUsername = username.trim();

      if (!trimmedUsername || !password) {
        showMessage({ type: 'error', text: t('login.errors.empty') });
        return;
      }

      setLoading(true);
      setMessage(null);

      const result = await login({ username: trimmedUsername, password, remember: true });

      if (result.success) {
        // Desktop app: Always save email for convenience until logout
        localStorage.setItem(REMEMBER_KEY, trimmedUsername);

        const successText = t('login.success');
        showMessage({ type: 'success', text: successText });

        window.setTimeout(() => {
          void navigate('/guid', { replace: true });
        }, 600);
      } else {
        const errorText = (() => {
          switch (result.code) {
            case 'invalidCredentials':
              return t('login.errors.invalidCredentials');
            case 'tooManyAttempts':
              return t('login.errors.tooManyAttempts');
            case 'networkError':
              return t('login.errors.networkError');
            case 'serverError':
              return t('login.errors.serverError');
            case 'unknown':
            default:
              return result.message ?? t('login.errors.unknown');
          }
        })();

        showMessage({ type: 'error', text: errorText });
      }

      setLoading(false);
    },
    [login, navigate, password, showMessage, t, username]
  );

  const handleGoogleLogin = useCallback(() => {
    loginWithGoogle().catch((error) => {
      console.error('Google login failed:', error);
      showMessage({ type: 'error', text: t('login.errors.networkError') });
    });
  }, [loginWithGoogle, showMessage, t]);

  if (status === 'checking') {
    return <AppLoader />;
  }

  return (
    <div className='login-page'>
      <div className='login-page__card'>
        <div className='login-page__header'>
          <h1 className='login-page__title'>{t('login.brand')}</h1>
          <p className='login-page__subtitle'>{t('login.subtitle')}</p>
        </div>

        <div className='login-page__social-login'>
          <button type='button' className='login-page__google-btn' onClick={handleGoogleLogin}>
            <img src={googleLogo} alt='Google' className='login-page__google-icon' />
            <span>{t('login.googleSignIn')}</span>
          </button>
        </div>

        <div className='login-page__divider'>
          <span>{t('login.divider')}</span>
        </div>

        <form className='login-page__form' onSubmit={handleSubmit}>
          <div className='login-page__form-item'>
            <label className='login-page__label' htmlFor='username'>
              {t('login.email')}
            </label>
            <div className='login-page__input-wrapper'>
              <svg className='login-page__input-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
                <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                <circle cx='12' cy='7' r='4' />
              </svg>
              <input ref={usernameRef} id='username' name='username' className='login-page__input' placeholder={t('login.emailPlaceholder')} autoComplete='username' value={username} onChange={(event) => setUsername(event.target.value)} aria-required='true' />
            </div>
          </div>

          <div className='login-page__form-item'>
            <label className='login-page__label' htmlFor='password'>
              {t('login.password')}
            </label>
            <div className='login-page__input-wrapper'>
              <svg className='login-page__input-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden='true'>
                <rect x='3' y='11' width='18' height='11' rx='2' ry='2' />
                <path d='M7 11V7a5 5 0 0 1 10 0v4' />
              </svg>
              <input ref={passwordRef} id='password' name='password' type={passwordVisible ? 'text' : 'password'} className='login-page__input' placeholder={t('login.passwordPlaceholder')} autoComplete='current-password' value={password} onChange={(event) => setPassword(event.target.value)} aria-required='true' />
              <button type='button' className='login-page__toggle-password' onClick={() => setPasswordVisible((prev) => !prev)} aria-label={passwordVisible ? t('login.hidePassword') : t('login.showPassword')}>
                <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                  {passwordVisible ? (
                    <>
                      <path d='M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24' />
                      <line x1='1' y1='1' x2='23' y2='23' />
                    </>
                  ) : (
                    <>
                      <path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' />
                      <circle cx='12' cy='12' r='3' />
                    </>
                  )}
                </svg>
              </button>
            </div>
          </div>

          <button type='submit' className='login-page__submit' disabled={loading}>
            {loading && (
              <svg className='login-page__spinner' viewBox='0 0 24 24' width='18' height='18'>
                <circle cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='3' fill='none' strokeDasharray='50' strokeDashoffset='25' strokeLinecap='round' />
              </svg>
            )}
            <span>{loading ? t('login.submitting') : t('login.submit')}</span>
          </button>

          <div role='alert' aria-live='polite' className={`login-page__message ${message ? 'login-page__message--visible' : ''} ${message ? (message.type === 'success' ? 'login-page__message--success' : 'login-page__message--error') : ''}`} hidden={!message}>
            {message?.text}
          </div>
        </form>

        <div className='login-page__footer'>
          <div className='login-page__footer-content'>
            <span>{t('login.footerPrimary')}</span>
            <a
              href='#'
              className='login-page__signup-link'
              onClick={(e) => {
                e.preventDefault();
                window.open('https://neuro.pango-gy.com/signup', '_blank');
              }}
            >
              {t('login.footerSecondary')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
