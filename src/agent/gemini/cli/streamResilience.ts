/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolCallGuard - 도구 호출 실행 중 취소 방지
 * Prevents tool calls from being cancelled during execution
 */
class ToolCallGuard {
  private protectedCallIds: Set<string> = new Set();
  private completedCallIds: Set<string> = new Set();

  /**
   * 도구 호출을 보호 상태로 등록
   * Register a tool call as protected
   */
  protect(callId: string): void {
    this.protectedCallIds.add(callId);
  }

  /**
   * 도구 호출이 보호 상태인지 확인
   * Check if a tool call is protected
   */
  isProtected(callId: string): boolean {
    return this.protectedCallIds.has(callId);
  }

  /**
   * 도구 호출을 완료 상태로 이동
   * Move a tool call to completed state
   */
  complete(callId: string): void {
    this.protectedCallIds.delete(callId);
    this.completedCallIds.add(callId);
  }

  /**
   * 도구 호출이 완료되었는지 확인
   * Check if a tool call is completed
   */
  isCompleted(callId: string): boolean {
    return this.completedCallIds.has(callId);
  }

  /**
   * 도구 호출 보호 해제
   * Remove protection from a tool call
   */
  unprotect(callId: string): void {
    this.protectedCallIds.delete(callId);
  }

  /**
   * 모든 추적 상태 초기화
   * Reset all tracking state
   */
  clear(): void {
    this.protectedCallIds.clear();
    this.completedCallIds.clear();
  }

  /**
   * 현재 보호 중인 도구 호출 ID 목록
   * Get array of currently protected call IDs
   */
  getProtectedCallIds(): string[] {
    return Array.from(this.protectedCallIds);
  }
}

// 모듈 레벨 싱글톤 인스턴스
// Module-level singleton instance
export const globalToolCallGuard = new ToolCallGuard();
