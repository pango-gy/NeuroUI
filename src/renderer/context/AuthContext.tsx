import { ipcBridge } from '@/common';
import type { IMcpServer } from '@/common/storage';
import { ConfigStorage } from '@/common/storage';
import type { Workspace } from '@/renderer/components/WorkspaceSelectModal';
import WorkspaceSelectModal from '@/renderer/components/WorkspaceSelectModal';
import { auth, db } from '@/renderer/config/firebase';
import { onAuthStateChanged, signInWithCustomToken, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, getDocs, limit, onSnapshot, query, where } from 'firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

const WORKSPACE_KEY = 'selectedWorkspaceId';

// MCP Platform Configuration - configurable via environment variables
const MCP_PLATFORMS = {
  'google-ads-mcp': {
    platform: 'google_ads', // Firebase connections에서 사용하는 platform 값
    url: process.env.VITE_GOOGLE_ADS_MCP_URL || 'http://localhost:3001/google-ads/mcp',
    description: 'Google Ads MCP Server',
  },
  'google-analytics-mcp': {
    platform: 'google_analytics',
    url: process.env.VITE_GOOGLE_ANALYTICS_MCP_URL || 'http://localhost:3001/google-analytics/mcp',
    description: 'Google Analytics MCP Server',
  },
} as const;

type McpServerName = keyof typeof MCP_PLATFORMS;

export interface AuthUser {
  id: string;
  username: string; // Firebase의 경우 email 또는 displayName 사용
  email?: string;
}

interface LoginParams {
  username: string;
  password: string;
  remember?: boolean;
}

type LoginErrorCode = 'invalidCredentials' | 'tooManyAttempts' | 'serverError' | 'networkError' | 'unknown';

interface LoginResult {
  success: boolean;
  message?: string;
  code?: LoginErrorCode;
}

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  status: AuthStatus;
  login: (params: LoginParams) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refresh: () => () => void;
  loginWithGoogle: () => Promise<void>;
  workspaceId: string | null;
  setWorkspaceId: (id: string | null) => void;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  switchWorkspace: (id: string) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [ready, setReady] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [needsWorkspaceSelection, setNeedsWorkspaceSelection] = useState(false);
  // 리스너 해제를 위한 ref
  const connectionUnsubscribeRef = useRef<(() => void) | null>(null);

  // Firestore에서 MCP 토큰 가져오기 (사용자 정의 함수)
  const fetchUserMcpToken = async (uid: string, selectedWorkspaceId?: string) => {
    try {
      if (!db) return;

      // 1. 워크스페이스 목록 조회
      if (!selectedWorkspaceId) {
        try {
          // 이전에 저장된 워크스페이스 ID 확인
          const savedWorkspaceId = localStorage.getItem(WORKSPACE_KEY);

          const workspaceQuery = query(collection(db, 'workspaces'), where('userId', '==', uid));
          const workspaceSnapshot = await getDocs(workspaceQuery);

          if (workspaceSnapshot.empty) {
            console.warn('[Auth] No workspaces found for user. Logging out.');
            await signOut(auth);
            localStorage.removeItem(WORKSPACE_KEY);
            return;
          }

          // 워크스페이스 목록을 상태로 저장 (브랜드 드롭다운용)
          const workspaceList = workspaceSnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as Workspace[];
          setWorkspaces(workspaceList);

          // 저장된 워크스페이스가 유효한지 확인
          const isValidSavedWorkspace = savedWorkspaceId && workspaceSnapshot.docs.some((doc) => doc.id === savedWorkspaceId);

          if (isValidSavedWorkspace) {
            // 저장된 워크스페이스가 유효하면 자동 선택
            selectedWorkspaceId = savedWorkspaceId as string;
          } else if (workspaceSnapshot.size > 1) {
            // 워크스페이스가 여러 개이고 저장된 값이 없거나 유효하지 않으면 선택 모달 표시
            setNeedsWorkspaceSelection(true);
            return;
          } else {
            // 워크스페이스가 1개면 자동 선택
            selectedWorkspaceId = workspaceSnapshot.docs[0].id;
          }
        } catch (e) {
          console.error('[Auth] Failed to fetch workspaces:', e);
          throw e;
        }
      }

      setWorkspaceId(selectedWorkspaceId);
      localStorage.setItem(WORKSPACE_KEY, selectedWorkspaceId); // 선택된 워크스페이스 저장
      setNeedsWorkspaceSelection(false);

      // 2. MCP Token 조회 (Firestore mcpTokens 컬렉션)
      // Google Ads MCP 등은 별도의 OAuth Access Token이 필요할 수 있으므로,
      // 웹 로그인 시 저장된 토큰을 mcpTokens 컬렉션에서 가져옵니다.
      let token: string | null = null;
      try {
        // 현재 선택된 워크스페이스의 토큰을 조회 (workspaceId 기준!)
        console.log('[Auth Debug] Querying mcpTokens with workspaceId ==', selectedWorkspaceId);
        const mcpTokensQuery = query(collection(db, 'mcpTokens'), where('workspaceId', '==', selectedWorkspaceId), limit(1));
        const mcpTokenSnapshot = await getDocs(mcpTokensQuery);

        if (!mcpTokenSnapshot.empty) {
          const docData = mcpTokenSnapshot.docs[0].data();
          console.log('[Auth Debug] Document data:', JSON.stringify(docData, null, 2));
          token = docData.token || docData.claims?.token;

          console.log('[Auth Debug] Token length:', token?.length);
          console.log('[Auth Debug] Token workspaceId:', docData.workspaceId);
          console.log('[Auth Debug] Selected workspaceId:', selectedWorkspaceId);

          // JWT 디코딩해서 payload 확인 (검증 없이)
          if (token) {
            try {
              const [, payloadBase64] = token.split('.');
              const payload = JSON.parse(atob(payloadBase64));
              console.log('[Auth Debug] JWT Payload:', JSON.stringify(payload));
            } catch (e) {
              console.log('[Auth Debug] Failed to decode JWT:', e);
            }
          }
        } else {
          console.warn('[Auth Debug] No mcpTokens document found for workspaceId:', selectedWorkspaceId);
          // 폴백: userId로 다시 시도 (이전 버전 호환)
          console.log('[Auth Debug] Fallback: trying with userId ==', uid);
          const fallbackQuery = query(collection(db, 'mcpTokens'), where('claims.userId', '==', uid), where('workspaceId', '==', selectedWorkspaceId), limit(1));
          const fallbackSnapshot = await getDocs(fallbackQuery);

          if (!fallbackSnapshot.empty) {
            const docData = fallbackSnapshot.docs[0].data();
            token = docData.token || docData.claims?.token;
            console.log('[Auth Debug] Fallback query found token');
          } else if (auth.currentUser) {
            token = await auth.currentUser.getIdToken(true);
            console.log('[Auth Debug] Fallback: Using Firebase ID Token (THIS WILL FAIL MCP AUTH!)');
          }
        }

        if (token) {
          // IPC를 통해 Main Process로 토큰 전달
          if (window.electronAPI) {
            // mcpService.updatePlatformCredentials 호출
            await ipcBridge.mcpService.updatePlatformCredentials.invoke({ token });
          }
        }
      } catch (e) {
        console.error('[Auth] Failed to fetch MCP token (step 2):', e);
        // 권한 에러 등이 발생해도 UI가 멈추지 않도록 예외 무시 (토큰 없이 진행)
      }

      // 3. MCP 플랫폼 연결 확인 및 MCP 서버 활성화/비활성화 (실시간 리스너)
      try {
        // 기존 리스너 해제
        if (connectionUnsubscribeRef.current) {
          console.log('[Auth] Unsubscribing from connections snapshot listener...');
          connectionUnsubscribeRef.current();
          connectionUnsubscribeRef.current = null;
        }

        if (!selectedWorkspaceId) return;

        // 해당 워크스페이스의 모든 MCP 관련 connections 조회
        const platformNames = Object.values(MCP_PLATFORMS).map((p) => p.platform);
        const connectionsQuery = query(collection(db, `workspaces/${selectedWorkspaceId}/connections`), where('platform', 'in', platformNames));

        const unsubscribe = onSnapshot(connectionsQuery, async (snapshot) => {
          try {
            // 활성화된 플랫폼 Set 생성
            const activeConnections = new Set<string>();
            snapshot.docs.forEach((doc) => {
              const data = doc.data();
              if (data.isActive === true) {
                activeConnections.add(data.platform);
              }
            });

            console.log('[Auth] Active platform connections:', Array.from(activeConnections));

            if (window.electronAPI) {
              // MCP 설정 읽기
              const mcpConfig = (await ConfigStorage.get('mcp.config')) as IMcpServer[];
              if (Array.isArray(mcpConfig)) {
                let configChanged = false;
                const updatedServers: IMcpServer[] = [];

                // 1. 각 MCP 플랫폼에 대해 활성화/비활성화 처리
                const newConfig = mcpConfig.map((server) => {
                  const platformConfig = MCP_PLATFORMS[server.name as McpServerName];
                  if (platformConfig) {
                    const hasConnection = activeConnections.has(platformConfig.platform);
                    const shouldEnable = hasConnection && !!token;

                    if (server.enabled !== shouldEnable) {
                      configChanged = true;
                      server = { ...server, enabled: shouldEnable };
                      console.log(`[Auth] ${server.name} ${shouldEnable ? 'enabled' : 'disabled'}`);
                    }

                    if (shouldEnable) {
                      updatedServers.push(server);
                    }
                  }
                  return server;
                });

                // 2. 누락된 MCP 서버 주입 (Self-Healing)
                for (const [mcpName, platformConfig] of Object.entries(MCP_PLATFORMS)) {
                  const hasConnection = activeConnections.has(platformConfig.platform);
                  if (!hasConnection || !token) continue;

                  const existingServer = newConfig.find((s) => s.name === mcpName);
                  if (!existingServer) {
                    console.log(`[Auth] Injecting missing default config for ${mcpName}`);
                    const newServer = {
                      id: `mcp_default_${Date.now()}_${mcpName.replace(/-/g, '_')}`,
                      name: mcpName,
                      description: platformConfig.description,
                      enabled: true,
                      status: 'connected',
                      transport: {
                        type: 'streamable_http',
                        url: platformConfig.url,
                        headers: { Authorization: `Bearer ${token}` },
                      },
                      originalJson: JSON.stringify({
                        [mcpName]: {
                          type: 'streamable_http',
                          url: platformConfig.url,
                          headers: { Authorization: `Bearer ${token}` },
                        },
                      }),
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    } as IMcpServer;

                    newConfig.push(newServer);
                    updatedServers.push(newServer);
                    configChanged = true;
                  } else {
                    // 3. Auto-Correction: transport/token 업데이트
                    const currentAuthHeader = (existingServer.transport as any).headers?.Authorization;
                    const expectedAuthHeader = `Bearer ${token}`;

                    if (existingServer.transport.type !== 'streamable_http' || currentAuthHeader !== expectedAuthHeader) {
                      console.log(`[Auth] Auto-correcting ${mcpName}: Updating transport/token`);

                      (existingServer.transport as any).type = 'streamable_http';
                      if ('url' in existingServer.transport) {
                        (existingServer.transport as any).url = platformConfig.url;
                      }

                      const transportAny = existingServer.transport as any;
                      if (!transportAny.headers) transportAny.headers = {};
                      transportAny.headers.Authorization = expectedAuthHeader;

                      try {
                        const json = JSON.parse(existingServer.originalJson || '{}');
                        if (json[mcpName]) {
                          json[mcpName].type = 'streamable_http';
                          json[mcpName].headers = { Authorization: expectedAuthHeader };
                          existingServer.originalJson = JSON.stringify(json);
                        }
                      } catch (e) {
                        // ignore json parse error
                      }

                      if (!updatedServers.includes(existingServer)) {
                        updatedServers.push(existingServer);
                      }
                      configChanged = true;
                    }
                  }
                }

                // 4. 설정 저장
                if (configChanged) {
                  await ConfigStorage.set('mcp.config', newConfig);
                  window.dispatchEvent(new Event('mcp-config-changed'));
                }

                // 5. 활성화된 MCP 서버들을 에이전트에 동기화
                if (token && updatedServers.length > 0) {
                  console.log(
                    '[Auth] Syncing MCP credentials to agents:',
                    updatedServers.map((s) => s.name)
                  );
                  try {
                    const agentsResponse = await ipcBridge.acpConversation.getAvailableAgents.invoke();
                    if (agentsResponse.success && agentsResponse.data) {
                      const syncResponse = await ipcBridge.mcpService.syncMcpToAgents.invoke({
                        mcpServers: updatedServers.filter((s) => s.enabled),
                        agents: agentsResponse.data,
                      });
                      console.log('[Auth] MCP sync completed:', syncResponse);
                    }
                  } catch (syncError) {
                    console.error('[Auth] Error during MCP sync:', syncError);
                  }
                }

                // 6. 비활성화된 MCP 서버들을 에이전트에서 제거
                for (const [mcpName, platformConfig] of Object.entries(MCP_PLATFORMS)) {
                  const hasConnection = activeConnections.has(platformConfig.platform);
                  const server = newConfig.find((s) => s.name === mcpName);
                  if (server && !server.enabled) {
                    console.log(`[Auth] Removing ${mcpName} from agents`);
                    try {
                      const agentsResponse = await ipcBridge.acpConversation.getAvailableAgents.invoke();
                      if (agentsResponse.success && agentsResponse.data) {
                        await ipcBridge.mcpService.removeMcpFromAgents.invoke({
                          mcpServerName: mcpName,
                          agents: agentsResponse.data,
                        });
                      }
                    } catch (removeError) {
                      console.error(`[Auth] Error removing ${mcpName}:`, removeError);
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.error('[Auth] Error processing connections snapshot:', error);
          }
        });

        // 리스너 참조 저장
        connectionUnsubscribeRef.current = unsubscribe;
      } catch (e) {
        console.error('[Auth] Failed to check MCP connections (step 3):', e);
        throw e;
      }
    } catch (error) {
      console.error('[Auth] Failed to fetch MCP token:', error);
    }
  };

  const handleWorkspaceSelect = (id: string) => {
    if (user) {
      void fetchUserMcpToken(user.id, id);
    }
  };

  const refresh = useCallback(() => {
    // Firebase Auth 상태 리스너 등록
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser({
          id: currentUser.uid,
          username: currentUser.displayName || currentUser.email || 'User',
          email: currentUser.email || undefined,
        });
        setStatus('authenticated');
        // 로그인 성공 시 워크스페이스 확인 및 토큰 조회 시작 (초기에는 workspaceId 없이 호출)
        void fetchUserMcpToken(currentUser.uid);
      } else {
        setUser(null);
        setStatus('unauthenticated');
        setWorkspaceId(null);
        setNeedsWorkspaceSelection(false);
        // 로그아웃 시 저장된 워크스페이스 정보는 유지할지 삭제할지 선택 가능 (여기서는 유지)
        // localStorage.removeItem(WORKSPACE_KEY);
      }
      setReady(true);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = refresh();

    const unsubscribeDeepLink = ipcBridge.auth.deepLink.on((event) => {
      try {
        if (event && event.type === 'auth' && event.token) {
          console.log('Authenticating with Deep Link Token (Custom Token)...');
          // Custom Token으로 로그인
          signInWithCustomToken(auth, event.token).catch(console.error);
        } else if (event && event.type === 'workspace' && event.workspaceId) {
          console.log(`[DeepLink] Switching to workspace: ${event.workspaceId}`);
          // 워크스페이스 전환 (로그인된 상태에서만 동작)
          if (user) {
            handleWorkspaceSelect(event.workspaceId);
          } else {
            // 로그인되지 않은 경우 localStorage에 저장하여 로그인 후 자동 선택
            localStorage.setItem(WORKSPACE_KEY, event.workspaceId);
            console.log('[DeepLink] User not logged in. Workspace ID saved for later.');
          }
        }
      } catch (e) {
        console.error('Deep Link handling failed:', e);
      }
    });

    // if (window.electronAPI) {
    //   window.electronAPI.on<{ type: string; token: string }>(handleDeepLink);
    // }

    return () => {
      unsubscribe();
      unsubscribeDeepLink();
      // 컴포넌트 언마운트 시 리스너 해제
      if (connectionUnsubscribeRef.current) {
        connectionUnsubscribeRef.current();
        connectionUnsubscribeRef.current = null;
      }
    };
  }, [refresh]);

  const login = useCallback(async ({ username, password, remember }: LoginParams): Promise<LoginResult> => {
    try {
      // Firebase Email/Password 로그인
      await signInWithEmailAndPassword(auth, username, password);

      // onAuthStateChanged가 상태를 업데이트하므로 여기서는 성공 리턴만 함
      return { success: true };
    } catch (error: any) {
      console.error('Login request failed:', error);
      let code: LoginErrorCode = 'unknown';

      // Firebase Error Codes mapping
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        code = 'invalidCredentials';
      } else if (error.code === 'auth/too-many-requests') {
        code = 'tooManyAttempts';
      } else if (error.code === 'auth/network-request-failed') {
        code = 'networkError';
      }

      return {
        success: false,
        message: error.message || 'Login failed',
        code,
      };
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    if (isDesktopRuntime) {
      // 외부 브라우저를 통한 로그인 시작 (Deep Link)
      // TODO: 실제 배포된 웹 서비스의 인증 페이지 URL로 교체 필요
      const authUrl = 'https://neuro.pango-gy.com/auth/electron-login';

      // window.electronAPI.emit은 Promise를 반환할 수 있으므로 await 사용
      // (현재 타입 정의에는 void | Promise<unknown>으로 되어 있음)
      if (window.electronAPI) {
        console.log('in window.electronAPI');
        await ipcBridge.shell.openExternal.invoke(authUrl);
      }

      console.log('Open external browser for Google Login...');
    } else {
      console.warn('Google login is only supported in desktop app via deep link.');
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut(auth);
      setUser(null);
      setStatus('unauthenticated');
      setWorkspaceId(null);
      setWorkspaces([]);
      setNeedsWorkspaceSelection(false);
      localStorage.removeItem(WORKSPACE_KEY);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }, []);

  // 현재 선택된 워크스페이스 (브랜드)
  const currentWorkspace = useMemo(() => {
    return workspaces.find((w) => w.id === workspaceId) || null;
  }, [workspaces, workspaceId]);

  // 워크스페이스 (브랜드) 전환
  const switchWorkspace = useCallback(
    (id: string) => {
      if (user) {
        handleWorkspaceSelect(id);
      }
    },
    [user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      status,
      login,
      logout,
      refresh,
      loginWithGoogle,
      workspaceId,
      setWorkspaceId,
      workspaces,
      currentWorkspace,
      switchWorkspace,
    }),
    [login, logout, ready, refresh, status, user, loginWithGoogle, workspaceId, workspaces, currentWorkspace, switchWorkspace]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {user && (
        <WorkspaceSelectModal
          userId={user.id}
          visible={needsWorkspaceSelection}
          onSelect={handleWorkspaceSelect}
          onCancel={() => {
            setNeedsWorkspaceSelection(false);
            void signOut(auth); // 취소 시 로그아웃
          }}
        />
      )}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
