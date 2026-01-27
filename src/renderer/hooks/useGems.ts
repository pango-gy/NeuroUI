/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IGem, IGemInput } from '@/common/types/gems';
import { db } from '@/renderer/config/firebase';
import { useAuth } from '@/renderer/context/AuthContext';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';

/**
 * useGems hook - Firestore에서 Gems 데이터를 가져오고 관리하는 hook
 * useGems hook - Fetch and manage Gems data from Firestore
 */
export function useGems() {
  const { workspaceId, user } = useAuth();
  const [gems, setGems] = useState<IGem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Firestore 실시간 리스너 설정 / Set up Firestore real-time listener
  useEffect(() => {
    if (!workspaceId || !db) {
      setGems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const gemsQuery = query(collection(db, `workspaces/${workspaceId}/gems`), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      gemsQuery,
      (snapshot) => {
        const gemsList = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as IGem[];
        setGems(gemsList);
        setLoading(false);
      },
      (err) => {
        console.error('[useGems] Error fetching gems:', err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [workspaceId]);

  // Gem 생성 / Create Gem
  const createGem = useCallback(
    async (input: IGemInput): Promise<IGem | null> => {
      if (!workspaceId || !db || !user) {
        setError('Workspace or user not available');
        return null;
      }

      try {
        const now = Date.now();
        // undefined 값 제거 (Firestore는 undefined를 허용하지 않음)
        // Remove undefined values (Firestore doesn't accept undefined)
        const cleanInput: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(input)) {
          if (value !== undefined) {
            cleanInput[key] = value;
          }
        }

        const newGem = {
          ...cleanInput,
          createdAt: now,
          updatedAt: now,
          createdBy: user.id,
          order: input.order ?? gems.length,
        };

        const docRef = await addDoc(collection(db, `workspaces/${workspaceId}/gems`), newGem);

        return {
          id: docRef.id,
          ...newGem,
        } as IGem;
      } catch (err) {
        console.error('[useGems] Error creating gem:', err);
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [workspaceId, user, gems.length]
  );

  // Gem 수정 / Update Gem
  const updateGem = useCallback(
    async (gemId: string, input: Partial<IGemInput>): Promise<boolean> => {
      if (!workspaceId || !db) {
        setError('Workspace not available');
        return false;
      }

      try {
        // undefined 값 제거 (Firestore는 undefined를 허용하지 않음)
        // Remove undefined values (Firestore doesn't accept undefined)
        const cleanInput: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(input)) {
          if (value !== undefined) {
            cleanInput[key] = value;
          }
        }

        const gemRef = doc(db, `workspaces/${workspaceId}/gems`, gemId);
        await updateDoc(gemRef, {
          ...cleanInput,
          updatedAt: Date.now(),
        });
        return true;
      } catch (err) {
        console.error('[useGems] Error updating gem:', err);
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [workspaceId]
  );

  // Gem 삭제 / Delete Gem
  const deleteGem = useCallback(
    async (gemId: string): Promise<boolean> => {
      if (!workspaceId || !db) {
        setError('Workspace not available');
        return false;
      }

      try {
        const gemRef = doc(db, `workspaces/${workspaceId}/gems`, gemId);
        await deleteDoc(gemRef);
        return true;
      } catch (err) {
        console.error('[useGems] Error deleting gem:', err);
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [workspaceId]
  );

  // 기본 Gem 가져오기 / Get default Gem
  const getDefaultGem = useCallback((): IGem | null => {
    return gems.find((gem) => gem.isDefault) || null;
  }, [gems]);

  // ID로 Gem 가져오기 / Get Gem by ID
  const getGemById = useCallback(
    (gemId: string): IGem | null => {
      return gems.find((gem) => gem.id === gemId) || null;
    },
    [gems]
  );

  return {
    gems,
    loading,
    error,
    createGem,
    updateGem,
    deleteGem,
    getDefaultGem,
    getGemById,
  };
}
