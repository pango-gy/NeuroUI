/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import { usePasteService } from '@/renderer/hooks/usePasteService';
import { useCallback, useState } from 'react';
import type { DuplicateConfirmState, MessageApi, PasteConfirmState, SelectedNodeRef } from '../types';
import { getTargetFolderPath } from '../utils/treeHelpers';

interface UseWorkspacePasteOptions {
  workspace: string;
  messageApi: MessageApi;
  t: (key: string, options?: Record<string, string>) => string;

  // Dependencies from useWorkspaceTree
  files: IDirOrFile[];
  selected: string[];
  selectedNodeRef: React.MutableRefObject<SelectedNodeRef | null>;
  refreshWorkspace: () => void;

  // Dependencies from useWorkspaceModals
  pasteConfirm: PasteConfirmState;
  setPasteConfirm: React.Dispatch<React.SetStateAction<PasteConfirmState>>;
  closePasteConfirm: () => void;
}

/**
 * useWorkspacePaste - 处理文件粘贴和添加逻辑
 * Handle file paste and add logic
 */
export function useWorkspacePaste(options: UseWorkspacePasteOptions) {
  const { workspace, messageApi, t, files, selected, selectedNodeRef, refreshWorkspace, pasteConfirm, setPasteConfirm, closePasteConfirm } = options;

  // 跟踪粘贴目标文件夹（用于视觉反馈）
  // Track paste target folder (for visual feedback)
  const [pasteTargetFolder, setPasteTargetFolder] = useState<string | null>(null);

  // 중복 파일 확인 모달 상태
  const [duplicateConfirm, setDuplicateConfirm] = useState<DuplicateConfirmState>({
    visible: false,
    duplicateFiles: [],
    originalFilePaths: [],
    targetWorkspace: '',
  });

  // 중복 파일 확인 모달 닫기
  const closeDuplicateConfirm = useCallback(() => {
    setDuplicateConfirm({
      visible: false,
      duplicateFiles: [],
      originalFilePaths: [],
      targetWorkspace: '',
    });
  }, []);

  // 중복 파일 교체 핸들러
  const handleDuplicateReplace = useCallback(async () => {
    try {
      const { originalFilePaths, targetWorkspace } = duplicateConfirm;

      // overwrite: true로 다시 호출
      const res = await ipcBridge.fs.copyFilesToWorkspace.invoke({
        filePaths: originalFilePaths,
        workspace: targetWorkspace,
        overwrite: true,
      });

      const copiedFiles = res.data?.copiedFiles ?? [];
      const failedFiles = res.data?.failedFiles ?? [];

      if (copiedFiles.length > 0) {
        messageApi.success(t('messages.responseSentSuccessfully') || 'Replaced');
        setTimeout(() => refreshWorkspace(), 300);
      }

      if (!res.success || failedFiles.length > 0) {
        const fallback = failedFiles.length > 0 ? 'Some files failed to copy' : res.msg;
        messageApi.warning(fallback || t('messages.unknownError') || 'Replace failed');
      }
    } catch (error) {
      messageApi.error(t('messages.unknownError') || 'Replace failed');
    } finally {
      closeDuplicateConfirm();
      setPasteTargetFolder(null);
    }
  }, [duplicateConfirm, closeDuplicateConfirm, messageApi, t, refreshWorkspace]);

  /**
   * 添加文件（从文件系统选择器）
   * Add files (from file system picker)
   */
  const handleAddFiles = useCallback(() => {
    ipcBridge.dialog.showOpen
      .invoke({
        properties: ['openFile', 'multiSelections'],
        defaultPath: workspace,
      })
      .then((selectedFiles) => {
        if (selectedFiles && selectedFiles.length > 0) {
          return ipcBridge.fs.copyFilesToWorkspace.invoke({ filePaths: selectedFiles, workspace }).then((result) => {
            const copiedFiles = result.data?.copiedFiles ?? [];
            const failedFiles = result.data?.failedFiles ?? [];
            const skippedFiles = result.data?.skippedFiles ?? [];

            if (copiedFiles.length > 0) {
              setTimeout(() => {
                refreshWorkspace();
              }, 300);
            }

            // 중복 파일이 있으면 확인 모달 표시
            if (skippedFiles.length > 0) {
              // 중복된 파일의 원본 경로 찾기
              const duplicateOriginalPaths = selectedFiles.filter((filePath) => {
                const fileName = filePath.split(/[\\/]/).pop() || '';
                return skippedFiles.includes(fileName);
              });

              setDuplicateConfirm({
                visible: true,
                duplicateFiles: skippedFiles,
                originalFilePaths: duplicateOriginalPaths,
                targetWorkspace: workspace,
              });
            }

            if (!result.success || failedFiles.length > 0) {
              const fallback = failedFiles.length > 0 ? 'Some files failed to copy' : result.msg;
              messageApi.warning(fallback || t('messages.unknownError') || 'Copy failed');
            }
          });
        }
      })
      .catch(() => {
        // Silently ignore errors
      });
  }, [workspace, refreshWorkspace, messageApi, t]);

  /**
   * 处理文件粘贴（从粘贴服务）
   * Handle files to add (from paste service)
   */
  const handleFilesToAdd = useCallback(
    async (filesMeta: { name: string; path: string }[]) => {
      if (!filesMeta || filesMeta.length === 0) return;

      // 使用工具函数获取目标文件夹路径 / Use utility function to get target folder path
      const targetFolder = getTargetFolderPath(selectedNodeRef.current, selected, files, workspace);
      const targetFolderPath = targetFolder.fullPath;
      const targetFolderKey = targetFolder.relativePath;

      // 设置粘贴目标文件夹以提供视觉反馈 / Set paste target folder for visual feedback
      if (targetFolderKey) {
        setPasteTargetFolder(targetFolderKey);
      }

      // 如果用户已禁用确认，直接执行复制 / If user has disabled confirmation, perform copy directly
      const skipConfirm = await ConfigStorage.get('workspace.pasteConfirm');
      if (skipConfirm) {
        try {
          const filePaths = filesMeta.map((f) => f.path);
          const res = await ipcBridge.fs.copyFilesToWorkspace.invoke({ filePaths, workspace: targetFolderPath });
          const copiedFiles = res.data?.copiedFiles ?? [];
          const failedFiles = res.data?.failedFiles ?? [];
          const skippedFiles = res.data?.skippedFiles ?? [];

          if (copiedFiles.length > 0) {
            messageApi.success(t('messages.responseSentSuccessfully') || 'Pasted');
            setTimeout(() => refreshWorkspace(), 300);
          }

          // 중복 파일이 있으면 확인 모달 표시
          if (skippedFiles.length > 0) {
            const duplicateOriginalPaths = filePaths.filter((filePath) => {
              const fileName = filePath.split(/[\\/]/).pop() || '';
              return skippedFiles.includes(fileName);
            });

            setDuplicateConfirm({
              visible: true,
              duplicateFiles: skippedFiles,
              originalFilePaths: duplicateOriginalPaths,
              targetWorkspace: targetFolderPath,
            });
          }

          if (!res.success || failedFiles.length > 0) {
            const fallback = failedFiles.length > 0 ? 'Some files failed to copy' : res.msg;
            messageApi.warning(fallback || t('messages.unknownError') || 'Paste failed');
          }
        } catch (error) {
          messageApi.error(t('messages.unknownError') || 'Paste failed');
        } finally {
          // 操作完成后重置粘贴目标文件夹（成功或失败都重置）
          // Reset paste target folder after operation completes (success or failure)
          if (!(await ConfigStorage.get('workspace.pasteConfirm'))) {
            setPasteTargetFolder(null);
          }
        }
        return;
      }

      // 否则显示确认对话框 / Otherwise show confirmation modal
      setPasteConfirm({
        visible: true,
        fileName: filesMeta[0].name,
        filesToPaste: filesMeta.map((f) => ({ path: f.path, name: f.name })),
        doNotAsk: false,
        targetFolder: targetFolderKey,
      });
    },
    [workspace, refreshWorkspace, t, messageApi, files, selected, selectedNodeRef, setPasteConfirm]
  );

  /**
   * 确认粘贴操作
   * Confirm paste operation
   */
  const handlePasteConfirm = useCallback(async () => {
    if (!pasteConfirm.filesToPaste || pasteConfirm.filesToPaste.length === 0) return;

    try {
      // 如果用户选中了"不再询问"，保存偏好设置 / Save preference if user checked "do not ask again"
      if (pasteConfirm.doNotAsk) {
        await ConfigStorage.set('workspace.pasteConfirm', true);
      }

      // 获取目标文件夹路径 / Get target folder path
      const targetFolder = getTargetFolderPath(selectedNodeRef.current, selected, files, workspace);
      const targetFolderPath = targetFolder.fullPath;

      const filePaths = pasteConfirm.filesToPaste.map((f) => f.path);
      const res = await ipcBridge.fs.copyFilesToWorkspace.invoke({ filePaths, workspace: targetFolderPath });
      const copiedFiles = res.data?.copiedFiles ?? [];
      const failedFiles = res.data?.failedFiles ?? [];
      const skippedFiles = res.data?.skippedFiles ?? [];

      if (copiedFiles.length > 0) {
        messageApi.success(t('messages.responseSentSuccessfully') || 'Pasted');
        setTimeout(() => refreshWorkspace(), 300);
      }

      // 중복 파일이 있으면 확인 모달 표시
      if (skippedFiles.length > 0) {
        const duplicateOriginalPaths = filePaths.filter((filePath) => {
          const fileName = filePath.split(/[\\/]/).pop() || '';
          return skippedFiles.includes(fileName);
        });

        setDuplicateConfirm({
          visible: true,
          duplicateFiles: skippedFiles,
          originalFilePaths: duplicateOriginalPaths,
          targetWorkspace: targetFolderPath,
        });
      }

      if (!res.success || failedFiles.length > 0) {
        const fallback = failedFiles.length > 0 ? 'Some files failed to copy' : res.msg;
        messageApi.warning(fallback || t('messages.unknownError') || 'Paste failed');
      }

      closePasteConfirm();
    } catch (error) {
      messageApi.error(t('messages.unknownError') || 'Paste failed');
    } finally {
      setPasteTargetFolder(null);
    }
  }, [pasteConfirm, closePasteConfirm, messageApi, t, files, selected, selectedNodeRef, workspace, refreshWorkspace]);

  // 注册粘贴服务以在工作空间组件获得焦点时捕获全局粘贴事件
  // Register paste service to catch global paste events when workspace component is focused
  const { onFocus } = usePasteService({
    // 传递空数组以指示"允许所有文件类型" / Pass empty array to indicate "allow all file types"
    supportedExts: [],
    onFilesAdded: (files) => {
      // files 是来自 PasteService 的 FileMetadata；映射到简单的格式
      // files are FileMetadata from PasteService; map to simple shape
      const meta = files.map((f) => ({ name: f.name, path: f.path }));
      void handleFilesToAdd(meta);
    },
  });

  return {
    pasteTargetFolder,
    handleAddFiles,
    handleFilesToAdd,
    handlePasteConfirm,
    onFocusPaste: onFocus,
    // 중복 파일 확인 관련
    duplicateConfirm,
    closeDuplicateConfirm,
    handleDuplicateReplace,
  };
}
