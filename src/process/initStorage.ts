/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync as _mkdirSync, existsSync, readdirSync, readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { application } from '../common/ipcBridge';
import type { IChatConversationRefer, IConfigStorageRefer, IEnvStorageRefer, IMcpServer } from '../common/storage';
import { ChatMessageStorage, ChatStorage, ConfigStorage, EnvStorage } from '../common/storage';
import { getDatabase } from './database/export';
import { copyDirectoryRecursively, getConfigPath, getDataPath, getTempPath, verifyDirectoryFiles } from './utils';
// 플랫폼 및 아키텍처 타입 (삭제된 updateConfig에서 이동)
type PlatformType = 'win32' | 'darwin' | 'linux';
type ArchitectureType = 'x64' | 'arm64' | 'ia32' | 'arm';

const nodePath = path;

const STORAGE_PATH = {
  config: 'aionui-config.txt',
  chatMessage: 'aionui-chat-message.txt',
  chat: 'aionui-chat.txt',
  env: '.aionui-env',
};

const getHomePage = getConfigPath;

const mkdirSync = (path: string) => {
  return _mkdirSync(path, { recursive: true });
};

/**
 * 이전 버전 데이터를 temp 디렉토리에서 userData/config 디렉토리로 마이그레이션
 */
const migrateLegacyData = async () => {
  const oldDir = getTempPath(); // 이전 temp 디렉토리
  const newDir = getConfigPath(); // 새로운 userData/config 디렉토리

  try {
    // 새 디렉토리가 비어있는지 확인 (존재하지 않거나 내용이 없는 경우)
    const isNewDirEmpty =
      !existsSync(newDir) ||
      (() => {
        try {
          return existsSync(newDir) && readdirSync(newDir).length === 0;
        } catch (error) {
          console.warn('[Neuro] 경고: 마이그레이션 확인 중 새 디렉토리를 읽을 수 없음:', error);
          return false; // 마이그레이션 덮어쓰기 방지를 위해 비어있지 않다고 가정
        }
      })();

    // 마이그레이션 조건 확인: 이전 디렉토리가 존재하고 새 디렉토리가 비어있는 경우
    if (existsSync(oldDir) && isNewDirEmpty) {
      // 대상 디렉토리 생성
      mkdirSync(newDir);

      // 모든 파일과 폴더 복사
      await copyDirectoryRecursively(oldDir, newDir);

      // 마이그레이션 성공 여부 검증
      const isVerified = await verifyDirectoryFiles(oldDir, newDir);
      if (isVerified) {
        // 동일한 디렉토리를 삭제하지 않도록 확인
        if (path.resolve(oldDir) !== path.resolve(newDir)) {
          try {
            await fs.rm(oldDir, { recursive: true });
          } catch (cleanupError) {
            console.warn('[Neuro] 원본 디렉토리 정리 실패, 수동으로 삭제해주세요:', oldDir, cleanupError);
          }
        }
      }

      return true;
    }
  } catch (error) {
    console.error('[Neuro] 데이터 마이그레이션 실패:', error);
  }

  return false;
};

const WriteFile = (path: string, data: string) => {
  return fs.writeFile(path, data);
};

const ReadFile = (path: string) => {
  return fs.readFile(path);
};

const RmFile = (path: string) => {
  return fs.rm(path, { recursive: true });
};

const CopyFile = (src: string, dest: string) => {
  return fs.copyFile(src, dest);
};

const FileBuilder = (file: string) => {
  const stack: (() => Promise<unknown>)[] = [];
  let isRunning = false;
  const run = () => {
    if (isRunning || !stack.length) return;
    isRunning = true;
    void stack
      .shift()?.()
      .finally(() => {
        isRunning = false;
        run();
      });
  };
  const pushStack = <R>(fn: () => Promise<R>) => {
    return new Promise<R>((resolve, reject) => {
      stack.push(() => fn().then(resolve).catch(reject));
      run();
    });
  };
  return {
    path: file,
    write(data: string) {
      return pushStack(() => WriteFile(file, data));
    },
    read() {
      return pushStack(() =>
        ReadFile(file).then((data) => {
          return data.toString();
        })
      );
    },
    copy(dist: string) {
      return pushStack(() => CopyFile(file, dist));
    },
    rm() {
      return pushStack(() => RmFile(file));
    },
  };
};

const JsonFileBuilder = <S extends Record<string, any>>(path: string) => {
  const file = FileBuilder(path);
  const encode = (data: unknown) => {
    return btoa(encodeURIComponent(String(data)));
  };

  const decode = (base64: string) => {
    return decodeURIComponent(atob(base64));
  };

  const toJson = async (): Promise<S> => {
    try {
      const result = await file.read();
      if (!result) return {} as S;

      // 파일 내용이 비어있지 않고 손상된 base64가 아닌지 검증
      if (result.trim() === '') {
        console.warn(`[Storage] 빈 파일 감지됨: ${path}`);
        return {} as S;
      }

      const decoded = decode(result);
      if (!decoded || decoded.trim() === '') {
        console.warn(`[Storage] 디코딩 후 비어있거나 손상된 내용: ${path}`);
        return {} as S;
      }

      const parsed = JSON.parse(decoded) as S;

      // 추가 검증: 채팅 기록 파일이고 파싱 결과가 빈 객체인 경우 사용자에게 경고
      if (path.includes('chat.txt') && Object.keys(parsed).length === 0) {
        console.warn(`[Storage] 채팅 기록 파일이 비어있는 것 같습니다: ${path}`);
      }

      return parsed;
    } catch (e) {
      // console.error(`[Storage] 파일 읽기/파싱 에러 ${path}:`, e);
      return {} as S;
    }
  };

  const setJson = async (data: any): Promise<any> => {
    try {
      await file.write(encode(JSON.stringify(data)));
      return data;
    } catch (e) {
      return Promise.reject(e);
    }
  };

  const toJsonSync = (): S => {
    try {
      return JSON.parse(decode(readFileSync(path).toString())) as S;
    } catch (e) {
      return {} as S;
    }
  };

  return {
    toJson,
    setJson,
    toJsonSync,
    async set<K extends keyof S>(key: K, value: S[K]): Promise<S[K]> {
      const data = await toJson();
      data[key] = value;
      await setJson(data);
      return value;
    },
    async get<K extends keyof S>(key: K): Promise<S[K]> {
      const data = await toJson();
      return Promise.resolve(data[key]);
    },
    async remove<K extends keyof S>(key: K) {
      const data = await toJson();
      delete data[key];
      return setJson(data);
    },
    clear() {
      return setJson({});
    },
    getSync<K extends keyof S>(key: K): S[K] {
      const data = toJsonSync();
      return data[key];
    },
    update<K extends keyof S>(key: K, updateFn: (value: S[K], data: S) => Promise<S[K]>) {
      return toJson().then((data) => {
        return updateFn(data[key], data).then((value) => {
          data[key] = value;
          return setJson(data);
        });
      });
    },
    backup(fullName: string) {
      const dir = nodePath.dirname(fullName);
      if (!existsSync(dir)) {
        mkdirSync(dir);
      }
      return file.copy(fullName).then(() => file.rm());
    },
  };
};

const envFile = JsonFileBuilder<IEnvStorageRefer>(path.join(getHomePage(), STORAGE_PATH.env));

const dirConfig = envFile.getSync('aionui.dir');

const cacheDir = dirConfig?.cacheDir || getHomePage();

const configFile = JsonFileBuilder<IConfigStorageRefer>(path.join(cacheDir, STORAGE_PATH.config));
const _chatMessageFile = JsonFileBuilder(path.join(cacheDir, STORAGE_PATH.chatMessage));
const _chatFile = JsonFileBuilder<IChatConversationRefer>(path.join(cacheDir, STORAGE_PATH.chat));

// 필드 마이그레이션이 포함된 채팅 기록 프록시 생성
const chatFile = {
  ..._chatFile,
  async get<K extends keyof IChatConversationRefer>(key: K): Promise<IChatConversationRefer[K]> {
    const data = await _chatFile.get(key);

    // chat.history의 필드 마이그레이션 특별 처리
    if (key === 'chat.history' && Array.isArray(data)) {
      return data.map((conversation: any) => {
        // model 필드 마이그레이션: selectedModel -> useModel
        if (conversation.model && 'selectedModel' in conversation.model && !('useModel' in conversation.model)) {
          conversation.model = {
            ...conversation.model,
            useModel: conversation.model.selectedModel,
          };
          delete conversation.model.selectedModel;
        }
        return conversation;
      }) as IChatConversationRefer[K];
    }

    return data;
  },
  async set<K extends keyof IChatConversationRefer>(key: K, value: IChatConversationRefer[K]): Promise<IChatConversationRefer[K]> {
    return await _chatFile.set(key, value);
  },
};

const buildMessageListStorage = (conversation_id: string, dir: string) => {
  const fullName = path.join(dir, 'aionui-chat-history', conversation_id + '.txt');
  if (!existsSync(fullName)) {
    mkdirSync(path.join(dir, 'aionui-chat-history'));
  }
  return JsonFileBuilder(path.join(dir, 'aionui-chat-history', conversation_id + '.txt'));
};

const conversationHistoryProxy = (options: typeof _chatMessageFile, dir: string) => {
  return {
    ...options,
    async set(key: string, data: any) {
      const conversation_id = key;
      const storage = buildMessageListStorage(conversation_id, dir);
      return await storage.setJson(data);
    },
    async get(key: string): Promise<any[]> {
      const conversation_id = key;
      const storage = buildMessageListStorage(conversation_id, dir);
      const data = await storage.toJson();
      if (Array.isArray(data)) return data;
      return [];
    },
    backup(conversation_id: string) {
      const storage = buildMessageListStorage(conversation_id, dir);
      return storage.backup(path.join(dir, 'aionui-chat-history', 'backup', conversation_id + '_' + Date.now() + '.txt'));
    },
  };
};

const chatMessageFile = conversationHistoryProxy(_chatMessageFile, cacheDir);

/**
 * 기본 MCP 서버 설정 생성
 */
const getDefaultMcpServers = (): IMcpServer[] => {
  const now = Date.now();

  const servers = [
    {
      name: 'chrome-devtools',
      config: {
        command: 'npx',
        args: ['-y', 'chrome-devtools-mcp@latest'],
      },
      transportType: 'stdio' as const,
    },
    {
      name: 'google-ads-mcp',
      description: 'Google Ads MCP Server',
      config: {
        url: 'https://nsxl30kipc.execute-api.ap-northeast-2.amazonaws.com/dev/mcp',
        headers: {
          Authorization: 'Bearer <token>',
        },
      },
      transportType: 'http' as const,
    },
  ];

  return servers.map((server, index) => {
    let transport: any;

    if (server.transportType === 'stdio') {
      transport = {
        type: 'stdio',
        command: server.config.command,
        args: server.config.args,
      };
    } else {
      transport = {
        type: server.transportType,
        url: server.config.url,
        headers: server.config.headers,
      };
    }

    return {
      id: `mcp_default_${now}_${index}`,
      name: server.name,
      description: server.description || `기본 MCP 서버: ${server.name}`,
      enabled: false,
      transport,
      createdAt: now,
      updatedAt: now,
      originalJson: JSON.stringify({ [server.name]: { ...server.config, type: server.transportType } }, null, 2),
    };
  });
};

const initStorage = async () => {
  console.log('[Neuro] 스토리지 초기화 시작...');

  // 1. 먼저 데이터 마이그레이션 실행 (디렉토리 생성 전에)
  await migrateLegacyData();

  // 2. 필요한 디렉토리 생성 (마이그레이션 후에 생성하여 정상적인 마이그레이션 보장)
  if (!existsSync(getHomePage())) {
    mkdirSync(getHomePage());
  }
  if (!existsSync(getDataPath())) {
    mkdirSync(getDataPath());
  }

  // 3. 스토리지 시스템 초기화
  ConfigStorage.interceptor(configFile);
  ChatStorage.interceptor(chatFile);
  ChatMessageStorage.interceptor(chatMessageFile);
  EnvStorage.interceptor(envFile);

  // 4. MCP 설정 초기화 (모든 사용자에게 기본 설정 제공)
  try {
    const existingMcpConfig = await configFile.get('mcp.config').catch((): undefined => undefined);

    // 설정이 존재하지 않거나 비어있을 때만 기본값 작성 (신규 및 기존 사용자 모두 적용)
    if (!existingMcpConfig || !Array.isArray(existingMcpConfig) || existingMcpConfig.length === 0) {
      const defaultServers = getDefaultMcpServers();
      await configFile.set('mcp.config', defaultServers);
      console.log('[Neuro] 기본 MCP 서버 초기화 완료');
    }
  } catch (error) {
    console.error('[Neuro] 기본 MCP 서버 초기화 실패:', error);
  }
  // 5. 데이터베이스 초기화 (better-sqlite3)
  try {
    getDatabase();
  } catch (error) {
    console.error('[InitStorage] 데이터베이스 초기화 실패, 파일 기반 스토리지로 폴백:', error);
  }

  application.systemInfo.provider(() => {
    return Promise.resolve(getSystemDir());
  });
};

export const ProcessConfig = configFile;

export const ProcessChat = chatFile;

export const ProcessChatMessage = chatMessageFile;

export const ProcessEnv = envFile;

export const getSystemDir = () => {
  return {
    cacheDir: cacheDir,
    workDir: dirConfig?.workDir || getDataPath(),
    platform: process.platform as PlatformType,
    arch: process.arch as ArchitectureType,
  };
};

export default initStorage;
