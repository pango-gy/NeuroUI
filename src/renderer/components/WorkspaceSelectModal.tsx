import { db } from '@/renderer/config/firebase';
import { Button, List, Spin } from '@arco-design/web-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
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

  return (
    <AionModal visible={visible && workspaces.length > 1} header='Select Workspace' footer={null} onCancel={onCancel} size='small'>
      <Spin loading={loading} style={{ width: '100%' }}>
        <List
          dataSource={workspaces}
          render={(item, index) => (
            <List.Item key={item.id} actionLayout='vertical'>
              <Button type='text' style={{ width: '100%', textAlign: 'left', height: 'auto', padding: '12px' }} onClick={() => onSelect(item.id)}>
                <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{item.name}</div>
                {item.description && <div style={{ color: '#888', fontSize: '12px' }}>{item.description}</div>}
              </Button>
            </List.Item>
          )}
        />
        {!loading && workspaces.length === 0 && <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>No workspaces found.</div>}
      </Spin>
    </AionModal>
  );
};

export default WorkspaceSelectModal;
