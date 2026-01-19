import i18n from '@/renderer/i18n';
import type { FileMetadata } from '@/renderer/services/FileService';
import { getCleanFileName, getCleanFileNames } from '@/renderer/services/FileService';
import type { FileOrFolderItem } from '@/renderer/types/files';
import { emitter } from '@/renderer/utils/emitter';
import { Message } from '@arco-design/web-react';
import { useCallback } from 'react';

/**
 * 파일 경로에서 파일명만 추출하는 유틸리티 함수
 * - aionui 타임스탬프 접미사 제거
 * - 유니코드 정규화 (NFC) 적용 (macOS NFD 문제 해결)
 * Extract filename from file path (removes aionui timestamp suffix, normalizes Unicode)
 */
const getFileName = (filePath: string): string => {
  return getCleanFileName(filePath).normalize('NFC');
};

/**
 * 创建通用的setUploadFile函数
 * 支持函数式更新，避免闭包陷阱
 */
export const createSetUploadFile = (mutate: (fn: (prev: Record<string, unknown> | undefined) => Record<string, unknown>) => void, data: unknown) => {
  return useCallback(
    (uploadFile: string[] | ((prev: string[]) => string[])) => {
      mutate((prev) => {
        // 取出最新的上传文件列表，保证函数式更新正确 / Derive latest upload list to keep functional updates accurate
        const previousUploadFile = Array.isArray(prev?.uploadFile) ? (prev?.uploadFile as string[]) : [];
        const newUploadFile = typeof uploadFile === 'function' ? uploadFile(previousUploadFile) : uploadFile;
        return { ...(prev ?? {}), uploadFile: newUploadFile };
      });
    },
    [data, mutate]
  );
};

interface UseSendBoxFilesProps {
  atPath: Array<string | FileOrFolderItem>;
  uploadFile: string[];
  setAtPath: (atPath: Array<string | FileOrFolderItem>) => void;
  setUploadFile: (uploadFile: string[] | ((prev: string[]) => string[])) => void;
  eventPrefix?: 'gemini' | 'acp' | 'codex';
}

/**
 * 独立的文件格式化工具函数，用于GUID等不需要完整SendBox状态管理的组件
 * Note: files can be full paths, getCleanFileNames will extract filenames
 */
export const formatFilesForMessage = (files: string[]): string => {
  if (files.length > 0) {
    return getCleanFileNames(files)
      .map((v) => `@${v}`)
      .join(' ');
  }
  return '';
};

/**
 * 共享的SendBox文件处理逻辑
 * 消除ACP、Gemini、GUID三个组件间的代码重复
 */
export const useSendBoxFiles = ({ atPath, uploadFile, setAtPath, setUploadFile, eventPrefix }: UseSendBoxFilesProps) => {
  // atPath에서 파일명 추출 (문자열 또는 객체 모두 처리)
  const getAtPathFileNames = useCallback((): Set<string> => {
    const names = new Set<string>();
    for (const item of atPath) {
      if (typeof item === 'string') {
        names.add(getFileName(item));
      } else if (item && item.path) {
        names.add(getFileName(item.path));
      }
    }
    return names;
  }, [atPath]);

  // 处理拖拽或粘贴的文件 (중복 체크 포함 - uploadFile + atPath + workspace 모두 검사, 파일명 기준)
  const handleFilesAdded = useCallback(
    (files: FileMetadata[]) => {
      const filePaths = files.map((file) => file.path);

      // atPath에 있는 파일명도 가져오기
      const atPathFileNames = getAtPathFileNames();

      // workspace 파일 목록 가져오기 (eventPrefix가 있을 경우)
      const processWithWorkspaceFiles = (workspaceFileNames: string[]) => {
        // 使用函数式更新，基于最新状态而不是闭包中的状态
        // 중복 체크를 위해 함수형 업데이트 내부에서 처리
        setUploadFile((prevUploadFile) => {
          // 각각의 중복 원인을 구분
          const uploadFileNames = new Set(prevUploadFile.map(getFileName));
          const attachedFileNames = new Set([...uploadFileNames, ...atPathFileNames]);
          const workspaceFileNamesSet = new Set(workspaceFileNames);

          const newPaths: string[] = [];
          const workspaceDuplicates: string[] = [];
          const attachedDuplicates: string[] = [];

          for (const path of filePaths) {
            const fileName = getFileName(path);
            if (attachedFileNames.has(fileName)) {
              attachedDuplicates.push(path);
            } else if (workspaceFileNamesSet.has(fileName)) {
              workspaceDuplicates.push(path);
            } else {
              newPaths.push(path);
              attachedFileNames.add(fileName); // 새로 추가되는 파일도 중복 체크에 포함
            }
          }

          // 중복 파일이 있으면 알림 표시 (setTimeout으로 상태 업데이트 후 실행)
          if (workspaceDuplicates.length > 0 || attachedDuplicates.length > 0) {
            setTimeout(() => {
              if (workspaceDuplicates.length > 0 && attachedDuplicates.length === 0 && newPaths.length === 0) {
                Message.warning(i18n.t('messages.workspaceAllFilesSkipped'));
              } else if (attachedDuplicates.length > 0 && workspaceDuplicates.length === 0 && newPaths.length === 0) {
                Message.warning(i18n.t('messages.allFilesDuplicate'));
              } else if ((workspaceDuplicates.length > 0 || attachedDuplicates.length > 0) && newPaths.length === 0) {
                Message.warning(i18n.t('messages.allFilesDuplicate'));
              } else if (workspaceDuplicates.length > 0 && newPaths.length > 0) {
                const duplicateNames = workspaceDuplicates.map(getFileName).join(', ');
                Message.warning(i18n.t('messages.workspaceFilesSkipped', { files: duplicateNames }));
              } else if (attachedDuplicates.length > 0 && newPaths.length > 0) {
                const duplicateNames = attachedDuplicates.map(getFileName).join(', ');
                Message.warning(i18n.t('messages.duplicateFilesIgnored', { files: duplicateNames }));
              }
            }, 0);
          }

          // 새로운 파일만 추가
          if (newPaths.length === 0) {
            return prevUploadFile;
          }
          return [...prevUploadFile, ...newPaths];
        });
      };

      // eventPrefix가 있으면 workspace 파일도 체크, 없으면 빈 배열로 처리
      if (eventPrefix) {
        const eventName = `${eventPrefix}.workspace.files.get` as any;

        // 리스너가 없으면 빈 배열로 처리 (workspace 컴포넌트가 마운트되지 않은 경우)
        const listenerCount = emitter.listenerCount(eventName);
        if (listenerCount === 0) {
          processWithWorkspaceFiles([]);
        } else {
          emitter.emit(eventName, (workspaceFileNames: string[]) => {
            processWithWorkspaceFiles(workspaceFileNames);
          });
        }
      } else {
        processWithWorkspaceFiles([]);
      }
    },
    [setUploadFile, getAtPathFileNames, eventPrefix]
  );

  // 处理消息中的文件引用（@文件名 格式）
  // Process file references in messages (format: @filename)
  const processMessageWithFiles = useCallback(
    (message: string): string => {
      if (atPath.length || uploadFile.length) {
        const cleanUploadFiles = getCleanFileNames(uploadFile).map((fileName) => '@' + fileName);
        // atPath 现在可能包含字符串路径或对象，需要分别处理
        // atPath may now contain string paths or objects, need to handle separately
        const atPathStrings = atPath.map((item) => {
          if (typeof item === 'string') {
            return item;
          } else {
            return item.path;
          }
        });
        const cleanAtPaths = getCleanFileNames(atPathStrings).map((fileName) => '@' + fileName);
        return cleanUploadFiles.join(' ') + ' ' + cleanAtPaths.join(' ') + ' ' + message;
      }
      return message;
    },
    [atPath, uploadFile]
  );

  // 清理文件状态
  const clearFiles = useCallback(() => {
    setAtPath([]);
    setUploadFile([]);
  }, [setAtPath, setUploadFile]);

  return {
    handleFilesAdded,
    processMessageWithFiles,
    clearFiles,
  };
};
