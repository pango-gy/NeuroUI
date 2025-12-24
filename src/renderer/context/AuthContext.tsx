import { ipcBridge, mcpService } from '@/common';
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
        // DB 구조가 claims 맵 안에 데이터가 있는 형태임
        // query by claims.userId (현재 로그인한 유저 ID 기준 - 더 확실함)
        const mcpTokensQuery = query(collection(db, 'mcpTokens'), where('claims.userId', '==', uid), limit(1));
        const mcpTokenSnapshot = await getDocs(mcpTokensQuery);

        if (!mcpTokenSnapshot.empty) {
          const docData = mcpTokenSnapshot.docs[0].data();
          console.log('!!! AUTH CHECK: Document Found !!!');
          // DB 로그 확인 결과: token은 root에 있음, claims 안에는 userId 등이 있음.
          token = docData.token || docData.claims?.token;

          console.log('[Auth] Retrieved MCP token from Firestore. Docs found:', mcpTokenSnapshot.size);
          console.log('[Auth] MCP Token prefix:', token?.substring(0, 20));
        } else {
          console.warn('[Auth] No MCP token found for workspace:', selectedWorkspaceId);
          console.warn('[Auth] Please verify document matches claims.workspaceId ==', selectedWorkspaceId);
          if (auth.currentUser) {
            token = await auth.currentUser.getIdToken(true);
            console.log('[Auth] Fallback: Generated Firebase ID Token');
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

      // 3. Google Ads 연결 확인 및 MCP 서버 활성화/비활성화 (실시간 리스너)
      try {
        // 기존 리스너 해제
        if (connectionUnsubscribeRef.current) {
          console.log('[Auth] Unsubscribing from connections snapshot listener...');
          connectionUnsubscribeRef.current();
          connectionUnsubscribeRef.current = null;
        }

        if (!selectedWorkspaceId) return;

        // 해당 워크스페이스의 connections 컬렉션 조회
        const connectionsQuery = query(
          collection(db, `workspaces/${selectedWorkspaceId}/connections`),
          where('platform', '==', 'google_ads'),
          limit(1) // 연결이 하나라도 있는지 확인
        );

        const unsubscribe = onSnapshot(connectionsQuery, async (snapshot) => {
          try {
            // isActive 필드까지 확인
            const hasGoogleAdsConnection = !snapshot.empty && snapshot.docs.some((doc) => doc.data().isActive === true);

            if (window.electronAPI) {
              // MCP 설정 읽기
              const mcpConfig = (await ConfigStorage.get('mcp.config')) as IMcpServer[];
              if (Array.isArray(mcpConfig)) {
                let configChanged = false;
                let targetServer: IMcpServer | undefined;

                const newConfig = mcpConfig.map((server) => {
                  if (server.name === 'google-ads-mcp') {
                    targetServer = server;
                    // Google Ads 연결이 있고 토큰도 유효하면 활성화
                    const shouldEnable = hasGoogleAdsConnection && !!token;
                    if (server.enabled !== shouldEnable) {
                      configChanged = true;
                      server = { ...server, enabled: shouldEnable };
                      targetServer = server;
                    }
                  }
                  return server;
                });

                if (configChanged) {
                  await ConfigStorage.set('mcp.config', newConfig);
                  window.dispatchEvent(new Event('mcp-config-changed'));
                  console.log(`[Auth] google-ads-mcp ${hasGoogleAdsConnection && !!token ? 'enabled' : 'disabled'}`);
                }

                // check if google-ads-mcp exists
                const existingAdsServer = newConfig.find((s) => s.name === 'google-ads-mcp');

                // Self-Healing: If missing, inject it. If present but wrong transport, fix it.
                if (!existingAdsServer && hasGoogleAdsConnection && !!token) {
                  console.log('[Auth] Injecting missing default config for google-ads-mcp');
                  const newServer = {
                    id: `mcp_default_${Date.now()}_google_ads`,
                    name: 'google-ads-mcp',
                    description: 'Default MCP server: google-ads-mcp',
                    enabled: true,
                    status: 'connected', // GeminiAgentManager가 이 값으로 필터링하므로 필수!
                    transport: {
                      type: 'streamable_http',
                      url: 'https://nsxl30kipc.execute-api.ap-northeast-2.amazonaws.com/dev/mcp',
                      headers: { Authorization: `Bearer ${token}` },
                    },
                    originalJson: JSON.stringify({
                      'google-ads-mcp': {
                        type: 'streamable_http',
                        url: 'https://nsxl30kipc.execute-api.ap-northeast-2.amazonaws.com/dev/mcp',
                        headers: { Authorization: `Bearer ${token}` },
                      },
                    }),
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  } as IMcpServer;

                  newConfig.push(newServer);
                  targetServer = newServer;
                  configChanged = true;

                  // Save immediately for self-healing
                  await ConfigStorage.set('mcp.config', newConfig);
                  window.dispatchEvent(new Event('mcp-config-changed'));

                  // 자동으로 연결 테스트하여 도구 목록 가져오기
                  console.log('[Auth] Auto-testing connection for google-ads-mcp...');
                  try {
                    const testResult = await mcpService.testMcpConnection.invoke(newServer);
                    if (testResult.success && testResult.data?.success && testResult.data?.tools) {
                      // 도구 목록 업데이트
                      newServer.tools = testResult.data.tools.map((tool: any) => ({ name: tool.name, description: tool.description }));
                      newServer.lastConnected = Date.now();
                      await ConfigStorage.set('mcp.config', newConfig);
                      window.dispatchEvent(new Event('mcp-config-changed'));
                      console.log('[Auth] google-ads-mcp tools loaded:', testResult.data.tools.length);
                    }
                  } catch (testError) {
                    console.error('[Auth] Failed to test google-ads-mcp connection:', testError);
                  }
                } else if (existingAdsServer && hasGoogleAdsConnection && !!token) {
                  // Auto-Correction: Fix legacy/wrong transport type OR stale/invalid token
                  const currentAuthHeader = (existingAdsServer.transport as any).headers?.Authorization;
                  const expectedAuthHeader = `Bearer ${token}`;

                  if (existingAdsServer.transport.type !== 'streamable_http' || currentAuthHeader !== expectedAuthHeader) {
                    console.log('[Auth] Auto-correcting google-ads-mcp: Updating transport/token');

                    // Update transport type
                    (existingAdsServer.transport as any).type = 'streamable_http';

                    // Update URL just in case
                    if ('url' in existingAdsServer.transport) {
                      (existingAdsServer.transport as any).url = 'https://nsxl30kipc.execute-api.ap-northeast-2.amazonaws.com/dev/mcp';
                    }

                    // Update Token (CRITICAL FIX)
                    // Update Token (CRITICAL FIX)
                    // Cast to any to avoid TS error about headers not existing on union type
                    const transportAny = existingAdsServer.transport as any;
                    if (!transportAny.headers) {
                      transportAny.headers = {};
                    }

                    console.log('[Auth] Updating Authorization header. Token length:', token?.length);
                    console.log('[Auth] Token prefix:', token?.substring(0, 20));
                    console.log('[Auth] User metadata:', user?.id, user?.email);
                    transportAny.headers.Authorization = expectedAuthHeader;

                    // Update originalJson to match
                    try {
                      const json = JSON.parse(existingAdsServer.originalJson || '{}');
                      if (json['google-ads-mcp']) {
                        json['google-ads-mcp'].type = 'streamable_http';
                        json['google-ads-mcp'].headers = { Authorization: expectedAuthHeader };
                        existingAdsServer.originalJson = JSON.stringify(json);
                      }
                    } catch (e) {
                      // ignore json parse error
                    }

                    targetServer = existingAdsServer;
                    configChanged = true;

                    // Save immediately for auto-correction
                    await ConfigStorage.set('mcp.config', newConfig);
                    window.dispatchEvent(new Event('mcp-config-changed'));

                    // 자동으로 연결 테스트하여 도구 목록 가져오기
                    console.log('[Auth] Auto-testing connection for google-ads-mcp (after correction)...');
                    try {
                      const testResult = await mcpService.testMcpConnection.invoke(existingAdsServer);
                      if (testResult.success && testResult.data?.success && testResult.data?.tools) {
                        existingAdsServer.tools = testResult.data.tools.map((tool: any) => ({ name: tool.name, description: tool.description }));
                        existingAdsServer.lastConnected = Date.now();
                        await ConfigStorage.set('mcp.config', newConfig);
                        window.dispatchEvent(new Event('mcp-config-changed'));
                        console.log('[Auth] google-ads-mcp tools reloaded:', testResult.data.tools.length);
                      }
                    } catch (testError) {
                      console.error('[Auth] Failed to test google-ads-mcp connection:', testError);
                    }
                  } else {
                    targetServer = existingAdsServer;
                  }
                } else if (!targetServer) {
                  // If it wasn't injected above, try to find it again (though finding logic above covers this, this is for safety if logic changes)
                  targetServer = newConfig.find((s) => s.name === 'google-ads-mcp');
                }

                if (token && targetServer) {
                  // enabled 상태에 따라 동기화 또는 제거
                  if (targetServer.enabled) {
                    console.log('[Auth] Syncing MCP credentials to agents for google-ads-mcp...');
                    try {
                      const agentsResponse = await ipcBridge.acpConversation.getAvailableAgents.invoke();
                      if (agentsResponse.success && agentsResponse.data) {
                        const syncResponse = await ipcBridge.mcpService.syncMcpToAgents.invoke({
                          mcpServers: [targetServer],
                          agents: agentsResponse.data,
                        });
                        console.log('[Auth] MCP sync completed:', syncResponse);
                      } else {
                        console.warn('[Auth] Failed to get available agents for MCP sync');
                      }
                    } catch (syncError) {
                      console.error('[Auth] Error during MCP sync:', syncError);
                    }
                  } else {
                    // enabled가 false인 경우 에이전트에서 제거
                    console.log('[Auth] Removing google-ads-mcp from agents (connection not active or no token)...');
                    try {
                      const agentsResponse = await ipcBridge.acpConversation.getAvailableAgents.invoke();
                      if (agentsResponse.success && agentsResponse.data) {
                        const removeResponse = await ipcBridge.mcpService.removeMcpFromAgents.invoke({
                          mcpServerName: 'google-ads-mcp',
                          agents: agentsResponse.data,
                        });
                        console.log('[Auth] MCP removal completed:', removeResponse);
                      }
                    } catch (removeError) {
                      console.error('[Auth] Error during MCP removal:', removeError);
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
        console.error('[Auth] Failed to check Google Ads connection (step 3):', e);
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
