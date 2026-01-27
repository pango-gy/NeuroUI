import GoogleLogo from '@/renderer/assets/logos/google.svg';
import GoogleAdsLogo from '@/renderer/assets/logos/google_ads.svg';
import GoogleAnalyticsLogo from '@/renderer/assets/logos/google_analytics.svg';
import MetaLogo from '@/renderer/assets/logos/meta.svg';
import NaverLogo from '@/renderer/assets/logos/naver.svg';
import NaverDataLabLogo from '@/renderer/assets/logos/naver_datalab.svg';
import { useMcpServers } from '@/renderer/hooks/mcp/useMcpServers';
import { Tooltip } from '@arco-design/web-react';
import React, { useMemo } from 'react';

// Fallback icon for non-google MCP servers
// We can use a generic icon or initials
const GenericMcpIcon: React.FC<{ name: string }> = ({ name }) => <div className='w-full h-full rounded-full bg-fill-3 flex items-center justify-center text-10px font-bold text-t-secondary border border-border'>{name.slice(0, 2).toUpperCase()}</div>;

export const ConnectedMcpIcons: React.FC = () => {
  const { mcpServers } = useMcpServers();

  const connectedServers = useMemo(() => {
    return mcpServers.filter((server) => server.enabled && server.status === 'connected');
  }, [mcpServers]);

  if (connectedServers.length === 0) {
    return null;
  }

  return (
    <div className='flex items-center group pl-8px'>
      {connectedServers.map((server, index) => {
        // Map common MCP server names to friendly display names and icons
        let displayName = server.name;
        let iconSrc = null;

        if (server.name.includes('google-ads')) {
          displayName = 'Google Ads 연동';
          iconSrc = GoogleAdsLogo;
        } else if (server.name.includes('google-analytics')) {
          displayName = 'Google Analytics 연동';
          iconSrc = GoogleAnalyticsLogo;
        } else if (server.name.includes('naver-ads')) {
          displayName = '네이버 광고 연동';
          iconSrc = NaverLogo;
        } else if (server.name.includes('naver-openapi')) {
          displayName = '네이버 데이터랩 연동';
          iconSrc = NaverDataLabLogo;
        } else if (server.name.includes('meta-ads')) {
          displayName = 'Meta Ads 연동';
          iconSrc = MetaLogo;
        } else if (server.name.toLowerCase().includes('google')) {
          iconSrc = GoogleLogo;
        }

        const icon = iconSrc ? (
          <div className='w-full h-full rounded-full bg-white flex items-center justify-center border border-border'>
            <img src={iconSrc} alt={server.name} className='w-3/5 h-3/5 object-contain' />
          </div>
        ) : (
          <GenericMcpIcon name={server.name} />
        );

        return (
          <Tooltip key={server.id} content={displayName} position='bottom'>
            <div
              className='relative w-28px h-28px rounded-full transition-all duration-300 ease-in-out cursor-pointer hover:z-10 hover:scale-110 border border-solid border-[#C9CDD4] box-content bg-white'
              style={{
                marginLeft: index === 0 ? 0 : '-8px', // Negative margin for stack effect
                zIndex: index, // Reverse stacking: rightmost (higher index) is on top
              }}
            >
              <div className='w-full h-full rounded-full shadow-sm overflow-hidden'>{icon}</div>
            </div>
          </Tooltip>
        );
      })}
      {/* Hover style for expansion - handled via CSS or inline style override on hover is tricky without CSS modules or Tailwind group-hover on parent affecting children */}
      <style>{`
        .group:hover .relative {
          margin-left: 4px !important;
        }
        .group:hover .relative:first-child {
          margin-left: 0 !important;
        }
      `}</style>
    </div>
  );
};
