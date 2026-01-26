import { Dropdown, Input, Menu, Tooltip } from '@arco-design/web-react';
import { ArrowCircleLeft, Down, Logout, Plus, Search, SettingTwo } from '@icon-park/react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import WorkspaceGroupedHistory from './pages/conversation/WorkspaceGroupedHistory';
import SettingsSider from './pages/settings/SettingsSider';
import { iconColors } from './theme/colors';
import { usePreviewContext } from './pages/conversation/preview';

interface SiderProps {
  onSessionClick?: () => void;
  collapsed?: boolean;
}

const Sider: React.FC<SiderProps> = ({ onSessionClick, collapsed = false }) => {
  const location = useLocation();
  const { pathname, search, hash } = location;

  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout, user, workspaces, currentWorkspace, switchWorkspace } = useAuth();
  const { closePreview } = usePreviewContext();
  const isSettings = pathname.startsWith('/settings');
  const lastNonSettingsPathRef = useRef('/guid');
  const [searchValue, setSearchValue] = useState('');

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  const handleSettingsClick = () => {
    if (isSettings) {
      const target = lastNonSettingsPathRef.current || '/guid';
      Promise.resolve(navigate(target)).catch((error) => {
        console.error('Navigation failed:', error);
      });
    } else {
      Promise.resolve(navigate('/settings/usage')).catch((error) => {
        console.error('Navigation failed:', error);
      });
    }
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleLogout = () => {
    logout().catch((error) => {
      console.error('Logout failed:', error);
    });
  };

  const filteredWorkspaces = workspaces.filter((ws) => ws.name.toLowerCase().includes(searchValue.toLowerCase()));

  // 브랜드 선택 드롭다운 메뉴
  const brandMenu = (
    <div className='bg-[var(--color-bg-popup)] shadow-lg rounded-lg border border-[var(--color-border-1)] overflow-hidden w-64 flex flex-col'>
      <div className='p-2 border-b border-[var(--color-border-2)] flex-shrink-0'>
        <Input prefix={<Search theme='outline' size='14' fill='var(--color-text-2)' />} placeholder={t('common.search', { defaultValue: '검색' })} value={searchValue} onChange={setSearchValue} allowClear className='w-full' />
      </div>
      <div className='overflow-y-auto max-h-[300px]'>
        <Menu
          style={{ border: 'none', boxShadow: 'none' }}
          onClickMenuItem={(key) => {
            if (key === 'add_workspace') {
              window.open('https://neuro.pango-gy.com', '_blank');
            } else {
              switchWorkspace(key);
            }
          }}
        >
          {filteredWorkspaces.map((ws) => (
            <Menu.Item key={ws.id} className={ws.id === currentWorkspace?.id ? 'arco-menu-selected' : ''}>
              {ws.name}
            </Menu.Item>
          ))}
          {filteredWorkspaces.length === 0 && <div className='px-12px py-8px text-t-tertiary text-12px text-center'>{t('common.noResult', { defaultValue: '검색 결과 없음' })}</div>}
          <Menu.Item key='add_workspace'>
            <div className='flex items-center gap-8px'>
              <Plus theme='outline' size='16' fill={iconColors.primary} />
              <span>{t('workspace.add', { defaultValue: '워크스페이스 추가' })}</span>
            </div>
          </Menu.Item>
        </Menu>
      </div>
    </div>
  );

  return (
    <div className='size-full flex flex-col'>
      {/* 브랜드 선택 드롭다운 */}
      {!isSettings && workspaces.length > 0 && (
        <Dropdown
          droplist={brandMenu}
          trigger='click'
          position='bl'
          onVisibleChange={(visible) => {
            if (!visible) setSearchValue('');
          }}
        >
          <div className='flex items-center justify-between px-12px py-12px hover:bg-[var(--color-primary-light-1)] rd-8px mx-4px mb-12px cursor-pointer bg-[var(--color-fill-2)] border border-solid border-[var(--color-border-2)]'>
            <div className='flex flex-col min-w-0 flex-1'>
              <span className='text-11px text-t-secondary collapsed-hidden'>{t('brand.current', { defaultValue: '현재 브랜드' })}</span>
              <span className='text-t-primary font-600 text-15px truncate collapsed-hidden'>{currentWorkspace?.name || t('brand.select', { defaultValue: '브랜드 선택' })}</span>
              {collapsed && <span className='text-t-primary text-14px font-600'>{currentWorkspace?.name?.charAt(0) || '?'}</span>}
            </div>
            {!collapsed && <Down theme='outline' size='18' fill={iconColors.primary} />}
          </div>
        </Dropdown>
      )}

      {isSettings ? (
        <SettingsSider collapsed={collapsed}></SettingsSider>
      ) : (
        <>
          <Tooltip disabled={!collapsed} content={t('conversation.welcome.newConversation')} position='right'>
            <div
              className='flex items-center justify-start gap-10px px-12px py-8px hover:bg-hover rd-0.5rem mb-8px cursor-pointer group'
              onClick={() => {
                closePreview();
                Promise.resolve(navigate('/guid')).catch((error) => {
                  console.error('Navigation failed:', error);
                });
                if (onSessionClick) {
                  onSessionClick();
                }
              }}
            >
              <Plus theme='outline' size='24' fill={iconColors.primary} className='flex' />
              <span className='collapsed-hidden font-bold text-t-primary'>{t('conversation.welcome.newConversation')}</span>
            </div>
          </Tooltip>
          <WorkspaceGroupedHistory collapsed={collapsed} onSessionClick={onSessionClick}></WorkspaceGroupedHistory>
        </>
      )}

      {/* 설정 버튼 */}
      <Tooltip disabled={!collapsed} content={isSettings ? t('common.back') : t('common.settings')} position='right'>
        <div onClick={handleSettingsClick} className='flex items-center justify-start gap-10px px-12px py-8px hover:bg-hover rd-0.5rem cursor-pointer'>
          {isSettings ? <ArrowCircleLeft className='flex' theme='outline' size='24' fill={iconColors.primary} /> : <SettingTwo className='flex' theme='outline' size='24' fill={iconColors.primary} />}
          <span className='collapsed-hidden text-t-primary'>{isSettings ? t('common.back') : t('common.settings')}</span>
        </div>
      </Tooltip>

      {/* 로그아웃 버튼 */}
      <Tooltip disabled={!collapsed} content={user?.email ? `${t('common.logout')} (${user.email})` : t('common.logout')} position='right'>
        <div onClick={handleLogout} className='flex items-center justify-start gap-10px px-12px py-8px hover:bg-hover rd-0.5rem mb-8px cursor-pointer text-red-500'>
          <Logout className='flex' theme='outline' size='24' fill='#ef4444' />
          <span className='collapsed-hidden'>{t('common.logout')}</span>
        </div>
      </Tooltip>
    </div>
  );
};

export default Sider;
