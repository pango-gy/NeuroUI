/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gem 인터페이스 - Firestore에 저장되는 시스템 프롬프트(Gem) 정의
 * Gem interface - System prompt definition stored in Firestore
 */
export interface IGem {
  id: string;
  name: string; // 예: "마케팅 전문가"
  description?: string; // 선택적 설명
  systemPrompt: string; // 실제 시스템 프롬프트 내용
  icon?: string; // 이모지 아이콘
  isDefault?: boolean; // 새 대화 시 자동 선택 여부
  createdAt: number;
  updatedAt: number;
  createdBy: string; // 생성한 사용자 ID
  order?: number; // 정렬 순서
}

/**
 * Gem 생성/수정 시 사용하는 인터페이스 (id, createdAt 등 자동 생성 필드 제외)
 * Interface for creating/updating Gems (excludes auto-generated fields)
 */
export interface IGemInput {
  name: string;
  description?: string;
  systemPrompt: string;
  icon?: string;
  isDefault?: boolean;
  order?: number;
}

/**
 * 대화에서 선택된 Gem 정보
 * Selected Gem info for conversation
 */
export interface ISelectedGem {
  id: string;
  name: string;
  systemPrompt: string;
}
