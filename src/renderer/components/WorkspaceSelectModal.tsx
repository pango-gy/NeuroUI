import { db } from '@/renderer/config/firebase';
import { Input, Spin } from '@arco-design/web-react';
import { Right, Search } from '@icon-park/react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import AionModal from './base/AionModal';

export interface Workspace {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt: any;
  updatedAt: any;
}

interface WorkspaceSelectModalProps {
  userId: string;
  visible: boolean;
  onSelect: (workspaceId: string) => void;
  onCancel: () => void;
}

const WorkspaceSelectModal: React.FC<WorkspaceSelectModalProps> = ({ userId, visible, onSelect, onCancel }) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    if (visible && userId) {
      const fetchWorkspaces = async () => {
        setLoading(true);
        try {
          const q = query(collection(db, 'workspaces'), where('userId', '==', userId));
          const snapshot = await getDocs(q);
          const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Workspace);
          setWorkspaces(list);

          // 워크스페이스가 1개뿐이라면 자동 선택
          if (list.length === 1) {
            onSelect(list[0].id);
          }
        } catch (error) {
          console.error('Failed to fetch workspaces:', error);
        } finally {
          setLoading(false);
        }
      };
      void fetchWorkspaces();
    }
  }, [visible, userId, onSelect]);

  // Reset search when modal closes
  useEffect(() => {
    if (!visible) {
      setSearchText('');
    }
  }, [visible]);

  // Filter workspaces based on search text
  const filteredWorkspaces = useMemo(() => {
    if (!searchText.trim()) return workspaces;
    const lowerSearch = searchText.toLowerCase();
    return workspaces.filter((ws) => ws.name.toLowerCase().includes(lowerSearch) || (ws.description && ws.description.toLowerCase().includes(lowerSearch)));
  }, [workspaces, searchText]);

  return (
    <AionModal
      visible={visible && workspaces.length > 1}
      header='Select Workspace'
      footer={null}
      onCancel={onCancel}
      alignCenter
      style={{
        width: '480px',
        maxHeight: '70vh',
      }}
    >
      <Spin loading={loading} style={{ width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Search input - only show when there are many workspaces */}
          {workspaces.length > 5 && (
            <div style={{ marginBottom: '16px', flexShrink: 0 }}>
              <Input placeholder='워크스페이스 검색...' value={searchText} onChange={(value) => setSearchText(value)} allowClear prefix={<Search theme='outline' size='14' fill='var(--color-text-3)' />} style={{ borderRadius: '8px' }} />
            </div>
          )}

          {/* Scrollable workspace list */}
          <div
            style={{
              maxHeight: '400px',
              overflowY: 'auto',
              marginRight: '-8px',
              paddingRight: '8px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredWorkspaces.map((item) => (
                <button
                  key={item.id}
                  type='button'
                  onClick={() => onSelect(item.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    border: '1px solid var(--color-border-2)',
                    backgroundColor: 'var(--color-bg-2)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-fill-2)';
                    e.currentTarget.style.borderColor = 'rgb(var(--primary-6))';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-bg-2)';
                    e.currentTarget.style.borderColor = 'var(--color-border-2)';
                  }}
                >
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: '15px',
                        color: 'var(--color-text-1)',
                        marginBottom: item.description ? '4px' : 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.name}
                    </div>
                    {item.description && (
                      <div
                        style={{
                          color: 'var(--color-text-3)',
                          fontSize: '13px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {item.description}
                      </div>
                    )}
                  </div>

                  {/* Arrow */}
                  <Right theme='outline' size='16' fill='var(--color-text-3)' style={{ flexShrink: 0, marginLeft: '12px' }} />
                </button>
              ))}
            </div>

            {/* Empty state */}
            {!loading && filteredWorkspaces.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '40px 20px',
                  color: 'var(--color-text-3)',
                }}
              >
                {searchText ? (
                  <div>
                    <div style={{ fontSize: '14px', marginBottom: '8px' }}>검색 결과가 없습니다</div>
                    <div style={{ fontSize: '12px' }}>다른 키워드로 검색해 보세요</div>
                  </div>
                ) : (
                  <div>워크스페이스를 찾을 수 없습니다.</div>
                )}
              </div>
            )}
          </div>

          {/* Footer info - workspace count */}
          {workspaces.length > 0 && (
            <div
              style={{
                marginTop: '16px',
                paddingTop: '12px',
                borderTop: '1px solid var(--color-border-2)',
                fontSize: '12px',
                color: 'var(--color-text-3)',
                textAlign: 'center',
                flexShrink: 0,
              }}
            >
              {searchText ? `${filteredWorkspaces.length} / ${workspaces.length}개 워크스페이스` : `총 ${workspaces.length}개 워크스페이스`}
            </div>
          )}
        </div>
      </Spin>
    </AionModal>
  );
};

export default WorkspaceSelectModal;
