# 데스크톱 앱에서 동적으로 뉴로 MCP 서버 관리

현재 데스크톱 앱 코드는 하드코딩됨

```typescript
// 현재 문제점들:
where('platform', '==', 'google_ads'); // ❌ google_ads만 조회
server.name === 'google-ads-mcp'; // ❌ 하드코딩된 서버명
url: 'https://...lambda.../dev/mcp'; // ❌ 하드코딩된 URL
```

향 후 아래와 같이 변경해야함.

```typescript
// 플랫폼 정의
const PLATFORM_CONFIG = {
  google_ads: {
    serverName: 'google-ads-mcp',
    endpoint: 'https://mcp.pango.com/google-ads/mcp',
  },
  naver_ads: {
    serverName: 'naver-ads-mcp',
    endpoint: 'https://mcp.pango.com/naver-ads/mcp',
  },
  meta_ads: {
    serverName: 'meta-ads-mcp',
    endpoint: 'https://mcp.pango.com/meta-ads/mcp',
  },
};

// 모든 연결된 플랫폼 조회
const connectionsQuery = query(
  collection(db, `workspaces/${selectedWorkspaceId}/connections`),
  where('isActive', '==', true) // 활성화된 모든 플랫폼
);

onSnapshot(connectionsQuery, async (snapshot) => {
  const activePlatforms = snapshot.docs.map((doc) => doc.data().platform);
  // ['google_ads', 'naver_ads'] 같은 배열

  // 각 플랫폼에 대해 MCP 서버 설정
  for (const platform of Object.keys(PLATFORM_CONFIG)) {
    const config = PLATFORM_CONFIG[platform];
    const isActive = activePlatforms.includes(platform);

    // MCP 서버 활성화/비활성화 로직
    await updateMcpServer(config.serverName, config.endpoint, isActive, token);
  }
});
```
